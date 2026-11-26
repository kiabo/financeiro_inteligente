import express, { type Response } from 'express';
import { getAuthUser, requireUser } from '../authMiddleware.ts';
import { isBackupKeyConfigured } from '../crypto/backupCrypto.ts';
import { isCredentialsKeyConfigured, timingSafeEqualStr } from '../crypto/secretBox.ts';
import { getAiProviderConfig } from '../aiProvider.ts';
import { isServerSupabaseConfigured } from '../supabaseAdmin.ts';
import { loadTenantWorkspace } from '../tenantData.ts';
import { syncCalendarForTenant } from './alerts/calendarSync.ts';
import { todayInSaoPaulo } from './alerts/dateUtils.ts';
import { dispatchNotification, getChannelStatus } from './alerts/notificationService.ts';
import { runEncryptedBackup, verifyLatestDriveBackup } from './backupService.ts';
import { loadPreferences, runDailyJobsAllTenants, runDailyJobsForTenant } from './dailyJobs.ts';
import {
  buildGoogleAuthUrl,
  completeGoogleOAuth,
  disconnectGoogle,
  getGoogleConnectionInfo,
  isGoogleOAuthConfigured,
  resolveGoogleRedirectUri,
} from './google/googleClient.ts';
import { classifyReceipt } from './ocrClassifier.ts';
import { resolvePublicBaseUrl } from './webhookRoutes.ts';

function fail(res: Response, err: unknown, status = 400): void {
  res.status(status).json({ error: err instanceof Error ? err.message : 'Erro inesperado.' });
}

function requireSupabase(res: Response): boolean {
  if (!isServerSupabaseConfigured()) {
    res.status(503).json({ error: 'Recurso disponível apenas com Supabase configurado no servidor.' });
    return false;
  }
  return true;
}

