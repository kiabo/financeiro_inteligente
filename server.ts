import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  answerCfoChatQuestion,
  assertServerPayloadZeroLeak,
  generateCfoStrategicInsights,
  getAiProviderConfig,
} from './server/aiProvider.ts';
import {
  handleMcpJsonRpcPost,
  handleMcpSseGet,
  pullTenantMcpUpdates,
  syncTenantMcpBridge,
} from './server/mcpHandler.ts';
import { requireUser } from './server/authMiddleware.ts';
import { createAutomationRouter } from './server/integrations/automationRoutes.ts';
import { startInternalScheduler } from './server/integrations/dailyJobs.ts';
import { createDbBackupRouter } from './server/integrations/dbBackup/dbBackupRoutes.ts';
import { startDbBackupScheduler } from './server/integrations/dbBackup/dbBackupContext.ts';
import { createHistoryRouter } from './server/integrations/historyRoutes.ts';
import { createWebhookRouter } from './server/integrations/webhookRoutes.ts';
import { isServerSandboxMode, isServerSupabaseConfigured } from './server/supabaseAdmin.ts';
import type { AnonymizedFinancialContext } from './src/modules/ai-cfo/aiContextBuilder.ts';
import type { McpAccessToken } from './src/modules/core/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer(): Promise<void> {
  const app = express();
  app.disable('x-powered-by');
  // Atrás de proxy reverso (Railway/Render/Fly/Nginx): respeita X-Forwarded-Proto para URLs https
  if ((process.env.TRUST_PROXY ?? '').toLowerCase() === 'true') {
    app.set('trust proxy', 1);
  }
  app.use(
    express.json({
      limit: '2mb',
      // Mantém o corpo bruto para validação de assinatura HMAC dos webhooks (Módulo 6)
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    })
  );

  if (!isServerSupabaseConfigured()) {
    console.warn(
      isServerSandboxMode()
        ? '[Vértice Server] Supabase não configurado no servidor: modo SANDBOX (sem autenticação nas rotas /api).'
        : '[Vértice Server] ERRO: Supabase não configurado em produção. Rotas autenticadas vão recusar todas as chamadas.'
    );
  }

  // Bloqueia a ponte MCP em memória fora do modo sandbox (no modo Supabase o MCP lê o banco direto)
  const sandboxBridgeOnly: express.RequestHandler = (_req, res, next) => {
    if (!isServerSandboxMode()) {
      res.status(410).json({
        error: 'Ponte MCP desativada: com Supabase configurado o servidor MCP lê o banco diretamente.',
      });
      return;
    }
    next();
  };

  // Health & AI Provider Status (never exposes API keys)
  app.get('/api/cfo/status', requireUser, (_req, res) => {
    const config = getAiProviderConfig();
    res.json(config);
  });

  // CFO Virtual: Proactive Strategic Analysis (100% Zero-Leak Anonymized Input)
  app.post('/api/cfo/analyze', requireUser, async (req, res) => {
    try {
      const body = req.body as { anonymizedContext?: unknown };
      if (!body?.anonymizedContext || typeof body.anonymizedContext !== 'object') {
        res.status(400).json({ error: 'anonymizedContext é obrigatório.' });
        return;
      }

      assertServerPayloadZeroLeak(body.anonymizedContext);
      const result = await generateCfoStrategicInsights(body.anonymizedContext);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao gerar análise do CFO Virtual.';
      const status = message.includes('Bloqueio Zero-Leak')
        ? 400
        : message.includes('não configurada')
          ? 503
          : 502;
      res.status(status).json({ error: message });
    }
  });

  // CFO Virtual: Private Analytical Chat ("Pergunte ao seu CFO")
  app.post('/api/cfo/chat', requireUser, async (req, res) => {
    try {
      const body = req.body as {
        question?: string;
        history?: Array<{ role: 'user' | 'assistant'; content: string }>;
        anonymizedContext?: unknown;
      };

      if (!body?.question || typeof body.question !== 'string' || !body.question.trim()) {
        res.status(400).json({ error: 'Pergunta vazia.' });
        return;
      }
      if (!body?.anonymizedContext || typeof body.anonymizedContext !== 'object') {
        res.status(400).json({ error: 'anonymizedContext é obrigatório.' });
        return;
      }

      const history = Array.isArray(body.history) ? body.history : [];
      assertServerPayloadZeroLeak({
        question: body.question,
        history,
        anonymizedContext: body.anonymizedContext,
      });

      const result = await answerCfoChatQuestion({
        question: body.question.trim(),
        history,
        anonymizedContext: body.anonymizedContext,
      });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro no chat analítico do CFO Virtual.';
      const status = message.includes('Bloqueio Zero-Leak')
        ? 400
        : message.includes('não configurada')
          ? 503
          : 502;
      res.status(status).json({ error: message });
    }
  });

  // Bridge: Sincroniza apenas contexto 100% anonimizado e hashes SHA-256 de tokens MCP
  app.post('/api/mcp/bridge/sync', sandboxBridgeOnly, (req, res) => {
    try {
      const body = req.body as {
        tenantId?: string;
        anonymizedContext?: AnonymizedFinancialContext;
        tokens?: McpAccessToken[];
      };

      if (!body?.tenantId || !body?.anonymizedContext) {
        res.status(400).json({ error: 'tenantId e anonymizedContext são obrigatórios.' });
        return;
      }

      const result = syncTenantMcpBridge({
        tenantId: body.tenantId,
        anonymizedContext: body.anonymizedContext,
        tokens: Array.isArray(body.tokens) ? body.tokens : [],
      });

      res.json({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao sincronizar ponte MCP.';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/mcp/bridge/updates', sandboxBridgeOnly, (req, res) => {
    const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : '';
    if (!tenantId) {
      res.status(400).json({ error: 'tenantId é obrigatório.' });
      return;
    }
    const updates = pullTenantMcpUpdates(tenantId);
    res.json(updates);
  });

  // Módulo 6: webhooks adaptáveis, integrações, Google, alertas, backup e OCR
  app.use('/api', createWebhookRouter());
  app.use('/api', createHistoryRouter());
  app.use('/api', createAutomationRouter());
  app.use('/api', createDbBackupRouter());

  // Endpoint Oficial do Servidor MCP (JSON-RPC Streamable HTTP + SSE)
  app.post('/api/mcp', (req, res) => {
    void handleMcpJsonRpcPost(req, res);
  });
  app.get('/api/mcp', (req, res) => {
    void handleMcpSseGet(req, res);
  });
  app.delete('/api/mcp', (_req, res) => {
    res.json({ ok: true, closed: true });
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build dist/ não encontrado. Execute npm run build.');
      }
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`[Vértice Server] Listening on http://0.0.0.0:${port}`);
    startInternalScheduler();
    startDbBackupScheduler();
  });
}

void startServer();
