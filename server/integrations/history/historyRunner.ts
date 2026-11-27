import type { Category, ProductService } from '../../../src/modules/core/types.ts';
import {
  buildMonthlyWindows,
  validateHistoryPeriod,
  type HistoryProvider,
  type HistoryWindow,
} from '../../../src/modules/integrations/historyPeriod.ts';
import type { NormalizedPaymentEvent } from '../webhooks/types.ts';
import { toISODateBR } from '../webhooks/utils.ts';
import { getPaymentAdapter } from '../webhooks/adapters/index.ts';
import { planTransactionsForEvent, type IntegrationConnectionRow } from '../webhooks/webhookCore.ts';
import { mapAsaasPayment, mapMercadoPagoPayment, toHistoryLogPayload, type HistoryPayment } from './mappers.ts';
import { upsertPayment, type TransactionStore, type UpsertIntent } from './paymentUpsert.ts';
import {
  AsaasClient,
  MercadoPagoClient,
  ProviderError,
  type AsaasCustomerLite,
  type ProviderClientOptions,
} from './providerClients.ts';

/**
 * Executor da importação de histórico (spec 004).
 *
 * Execução em lotes dirigida pelo navegador: `startRun` cria a execução e valida tudo;
 * cada `stepRun` processa **uma página** e grava o progresso (cursor + contadores). Uma falha de página
 * deixa a execução `failed` **com o cursor**: chamar `stepRun` de novo retoma de onde parou.
 * Falha em um pagamento não aborta a página: conta em "erros" (só o id do pagamento, nunca nome de cliente).
 */

type Obj = Record<string, unknown>;

export type RunStatus = 'running' | 'completed' | 'failed' | 'canceled';

export interface RunCursor {
  /** Índice da janela mensal em andamento */
  window: number;
  /** Deslocamento dentro da janela */
  offset: number;
  /** Deslocamento na listagem de clientes (Asaas) */
  customersOffset: number;
}

export interface RunError {
  ref: string;
  message: string;
}

export interface RunRecord {
  id: string;
  tenant_id: string;
  connection_id: string;
  provider: HistoryProvider;
  company_id: string;
  account_id: string;
  period_start: string;
  period_end: string;
  status: RunStatus;
  phase: 'customers' | 'payments';
  cursor: RunCursor;
  /** id do cliente → nome (Asaas); fica só no servidor */
  customers: Record<string, string>;
  count_created: number;
  count_updated: number;
  count_ignored: number;
  count_marked_apart: number;
  count_failed: number;
  errors: RunError[];
  last_error: string | null;
  started_at: string;
  finished_at: string | null;
}

/** Visão da execução devolvida ao navegador (sem cursor interno nem nomes de clientes). */
export interface PublicRun {
  id: string;
  connection_id: string;
  provider: HistoryProvider;
  account_id: string;
  period_start: string;
  period_end: string;
  status: RunStatus;
  phase: 'customers' | 'payments';
  window_index: number;
  window_total: number;
  counts: { created: number; updated: number; ignored: number; marked_apart: number; failed: number };
  errors: RunError[];
  last_error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface RunStore {
  create(run: Omit<RunRecord, 'id'>): Promise<RunRecord>;
  get(tenantId: string, id: string): Promise<RunRecord | null>;
  findRunning(tenantId: string, connectionId: string): Promise<RunRecord | null>;
  update(tenantId: string, id: string, patch: Partial<Omit<RunRecord, 'id' | 'tenant_id'>>): Promise<RunRecord>;
}

export interface HistoryEvent {
  tenant_id: string;
  connection_id: string;
  provider: string;
  external_event_id: string;
  event_type: string;
  status: 'processed' | 'ignored' | 'failed';
  payload: Record<string, unknown>;
  normalized: NormalizedPaymentEvent | null;
  error_message: string | null;
  transaction_ids: string[];
}

export interface EventLog {
  /** Grava o evento com origem "api"; repetido (mesma conexão + id) é ignorado. */
  record(event: HistoryEvent): Promise<void>;
}

export interface HistorySource {
  readonly pageSize: number;
  verifyKey(): Promise<void>;
  /** Só Asaas: lista de clientes (id → nome) antes dos pagamentos */
  listCustomers?(offset: number): Promise<{ items: AsaasCustomerLite[]; hasMore: boolean }>;
  listPayments(window: HistoryWindow, offset: number): Promise<{ items: Obj[]; hasMore: boolean; total: number | null }>;
}

export interface HistoryDeps {
  runs: RunStore;
  txStore: TransactionStore;
  events: EventLog;
  loadCatalog(tenantId: string): Promise<{ categories: Category[]; products: ProductService[] }>;
  getAccount(tenantId: string, accountId: string): Promise<{ id: string; company_id: string } | null>;
  createSource(provider: HistoryProvider, apiKey: string): HistorySource;
  audit(tenantId: string, action: string, entityId: string, metadata: Record<string, unknown>): Promise<void>;
  now(): Date;
}

/** Erro de uso (entrada inválida, conflito...) com o status HTTP sugerido. */
export class HistoryRunError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly run?: PublicRun
  ) {
    super(message);
    this.name = 'HistoryRunError';
  }
}

