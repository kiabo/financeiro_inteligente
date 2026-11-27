import type { Category, ProductService } from '../../../src/modules/core/types.ts';
import { decryptSecret } from '../../crypto/secretBox.ts';
import { getSupabaseAdmin } from '../../supabaseAdmin.ts';
import { getPaymentAdapter } from './adapters/index.ts';
import { upsertPayment, type TransactionStore } from '../history/paymentUpsert.ts';
import { SupabaseTransactionStore } from '../history/supabaseTransactionStore.ts';
import {
  WebhookSignatureError,
  type ConnectionConfig,
  type ConnectionSecrets,
  type NormalizedPaymentEvent,
  type WebhookRequestContext,
} from './types.ts';
import { roundMoney, toISODateBR } from './utils.ts';

/**
 * Núcleo comum de recebimento de webhooks:
 *   1. Localiza a conexão pelo identificador público da URL
 *   2. Decifra o segredo (AES-256-GCM, AAD = tenant_id) e valida a assinatura do provedor
 *   3. Normaliza o evento pelo adaptador do provedor
 *   4. Grava imediatamente em webhook_events — a restrição UNIQUE (connection_id, external_event_id)
 *      garante idempotência: o mesmo evento nunca gera lançamentos duplicados
 *   5. Gera/atualiza os lançamentos e marca o evento como processed (ou failed, para reprocesso manual)
 */

export interface IntegrationConnectionRow {
  id: string;
  tenant_id: string;
  provider: string;
  label: string;
  company_id: string | null;
  account_id: string | null;
  webhook_secret_id: string | null;
  signing_secret_encrypted: string | null;
  credentials_encrypted: string | null;
  config: ConnectionConfig;
  status: 'active' | 'paused' | 'error';
}

export interface PlannedTransactionRow {
  role: 'income' | 'fee' | 'refund';
  tenant_id: string;
  company_id: string;
  account_id: string;
  destination_account_id: null;
  category_id: string | null;
  product_service_id: string | null;
  project_id: null;
  transaction_type: 'income' | 'expense';
  status: 'pending' | 'paid' | 'canceled';
  description: string;
  counterparty_name: string | null;
  amount: number;
  competence_date: string;
  due_date: string;
  payment_date: string | null;
  notes: string;
}

export interface WebhookProcessResult {
  httpStatus: number;
  body: Record<string, unknown>;
}

const clampDescription = (text: string): string => {
  const clean = text.replace(/\s+/g, ' ').trim();
  const value = clean.length >= 2 ? clean : 'Webhook';
  return value.slice(0, 240);
};

export function resolveFeeAmount(normalized: NormalizedPaymentEvent, config: ConnectionConfig): number {
  if (normalized.kind === 'refund') return 0;
  if (normalized.feeAmount !== null && normalized.feeAmount >= 0) return roundMoney(normalized.feeAmount);
  if (normalized.netAmount !== null && normalized.netAmount >= 0) {
    return roundMoney(Math.max(0, normalized.grossAmount - normalized.netAmount));
  }
  const pct = Math.max(0, Number(config.fee_pct ?? 0));
  const fixed = Math.max(0, Number(config.fee_fixed ?? 0));
  return roundMoney(normalized.grossAmount * (pct / 100) + (normalized.grossAmount > 0 ? fixed : 0));
}

function findCategoryByCode(categories: readonly Category[], companyId: string, code: string): string | null {
  return categories.find((c) => c.company_id === companyId && c.code === code)?.id ?? null;
}

export function matchProductFromHint(
  hint: string | null,
  products: readonly ProductService[],
  companyId: string
): ProductService | null {
  if (!hint) return null;
  const h = hint.trim().toUpperCase();
  return (
    products.find(
      (p) =>
        p.is_active &&
        (p.company_id === companyId || p.company_id === null) &&
        (p.analytical_token.toUpperCase() === h || (p.sku_code ?? '').toUpperCase() === h)
    ) ?? null
  );
}

