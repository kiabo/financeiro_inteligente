import express, { type Response } from 'express';
import { getAuthUser, requireUser } from '../authMiddleware.ts';
import { getSupabaseAdmin, isServerSupabaseConfigured } from '../supabaseAdmin.ts';
import { HistoryRunError } from './history/historyRunner.ts';
import { createDefaultHistoryDeps, decryptConnectionApiKey } from './history/historyStores.ts';
import {
  cancelHistoryImport,
  getHistoryImport,
  latestHistoryImport,
  startHistoryImport,
  stepHistoryImport,
  type HistoryServiceDeps,
} from './history/historyService.ts';
import { isCredentialsKeyConfigured } from './routeHelpers.ts';
import type { IntegrationConnectionRow } from './webhooks/webhookCore.ts';

/** Rotas autenticadas (JWT aal2) da importação de histórico por API — spec 004. O tenant vem sempre do JWT. */

function buildServiceDeps(): HistoryServiceDeps {
  const base = createDefaultHistoryDeps();
  return {
    ...base,
    loadConnection: async (tenantId, connectionId) => {
      const { data, error } = await getSupabaseAdmin()
        .from('integration_connections')
        .select('*')
        .eq('id', connectionId)
        .eq('tenant_id', tenantId)
        .neq('provider', 'google')
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as IntegrationConnectionRow | null) ?? null;
    },
    getApiKey: decryptConnectionApiKey,
    findLatest: (tenantId, connectionId) => base.runs.findLatest(tenantId, connectionId),
  };
}

function ready(res: Response): boolean {
  if (!isServerSupabaseConfigured()) {
    res.status(503).json({ error: 'Integrações exigem Supabase configurado no servidor.' });
    return false;
  }
  if (!isCredentialsKeyConfigured()) {
    res.status(503).json({ error: 'Defina CREDENTIALS_ENCRYPTION_KEY no .env do servidor para usar as chaves de API.' });
    return false;
  }
  return true;
}

function sendError(res: Response, err: unknown): void {
  if (err instanceof HistoryRunError) {
    res.status(err.httpStatus).json({ error: err.message, ...(err.run ? { run: err.run } : {}) });
    return;
  }
  // Mensagem genérica: detalhes internos (e qualquer dado do provedor) ficam fora da resposta
  console.error('[Histórico] Erro inesperado:', err instanceof Error ? err.message : 'desconhecido');
  res.status(500).json({ error: 'Falha ao processar a importação. Tente retomar em instantes.' });
}

export function createHistoryRouter(deps: () => HistoryServiceDeps = buildServiceDeps): express.Router {
  const router = express.Router();

  router.post('/integrations/connections/:id/history/start', requireUser, async (req, res) => {
    if (!ready(res)) return;
    try {
      const run = await startHistoryImport(deps(), {
        tenantId: getAuthUser(req).id,
        connectionId: String(req.params.id),
        body: (req.body ?? {}) as Record<string, unknown>,
      });
      res.status(201).json({ run });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get('/integrations/connections/:id/history/latest', requireUser, async (req, res) => {
    if (!isServerSupabaseConfigured()) {
      res.json({ run: null });
      return;
    }
    try {
      const run = await latestHistoryImport(deps(), { tenantId: getAuthUser(req).id, connectionId: String(req.params.id) });
      res.json({ run });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post('/integrations/history/:runId/step', requireUser, async (req, res) => {
    if (!ready(res)) return;
    try {
      const run = await stepHistoryImport(deps(), { tenantId: getAuthUser(req).id, runId: String(req.params.runId) });
      res.json({ run, done: run.status !== 'running' });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get('/integrations/history/:runId', requireUser, async (req, res) => {
    if (!isServerSupabaseConfigured()) {
      res.status(503).json({ error: 'Supabase não configurado.' });
      return;
    }
    try {
      res.json({ run: await getHistoryImport(deps(), { tenantId: getAuthUser(req).id, runId: String(req.params.runId) }) });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post('/integrations/history/:runId/cancel', requireUser, async (req, res) => {
    if (!isServerSupabaseConfigured()) {
      res.status(503).json({ error: 'Supabase não configurado.' });
      return;
    }
    try {
      res.json({ run: await cancelHistoryImport(deps(), { tenantId: getAuthUser(req).id, runId: String(req.params.runId) }) });
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}
