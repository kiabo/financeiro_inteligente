import { CheckCircle2, CircleAlert, Database, HardDriveDownload, RefreshCw } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { StatusChip } from '../../components/ui/status-chip';
import { formatDateTimeBR } from '../../lib/utils';
import { Notice } from '../integrations/components/moduleUi';
import { fetchDbStatus, runDbBackupNow, type DbStatus, type UsageReading } from './dbOpsApi';
import { backupHourLabel, formatBytes, formatPct, usageBarClass, usageBarWidth } from './dbOpsFormat';

const UsageBar: React.FC<{ label: string; reading: UsageReading }> = ({ label, reading }) => (
  <div className="space-y-1.5">
    <div className="flex items-baseline justify-between gap-3 text-[13px]">
      <span className="font-medium text-[#0F172A] dark:text-[#EAF1FF]">{label}</span>
      <span className="tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
        {formatBytes(reading.bytes)} de {formatBytes(reading.limitBytes)} · {formatPct(reading.pct)}
      </span>
    </div>
    <div
      className="h-2.5 w-full overflow-hidden rounded-full bg-[#E2E8F0] dark:bg-[#1E2F3F]"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(reading.pct)}
    >
      <div className={`h-full rounded-full ${usageBarClass(reading.level)}`} style={{ width: usageBarWidth(reading.pct) }} />
    </div>
  </div>
);

const Check: React.FC<{ ok: boolean; okText: string; badText: string }> = ({ ok, okText, badText }) => (
  <li className="flex items-start gap-2 text-[13px]">
    {ok ? (
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#0F7A5C] dark:text-[#68DBA9]" />
    ) : (
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#D97706] dark:text-[#FBBF24]" />
    )}
    <span className="text-[#42484C] dark:text-[#9DB0C2]">{ok ? okText : badText}</span>
  </li>
);

