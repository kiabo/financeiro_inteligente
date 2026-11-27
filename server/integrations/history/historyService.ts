import {
  HistoryRunError,
  cancelRun,
  getRun,
  startRun,
  stepRun,
  toPublicRun,
  type HistoryDeps,
  type PublicRun,
} from './historyRunner.ts';
import type { IntegrationConnectionRow } from '../webhooks/webhookCore.ts';

/**
 * Casos de uso da importação de histórico, sem Express: as rotas só traduzem HTTP.
 * `loadConnection` já filtra por tenant e ignora a conexão do Google; `getApiKey` decifra a chave
 * (que nunca sai daqui para o navegador).
 */
export interface HistoryServiceDeps extends HistoryDeps {
  loadConnection(tenantId: string, connectionId: string): Promise<IntegrationConnectionRow | null>;
  getApiKey(connection: IntegrationConnectionRow): string | null;
  findLatest(tenantId: string, connectionId: string): Promise<import('./historyRunner.ts').RunRecord | null>;
}

async function requireConnection(deps: HistoryServiceDeps, tenantId: string, connectionId: string): Promise<IntegrationConnectionRow> {
  const connection = await deps.loadConnection(tenantId, connectionId);
  if (!connection) throw new HistoryRunError('Conexão não encontrada.', 404);
  return connection;
}

export async function startHistoryImport(
  deps: HistoryServiceDeps,
  params: { tenantId: string; connectionId: string; body: Record<string, unknown> }
): Promise<PublicRun> {
  const connection = await requireConnection(deps, params.tenantId, params.connectionId);
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return startRun(deps, {
    tenantId: params.tenantId,
    connection,
    apiKey: deps.getApiKey(connection),
    accountId: text(params.body.account_id),
    start: text(params.body.period_start),
    end: text(params.body.period_end),
  });
}

export async function stepHistoryImport(deps: HistoryServiceDeps, params: { tenantId: string; runId: string }): Promise<PublicRun> {
  const run = await deps.runs.get(params.tenantId, params.runId);
  if (!run) throw new HistoryRunError('Importação não encontrada.', 404);
  const connection = await requireConnection(deps, params.tenantId, run.connection_id);
  return stepRun(deps, { tenantId: params.tenantId, runId: params.runId, connection, apiKey: deps.getApiKey(connection) });
}

export const getHistoryImport = (deps: HistoryServiceDeps, params: { tenantId: string; runId: string }) => getRun(deps, params);
export const cancelHistoryImport = (deps: HistoryServiceDeps, params: { tenantId: string; runId: string }) => cancelRun(deps, params);

/** Execução mais recente da conexão (ou `null`), para oferecer "Retomar" ao reabrir a tela. */
export async function latestHistoryImport(
  deps: HistoryServiceDeps,
  params: { tenantId: string; connectionId: string }
): Promise<PublicRun | null> {
  await requireConnection(deps, params.tenantId, params.connectionId);
  const run = await deps.findLatest(params.tenantId, params.connectionId);
  return run ? toPublicRun(run) : null;
}
