import { CalendarDays, CheckCircle2, CircleAlert, CloudUpload, HardDriveDownload, Link2, Mail, MessageCircle, RefreshCw, Save, ShieldCheck, Unlink } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input, Label } from '../../components/ui/input';
import { StatusChip } from '../../components/ui/status-chip';
import { cn, formatDateTimeBR } from '../../lib/utils';
import { InfoTooltip } from '../core/components/InfoTooltip';
import { isSupabaseConfigured } from '../core/supabase';
import type { AuthSessionState } from '../core/types';
import { formatBytes, ModuleHeader, NativeSelect, Notice, SandboxGate, Toggle } from './components/moduleUi';
import {
  DEFAULT_EDITABLE_PREFERENCES,
  disconnectGoogleAccount,
  fetchAutomationStatus,
  fetchBackupLogs,
  fetchNotificationLogs,
  fetchPreferences,
  runBackupNow,
  runCalendarSyncNow,
  runDailyJobsNow,
  savePreferences,
  sendTestAlert,
  startGoogleConnect,
  verifyLatestBackup,
} from './integrationsApi';
import type { AutomationStatus, BackupLogRow, EditablePreferences, NotificationLogRow } from './types';

interface AutomationCenterViewProps {
  session: AuthSessionState;
  initialMessage?: { tone: 'success' | 'error'; text: string } | null;
}

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const CheckRow: React.FC<{ ok: boolean; label: string; hint: string }> = ({ ok, label, hint }) => (
  <div className="flex items-start gap-2 py-1.5 text-[12px]">
    {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#047857] dark:text-[#68DBA9]" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#B45309] dark:text-[#FCD34D]" />}
    <div>
      <p className="font-medium text-[#0F172A] dark:text-[#EAF1FF]">{label}</p>
      {!ok && <p className="font-mono text-[11px] text-[#72787D]">{hint}</p>}
    </div>
  </div>
);

export const AutomationCenterView: React.FC<AutomationCenterViewProps> = ({ session, initialMessage }) => {
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [prefs, setPrefs] = useState<EditablePreferences>(DEFAULT_EDITABLE_PREFERENCES);
  const [prefsExist, setPrefsExist] = useState(false);
  const [meta, setMeta] = useState<{ lastDaily: string | null; lastCalendar: string | null }>({ lastDaily: null, lastCalendar: null });
  const [backupLogs, setBackupLogs] = useState<BackupLogRow[]>([]);
  const [notifLogs, setNotifLogs] = useState<NotificationLogRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error' | 'info' | 'warning'; text: string } | null>(initialMessage ?? null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const [st, p, bl, nl] = await Promise.all([fetchAutomationStatus(), fetchPreferences(), fetchBackupLogs(), fetchNotificationLogs()]);
      setStatus(st);
      if (p) {
        const { tenant_id: _t, drive_folder_id: _d, last_daily_run_at, last_weekly_summary_at: _w, last_calendar_sync_at, ...editable } = p;
        setPrefs({ ...DEFAULT_EDITABLE_PREFERENCES, ...editable });
        setMeta({ lastDaily: last_daily_run_at, lastCalendar: last_calendar_sync_at });
        setPrefsExist(true);
      } else {
        setPrefs({ ...DEFAULT_EDITABLE_PREFERENCES, email_to: session.email });
      }
      setBackupLogs(bl);
      setNotifLogs(nl);
      setDirty(false);
    } catch (err) {
      setFeedback({ tone: 'error', text: err instanceof Error ? err.message : 'Falha ao carregar a central.' });
    }
  }, [session.email]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = <K extends keyof EditablePreferences>(key: K, value: EditablePreferences[K]) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    setDirty(true);
  };

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    setFeedback(null);
    try {
      const msg = await fn();
      if (msg) setFeedback({ tone: 'success', text: msg });
      await load();
    } catch (err) {
      setFeedback({ tone: 'error', text: err instanceof Error ? err.message : 'Operação falhou.' });
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run('save', async () => {
      await savePreferences(session.userId, prefs, prefsExist);
      return 'Preferências salvas.';
    });

  const google = status?.google;
  const lastBackup = backupLogs.find((b) => b.status === 'success');

  return (
    <div className="space-y-6">
      <ModuleHeader
        eyebrow="Automação & Continuidade"
        title="Alertas, Agenda & Backup"
        description="Vencimentos no Google Calendar, alertas por e-mail e WhatsApp (anonimizados por padrão) e backup diário criptografado no seu Google Drive."
        actions={
          <>
            <Button variant="outline" disabled={busy !== null} onClick={() => void run('daily', async () => {
              const r = await runDailyJobsNow();
              return `Rotina diária executada: ${JSON.stringify({ agenda: r.calendar ?? 'off', alertas: (r.notifications as unknown[] | undefined)?.length ?? 0, backup: (r.backup as { status?: string } | undefined)?.status ?? 'off' })}`;
            })}>
              <RefreshCw className={cn('h-4 w-4', busy === 'daily' && 'animate-spin')} />
              <span>Executar rotina agora</span>
            </Button>
            <Button disabled={!dirty || busy !== null} onClick={() => void save()}>
              <Save className="h-4 w-4" />
              <span>Salvar preferências</span>
            </Button>
          </>
        }
      />

      <SandboxGate isSandbox={!isSupabaseConfigured}>
        {feedback && <Notice tone={feedback.tone}>{feedback.text}</Notice>}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Prontidão do servidor */}
          <Card>
            <CardHeader>
              <CardTitle>Configuração do servidor</CardTitle>
              <CardDescription>Variáveis no .env do servidor (os valores nunca chegam ao navegador).</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {status ? (
                <>
                  <CheckRow ok={status.credentialsKeyConfigured} label="Cofre de credenciais" hint="CREDENTIALS_ENCRYPTION_KEY" />
                  <CheckRow ok={status.backupKeyConfigured} label="Chave do backup" hint="BACKUP_ENCRYPTION_KEY" />
                  <CheckRow ok={status.googleOAuthConfigured} label="Google OAuth" hint="GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET" />
                  <CheckRow ok={status.channels.email} label="E-mail (Resend)" hint="RESEND_API_KEY / NOTIFY_EMAIL_FROM" />
                  <CheckRow ok={status.channels.whatsapp} label={`WhatsApp${status.channels.whatsappProvider ? ` (${status.channels.whatsappProvider})` : ''}`} hint="EVOLUTION_API_* ou WHATSAPP_CLOUD_*" />
                  <CheckRow ok={status.cronSecretConfigured || status.internalScheduler} label="Agendamento diário" hint="CRON_SECRET ou ENABLE_INTERNAL_SCHEDULER=true" />
                  <div className="mt-3 space-y-1 border-t border-[#E2E8F0] pt-3 text-[11px] text-[#72787D] dark:border-[#1E2F3F]">
                    <p>URL pública: <span className="font-mono">{status.publicBaseUrl}</span></p>
                    <p>Redirect OAuth: <span className="break-all font-mono">{status.googleRedirectUri}</span></p>
                    {meta.lastDaily && <p>Última rotina: {formatDateTimeBR(meta.lastDaily)}</p>}
                  </div>
                </>
              ) : (
                <p className="text-[12px] text-[#72787D]">Carregando…</p>
              )}
            </CardContent>
          </Card>

          {/* Google */}
          <Card>
            <CardHeader>
              <CardTitle>Conta Google</CardTitle>
              <CardDescription>Acesso mínimo: apenas arquivos criados pelo app no Drive e eventos da agenda.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {google?.connected ? (
                <>
                  <div className="flex items-center gap-2">
                    <StatusChip variant="positive">Conectada</StatusChip>
                    <span className="truncate text-[13px]">{google.email ?? 'conta Google'}</span>
                  </div>
                  <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void run('gdis', async () => {
                    if (!window.confirm('Desconectar o Google? Backups agendados e a sincronização da agenda param.')) return;
                    await disconnectGoogleAccount();
                    return 'Conta Google desconectada e acesso revogado.';
                  })}>
                    <Unlink className="h-3.5 w-3.5" />
                    Desconectar
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-[12px] text-[#42484C] dark:text-[#9DB0C2]">Necessária para backup no Drive e sincronização com o Calendar.</p>
                  <Button disabled={!status?.googleOAuthConfigured || !status?.credentialsKeyConfigured || busy !== null} onClick={() => void run('gcon', async () => startGoogleConnect())}>
                    <Link2 className="h-4 w-4" />
                    Conectar Google
                  </Button>
                </>
              )}

              <div className="border-t border-[#E2E8F0] pt-3 dark:border-[#1E2F3F]">
                <Toggle id="cal-sync" checked={prefs.calendar_sync_enabled} onChange={(v) => update('calendar_sync_enabled', v)} label="Sincronizar vencimentos no Calendar" description="Contas a pagar, parcelas, impostos e marcos de projetos (início, fim, payback)." />
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="cal-id">Agenda</Label>
                    <Input id="cal-id" value={prefs.calendar_id} onChange={(e) => update('calendar_id', e.target.value)} placeholder="primary" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cal-days">Dias à frente</Label>
                    <Input id="cal-days" type="number" min={7} max={365} value={prefs.calendar_days_ahead} onChange={(e) => update('calendar_days_ahead', Math.min(365, Math.max(7, Number(e.target.value) || 60)))} />
                  </div>
                </div>
                <Button className="mt-3" size="sm" variant="outline" disabled={!google?.connected || busy !== null} onClick={() => void run('cal', async () => {
                  const r = await runCalendarSyncNow();
                  return `Agenda sincronizada: ${r.created} criado(s), ${r.updated} atualizado(s), ${r.deleted} removido(s), ${r.unchanged} sem mudança${r.errors.length ? ` · ${r.errors.length} erro(s)` : ''}.`;
                })}>
                  <CalendarDays className="h-3.5 w-3.5" />
                  Sincronizar agora
                </Button>
                {meta.lastCalendar && <p className="mt-1 text-[11px] text-[#72787D]">Última sincronização: {formatDateTimeBR(meta.lastCalendar)}</p>}
              </div>
            </CardContent>
          </Card>

          {/* Backup */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle>Backup blindado</CardTitle>
                <InfoTooltip glossaryKey="backup_blindado" />
              </div>
              <CardDescription>AES-256-GCM antes de sair do servidor · retenção no Drive.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <Toggle id="bk-enabled" checked={prefs.backup_enabled} onChange={(v) => update('backup_enabled', v)} label="Backup diário automático" description="Requer Google conectado e agendamento diário ativo." />
              <div className="space-y-1">
                <Label htmlFor="bk-ret">Manter os últimos</Label>
                <NativeSelect id="bk-ret" value={String(prefs.backup_retention_count)} onChange={(e) => update('backup_retention_count', Number(e.target.value))} options={[7, 15, 30, 60, 90].map((n) => ({ value: String(n), label: `${n} backups` }))} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!status?.backupKeyConfigured || busy !== null} onClick={() => void run('bk', async () => {
                  const r = await runBackupNow();
                  return r.mode === 'download'
                    ? `Backup cifrado baixado (${r.fileName}). Google não conectado: guarde o arquivo em local seguro. SHA-256 ${r.sha256.slice(0, 16)}…`
                    : `Backup cifrado enviado ao Google Drive (${formatBytes(Number(r.summary.sizeBytes))}, ${String(r.summary.rowsCount)} linhas${Number(r.summary.deletedOldBackups) ? `, ${String(r.summary.deletedOldBackups)} antigo(s) removido(s)` : ''}).`;
                })}>
                  {google?.connected ? <CloudUpload className="h-3.5 w-3.5" /> : <HardDriveDownload className="h-3.5 w-3.5" />}
                  {busy === 'bk' ? 'Gerando…' : 'Executar backup criptografado agora'}
                </Button>
                <Button size="sm" variant="outline" disabled={!lastBackup || !google?.connected || busy !== null} onClick={() => void run('verify', async () => {
                  const r = await verifyLatestBackup();
                  return r.sha256Matches
                    ? `Restauração verificada: ${r.fileName} baixado do Drive, SHA-256 confere, decifrado com sucesso (${r.rowsInFile} linhas em ${r.tables.length} tabelas).`
                    : 'ATENÇÃO: o SHA-256 do arquivo no Drive não confere com o registrado.';
                })}>
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Verificar último backup
                </Button>
              </div>
              <p className="text-[11px] text-[#72787D]">Para restaurar: <span className="font-mono">npm run restore-backup -- arquivo.vtxbak --sql restore.sql</span></p>
            </CardContent>
          </Card>
        </div>

        {/* Alertas */}
        <Card>
          <CardHeader>
            <CardTitle>Alertas por e-mail e WhatsApp</CardTitle>
            <CardDescription>Por padrão as mensagens trazem apenas tokens do Cofre (EMP_01, CTA_02) e valores — sem nomes de clientes, fornecedores ou descrições.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-6 pt-0 lg:grid-cols-2">
            <div className="space-y-2">
              <Toggle id="em-on" checked={prefs.email_enabled} onChange={(v) => update('email_enabled', v)} label="E-mail" />
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-[#72787D]" />
                <Input aria-label="E-mail para alertas" type="email" value={prefs.email_to ?? ''} onChange={(e) => update('email_to', e.target.value)} placeholder="voce@empresa.com" />
              </div>
              <Toggle id="wa-on" checked={prefs.whatsapp_enabled} onChange={(v) => update('whatsapp_enabled', v)} label="WhatsApp" />
              <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-[#72787D]" />
                <Input aria-label="Número de WhatsApp" inputMode="numeric" value={prefs.whatsapp_number ?? ''} onChange={(e) => update('whatsapp_number', e.target.value)} placeholder="5511999998888" />
              </div>
              <Button size="sm" variant="outline" disabled={busy !== null || dirty} title={dirty ? 'Salve as preferências antes de testar' : undefined} onClick={() => void run('test', async () => {
                const r = await sendTestAlert();
                return r.results.map((x) => `${x.channel}: ${x.status}${x.error ? ` (${x.error})` : ''}`).join(' · ');
              })}>
                Enviar teste
              </Button>
              <Notice tone="info" className="text-[12px]">
                WhatsApp Cloud API só entrega texto livre dentro da janela de 24h de conversa; fora dela exige template aprovado. A Evolution API não tem essa restrição.
              </Notice>
            </div>
            <div className="space-y-1">
              <Toggle checked={prefs.notify_due_today} onChange={(v) => update('notify_due_today', v)} label="Vencimentos do dia" />
              <Toggle checked={prefs.notify_overdue} onChange={(v) => update('notify_overdue', v)} label="Contas em atraso" />
              <Toggle checked={prefs.notify_cfo_critical} onChange={(v) => update('notify_cfo_critical', v)} label="Alertas críticos do CFO Virtual" />
              <Toggle checked={prefs.notify_weekly_summary} onChange={(v) => update('notify_weekly_summary', v)} label="Resumo semanal de saúde financeira" />
              <div className="pl-0 sm:max-w-[200px]">
                <NativeSelect aria-label="Dia do resumo semanal" value={String(prefs.weekly_summary_weekday)} onChange={(e) => update('weekly_summary_weekday', Number(e.target.value))} options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} />
              </div>
              <div className="border-t border-[#E2E8F0] pt-2 dark:border-[#1E2F3F]">
                <Toggle
                  checked={prefs.include_real_labels}
                  onChange={(v) => update('include_real_labels', v)}
                  label="Incluir nomes reais nas mensagens e na agenda"
                  description="Desligado (recomendado): Google, Meta e o provedor de e-mail só veem tokens e valores."
                />
                {prefs.include_real_labels && <Notice tone="warning" className="mt-1 text-[12px]">Com esta opção, descrições e nomes reais passam a trafegar por serviços externos (Google, Meta/WhatsApp, Resend).</Notice>}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Logs */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Saúde dos backups</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {backupLogs.length === 0 ? (
                <p className="text-[12px] text-[#72787D]">Nenhum backup executado ainda.</p>
              ) : (
                <ul className="divide-y divide-[#F1F5F9] text-[12px] dark:divide-[#162838]">
                  {backupLogs.slice(0, 10).map((b) => (
                    <li key={b.id} className="flex items-start justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="font-medium tabular-nums">{formatDateTimeBR(b.started_at)} · {b.trigger_source === 'cron' ? 'agendado' : 'manual'} · {b.destination === 'google_drive' ? 'Drive' : 'download'}</p>
                        <p className="truncate font-mono text-[11px] text-[#72787D]">{b.sha256 ? `sha256 ${b.sha256.slice(0, 20)}…` : b.error_message ?? ''}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <StatusChip variant={b.status === 'success' ? 'positive' : b.status === 'failed' ? 'alert' : 'neutral'}>{b.status}</StatusChip>
                        <span className="text-[11px] text-[#72787D]">{formatBytes(b.size_bytes)}{b.verified_at ? ' · verificado' : ''}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Alertas enviados</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {notifLogs.length === 0 ? (
                <p className="text-[12px] text-[#72787D]">Nenhum alerta enviado ainda.</p>
              ) : (
                <ul className="divide-y divide-[#F1F5F9] text-[12px] dark:divide-[#162838]">
                  {notifLogs.slice(0, 10).map((n) => (
                    <li key={n.id} className="flex items-start justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="font-medium">{formatDateTimeBR(n.created_at)} · {n.channel} · {n.kind}</p>
                        {n.error_message && <p className="truncate text-[11px] text-[#72787D]">{n.error_message}</p>}
                      </div>
                      <StatusChip variant={n.status === 'sent' ? 'positive' : n.status === 'failed' ? 'alert' : 'neutral'}>{n.status}</StatusChip>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </SandboxGate>
    </div>
  );
};
