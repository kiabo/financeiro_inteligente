import express, { type Request, type Response } from 'express';
import { getAuthUser, requireUser } from '../authMiddleware.ts';
import { encryptSecret, hmacSecretForTest, isCredentialsKeyConfigured, randomHex } from './routeHelpers.ts';
import { getSupabaseAdmin, isServerSupabaseConfigured } from '../supabaseAdmin.ts';
import { getPaymentAdapter, listPaymentAdapters } from './webhooks/adapters/index.ts';
import { CUSTOM_DEFAULT_MAPPING, OPEN_FINANCE_DEFAULT_MAPPING } from './webhooks/adapters/customJsonMapping.ts';
import { WEBHOOK_PROVIDERS, type ConnectionConfig, type CustomFieldMapping, type WebhookProviderId } from './webhooks/types.ts';
import {
  decryptConnectionSecrets,
  processIncomingWebhook,
  reprocessWebhookEvent,
  type IntegrationConnectionRow,
} from './webhooks/webhookCore.ts';

const PUBLIC_CONNECTION_COLUMNS =
  'id, tenant_id, provider, label, company_id, account_id, webhook_secret_id, config, status, last_event_at, last_error, created_at, updated_at';

export function resolvePublicBaseUrl(req: Request): string {
  const configured = (process.env.APP_URL ?? '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  return `${req.protocol}://${req.get('host') ?? 'localhost:3000'}`;
}

function sanitizeMapping(raw: unknown, defaults: CustomFieldMapping): CustomFieldMapping | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const m = raw as Record<string, unknown>;
  const str = (k: keyof CustomFieldMapping) =>
    typeof m[k] === 'string' && (m[k] as string).trim() ? (m[k] as string).trim().slice(0, 120) : undefined;
  const list = (k: keyof CustomFieldMapping) =>
    Array.isArray(m[k])
      ? (m[k] as unknown[]).filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim()).slice(0, 20)
      : typeof m[k] === 'string'
        ? (m[k] as string).split(',').map((v) => v.trim()).filter(Boolean).slice(0, 20)
        : undefined;
  return {
    ...defaults,
    event_id_path: str('event_id_path') ?? defaults.event_id_path,
    event_type_path: str('event_type_path') ?? defaults.event_type_path,
    payment_ref_path: str('payment_ref_path') ?? defaults.payment_ref_path,
    amount_path: str('amount_path') ?? defaults.amount_path,
    fee_path: str('fee_path') ?? defaults.fee_path,
    net_path: str('net_path') ?? defaults.net_path,
    date_path: str('date_path') ?? defaults.date_path,
    settlement_date_path: str('settlement_date_path') ?? defaults.settlement_date_path,
    description_path: str('description_path') ?? defaults.description_path,
    status_path: str('status_path') ?? defaults.status_path,
    settled_values: list('settled_values') ?? defaults.settled_values,
    pending_values: list('pending_values') ?? defaults.pending_values,
    refund_values: list('refund_values') ?? defaults.refund_values,
    amount_in_cents: typeof m.amount_in_cents === 'boolean' ? m.amount_in_cents : defaults.amount_in_cents,
    signature_header: str('signature_header')?.toLowerCase() ?? defaults.signature_header,
    signature_encoding: m.signature_encoding === 'base64' ? 'base64' : 'hex',
  };
}

function sanitizeConfig(provider: WebhookProviderId, raw: unknown): ConnectionConfig {
  const c = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const num = (v: unknown, min: number, max: number): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
  };
  const uuidOrNull = (v: unknown): string | null =>
    typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null;

  const config: ConnectionConfig = {
    fee_pct: num(c.fee_pct, 0, 50),
    fee_fixed: num(c.fee_fixed, 0, 1000),
    revenue_category_id: uuidOrNull(c.revenue_category_id),
    fee_category_id: uuidOrNull(c.fee_category_id),
    refund_category_id: uuidOrNull(c.refund_category_id),
    default_product_service_id: uuidOrNull(c.default_product_service_id),
    record_fee_as_expense: c.record_fee_as_expense !== false,
    signature_tolerance_seconds: num(c.signature_tolerance_seconds, 60, 3600),
  };
  if (provider === 'custom_json_mapping') config.mapping = sanitizeMapping(c.mapping, CUSTOM_DEFAULT_MAPPING) ?? CUSTOM_DEFAULT_MAPPING;
  if (provider === 'openfinance_generic') config.mapping = sanitizeMapping(c.mapping, OPEN_FINANCE_DEFAULT_MAPPING) ?? OPEN_FINANCE_DEFAULT_MAPPING;
  return config;
}

function sendError(res: Response, err: unknown, fallbackStatus = 400): void {
  const message = err instanceof Error ? err.message : 'Erro inesperado.';
  res.status(fallbackStatus).json({ error: message });
}

