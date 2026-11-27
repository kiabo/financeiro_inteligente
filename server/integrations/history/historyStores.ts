import { decryptSecret } from '../../crypto/secretBox.ts';
import { getSupabaseAdmin } from '../../supabaseAdmin.ts';
import { loadTenantCatalog, type IntegrationConnectionRow } from '../webhooks/webhookCore.ts';
import {
  HistoryRunError,
  createHistorySource,
  type EventLog,
  type HistoryDeps,
  type HistoryEvent,
  type RunRecord,
  type RunStore,
} from './historyRunner.ts';
import { SupabaseTransactionStore } from './supabaseTransactionStore.ts';

/** Implementações Supabase (service role) das dependências da importação. Toda consulta filtra por `tenant_id`. */

const RUN_COLUMNS =
  'id, tenant_id, connection_id, provider, company_id, account_id, period_start, period_end, status, phase, cursor, customers, ' +
  'count_created, count_updated, count_ignored, count_marked_apart, count_failed, errors, last_error, started_at, finished_at';

export class SupabaseRunStore implements RunStore {
  async create(run: Omit<RunRecord, 'id'>): Promise<RunRecord> {
    const { data, error } = await getSupabaseAdmin().from('import_runs').insert(run).select(RUN_COLUMNS).single();
    if (error) {
      if (error.code === '23505') {
        throw new HistoryRunError('Já existe uma importação em andamento nesta conexão. Retome ou cancele antes de iniciar outra.', 409);
      }
      throw new Error(error.message);
    }
    return data as unknown as RunRecord;
  }

  async get(tenantId: string, id: string): Promise<RunRecord | null> {
    const { data, error } = await getSupabaseAdmin().from('import_runs').select(RUN_COLUMNS).eq('id', id).eq('tenant_id', tenantId).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as RunRecord | null) ?? null;
  }

  async findRunning(tenantId: string, connectionId: string): Promise<RunRecord | null> {
    const { data, error } = await getSupabaseAdmin()
      .from('import_runs')
      .select(RUN_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('connection_id', connectionId)
      .eq('status', 'running')
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as RunRecord | null) ?? null;
  }

  /** Execução mais recente da conexão (qualquer status), para "Retomar" ao reabrir a tela. */
  async findLatest(tenantId: string, connectionId: string): Promise<RunRecord | null> {
    const { data, error } = await getSupabaseAdmin()
      .from('import_runs')
      .select(RUN_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('connection_id', connectionId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as RunRecord | null) ?? null;
  }

  async update(tenantId: string, id: string, patch: Partial<Omit<RunRecord, 'id' | 'tenant_id'>>): Promise<RunRecord> {
    // Lista explícita de colunas atualizáveis
    const columns: Record<string, unknown> = {};
    for (const key of [
      'status', 'phase', 'cursor', 'customers', 'count_created', 'count_updated', 'count_ignored',
      'count_marked_apart', 'count_failed', 'errors', 'last_error', 'finished_at',
    ] as const) {
      if (patch[key] !== undefined) columns[key] = patch[key];
    }
    const { data, error } = await getSupabaseAdmin()
      .from('import_runs')
      .update(columns)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(RUN_COLUMNS)
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new HistoryRunError('Já existe outra importação em andamento nesta conexão.', 409);
      }
      throw new Error(error.message);
    }
    return data as unknown as RunRecord;
  }
}

export class SupabaseEventLog implements EventLog {
  async record(event: HistoryEvent): Promise<void> {
    const { error } = await getSupabaseAdmin()
      .from('webhook_events')
      .insert({
        tenant_id: event.tenant_id,
        connection_id: event.connection_id,
        provider: event.provider,
        external_event_id: event.external_event_id,
        event_type: event.event_type.slice(0, 120),
        status: event.status,
        payload: event.payload,
        normalized: event.normalized,
        error_message: event.error_message ? event.error_message.slice(0, 500) : null,
        attempts: 1,
        transaction_ids: event.transaction_ids,
        processed_at: event.status === 'processed' ? new Date().toISOString() : null,
        source: 'api',
      });
    // Mesmo pagamento/status já registrado (reimportação): ignora
    if (error && error.code !== '23505') throw new Error(error.message);
  }
}

export function createDefaultHistoryDeps(): HistoryDeps & { runs: SupabaseRunStore } {
  return {
    runs: new SupabaseRunStore(),
    txStore: new SupabaseTransactionStore(),
    events: new SupabaseEventLog(),
    loadCatalog: loadTenantCatalog,
    getAccount: async (tenantId, accountId) => {
      const { data, error } = await getSupabaseAdmin()
        .from('financial_accounts')
        .select('id, company_id')
        .eq('id', accountId)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { id: string; company_id: string } | null) ?? null;
    },
    createSource: (provider, apiKey) => createHistorySource(provider, apiKey),
    audit: async (tenantId, action, entityId, metadata) => {
      await getSupabaseAdmin().from('audit_logs').insert({
        tenant_id: tenantId,
        actor_id: tenantId,
        action,
        entity_type: 'integration_connection',
        entity_id: entityId,
        metadata,
      });
    },
    now: () => new Date(),
  };
}

/** Chave de API da conexão (campo cifrado `api_access_token`); `null` quando não configurada. Nunca é devolvida ao navegador. */
export function decryptConnectionApiKey(connection: Pick<IntegrationConnectionRow, 'tenant_id' | 'credentials_encrypted'>): string | null {
  if (!connection.credentials_encrypted) return null;
  const creds = JSON.parse(decryptSecret(connection.credentials_encrypted, connection.tenant_id)) as { api_access_token?: string };
  return creds.api_access_token?.trim() || null;
}
