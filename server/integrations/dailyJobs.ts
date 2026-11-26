import { buildAnonymizedCfoContext } from '../../src/modules/ai-cfo/aiContextBuilder.ts';
import { rehydrateFromAI } from '../../src/modules/vault/anonymizer.ts';
import { getSupabaseAdmin } from '../supabaseAdmin.ts';
import { loadTenantWorkspace } from '../tenantData.ts';
import { buildAgendaItems } from './alerts/agendaBuilder.ts';
import { syncCalendarForTenant } from './alerts/calendarSync.ts';
import { addDaysISO, saoPauloClock, todayInSaoPaulo } from './alerts/dateUtils.ts';
import {
  composeCfoCriticalMessage,
  composeDueTodayMessage,
  composeOverdueMessage,
  composeWeeklySummary,
  dispatchNotification,
  type NotificationPreferences,
} from './alerts/notificationService.ts';
import { runEncryptedBackup } from './backupService.ts';
import { getGoogleConnectionInfo } from './google/googleClient.ts';
import { settleMaturedWebhookTransactions } from './webhooks/webhookCore.ts';

export interface DailyJobReport {
  tenantRef: string;
  ranAt: string;
  skipped?: string;
  settledWebhookTransactions: number;
  calendar?: { created: number; updated: number; deleted: number; unchanged: number; errors: number } | { error: string };
  notifications: Array<{ kind: string; results: Array<{ channel: string; status: string; error?: string }> }>;
  backup?: { status: string; error?: string; sizeBytes?: number | null };
}

export const DEFAULT_PREFERENCES: Omit<NotificationPreferences, 'tenant_id'> = {
  email_enabled: false,
  email_to: null,
  whatsapp_enabled: false,
  whatsapp_number: null,
  notify_due_today: true,
  notify_overdue: true,
  notify_weekly_summary: true,
  weekly_summary_weekday: 1,
  notify_cfo_critical: true,
  include_real_labels: false,
  calendar_sync_enabled: false,
  calendar_id: 'primary',
  calendar_days_ahead: 60,
  backup_enabled: false,
  backup_retention_count: 30,
  drive_folder_id: null,
  last_daily_run_at: null,
  last_weekly_summary_at: null,
  last_calendar_sync_at: null,
};

export async function loadPreferences(tenantId: string): Promise<NotificationPreferences> {
  const { data, error } = await getSupabaseAdmin()
    .from('notification_preferences')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { ...DEFAULT_PREFERENCES, ...((data as Partial<NotificationPreferences> | null) ?? {}), tenant_id: tenantId };
}