function ensureReady(res: Response): boolean {
  if (!isServerSupabaseConfigured()) {
    res.status(503).json({ error: 'Integrações exigem Supabase configurado no servidor.' });
    return false;
  }
  if (!isCredentialsKeyConfigured()) {
    res.status(503).json({ error: 'Defina CREDENTIALS_ENCRYPTION_KEY no .env do servidor para cifrar os segredos das integrações.' });
    return false;
  }
  return true;
}

/** Monta um evento de teste assinado com o segredo real da conexão (não disponível para Mercado Pago). */
function buildTestRequest(
  provider: WebhookProviderId,
  signingSecret: string,
  config: ConnectionConfig,
  now: Date
): { rawBody: Buffer; headers: Record<string, string> } {
  const stamp = now.getTime();
  if (provider === 'stripe') {
    const body = JSON.stringify({
      id: `evt_test_${stamp}`,
      type: 'payment_intent.succeeded',
      created: Math.floor(stamp / 1000),
      data: {
        object: {
          id: `pi_test_${stamp}`,
          amount_received: 15000,
          currency: 'brl',
          description: 'Evento de teste Vértice',
          metadata: {},
        },
      },
    });
    const t = Math.floor(stamp / 1000);
    return {
      rawBody: Buffer.from(body),
      headers: { 'stripe-signature': `t=${t},v1=${hmacSecretForTest(signingSecret, `${t}.${body}`)}` },
    };
  }
  if (provider === 'asaas') {
    const body = JSON.stringify({
      id: `evt_test_${stamp}`,
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: `pay_test_${stamp}`,
        value: 150,
        netValue: 146.01,
        billingType: 'PIX',
        description: 'Evento de teste Vértice',
        paymentDate: now.toISOString().slice(0, 10),
        creditDate: now.toISOString().slice(0, 10),
      },
    });
    return { rawBody: Buffer.from(body), headers: { 'asaas-access-token': signingSecret } };
  }
  // custom_json_mapping / openfinance_generic: monta o corpo seguindo o mapeamento configurado
  const mapping = config.mapping ?? (provider === 'openfinance_generic' ? OPEN_FINANCE_DEFAULT_MAPPING : CUSTOM_DEFAULT_MAPPING);
  const obj: Record<string, unknown> = {};
  const setPath = (path: string | undefined, value: unknown) => {
    if (!path) return;
    const segs = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let cur: Record<string, unknown> = obj;
    segs.forEach((seg, i) => {
      if (i === segs.length - 1) cur[seg] = value;
      else {
        if (!cur[seg] || typeof cur[seg] !== 'object') cur[seg] = {};
        cur = cur[seg] as Record<string, unknown>;
      }
    });
  };
  const today = now.toISOString().slice(0, 10);
  setPath(mapping.event_id_path, `test_${stamp}`);
  setPath(mapping.event_type_path, 'payment.test');
  setPath(mapping.payment_ref_path, `pay_test_${stamp}`);
  setPath(mapping.amount_path, mapping.amount_in_cents ? 15000 : 150);
  setPath(mapping.fee_path, mapping.amount_in_cents ? 399 : 3.99);
  setPath(mapping.date_path, today);
  setPath(mapping.settlement_date_path, today);
  setPath(mapping.description_path, 'Evento de teste Vértice');
  setPath(mapping.status_path, mapping.settled_values?.[0] ?? 'paid');
  const body = JSON.stringify(obj);
  const encoding = mapping.signature_encoding ?? 'hex';
  return {
    rawBody: Buffer.from(body),
    headers: { [(mapping.signature_header ?? 'x-signature').toLowerCase()]: hmacSecretForTest(signingSecret, body, encoding) },
  };
}