const MAX_RUN_ERRORS = 50;
const MAX_CUSTOMERS = 20_000;

export function createHistorySource(provider: HistoryProvider, apiKey: string, options: ProviderClientOptions = {}): HistorySource {
  if (provider === 'asaas') {
    const client = new AsaasClient(apiKey, options);
    return {
      pageSize: 100,
      verifyKey: () => client.verifyKey(),
      listCustomers: (offset) => client.listCustomers({ offset }),
      listPayments: async (window, offset) => {
        const page = await client.listPayments({ start: window.start, end: window.end, offset });
        return { items: page.items, hasMore: page.hasMore, total: page.totalCount };
      },
    };
  }
  const client = new MercadoPagoClient(apiKey, options);
  return {
    pageSize: 50,
    verifyKey: () => client.verifyKey(),
    listPayments: async (window, offset) => {
      const page = await client.searchPayments({ start: window.start, end: window.end, offset });
      return { items: page.items, hasMore: page.hasMore, total: page.total };
    },
  };
}

export function toPublicRun(run: RunRecord): PublicRun {
  return {
    id: run.id,
    connection_id: run.connection_id,
    provider: run.provider,
    account_id: run.account_id,
    period_start: run.period_start,
    period_end: run.period_end,
    status: run.status,
    phase: run.phase,
    window_index: Math.min(run.cursor.window, Math.max(0, buildMonthlyWindows(run.period_start, run.period_end).length - 1)),
    window_total: buildMonthlyWindows(run.period_start, run.period_end).length,
    counts: {
      created: run.count_created,
      updated: run.count_updated,
      ignored: run.count_ignored,
      marked_apart: run.count_marked_apart,
      failed: run.count_failed,
    },
    errors: run.errors,
    last_error: run.last_error,
    started_at: run.started_at,
    finished_at: run.finished_at,
  };
}

const isHistoryProvider = (p: string): p is HistoryProvider => p === 'asaas' || p === 'mercadopago';

export async function startRun(
  deps: HistoryDeps,
  params: {
    tenantId: string;
    connection: IntegrationConnectionRow;
    apiKey: string | null;
    accountId: string;
    start: string;
    end: string;
  }
): Promise<PublicRun> {
  const { tenantId, connection } = params;
  if (!isHistoryProvider(connection.provider)) {
    throw new HistoryRunError('A importação de histórico está disponível só para Asaas e Mercado Pago.', 400);
  }
  if (!params.apiKey) {
    throw new HistoryRunError('Configure a chave de API desta conexão antes de importar o histórico.', 400);
  }
  if (!params.accountId) {
    throw new HistoryRunError('Escolha a conta de destino da importação.', 400);
  }
  const todayISO = toISODateBR(undefined, deps.now());
  const period = validateHistoryPeriod({ start: params.start, end: params.end, today: todayISO, provider: connection.provider });
  if (!period.ok) throw new HistoryRunError(period.message, 400);

  const account = await deps.getAccount(tenantId, params.accountId);
  if (!account || !connection.company_id || account.company_id !== connection.company_id) {
    throw new HistoryRunError('A conta de destino precisa ser uma conta da empresa desta conexão.', 400);
  }

  const active = await deps.runs.findRunning(tenantId, connection.id);
  if (active) {
    throw new HistoryRunError('Já existe uma importação em andamento nesta conexão. Retome ou cancele antes de iniciar outra.', 409, toPublicRun(active));
  }

  // Testa a chave com 1 consulta (mensagem clara quando inválida)
  const source = deps.createSource(connection.provider, params.apiKey);
  try {
    await source.verifyKey();
  } catch (err) {
    if (err instanceof ProviderError) throw new HistoryRunError(err.message, err.resumable ? 502 : 400);
    throw err;
  }

  const run = await deps.runs.create({
    tenant_id: tenantId,
    connection_id: connection.id,
    provider: connection.provider,
    company_id: connection.company_id,
    account_id: params.accountId,
    period_start: period.start,
    period_end: period.end,
    status: 'running',
    phase: connection.provider === 'asaas' ? 'customers' : 'payments',
    cursor: { window: 0, offset: 0, customersOffset: 0 },
    customers: {},
    count_created: 0,
    count_updated: 0,
    count_ignored: 0,
    count_marked_apart: 0,
    count_failed: 0,
    errors: [],
    last_error: null,
    started_at: deps.now().toISOString(),
    finished_at: null,
  });
  return toPublicRun(run);
}

