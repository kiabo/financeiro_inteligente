import type { AnonymizedFinancialContext } from '../../../src/modules/ai-cfo/aiContextBuilder.ts';
import { getSupabaseAdmin } from '../../supabaseAdmin.ts';
import { formatBRL, formatDateBR, pickLabel, type AgendaItem } from './agendaBuilder.ts';

/**
 * Motor de alertas (E-mail via Resend · WhatsApp via Evolution API ou WhatsApp Cloud API).
 * Por padrão as mensagens usam apenas tokens do cofre (EMP_01, CTA_02, CRD_01) e valores:
 * nomes reais só saem se o titular ativar `include_real_labels`.
 */

export type NotificationChannel = 'email' | 'whatsapp';
export type NotificationKind = 'due_today' | 'overdue' | 'weekly_summary' | 'cfo_critical' | 'test';

export interface NotificationPreferences {
  tenant_id: string;
  email_enabled: boolean;
  email_to: string | null;
  whatsapp_enabled: boolean;
  whatsapp_number: string | null;
  notify_due_today: boolean;
  notify_overdue: boolean;
  notify_weekly_summary: boolean;
  weekly_summary_weekday: number;
  notify_cfo_critical: boolean;
  include_real_labels: boolean;
  calendar_sync_enabled: boolean;
  calendar_id: string;
  calendar_days_ahead: number;
  backup_enabled: boolean;
  backup_retention_count: number;
  drive_folder_id: string | null;
  last_daily_run_at: string | null;
  last_weekly_summary_at: string | null;
  last_calendar_sync_at: string | null;
}

export interface OutgoingMessage {
  subject: string;
  text: string;
  html: string;
}