export function createWebhookRouter(): express.Router {
  const router = express.Router();

  // ---------------------------------------------------------------------------
  // Endpoint PÚBLICO de recebimento: /api/webhooks/:provider/:secretId
  // ---------------------------------------------------------------------------
  router.post('/webhooks/:provider/:secretId', async (req, res) => {
    if (!isServerSupabaseConfigured()) {
      res.status(503).json({ error: 'Servidor sem Supabase configurado.' });
      return;
    }
    try {
      const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
      const query: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.query)) {
        query[k] = typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined;
      }
      const result = await processIncomingWebhook({
        provider: String(req.params.provider),
        secretId: String(req.params.secretId),
        rawBody,
        headers: req.headers,
        query,
      });
      res.status(result.httpStatus).json(result.body);
    } catch (err) {
      console.error('[Webhook] Erro inesperado:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Falha temporária ao processar webhook.' });
    }
  });

  // ---------------------------------------------------------------------------
  // Gestão autenticada (JWT AAL2)
  // ---------------------------------------------------------------------------
  router.get('/integrations/providers', requireUser, (_req, res) => {
    res.json({
      providers: listPaymentAdapters().map((a) => ({ id: a.provider, name: a.displayName })),
      defaults: { custom_json_mapping: CUSTOM_DEFAULT_MAPPING, openfinance_generic: OPEN_FINANCE_DEFAULT_MAPPING },
      credentialsKeyConfigured: isCredentialsKeyConfigured(),
    });
  });

  router.get('/integrations/connections', requireUser, async (req, res) => {
    if (!isServerSupabaseConfigured()) {
      res.json({ connections: [], baseUrl: resolvePublicBaseUrl(req) });
      return;
    }
    try {
      const user = getAuthUser(req);
      const { data, error } = await getSupabaseAdmin()
        .from('integration_connections')
        .select(PUBLIC_CONNECTION_COLUMNS)
        .eq('tenant_id', user.id)
        .neq('provider', 'google')
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      const baseUrl = resolvePublicBaseUrl(req);
      res.json({
        baseUrl,
        connections: (data ?? []).map((c) => ({
          ...c,
          webhook_url: c.webhook_secret_id ? `${baseUrl}/api/webhooks/${c.provider}/${c.webhook_secret_id}` : null,
        })),
      });
    } catch (err) {
      sendError(res, err, 500);
    }
  });

  router.post('/integrations/connections', requireUser, async (req, res) => {
    if (!ensureReady(res)) return;
    try {
      const user = getAuthUser(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const provider = String(body.provider ?? '') as WebhookProviderId;
      if (!WEBHOOK_PROVIDERS.includes(provider)) throw new Error('Provedor inválido.');
      const label = String(body.label ?? '').trim();
      if (label.length < 2 || label.length > 100) throw new Error('Informe um nome entre 2 e 100 caracteres.');
      const companyId = String(body.company_id ?? '');
      const accountId = String(body.account_id ?? '');
      if (!companyId || !accountId) throw new Error('Selecione a empresa e a conta de destino dos lançamentos.');
      const signingSecret = String(body.signing_secret ?? '').trim();
      if (signingSecret.length < 8) throw new Error('Informe o segredo de assinatura do webhook (mínimo 8 caracteres).');
      const apiAccessToken = String(body.api_access_token ?? '').trim();
      if (provider === 'mercadopago' && !apiAccessToken) {
        throw new Error('Mercado Pago exige o Access Token para consultar os pagamentos (o corpo do webhook não é assinado).');
      }

      const row = {
        tenant_id: user.id,
        provider,
        label,
        company_id: companyId,
        account_id: accountId,
        webhook_secret_id: randomHex(16),
        signing_secret_encrypted: encryptSecret(signingSecret, user.id),
        credentials_encrypted: apiAccessToken
          ? encryptSecret(JSON.stringify({ api_access_token: apiAccessToken }), user.id)
          : null,
        config: sanitizeConfig(provider, body.config),
        status: 'active',
      };
      const admin = getSupabaseAdmin();
      const { data, error } = await admin.from('integration_connections').insert(row).select(PUBLIC_CONNECTION_COLUMNS).single();
      if (error) throw new Error(error.message);
      await admin.from('audit_logs').insert({
        tenant_id: user.id,
        actor_id: user.id,
        action: 'integration.connected',
        entity_type: 'integration_connection',
        entity_id: (data as { id: string }).id,
        metadata: { provider },
      });
      const baseUrl = resolvePublicBaseUrl(req);
      res.status(201).json({
        connection: { ...data, webhook_url: `${baseUrl}/api/webhooks/${provider}/${row.webhook_secret_id}` },
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.patch('/integrations/connections/:id', requireUser, async (req, res) => {
    if (!ensureReady(res)) return;
    try {
      const user = getAuthUser(req);
      const admin = getSupabaseAdmin();
      const { data: existing, error: exErr } = await admin
        .from('integration_connections')
        .select('id, provider, config')
        .eq('id', req.params.id)
        .eq('tenant_id', user.id)
        .neq('provider', 'google')
        .maybeSingle();
      if (exErr) throw new Error(exErr.message);
      if (!existing) {
        res.status(404).json({ error: 'Conexão não encontrada.' });
        return;
      }
      const current = existing as { id: string; provider: WebhookProviderId; config: ConnectionConfig };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      if (typeof body.label === 'string') {
        const label = body.label.trim();
        if (label.length < 2 || label.length > 100) throw new Error('Nome inválido.');
        patch.label = label;
      }
      if (body.status === 'active' || body.status === 'paused') patch.status = body.status;
      if (typeof body.account_id === 'string' && body.account_id) patch.account_id = body.account_id;
      if (body.config !== undefined) patch.config = sanitizeConfig(current.provider, { ...current.config, ...(body.config as object) });
      if (typeof body.signing_secret === 'string' && body.signing_secret.trim()) {
        if (body.signing_secret.trim().length < 8) throw new Error('Segredo muito curto.');
        patch.signing_secret_encrypted = encryptSecret(body.signing_secret.trim(), user.id);
      }
      if (typeof body.api_access_token === 'string' && body.api_access_token.trim()) {
        patch.credentials_encrypted = encryptSecret(JSON.stringify({ api_access_token: body.api_access_token.trim() }), user.id);
      }
      if (body.rotate_url === true) patch.webhook_secret_id = randomHex(16);
      if (Object.keys(patch).length === 0) throw new Error('Nada para atualizar.');

      const { data, error } = await admin
        .from('integration_connections')
        .update(patch)
        .eq('id', current.id)
        .eq('tenant_id', user.id)
        .select(PUBLIC_CONNECTION_COLUMNS)
        .single();
      if (error) throw new Error(error.message);
      await admin.from('audit_logs').insert({
        tenant_id: user.id,
        actor_id: user.id,
        action: 'integration.updated',
        entity_type: 'integration_connection',
        entity_id: current.id,
        metadata: { fields: Object.keys(patch).map((k) => k.replace(/_encrypted$/, '')) },
      });
      const conn = data as { provider: string; webhook_secret_id: string | null };
      const baseUrl = resolvePublicBaseUrl(req);
      res.json({
        connection: {
          ...data,
          webhook_url: conn.webhook_secret_id ? `${baseUrl}/api/webhooks/${conn.provider}/${conn.webhook_secret_id}` : null,
        },
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.delete('/integrations/connections/:id', requireUser, async (req, res) => {
    if (!isServerSupabaseConfigured()) {
      res.status(503).json({ error: 'Supabase não configurado.' });
      return;
    }
    try {
      const user = getAuthUser(req);
      const admin = getSupabaseAdmin();
      const { error, count } = await admin
        .from('integration_connections')
        .delete({ count: 'exact' })
        .eq('id', req.params.id)
        .eq('tenant_id', user.id)
        .neq('provider', 'google');
      if (error) throw new Error(error.message);
      if (!count) {
        res.status(404).json({ error: 'Conexão não encontrada.' });
        return;
      }
      await admin.from('audit_logs').insert({
        tenant_id: user.id,
        actor_id: user.id,
        action: 'integration.removed',
        entity_type: 'integration_connection',
        entity_id: req.params.id,
        metadata: {},
      });
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get('/integrations/events', requireUser, async (req, res) => {
    if (!isServerSupabaseConfigured()) {
      res.json({ events: [] });
      return;
    }
    try {
      const user = getAuthUser(req);
      let query = getSupabaseAdmin()
        .from('webhook_events')
        .select('id, connection_id, provider, external_event_id, event_type, status, normalized, error_message, attempts, transaction_ids, received_at, processed_at')
        .eq('tenant_id', user.id)
        .order('received_at', { ascending: false })
        .limit(Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50)));
      if (typeof req.query.connection_id === 'string' && req.query.connection_id) {
        query = query.eq('connection_id', req.query.connection_id);
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      res.json({ events: data ?? [] });
    } catch (err) {
      sendError(res, err, 500);
    }
  });

  router.post('/integrations/events/:id/reprocess', requireUser, async (req, res) => {
    if (!ensureReady(res)) return;
    try {
      const user = getAuthUser(req);
      const result = await reprocessWebhookEvent(user.id, String(req.params.id));
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post('/integrations/connections/:id/test', requireUser, async (req, res) => {
    if (!ensureReady(res)) return;
    try {
      const user = getAuthUser(req);
      const admin = getSupabaseAdmin();
      const { data } = await admin
        .from('integration_connections')
        .select('*')
        .eq('id', req.params.id)
        .eq('tenant_id', user.id)
        .maybeSingle();
      const connection = data as IntegrationConnectionRow | null;
      if (!connection || !connection.webhook_secret_id) {
        res.status(404).json({ error: 'Conexão não encontrada.' });
        return;
      }
      const provider = connection.provider as WebhookProviderId;
      if (provider === 'mercadopago') {
        throw new Error(
          'Teste interno indisponível para Mercado Pago: a assinatura do MP não cobre o corpo e os dados vêm da API. Use "Simular notificação" no painel do Mercado Pago.'
        );
      }
      if (!getPaymentAdapter(provider)) throw new Error('Provedor sem adaptador.');
      const secrets = decryptConnectionSecrets(connection);
      const now = new Date();
      const testReq = buildTestRequest(provider, secrets.signingSecret, connection.config ?? {}, now);
      const result = await processIncomingWebhook({
        provider,
        secretId: connection.webhook_secret_id,
        rawBody: testReq.rawBody,
        headers: testReq.headers,
        query: {},
        now,
      });
      res.status(result.httpStatus === 200 ? 200 : 400).json({ test: true, ...result.body });
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}