const safeMessage = (err: unknown): string => {
  const text = err instanceof Error ? err.message : 'Erro inesperado.';
  return text.replace(/\s+/g, ' ').slice(0, 200);
};

function mapPayment(run: RunRecord, raw: Obj, now: Date): HistoryPayment {
  if (run.provider === 'asaas') {
    const customerId = typeof raw.customer === 'string' ? raw.customer : '';
    return mapAsaasPayment(raw, customerId ? run.customers[customerId] ?? null : null, now);
  }
  return mapMercadoPagoPayment(raw, now);
}

const INTENT: Record<'settled' | 'open' | 'canceled' | 'refunded', UpsertIntent> = {
  settled: 'settled',
  open: 'open',
  canceled: 'void',
  refunded: 'void',
};

/** Processa uma página e devolve a execução atualizada. Falhas de provedor deixam a execução `failed` (retomável). */
export async function stepRun(
  deps: HistoryDeps,
  params: { tenantId: string; runId: string; connection: IntegrationConnectionRow; apiKey: string | null }
): Promise<PublicRun> {
  const { tenantId } = params;
  let run = await deps.runs.get(tenantId, params.runId);
  if (!run || run.connection_id !== params.connection.id) throw new HistoryRunError('Importação não encontrada.', 404);
  if (run.status === 'completed' || run.status === 'canceled') return toPublicRun(run);
  if (!params.apiKey) throw new HistoryRunError('Configure a chave de API desta conexão para continuar.', 400);

  // Retomar: uma execução `failed` volta a `running` (a chave é relida a cada passo, então pode ter sido trocada)
  if (run.status === 'failed') {
    const active = await deps.runs.findRunning(tenantId, run.connection_id);
    if (active && active.id !== run.id) {
      throw new HistoryRunError('Já existe outra importação em andamento nesta conexão.', 409, toPublicRun(active));
    }
    run = await deps.runs.update(tenantId, run.id, { status: 'running', last_error: null });
  }

  const windows = buildMonthlyWindows(run.period_start, run.period_end);
  const source = deps.createSource(run.provider, params.apiKey);
  const now = deps.now();

  try {
    // ---- Fase 1 (Asaas): lista de clientes, uma página por passo
    if (run.phase === 'customers') {
      if (!source.listCustomers) {
        return toPublicRun(await deps.runs.update(tenantId, run.id, { phase: 'payments' }));
      }
      const page = await source.listCustomers(run.cursor.customersOffset);
      const customers = { ...run.customers };
      for (const c of page.items) {
        if (c.name && Object.keys(customers).length < MAX_CUSTOMERS) customers[c.id] = c.name;
      }
      const done = !page.hasMore || page.items.length === 0;
      run = await deps.runs.update(tenantId, run.id, {
        customers,
        phase: done ? 'payments' : 'customers',
        cursor: { ...run.cursor, customersOffset: run.cursor.customersOffset + page.items.length },
      });
      return toPublicRun(run);
    }

    // ---- Fase 2: pagamentos, uma página por passo
    const window = windows[run.cursor.window];
    if (!window) return toPublicRun(await finish(deps, run));

    const page = await source.listPayments(window, run.cursor.offset);
    const { categories, products } = await deps.loadCatalog(tenantId);
    const adapterName = getPaymentAdapter(run.provider)?.displayName ?? run.provider;
    const todayISO = toISODateBR(undefined, now);

    const counts = { created: 0, updated: 0, ignored: 0, marked_apart: 0, failed: 0 };
    const errors = [...run.errors];

    for (const raw of page.items) {
      const mapped = mapPayment(run, raw, now);
      const ref = mapped.normalized.paymentRef;
      const eventBase = {
        tenant_id: tenantId,
        connection_id: run.connection_id,
        provider: run.provider,
        external_event_id: `api:${ref}:${mapped.providerStatus || 'sem-status'}`.slice(0, 200),
        event_type: `payment.${(mapped.providerStatus || 'unknown').toLowerCase()}`,
        payload: toHistoryLogPayload(run.provider, raw),
        normalized: mapped.normalized,
      };

      if (mapped.lifecycle === 'unknown') {
        counts.ignored += 1;
        await deps.events.record({ ...eventBase, status: 'ignored', error_message: mapped.normalized.ignoredReason ?? null, transaction_ids: [] });
        continue;
      }

      try {
        const planned = planTransactionsForEvent({
          connection: params.connection,
          providerName: adapterName,
          normalized: mapped.normalized,
          categories,
          products,
          todayISO,
          accountId: run.account_id,
          voidAs: mapped.lifecycle === 'canceled' ? 'canceled' : mapped.lifecycle === 'refunded' ? 'refunded' : undefined,
        });
        const outcome = await upsertPayment(deps.txStore, {
          tenantId,
          source: run.provider,
          ref,
          intent: INTENT[mapped.lifecycle],
          planned: planned.map((row) => ({ ...row })),
        });
        if (outcome.action === 'created') counts.created += 1;
        else if (outcome.action === 'updated') counts.updated += 1;
        else if (outcome.action === 'marked_apart') counts.marked_apart += 1;
        else counts.ignored += 1;
        await deps.events.record({ ...eventBase, status: 'processed', error_message: null, transaction_ids: outcome.ids });
      } catch (err) {
        counts.failed += 1;
        const message = safeMessage(err);
        if (errors.length < MAX_RUN_ERRORS) errors.push({ ref, message });
        await deps.events.record({ ...eventBase, status: 'failed', error_message: message, transaction_ids: [] });
      }
    }

    // Avança o cursor: mais páginas na janela, ou próxima janela
    const exhausted = !page.hasMore || page.items.length === 0;
    const cursor: RunCursor = exhausted
      ? { ...run.cursor, window: run.cursor.window + 1, offset: 0 }
      : { ...run.cursor, offset: run.cursor.offset + page.items.length };
    run = await deps.runs.update(tenantId, run.id, {
      cursor,
      count_created: run.count_created + counts.created,
      count_updated: run.count_updated + counts.updated,
      count_ignored: run.count_ignored + counts.ignored,
      count_marked_apart: run.count_marked_apart + counts.marked_apart,
      count_failed: run.count_failed + counts.failed,
      errors,
    });
    if (cursor.window >= windows.length) run = await finish(deps, run);
    return toPublicRun(run);
  } catch (err) {
    if (err instanceof ProviderError) {
      // Mantém o cursor e o que já foi importado: "Retomar" continua daqui
      run = await deps.runs.update(tenantId, run.id, { status: 'failed', last_error: err.message });
      return toPublicRun(run);
    }
    throw err;
  }
}