export function getChannelStatus(): { email: boolean; whatsapp: boolean; whatsappProvider: string | null } {
  const email = Boolean(process.env.RESEND_API_KEY?.trim() && process.env.NOTIFY_EMAIL_FROM?.trim());
  const provider = (process.env.WHATSAPP_PROVIDER ?? 'evolution').trim().toLowerCase();
  const whatsapp =
    provider === 'cloud_api'
      ? Boolean(process.env.WHATSAPP_CLOUD_TOKEN?.trim() && process.env.WHATSAPP_PHONE_NUMBER_ID?.trim())
      : Boolean(process.env.EVOLUTION_API_URL?.trim() && process.env.EVOLUTION_API_KEY?.trim() && process.env.EVOLUTION_INSTANCE?.trim());
  return { email, whatsapp, whatsappProvider: whatsapp ? provider : null };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function wrapHtml(title: string, lines: string[], footer: string): string {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#F8FAFC;padding:24px;color:#0F172A">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;border-radius:8px;padding:24px">
<h2 style="margin:0 0 12px;font-size:18px">${escapeHtml(title)}</h2>
${lines.map((l) => `<p style="margin:6px 0;font-size:14px;line-height:20px">${escapeHtml(l)}</p>`).join('\n')}
<p style="margin-top:20px;font-size:12px;color:#64748B">${escapeHtml(footer)}</p>
</div></body></html>`;
}

const FOOTER_TOKENS = 'Vértice · mensagem com identificadores anonimizados (tokens do Cofre). Abra o app para ver os nomes reais.';
const FOOTER_REAL = 'Vértice · alertas com rótulos reais ativados nas preferências.';

function itemLine(item: AgendaItem, includeReal: boolean): string {
  const amount = item.amount !== null ? ` — ${formatBRL(item.amount)}` : '';
  return `${formatDateBR(item.date)} · ${pickLabel(item, includeReal)}${amount}`;
}

export function composeDueTodayMessage(items: AgendaItem[], includeReal: boolean, todayISO: string): OutgoingMessage | null {
  const due = items.filter((i) => i.date === todayISO && i.status === 'pending' && i.kind !== 'project');
  if (due.length === 0) return null;
  const payable = due.filter((i) => i.kind !== 'receivable').reduce((s, i) => s + (i.amount ?? 0), 0);
  const receivable = due.filter((i) => i.kind === 'receivable').reduce((s, i) => s + (i.amount ?? 0), 0);
  const lines = [
    `${due.length} vencimento(s) hoje · a pagar ${formatBRL(payable)} · a receber ${formatBRL(receivable)}`,
    ...due.slice(0, 20).map((i) => `• ${itemLine(i, includeReal)}`),
  ];
  if (due.length > 20) lines.push(`… e mais ${due.length - 20} item(ns).`);
  const subject = `Vértice · ${due.length} vencimento(s) hoje (${formatDateBR(todayISO)})`;
  const footer = includeReal ? FOOTER_REAL : FOOTER_TOKENS;
  return { subject, text: [subject, '', ...lines, '', footer].join('\n'), html: wrapHtml(subject, lines, footer) };
}

export function composeOverdueMessage(items: AgendaItem[], includeReal: boolean, todayISO: string): OutgoingMessage | null {
  const overdue = items.filter((i) => i.status === 'overdue' && i.kind !== 'receivable');
  if (overdue.length === 0) return null;
  const total = overdue.reduce((s, i) => s + (i.amount ?? 0), 0);
  const top = [...overdue].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).slice(0, 15);
  const lines = [
    `${overdue.length} obrigação(ões) em atraso somando ${formatBRL(total)}`,
    ...top.map((i) => `• ${itemLine(i, includeReal)}`),
  ];
  const subject = `Vértice · ATENÇÃO: ${overdue.length} conta(s) em atraso`;
  const footer = includeReal ? FOOTER_REAL : FOOTER_TOKENS;
  void todayISO;
  return { subject, text: [subject, '', ...lines, '', footer].join('\n'), html: wrapHtml(subject, lines, footer) };
}

export function composeWeeklySummary(ctx: AnonymizedFinancialContext): OutgoingMessage {
  const h = ctx.healthSummary;
  const risk = ctx.cashRisk45d;
  const lines = [
    `Score de Saúde Financeira: ${h.healthScore}/100 (${h.classification})`,
    `Caixa livre: ${formatBRL(h.freeCash)} · Runway: ${h.runwayMonths !== null ? `${h.runwayMonths} meses` : 'n/d'}`,
    `Resultado líquido (${ctx.periodCurrentLabel}): ${formatBRL(h.netResultCurrent)} · margem ${h.netMarginPct.toFixed(1)}%`,
    `Receita bruta: ${formatBRL(h.grossRevenueCurrent)} (comparativo ${formatBRL(h.grossRevenueCompare)})`,
    `Próximos 45 dias: entradas ${formatBRL(risk.pendingInflows45d)} · saídas ${formatBRL(risk.pendingOutflows45d + risk.debtService45d + risk.taxOutflows45d)} · caixa projetado ${formatBRL(risk.projectedCash45d)}`,
    risk.hasCashRisk45d ? `⚠ Risco de caixa ${risk.riskSeverity === 'critical' ? 'CRÍTICO' : 'moderado'} nos próximos 45 dias.` : 'Sem risco de caixa projetado para 45 dias.',
    h.overdueInstallmentsCount + h.overdueTaxesCount > 0
      ? `Em atraso: ${h.overdueInstallmentsCount} parcela(s) de dívida e ${h.overdueTaxesCount} imposto(s).`
      : 'Nenhuma parcela de dívida ou imposto em atraso.',
  ];
  const subject = `Vértice · Resumo semanal de saúde financeira (${h.healthScore}/100)`;
  return { subject, text: [subject, '', ...lines, '', FOOTER_TOKENS].join('\n'), html: wrapHtml(subject, lines, FOOTER_TOKENS) };
}

export function composeCfoCriticalMessage(
  insights: Array<{ title: string; summary: string; impact: number }>
): OutgoingMessage | null {
  if (insights.length === 0) return null;
  const lines = insights.slice(0, 5).flatMap((i) => [`• ${i.title}`, `  ${i.summary} (impacto estimado ${formatBRL(i.impact)})`]);
  const subject = `Vértice · ${insights.length} alerta(s) crítico(s) do CFO Virtual`;
  return { subject, text: [subject, '', ...lines, '', FOOTER_TOKENS].join('\n'), html: wrapHtml(subject, lines, FOOTER_TOKENS) };
}

// ----------------------------------------------------------------------------
// Canais
// ----------------------------------------------------------------------------
async function sendEmail(to: string, message: OutgoingMessage): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.NOTIFY_EMAIL_FROM?.trim();
  if (!apiKey || !from) throw new Error('E-mail não configurado (RESEND_API_KEY / NOTIFY_EMAIL_FROM).');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: message.subject, html: message.html, text: message.text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function sendWhatsApp(number: string, message: OutgoingMessage): Promise<void> {
  const provider = (process.env.WHATSAPP_PROVIDER ?? 'evolution').trim().toLowerCase();
  const text = message.text.slice(0, 4000);
  if (provider === 'cloud_api') {
    const token = process.env.WHATSAPP_CLOUD_TOKEN?.trim();
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
    if (!token || !phoneId) throw new Error('WhatsApp Cloud API não configurada.');
    const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: number, type: 'text', text: { preview_url: false, body: text } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`WhatsApp Cloud ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return;
  }
  const baseUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  const instance = process.env.EVOLUTION_INSTANCE?.trim();
  if (!baseUrl || !apiKey || !instance) throw new Error('Evolution API não configurada.');
  const res = await fetch(`${baseUrl}/message/sendText/${encodeURIComponent(instance)}`, {
    method: 'POST',
    headers: { apikey: apiKey, 'Content-Type': 'application/json' },
    // "text" (Evolution v2) + "textMessage" (v1) para compatibilidade
    body: JSON.stringify({ number, text, textMessage: { text } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Evolution API ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/**
 * Envia por todos os canais habilitados, com dedupe por (tenant, canal, dedupe_key):
 * a linha de log é inserida ANTES do envio — se já existir, o alerta foi enviado e é pulado.
 */
export async function dispatchNotification(params: {
  prefs: NotificationPreferences;
  kind: NotificationKind;
  dedupeKey: string;
  message: OutgoingMessage;
  itemsCount: number;
}): Promise<Array<{ channel: NotificationChannel; status: 'sent' | 'failed' | 'skipped'; error?: string }>> {
  const admin = getSupabaseAdmin();
  const status = getChannelStatus();
  const targets: Array<{ channel: NotificationChannel; to: string }> = [];
  if (params.prefs.email_enabled && params.prefs.email_to && status.email) targets.push({ channel: 'email', to: params.prefs.email_to });
  if (params.prefs.whatsapp_enabled && params.prefs.whatsapp_number && status.whatsapp) targets.push({ channel: 'whatsapp', to: params.prefs.whatsapp_number });

  const results: Array<{ channel: NotificationChannel; status: 'sent' | 'failed' | 'skipped'; error?: string }> = [];
  for (const target of targets) {
    const { data: logRow, error: insertErr } = await admin
      .from('notification_logs')
      .insert({
        tenant_id: params.prefs.tenant_id,
        channel: target.channel,
        kind: params.kind,
        dedupe_key: params.dedupeKey,
        status: 'skipped',
        items_count: params.itemsCount,
      })
      .select('id')
      .single();
    if (insertErr) {
      results.push({ channel: target.channel, status: 'skipped', error: insertErr.code === '23505' ? 'já enviado' : insertErr.message });
      continue;
    }
    const logId = (logRow as { id: string }).id;
    try {
      if (target.channel === 'email') await sendEmail(target.to, params.message);
      else await sendWhatsApp(target.to, params.message);
      await admin.from('notification_logs').update({ status: 'sent' }).eq('id', logId);
      results.push({ channel: target.channel, status: 'sent' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'falha no envio';
      // Libera a dedupe_key original para que a próxima execução possa tentar de novo
      await admin
        .from('notification_logs')
        .update({
          status: 'failed',
          error_message: message.slice(0, 500),
          dedupe_key: `${params.dedupeKey}:failed:${logId}`,
        })
        .eq('id', logId);
      results.push({ channel: target.channel, status: 'failed', error: message });
    }
  }
  return results;
}