/** Aba "Banco e backups" (somente owner/admin): uso do plano, último backup do banco e estado da configuração. */
export const PlanUsagePanel: React.FC = () => {
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setStatus(await fetchDbStatus());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar o estado do banco.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRun = async () => {
    setRunning(true);
    setFeedback(null);
    try {
      const { lastBackup } = await runDbBackupNow();
      if (lastBackup.status === 'success') {
        setFeedback({
          tone: 'success',
          text: `Backup concluído (${formatBytes(lastBackup.sizeBytes ?? 0)})${lastBackup.driveUploaded ? ' e copiado para o Google Drive' : ''}.${
            lastBackup.driveError ? ` Mas a cópia no Drive falhou: ${lastBackup.driveError}` : ''
          }`,
        });
      } else {
        setFeedback({ tone: 'error', text: `O backup falhou: ${lastBackup.error ?? 'motivo desconhecido'}` });
      }
      await load();
    } catch (err) {
      setFeedback({ tone: 'error', text: err instanceof Error ? err.message : 'Não foi possível iniciar o backup.' });
    } finally {
      setRunning(false);
    }
  };

  const last = status?.lastBackup ?? null;
  const warn = status?.usage && status.usage.level !== 'ok';

  return (
    <div className="space-y-6">
      {feedback && <Notice tone={feedback.tone}>{feedback.text}</Notice>}
      {loadError && <Notice tone="error">{loadError}</Notice>}

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Uso do plano gratuito</CardTitle>
            <CardDescription>Tamanho do banco e dos arquivos guardados, comparado com os limites do plano.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {status?.usage ? (
            <>
              <UsageBar label="Banco de dados" reading={status.usage.db} />
              <UsageBar label="Armazenamento de arquivos" reading={status.usage.storage} />
              {warn && (
                <Notice tone={status.usage.level === 'critical' ? 'error' : 'warning'}>
                  {status.usage.level === 'critical'
                    ? 'O uso está quase no limite do plano. Ao estourar, o projeto pode ser restringido: libere espaço ou avalie mudar de plano.'
                    : 'O uso passou de 70% do limite. Vale acompanhar antes de chegar perto do teto.'}
                </Notice>
              )}
            </>
          ) : (
            <p className="text-[13px] text-[#42484C] dark:text-[#9DB0C2]">
              {loading
                ? 'Medindo…'
                : status && !status.configured.dbUrl
                  ? 'O uso não pode ser medido porque o servidor ainda não está ligado ao banco para esta função.'
                  : (status?.usageError ?? 'Sem medição disponível.')}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Backup do banco</CardTitle>
            <CardDescription>
              Uma cópia cifrada do banco inteiro, todos os dias às {backupHourLabel(status?.nextRunHour ?? 3)} (horário de Brasília), guardada no servidor e no seu Google Drive.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => void handleRun()} disabled={running || loading || !status?.configured.dbUrl || !status?.configured.backupKey}>
            <HardDriveDownload className="h-3.5 w-3.5" />
            {running ? 'Fazendo backup…' : 'Fazer backup do banco agora'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {last ? (
            <div className="space-y-1.5 text-[13px] text-[#42484C] dark:text-[#9DB0C2]">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip variant={last.status === 'success' ? 'positive' : 'alert'}>{last.status === 'success' ? 'Último backup: sucesso' : 'Último backup: falhou'}</StatusChip>
                <span>{formatDateTimeBR(last.at)}</span>
                <span>· {last.trigger === 'manual' ? 'manual' : 'automático'}</span>
              </div>
              {last.status === 'success' ? (
                <>
                  <p>
                    Arquivo de {formatBytes(last.sizeBytes ?? 0)} · cópia no Google Drive: <strong>{last.driveUploaded ? 'sim' : 'não'}</strong>
                    {last.driveError ? <span className="text-[#B45309] dark:text-[#FBBF24]"> ({last.driveError})</span> : null}
                  </p>
                  {last.sha256 && (
                    <p className="break-all font-mono text-[11px] text-[#72787D]">SHA-256 {last.sha256}</p>
                  )}
                </>
              ) : (
                <p className="text-[#991B1B] dark:text-[#FCA5A5]">{last.error}</p>
              )}
              {status && status.lastSuccessAt && last.status === 'failed' && (
                <p>Último backup bem-sucedido: {formatDateTimeBR(status.lastSuccessAt)}.</p>
              )}
            </div>
          ) : (
            <p className="text-[13px] text-[#42484C] dark:text-[#9DB0C2]">{loading ? 'Carregando…' : 'Nenhum backup do banco foi feito ainda.'}</p>
          )}
          {status && <p className="text-[12px] text-[#72787D]">{status.retained} arquivo(s) guardado(s) no servidor (mantemos os 14 mais recentes).</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Situação da configuração
          </CardTitle>
          <CardDescription>O que precisa estar ligado para o backup e os avisos funcionarem.</CardDescription>
        </CardHeader>
        <CardContent>
          {status ? (
            <ul className="space-y-2">
              <Check ok={status.configured.dbUrl} okText="Servidor ligado ao banco para backup e medição." badText="Falta ligar o servidor ao banco (configuração feita no servidor)." />
              <Check ok={status.configured.backupKey} okText="Chave de cifragem dos backups definida." badText="Falta a chave de cifragem dos backups no servidor. Nenhum backup é gerado sem ela." />
              <Check ok={status.configured.drive} okText="Google Drive conectado: a cópia do backup é enviada para lá." badText="Google Drive não conectado (ou titular da instância não definido): o backup fica só no servidor." />
              <Check ok={status.configured.alerts} okText="Avisos por e-mail/WhatsApp ligados para falha de backup e uso acima de 70%." badText="Avisos desligados: o titular da instância não está definido no servidor." />
            </ul>
          ) : (
            <p className="text-[13px] text-[#42484C] dark:text-[#9DB0C2]">{loading ? 'Carregando…' : '—'}</p>
          )}
          <p className="mt-4 text-[12px] text-[#72787D]">
            Guarde a chave de cifragem fora do servidor: sem ela, nenhum backup pode ser restaurado.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