async function finish(deps: HistoryDeps, run: RunRecord): Promise<RunRecord> {
  const done = await deps.runs.update(run.tenant_id, run.id, { status: 'completed', finished_at: deps.now().toISOString(), last_error: null });
  await deps.audit(run.tenant_id, 'integration.history_imported', run.connection_id, {
    provider: run.provider,
    period_start: run.period_start,
    period_end: run.period_end,
    created: done.count_created,
    updated: done.count_updated,
    ignored: done.count_ignored,
    marked_apart: done.count_marked_apart,
    failed: done.count_failed,
  });
  return done;
}

export async function cancelRun(
  deps: HistoryDeps,
  params: { tenantId: string; runId: string }
): Promise<PublicRun> {
  const run = await deps.runs.get(params.tenantId, params.runId);
  if (!run) throw new HistoryRunError('Importação não encontrada.', 404);
  if (run.status === 'completed' || run.status === 'canceled') return toPublicRun(run);
  const updated = await deps.runs.update(params.tenantId, run.id, { status: 'canceled', finished_at: deps.now().toISOString() });
  return toPublicRun(updated);
}

export async function getRun(deps: HistoryDeps, params: { tenantId: string; runId: string }): Promise<PublicRun> {
  const run = await deps.runs.get(params.tenantId, params.runId);
  if (!run) throw new HistoryRunError('Importação não encontrada.', 404);
  return toPublicRun(run);
}
