import { todayInSaoPaulo } from '../alerts/dateUtils.ts';
import { dispatchNotification, wrapHtml, type NotificationKind, type OutgoingMessage } from '../alerts/notificationService.ts';
import type { PlanUsage, UsageReading } from './planUsage.ts';

/**
 * Alertas do backup do banco e do uso do plano (spec 006), pelos canais que já existem (e-mail e WhatsApp).
 * As mensagens trazem só tamanhos e porcentagens: nenhum dado do cliente, senha ou chave.
 */

export type AlertResult = Array<{ channel: string; status: 'sent' | 'failed' | 'skipped'; error?: string }>;

/** Entrega uma mensagem ao titular da instância; `null` quando ele não está configurado (alertas desligados). */
export type AlertSink = (kind: NotificationKind, dedupeKey: string, message: OutgoingMessage) => Promise<AlertResult>;

const FOOTER = 'Mensagem automática do monitor de banco e backups. Detalhes em Segurança & SQL → Banco e backups.';

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;

export function composeBackupFailedMessage(error: string, at: Date, brandName = 'Vértice'): OutgoingMessage {
  const subject = `${brandName} · ATENÇÃO: o backup do banco falhou`;
  const lines = [
    `O backup do banco de dados não foi concluído em ${todayInSaoPaulo(at).split('-').reverse().join('/')}.`,
    `Motivo: ${error}`,
    'Enquanto isso, o último backup bem-sucedido continua guardado. Abra Segurança & SQL → Banco e backups para ver o estado e tentar de novo.',
  ];
  return { subject, text: [subject, '', ...lines, '', FOOTER].join('\n'), html: wrapHtml(subject, lines, FOOTER) };
}

const resourceLine = (label: string, r: UsageReading) => `${label}: ${mb(r.bytes)} de ${mb(r.limitBytes)} (${String(r.pct).replace('.', ',')}%)`;

/** `null` quando está tudo abaixo de 70%. */
export function composeUsageMessage(usage: PlanUsage, brandName = 'Vértice'): OutgoingMessage | null {
  if (usage.level === 'ok') return null;
  const critical = usage.level === 'critical';
  const subject = `${brandName} · ${critical ? 'ATENÇÃO: uso do plano quase no limite' : 'Aviso: uso do plano passou de 70%'}`;
  const lines = [
    resourceLine('Banco de dados', usage.db),
    resourceLine('Armazenamento de arquivos', usage.storage),
    critical
      ? 'O plano Free tem limite fixo: ao estourar, o projeto pode ser restringido. Libere espaço ou avalie mudar de plano.'
      : 'Vale acompanhar: o plano Free tem limite fixo de banco (500 MB) e de arquivos (1 GB).',
  ];
  return { subject, text: [subject, '', ...lines, '', FOOTER].join('\n'), html: wrapHtml(subject, lines, FOOTER) };
}

/** Semana ISO (AAAA-Www) de uma data AAAA-MM-DD, para lembrar no máximo uma vez por semana. */
export function isoWeekKey(dateISO: string): string {
  const d = new Date(`${dateISO}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // segunda = 0
  d.setUTCDate(d.getUTCDate() - day + 3); // quinta-feira da semana
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Um alerta de falha por dia (de São Paulo). Sem destinatário configurado, devolve `null`. */
export async function sendBackupFailedAlert(sink: AlertSink | null, error: string, at: Date, brandName?: string): Promise<AlertResult | null> {
  if (!sink) return null;
  return sink('backup_failed', `backup_failed:${todayInSaoPaulo(at)}`, composeBackupFailedMessage(error, at, brandName));
}

/** Um lembrete por semana para cada combinação de níveis; subir de aviso para crítico avisa na hora. */
export async function sendUsageAlert(sink: AlertSink | null, usage: PlanUsage, now: Date, brandName?: string): Promise<AlertResult | null> {
  if (!sink) return null;
  const message = composeUsageMessage(usage, brandName);
  if (!message) return [];
  const key = `usage_high:db-${usage.db.level}:storage-${usage.storage.level}:${isoWeekKey(todayInSaoPaulo(now))}`;
  return sink('usage_high', key, message);
}

/** Destinatário real: as preferências de alerta (e-mail/WhatsApp) do titular da instância. */
export async function createOwnerAlertSink(tenantId: string | undefined): Promise<AlertSink | null> {
  if (!tenantId) return null;
  const { loadPreferences } = await import('../dailyJobs.ts');
  return async (kind, dedupeKey, message) => {
    const prefs = await loadPreferences(tenantId);
    return dispatchNotification({ prefs, kind, dedupeKey, message, itemsCount: 1 });
  };
}