/**
 * Planeja os lançamentos para um evento normalizado (função pura, testável).
 * Receita bruta e taxa do gateway são lançadas separadamente para preservar a margem real.
 */
export function planTransactionsForEvent(params: {
  connection: Pick<IntegrationConnectionRow, 'tenant_id' | 'company_id' | 'account_id' | 'provider' | 'config'>;
  providerName: string;
  normalized: NormalizedPaymentEvent;
  categories: readonly Category[];
  products: readonly ProductService[];
  todayISO: string;
  /** Conta de destino da importação (sobrepõe a conta fixa da conexão) */
  accountId?: string;
  /** Importação de histórico: cancelado/estornado entram como receita `canceled`, sem taxa nem estorno */
  voidAs?: 'canceled' | 'refunded';
}): PlannedTransactionRow[] {
  const { connection, normalized, todayISO } = params;
  const config = connection.config ?? {};
  if (normalized.kind === 'ignored' || normalized.grossAmount <= 0) return [];
  const accountId = params.accountId ?? connection.account_id;
  if (!connection.company_id || !accountId) {
    throw new Error('Conexão sem empresa/conta de destino configurada.');
  }

  const companyId = connection.company_id;
  const counterparty = normalized.counterpartyName?.trim() ? normalized.counterpartyName.trim().slice(0, 160) : null;
  const product =
    matchProductFromHint(normalized.productHint, params.products, companyId) ??
    (config.default_product_service_id
      ? params.products.find((p) => p.id === config.default_product_service_id) ?? null
      : null);

  const revenueCategory =
    config.revenue_category_id ??
    findCategoryByCode(params.categories, companyId, product?.item_type === 'service' ? '1.2' : '1.1');
  const feeCategory = config.fee_category_id ?? findCategoryByCode(params.categories, companyId, '2.2');
  const refundCategory = config.refund_category_id ?? null;

  // Liquidação futura (ex.: D+30 no cartão) fica pendente com vencimento na data de crédito
  const settled = normalized.kind === 'payment_settled' || normalized.kind === 'refund';
  const cashArrived = settled && normalized.settlementDate <= todayISO;
  const status: 'pending' | 'paid' = cashArrived ? 'paid' : 'pending';
  const marker = `webhook:${connection.provider}:${normalized.paymentRef}:${params.voidAs ? 'canceled' : settled ? 'settled' : 'pending'}`;

  // Cancelado/estornado (importação): só a receita, marcada como cancelada — não soma em nenhum saldo
  if (params.voidAs) {
    const label = params.voidAs === 'refunded' ? 'Estornado' : 'Cancelado';
    return [
      {
        role: 'income',
        tenant_id: connection.tenant_id,
        company_id: companyId,
        account_id: accountId,
        destination_account_id: null,
        category_id: revenueCategory,
        product_service_id: product?.id ?? null,
        project_id: null,
        transaction_type: 'income',
        status: 'canceled',
        description: clampDescription(`${params.providerName} [${label}]: ${normalized.description}`),
        counterparty_name: counterparty,
        amount: roundMoney(normalized.grossAmount),
        competence_date: normalized.competenceDate,
        due_date: normalized.settlementDate,
        payment_date: null,
        notes: marker,
      },
    ];
  }

  const base = {
    tenant_id: connection.tenant_id,
    company_id: companyId,
    account_id: accountId,
    destination_account_id: null,
    project_id: null,
    competence_date: normalized.competenceDate,
    due_date: normalized.settlementDate,
    payment_date: status === 'paid' ? normalized.settlementDate : null,
    status,
    notes: marker,
  } as const;

  if (normalized.kind === 'refund') {
    return [
      {
        ...base,
        role: 'refund',
        counterparty_name: counterparty,
        transaction_type: 'expense',
        category_id: refundCategory,
        product_service_id: product?.id ?? null,
        description: clampDescription(`Estorno ${params.providerName}: ${normalized.description}`),
        amount: roundMoney(normalized.grossAmount),
      },
    ];
  }

  const rows: PlannedTransactionRow[] = [
    {
      ...base,
      role: 'income',
      counterparty_name: counterparty,
      transaction_type: 'income',
      category_id: revenueCategory,
      product_service_id: product?.id ?? null,
      description: clampDescription(`${params.providerName}: ${normalized.description}`),
      amount: roundMoney(normalized.grossAmount),
    },
  ];

  const fee = resolveFeeAmount(normalized, config);
  if (fee > 0 && config.record_fee_as_expense !== false) {
    rows.push({
      ...base,
      role: 'fee',
      counterparty_name: null,
      transaction_type: 'expense',
      category_id: feeCategory,
      product_service_id: product?.id ?? null,
      description: clampDescription(`Taxa ${params.providerName}: ${normalized.description}`),
      amount: Math.min(fee, roundMoney(normalized.grossAmount)),
    });
  }

  return rows;
}