export async function runDailyJobsForTenant(
  tenantId: string,
  options: { force?: boolean; now?: Date } = {}
): Promise<DailyJobReport> {
  const now = options.now ?? new Date();
  const todayISO = todayInSaoPaulo(now);
  const admin = getSupabaseAdmin();
  const prefs = await loadPreferences(tenantId);
  const report: DailyJobReport = {
    tenantRef: tenantId.slice(0, 8),
    ranAt: now.toISOString(),
    settledWebhookTransactions: 0,
    notifications: [],
  };

  if (!options.force && prefs.last_daily_run_at && todayInSaoPaulo(new Date(prefs.last_daily_run_at)) === todayISO) {
    report.skipped = 'já executado hoje';
    return report;
  }

  // 1. Liquidação de lançamentos de webhook com crédito futuro que venceu
  report.settledWebhookTransactions = await settleMaturedWebhookTransactions(tenantId, todayISO);

  const workspace = await loadTenantWorkspace(tenantId);
  const google = await getGoogleConnectionInfo(tenantId);

  // 2. Agenda Google Calendar
  if (prefs.calendar_sync_enabled && google.connected) {
    try {
      const r = await syncCalendarForTenant({
        tenantId,
        workspace,
        calendarId: prefs.calendar_id || 'primary',
        daysAhead: prefs.calendar_days_ahead,
        includeRealLabels: prefs.include_real_labels,
        todayISO,
      });
      report.calendar = { created: r.created, updated: r.updated, deleted: r.deleted, unchanged: r.unchanged, errors: r.errors.length };
    } catch (err) {
      report.calendar = { error: err instanceof Error ? err.message : 'falha na agenda' };
    }
  }

  // 3. Alertas
  const items = buildAgendaItems(workspace, { todayISO, fromISO: addDaysISO(todayISO, -120), toISO: todayISO });
  if (prefs.notify_due_today) {
    const msg = composeDueTodayMessage(items, prefs.include_real_labels, todayISO);
    if (msg) {
      const results = await dispatchNotification({ prefs, kind: 'due_today', dedupeKey: `due_today:${todayISO}`, message: msg, itemsCount: items.filter((i) => i.date === todayISO).length });
      report.notifications.push({ kind: 'due_today', results });
    }
  }
  if (prefs.notify_overdue) {
    const msg = composeOverdueMessage(items, prefs.include_real_labels, todayISO);
    if (msg) {
      const results = await dispatchNotification({ prefs, kind: 'overdue', dedupeKey: `overdue:${todayISO}`, message: msg, itemsCount: items.filter((i) => i.status === 'overdue').length });
      report.notifications.push({ kind: 'overdue', results });
    }
  }
  const { weekday } = saoPauloClock(now);
  const weeklyDue =
    prefs.notify_weekly_summary &&
    (options.force || weekday === prefs.weekly_summary_weekday) &&
    (!prefs.last_weekly_summary_at || now.getTime() - new Date(prefs.last_weekly_summary_at).getTime() > 6 * 24 * 3600 * 1000);
  if (weeklyDue && workspace.companies.length > 0) {
    const ctx = buildAnonymizedCfoContext({ ...workspace, activeContext: { scope: 'all_independent' }, regime: 'cash' }).context;
    const results = await dispatchNotification({ prefs, kind: 'weekly_summary', dedupeKey: `weekly:${todayISO}`, message: composeWeeklySummary(ctx), itemsCount: 1 });
    report.notifications.push({ kind: 'weekly_summary', results });
    if (results.some((r) => r.status === 'sent')) {
      await admin.from('notification_preferences').update({ last_weekly_summary_at: now.toISOString() }).eq('tenant_id', tenantId);
    }
  }
  if (prefs.notify_cfo_critical) {
    const since = new Date(now.getTime() - 26 * 3600 * 1000).toISOString();
    const { data: insights } = await admin
      .from('ai_insights')
      .select('id, title_tokenized, summary_tokenized, estimated_financial_impact')
      .eq('tenant_id', tenantId)
      .eq('severity', 'critical')
      .eq('status', 'new')
      .gte('created_at', since);
    const rows = (insights ?? []) as Array<{ id: string; title_tokenized: string; summary_tokenized: string; estimated_financial_impact: number }>;
    if (rows.length > 0) {
      const mapped = rows.map((r) => {
        const base = { title: r.title_tokenized, summary: r.summary_tokenized, impact: Number(r.estimated_financial_impact ?? 0) };
        return prefs.include_real_labels ? rehydrateFromAI(base, workspace.vault, { isAuthenticatedClient: true, includeFormattedCnpj: false }) : base;
      });
      const msg = composeCfoCriticalMessage(mapped);
      if (msg) {
        const key = `cfo:${rows.map((r) => r.id).sort().join(',').slice(0, 180)}`;
        const results = await dispatchNotification({ prefs, kind: 'cfo_critical', dedupeKey: key, message: msg, itemsCount: rows.length });
        report.notifications.push({ kind: 'cfo_critical', results });
      }
    }
  }

  // 4. Backup criptografado (1x/dia quando ativado e Google conectado)
  if (prefs.backup_enabled && google.connected) {
    const { data: lastOk } = await admin
      .from('backup_logs')
      .select('started_at')
      .eq('tenant_id', tenantId)
      .eq('status', 'success')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastAt = (lastOk as { started_at?: string } | null)?.started_at;
    if (options.force || !lastAt || now.getTime() - new Date(lastAt).getTime() > 20 * 3600 * 1000) {
      try {
        const b = await runEncryptedBackup({ tenantId, trigger: 'cron', now });
        report.backup = { status: b.status, error: b.error, sizeBytes: b.sizeBytes };
      } catch (err) {
        report.backup = { status: 'failed', error: err instanceof Error ? err.message : 'falha no backup' };
      }
    }
  }

  await admin.from('notification_preferences').update({ last_daily_run_at: now.toISOString() }).eq('tenant_id', tenantId);
  return report;
}

/** Executa para todos os tenants com preferências salvas e convite ativo. */
export async function runDailyJobsAllTenants(options: { force?: boolean } = {}): Promise<DailyJobReport[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from('notification_preferences').select('tenant_id');
  if (error) throw new Error(error.message);
  const reports: DailyJobReport[] = [];
  for (const row of (data ?? []) as Array<{ tenant_id: string }>) {
    try {
      const { data: userData } = await admin.auth.admin.getUserById(row.tenant_id);
      const email = userData.user?.email?.toLowerCase();
      if (!email) continue;
      const { data: invite } = await admin.from('invited_users').select('is_active').eq('email', email).maybeSingle();
      if (!(invite as { is_active?: boolean } | null)?.is_active) continue;
      reports.push(await runDailyJobsForTenant(row.tenant_id, options));
    } catch (err) {
      reports.push({
        tenantRef: row.tenant_id.slice(0, 8),
        ranAt: new Date().toISOString(),
        skipped: `erro: ${err instanceof Error ? err.message : 'desconhecido'}`,
        settledWebhookTransactions: 0,
        notifications: [],
      });
    }
  }
  return reports;
}

/**
 * Agendador interno opcional (ENABLE_INTERNAL_SCHEDULER=true): verifica a cada 15 min e
 * dispara as rotinas uma vez por dia a partir de DAILY_JOBS_HOUR (padrão 7h, horário de Brasília).
 * Em hospedagens serverless use o endpoint POST /api/cron/daily com CRON_SECRET.
 */
export function startInternalScheduler(): void {
  if ((process.env.ENABLE_INTERNAL_SCHEDULER ?? '').toLowerCase() !== 'true') return;
  const hour = Math.min(23, Math.max(0, Number(process.env.DAILY_JOBS_HOUR ?? 7) || 7));
  let running = false;
  const tick = async () => {
    if (running) return;
    if (saoPauloClock().hour < hour) return;
    running = true;
    try {
      const reports = await runDailyJobsAllTenants();
      const executed = reports.filter((r) => !r.skipped).length;
      if (executed > 0) console.log(`[Agendador] Rotinas diárias executadas para ${executed} tenant(s).`);
    } catch (err) {
      console.error('[Agendador] Falha:', err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  };
  setInterval(() => void tick(), 15 * 60 * 1000).unref();
  setTimeout(() => void tick(), 30_000).unref();
  console.log(`[Agendador] Interno ativo: rotinas diárias a partir das ${hour}h (America/Sao_Paulo).`);
}