export function createAutomationRouter(): express.Router {
  const router = express.Router();

  // ---------------------------------------------------------------------------
  // Status geral do Módulo 6 (nunca expõe valores de chaves)
  // ---------------------------------------------------------------------------
  router.get('/automation/status', requireUser, async (req, res) => {
    try {
      const user = getAuthUser(req);
      const google = isServerSupabaseConfigured()
        ? await getGoogleConnectionInfo(user.id)
        : { connected: false, email: null, scopes: [], connectedAt: null, configured: isGoogleOAuthConfigured() };
      res.json({
        supabase: isServerSupabaseConfigured(),
        credentialsKeyConfigured: isCredentialsKeyConfigured(),
        backupKeyConfigured: isBackupKeyConfigured(),
        googleOAuthConfigured: isGoogleOAuthConfigured(),
        google,
        channels: getChannelStatus(),
        cronSecretConfigured: Boolean(process.env.CRON_SECRET?.trim()),
        internalScheduler: (process.env.ENABLE_INTERNAL_SCHEDULER ?? '').toLowerCase() === 'true',
        ai: getAiProviderConfig(),
        publicBaseUrl: resolvePublicBaseUrl(req),
        googleRedirectUri: resolveGoogleRedirectUri(resolvePublicBaseUrl(req)),
      });
    } catch (err) {
      fail(res, err, 500);
    }
  });

  // ---------------------------------------------------------------------------
  // Google OAuth (Drive + Calendar)
  // ---------------------------------------------------------------------------
  router.get('/google/oauth/start', requireUser, (req, res) => {
    if (!requireSupabase(res)) return;
    if (!isGoogleOAuthConfigured()) {
      res.status(503).json({ error: 'Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env do servidor.' });
      return;
    }
    if (!isCredentialsKeyConfigured()) {
      res.status(503).json({ error: 'Defina CREDENTIALS_ENCRYPTION_KEY para guardar o token do Google cifrado.' });
      return;
    }
    const user = getAuthUser(req);
    const redirectUri = resolveGoogleRedirectUri(resolvePublicBaseUrl(req));
    res.json({ url: buildGoogleAuthUrl(user.id, redirectUri) });
  });

  // Callback público: autenticidade garantida pelo `state` assinado (HMAC + expiração de 10 min)
  router.get('/google/oauth/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const oauthError = typeof req.query.error === 'string' ? req.query.error : '';
    if (oauthError || !code || !state) {
      res.redirect(`/?google=error&reason=${encodeURIComponent(oauthError || 'parametros_ausentes')}`);
      return;
    }
    try {
      await completeGoogleOAuth({ code, state, redirectUri: resolveGoogleRedirectUri(resolvePublicBaseUrl(req)) });
      res.redirect('/?google=connected');
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 160) : 'falha';
      res.redirect(`/?google=error&reason=${encodeURIComponent(reason)}`);
    }
  });

  router.post('/google/disconnect', requireUser, async (req, res) => {
    if (!requireSupabase(res)) return;
    try {
      await disconnectGoogle(getAuthUser(req).id);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  // ---------------------------------------------------------------------------
  // Agenda, alertas e rotinas
  // ---------------------------------------------------------------------------
  router.post('/calendar/sync', requireUser, async (req, res) => {
    if (!requireSupabase(res)) return;
    try {
      const user = getAuthUser(req);
      const prefs = await loadPreferences(user.id);
      const google = await getGoogleConnectionInfo(user.id);
      if (!google.connected) throw new Error('Conecte sua conta Google primeiro.');
      const workspace = await loadTenantWorkspace(user.id);
      const result = await syncCalendarForTenant({
        tenantId: user.id,
        workspace,
        calendarId: prefs.calendar_id || 'primary',
        daysAhead: prefs.calendar_days_ahead,
        includeRealLabels: prefs.include_real_labels,
        todayISO: todayInSaoPaulo(),
      });
      res.json(result);
    } catch (err) {
      fail(res, err);
    }
  });

  router.post('/alerts/test', requireUser, async (req, res) => {
    if (!requireSupabase(res)) return;
    try {
      const user = getAuthUser(req);
      const prefs = await loadPreferences(user.id);
      const stamp = new Date().toISOString();
      const text = `Teste de alerta Vértice enviado em ${stamp}. Se você recebeu esta mensagem, o canal está funcionando.`;
      const results = await dispatchNotification({
        prefs,
        kind: 'test',
        dedupeKey: `test:${stamp}`,
        itemsCount: 0,
        message: { subject: 'Vértice · Teste de alerta', text, html: `<p>${text}</p>` },
      });
      if (results.length === 0) {
        throw new Error('Nenhum canal habilitado e configurado. Ative e-mail/WhatsApp nas preferências e confira as variáveis do servidor.');
      }
      res.json({ results });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post('/automation/run-daily', requireUser, async (req, res) => {
    if (!requireSupabase(res)) return;
    try {
      const report = await runDailyJobsForTenant(getAuthUser(req).id, { force: true });
      res.json(report);
    } catch (err) {
      fail(res, err, 500);
    }
  });

  // Cron externo (Vercel Cron, GitHub Actions, cron-job.org, n8n): Authorization: Bearer <CRON_SECRET>
  router.post('/cron/daily', async (req, res) => {
    const secret = process.env.CRON_SECRET?.trim() ?? '';
    const header = req.headers.authorization ?? '';
    const provided = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    if (!secret || secret.length < 24 || !provided || !timingSafeEqualStr(provided, secret)) {
      res.status(401).json({ error: 'Não autorizado.' });
      return;
    }
    if (!requireSupabase(res)) return;
    try {
      const reports = await runDailyJobsAllTenants({ force: req.query.force === 'true' });
      res.json({ ok: true, tenants: reports.length, reports });
    } catch (err) {
      fail(res, err, 500);
    }
  });

  // ---------------------------------------------------------------------------
  // Backup blindado
  // ---------------------------------------------------------------------------
  router.post('/backup/run', requireUser, async (req, res) => {
    if (!requireSupabase(res)) return;
    try {
      const result = await runEncryptedBackup({ tenantId: getAuthUser(req).id, trigger: 'manual' });
      if (result.status === 'failed') {
        res.status(500).json({ error: result.error ?? 'Falha no backup.', logId: result.logId });
        return;
      }
      if (result.destination === 'download' && result.fileContent) {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${result.fileName ?? 'vertice-backup.vtxbak'}"`);
        res.setHeader('X-Backup-Sha256', result.sha256 ?? '');
        res.setHeader('Access-Control-Expose-Headers', 'X-Backup-Sha256, Content-Disposition');
        res.send(result.fileContent);
        return;
      }
      const { fileContent: _omit, ...summary } = result;
      res.json(summary);
    } catch (err) {
      fail(res, err);
    }
  });

  router.post('/backup/verify', requireUser, async (req, res) => {
    if (!requireSupabase(res)) return;
    try {
      res.json(await verifyLatestDriveBackup(getAuthUser(req).id));
    } catch (err) {
      fail(res, err);
    }
  });

  // ---------------------------------------------------------------------------
  // OCR: classificação de texto JÁ SANITIZADO no navegador
  // ---------------------------------------------------------------------------
  router.post('/ocr/classify', requireUser, async (req, res) => {
    if (!requireSupabase(res)) return;
    try {
      const user = getAuthUser(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const companyId = typeof body.company_id === 'string' ? body.company_id : '';
      const text = typeof body.sanitized_text === 'string' ? body.sanitized_text : '';
      if (!companyId) throw new Error('Selecione a empresa do comprovante.');
      if (text.trim().length < 3) throw new Error('Texto do comprovante vazio.');
      const amount = typeof body.amount === 'number' && Number.isFinite(body.amount) ? body.amount : null;
      const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
      res.json(await classifyReceipt({ tenantId: user.id, companyId, sanitizedText: text, amount, date }));
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      fail(res, err, message.includes('Zero-Leak') ? 422 : 400);
    }
  });

  return router;
}