// ----------------------------------------------------------------------------
// Persistência
// ----------------------------------------------------------------------------

export function decryptConnectionSecrets(connection: IntegrationConnectionRow): ConnectionSecrets {
  if (!connection.signing_secret_encrypted) {
    throw new Error('Conexão sem segredo de assinatura configurado.');
  }
  const signingSecret = decryptSecret(connection.signing_secret_encrypted, connection.tenant_id);
  let apiAccessToken: string | undefined;
  if (connection.credentials_encrypted) {
    const creds = JSON.parse(decryptSecret(connection.credentials_encrypted, connection.tenant_id)) as {
      api_access_token?: string;
    };
    apiAccessToken = creds.api_access_token || undefined;
  }
  return { signingSecret, apiAccessToken };
}

export async function loadTenantCatalog(tenantId: string): Promise<{ categories: Category[]; products: ProductService[] }> {
  const admin = getSupabaseAdmin();
  const [cats, prods] = await Promise.all([
    admin.from('categories').select('*').eq('tenant_id', tenantId),
    admin.from('products_services').select('*').eq('tenant_id', tenantId),
  ]);
  if (cats.error) throw new Error(cats.error.message);
  if (prods.error) throw new Error(prods.error.message);
  return {
    categories: (cats.data ?? []) as Category[],
    products: (prods.data ?? []) as ProductService[],
  };
}

/** Dependências injetáveis (testes): armazenamento de lançamentos e catálogo do tenant. */
export interface ApplyEventDeps {
  store?: TransactionStore;
  catalog?: { categories: Category[]; products: ProductService[] };
}

/**
 * Aplica o evento normalizado de forma idempotente por **pagamento** (provedor + id do pagamento),
 * independente da conexão e da conta (spec 004): pendente → liquidado atualiza as mesmas linhas,
 * repetição não duplica e estorno não duplica receita já marcada como cancelada.
 * Retorna os IDs dos lançamentos criados/atualizados.
 */
export async function applyNormalizedEvent(
  connection: IntegrationConnectionRow,
  normalized: NormalizedPaymentEvent,
  _currentEventId: string,
  now: Date = new Date(),
  deps: ApplyEventDeps = {}
): Promise<string[]> {
  if (normalized.kind === 'ignored') return [];
  const adapter = getPaymentAdapter(connection.provider);
  const providerName = adapter?.displayName ?? connection.provider;
  const todayISO = toISODateBR(undefined, now);

  const { categories, products } = deps.catalog ?? (await loadTenantCatalog(connection.tenant_id));
  const planned = planTransactionsForEvent({
    connection,
    providerName,
    normalized,
    categories,
    products,
    todayISO,
  });
  if (planned.length === 0) return [];

  const intent = normalized.kind === 'refund' ? 'refund' : normalized.kind === 'payment_settled' ? 'settled' : 'open';
  const outcome = await upsertPayment(deps.store ?? new SupabaseTransactionStore(), {
    tenantId: connection.tenant_id,
    source: connection.provider,
    ref: normalized.paymentRef,
    intent,
    planned: planned.map((row) => ({ ...row })),
  });
  return outcome.ids;
}

function lowerHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

export async function processIncomingWebhook(params: {
  provider: string;
  secretId: string;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | undefined>;
  now?: Date;
}): Promise<WebhookProcessResult> {
  const now = params.now ?? new Date();
  const adapter = getPaymentAdapter(params.provider);
  // Resposta genérica para não revelar quais IDs existem
  const notFound: WebhookProcessResult = { httpStatus: 404, body: { error: 'Endpoint de webhook não encontrado.' } };
  if (!adapter || !/^[a-f0-9]{32}$/.test(params.secretId)) return notFound;

  const admin = getSupabaseAdmin();
  const { data: connData, error: connErr } = await admin
    .from('integration_connections')
    .select('*')
    .eq('webhook_secret_id', params.secretId)
    .maybeSingle();
  if (connErr) return { httpStatus: 500, body: { error: 'Falha temporária.' } };
  const connection = connData as IntegrationConnectionRow | null;
  if (!connection || connection.provider !== params.provider) return notFound;

  let secrets: ConnectionSecrets;
  try {
    secrets = decryptConnectionSecrets(connection);
  } catch {
    return { httpStatus: 500, body: { error: 'Conexão com credenciais inválidas no servidor.' } };
  }

  const ctx: WebhookRequestContext = {
    rawBody: params.rawBody,
    headers: lowerHeaders(params.headers),
    query: params.query,
    now,
  };

  try {
    adapter.verifySignature(ctx, secrets, connection.config ?? {});
  } catch (err) {
    const message = err instanceof WebhookSignatureError ? err.message : 'Assinatura inválida.';
    await admin
      .from('integration_connections')
      .update({ last_error: `Assinatura rejeitada em ${now.toISOString()}: ${message}` })
      .eq('id', connection.id);
    return { httpStatus: 401, body: { error: message } };
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(params.rawBody.toString('utf8') || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('payload');
    payload = parsed as Record<string, unknown>;
  } catch {
    return { httpStatus: 400, body: { error: 'Corpo JSON inválido.' } };
  }

  let resolved;
  try {
    resolved = await adapter.resolve(payload, ctx, secrets, connection.config ?? {});
  } catch (err) {
    // Sem normalização não há id idempotente: devolve 5xx para o provedor reenviar
    return {
      httpStatus: 502,
      body: { error: err instanceof Error ? err.message : 'Falha ao interpretar o evento.' },
    };
  }

  const paused = connection.status === 'paused';
  const { data: eventRow, error: insertErr } = await admin
    .from('webhook_events')
    .insert({
      tenant_id: connection.tenant_id,
      connection_id: connection.id,
      provider: connection.provider,
      external_event_id: resolved.externalEventId.slice(0, 200),
      event_type: resolved.eventType.slice(0, 120),
      status: paused || resolved.normalized.kind === 'ignored' ? 'ignored' : 'received',
      payload: resolved.storedPayload,
      normalized: resolved.normalized,
      error_message: paused ? 'Conexão pausada: evento registrado sem gerar lançamentos.' : resolved.normalized.ignoredReason ?? null,
    })
    .select('id')
    .single();

  if (insertErr) {
    if (insertErr.code === '23505') {
      return { httpStatus: 200, body: { received: true, duplicate: true } };
    }
    return { httpStatus: 500, body: { error: 'Falha ao registrar evento.' } };
  }
  const eventId = (eventRow as { id: string }).id;

  await admin
    .from('integration_connections')
    .update({ last_event_at: now.toISOString() })
    .eq('id', connection.id);

  if (paused || resolved.normalized.kind === 'ignored') {
    return { httpStatus: 200, body: { received: true, processed: false, ignored: true } };
  }

  const outcome = await runEventProcessing(connection, eventId, resolved.normalized, now);
  return { httpStatus: 200, body: { received: true, processed: outcome.ok, transactions: outcome.transactionIds.length } };
}

async function runEventProcessing(
  connection: IntegrationConnectionRow,
  eventId: string,
  normalized: NormalizedPaymentEvent,
  now: Date
): Promise<{ ok: boolean; transactionIds: string[]; error?: string }> {
  const admin = getSupabaseAdmin();
  const { data: current } = await admin.from('webhook_events').select('attempts').eq('id', eventId).single();
  const attempts = Number((current as { attempts?: number } | null)?.attempts ?? 0) + 1;

  try {
    const transactionIds = await applyNormalizedEvent(connection, normalized, eventId, now);
    await admin
      .from('webhook_events')
      .update({
        status: 'processed',
        attempts,
        transaction_ids: transactionIds,
        processed_at: now.toISOString(),
        error_message: null,
      })
      .eq('id', eventId);
    await admin.from('integration_connections').update({ status: connection.status === 'error' ? 'active' : connection.status, last_error: null }).eq('id', connection.id);
    await admin.from('audit_logs').insert({
      tenant_id: connection.tenant_id,
      actor_id: null,
      action: 'webhook.processed',
      entity_type: 'webhook_event',
      entity_id: eventId,
      analytical_token: null,
      metadata: { provider: connection.provider, kind: normalized.kind, transactions: transactionIds.length },
    });
    return { ok: true, transactionIds };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao gerar lançamentos.';
    await admin
      .from('webhook_events')
      .update({ status: 'failed', attempts, error_message: message.slice(0, 500) })
      .eq('id', eventId);
    await admin.from('integration_connections').update({ last_error: message.slice(0, 500) }).eq('id', connection.id);
    return { ok: false, transactionIds: [], error: message };
  }
}

/** Reprocessamento manual (somente eventos failed do próprio tenant). */
export async function reprocessWebhookEvent(tenantId: string, eventId: string): Promise<{ ok: boolean; transactions: number; error?: string }> {
  const admin = getSupabaseAdmin();
  const { data: ev, error } = await admin
    .from('webhook_events')
    .select('id, tenant_id, connection_id, status, normalized')
    .eq('id', eventId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const event = ev as { id: string; connection_id: string; status: string; normalized: NormalizedPaymentEvent | null } | null;
  if (!event) throw new Error('Evento não encontrado.');
  if (event.status !== 'failed') throw new Error('Somente eventos com falha podem ser reprocessados.');
  if (!event.normalized) throw new Error('Evento sem dados normalizados para reprocessar.');

  const { data: conn } = await admin
    .from('integration_connections')
    .select('*')
    .eq('id', event.connection_id)
    .eq('tenant_id', tenantId)
    .single();
  if (!conn) throw new Error('Conexão do evento não encontrada.');

  const outcome = await runEventProcessing(conn as IntegrationConnectionRow, event.id, event.normalized, new Date());
  return { ok: outcome.ok, transactions: outcome.transactionIds.length, error: outcome.error };
}

/**
 * Rotina diária: lançamentos de webhook liquidados com crédito futuro (ex.: cartão D+30)
 * viram "pago" quando a data de crédito chega.
 */
export async function settleMaturedWebhookTransactions(tenantId: string, todayISO: string): Promise<number> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('transactions')
    .select('id, due_date')
    .eq('tenant_id', tenantId)
    .in('status', ['pending', 'overdue'])
    .like('notes', 'webhook:%:settled')
    .lte('due_date', todayISO);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: string; due_date: string }>;
  for (const row of rows) {
    await admin
      .from('transactions')
      .update({ status: 'paid', payment_date: row.due_date })
      .eq('id', row.id)
      .eq('tenant_id', tenantId);
  }
  return rows.length;
}
