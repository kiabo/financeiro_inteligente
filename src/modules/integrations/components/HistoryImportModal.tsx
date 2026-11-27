import { CheckCircle2, Download, Loader2, RotateCw, XCircle } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Input, Label } from '../../../components/ui/input';
import type { FinancialAccount } from '../../core/types';
import { cancelHistoryImport, fetchLatestHistoryImport, startHistoryImport, stepHistoryImport } from '../integrationsApi';
import { presetPeriod, validateHistoryPeriod } from '../historyPeriod';
import { PROVIDER_LABELS, type HistoryImportRun, type IntegrationConnection } from '../types';
import { NativeSelect, Notice } from './moduleUi';

interface HistoryImportModalProps {
  connection: IntegrationConnection | null;
  /** Contas da empresa da conexão (os lançamentos herdam a empresa) */
  accounts: FinancialAccount[];
  onClose: () => void;
  /** Chamado ao terminar (ou fechar com progresso) para recarregar eventos e lançamentos */
  onFinished: () => void;
}

/** Data de hoje no fuso de São Paulo (mesma regra do servidor). */
const todayISO = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const presetRange = (months: number): { start: string; end: string } => presetPeriod(months, todayISO());

const PRESETS = [3, 6, 12] as const;
const formatBR = (iso: string) => iso.split('-').reverse().join('/');

const COUNTERS: Array<{ key: keyof HistoryImportRun['counts']; label: string }> = [
  { key: 'created', label: 'Importados' },
  { key: 'updated', label: 'Atualizados' },
  { key: 'ignored', label: 'Ignorados' },
  { key: 'marked_apart', label: 'Cancelados/estornados' },
  { key: 'failed', label: 'Erros' },
];

export const HistoryImportModal: React.FC<HistoryImportModalProps> = ({ connection, accounts, onClose, onFinished }) => {
  const initial = useMemo(() => presetRange(3), []);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [accountId, setAccountId] = useState('');
  const [run, setRun] = useState<HistoryImportRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [loadingLatest, setLoadingLatest] = useState(false);
  const stopRef = useRef(false);
  const touchedRef = useRef(false);

  const provider = connection?.provider === 'asaas' || connection?.provider === 'mercadopago' ? connection.provider : null;
  const providerName = connection ? PROVIDER_LABELS[connection.provider] : 'provedor';

  // Ao abrir: limpa e procura uma execução em andamento ou interrompida para oferecer "Retomar"
  useEffect(() => {
    if (!connection) return;
    stopRef.current = false;
    touchedRef.current = false;
    const fresh = presetRange(3);
    setStart(fresh.start);
    setEnd(fresh.end);
    setAccountId('');
    setRun(null);
    setError(null);
    setWorking(false);
    let cancelled = false;
    setLoadingLatest(true);
    fetchLatestHistoryImport(connection.id)
      .then((latest) => {
        if (!cancelled && latest && (latest.status === 'running' || latest.status === 'failed')) setRun(latest);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoadingLatest(false));
    return () => {
      cancelled = true;
      stopRef.current = true;
    };
  }, [connection]);

  const periodCheck = useMemo(
    () => (provider ? validateHistoryPeriod({ start, end, today: todayISO(), provider }) : null),
    [provider, start, end]
  );
  const periodError = periodCheck && !periodCheck.ok ? periodCheck.message : null;

  /** Processa lotes até concluir, falhar, cancelar ou o modal ser fechado. */
  const drive = useCallback(
    async (initialRun: HistoryImportRun) => {
      setWorking(true);
      setError(null);
      let current = initialRun;
      try {
        while (!stopRef.current) {
          current = await stepHistoryImport(current.id);
          touchedRef.current = true;
          setRun(current);
          if (current.status !== 'running') break;
        }
        if (current.status === 'completed') onFinished();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Falha ao processar a importação. Use "Retomar" para continuar.');
      } finally {
        setWorking(false);
      }
    },
    [onFinished]
  );

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connection) return;
    setError(null);
    if (!accountId) {
      setError('Escolha a conta de destino da importação.');
      return;
    }
    if (periodError) {
      setError(periodError);
      return;
    }
    setWorking(true);
    try {
      const started = await startHistoryImport(connection.id, { period_start: start, period_end: end, account_id: accountId });
      stopRef.current = false;
      touchedRef.current = true;
      setRun(started);
      await drive(started);
    } catch (err) {
      setWorking(false);
      setError(err instanceof Error ? err.message : 'Não foi possível iniciar a importação.');
    }
  };

  const handleResume = async () => {
    if (!run) return;
    stopRef.current = false;
    await drive(run);
  };

  const handleCancel = async () => {
    if (!run) return;
    stopRef.current = true;
    try {
      setRun(await cancelHistoryImport(run.id));
      onFinished();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível cancelar.');
    }
  };

  const handleClose = () => {
    stopRef.current = true;
    if (touchedRef.current) onFinished();
    onClose();
  };

  const active = run && (run.status === 'running' || run.status === 'failed');
  const finished = run && (run.status === 'completed' || run.status === 'canceled');
  const progressPct = run ? Math.min(100, Math.round(((run.status === 'completed' ? run.window_total : run.window_index) / Math.max(1, run.window_total)) * 100)) : 0;

  return (
    <Dialog open={connection !== null} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Importar histórico — {connection?.label}</DialogTitle>
          <DialogDescription>
            Busca no {providerName} as cobranças criadas no período e cria os lançamentos. O sistema apenas lê dados do {providerName}; nada é alterado lá.
            Importar o mesmo período de novo não duplica lançamentos.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          {error && <Notice tone="error">{error}</Notice>}
          {loadingLatest && !run && <p className="text-[12px] text-[#72787D]">Verificando importações anteriores…</p>}

          {!run && (
            <form onSubmit={(e) => void handleStart(e)} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Período</Label>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((months) => (
                    <Button
                      key={months}
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={working}
                      onClick={() => {
                        const r = presetRange(months);
                        setStart(r.start);
                        setEnd(r.end);
                      }}
                    >
                      Últimos {months} meses
                    </Button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="hist-start">De</Label>
                    <Input id="hist-start" type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="hist-end">Até</Label>
                    <Input id="hist-end" type="date" required value={end} onChange={(e) => setEnd(e.target.value)} />
                  </div>
                </div>
                {periodError ? (
                  <p className="text-[12px] text-[#991B1B] dark:text-[#FCA5A5]">{periodError}</p>
                ) : (
                  <p className="text-[11px] text-[#72787D]">Cobranças criadas no período, no máximo 12 meses por importação.</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="hist-account">Conta de destino *</Label>
                <NativeSelect
                  id="hist-account"
                  required
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  placeholder="Selecione a conta"
                  options={accounts.map((a) => ({ value: a.id, label: a.name }))}
                />
                <p className="text-[11px] text-[#72787D]">
                  Os lançamentos importados entram nesta conta, mesmo que seja diferente da conta de recebimento configurada na conexão.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={handleClose}>
                  Fechar
                </Button>
                <Button type="submit" disabled={working || !accountId || Boolean(periodError)}>
                  {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Importar histórico
                </Button>
              </div>
            </form>
          )}

          {run && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
                  <span>
                    {formatBR(run.period_start)} a {formatBR(run.period_end)}
                  </span>
                  <span>
                    {run.status === 'completed'
                      ? 'Concluída'
                      : run.status === 'canceled'
                        ? 'Cancelada'
                        : run.status === 'failed'
                          ? 'Interrompida'
                          : run.phase === 'customers'
                            ? 'Preparando a lista de clientes…'
                            : `Mês ${Math.min(run.window_index + 1, run.window_total)} de ${run.window_total}`}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#E2E8F0] dark:bg-[#1E2F3F]" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-[#0F374A] transition-all dark:bg-[#68DBA9]" style={{ width: `${progressPct}%` }} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {COUNTERS.map((c) => (
                  <div key={c.key} className="rounded-[6px] border border-[#E2E8F0] px-2.5 py-2 dark:border-[#1E2F3F]">
                    <p className="text-[18px] font-semibold tabular-nums">{run.counts[c.key]}</p>
                    <p className="text-[11px] leading-4 text-[#72787D]">{c.label}</p>
                  </div>
                ))}
              </div>

              {run.status === 'failed' && run.last_error && <Notice tone="error">{run.last_error}</Notice>}
              {run.status === 'completed' && (
                <Notice tone="success">
                  <span className="inline-flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    Importação concluída. Os lançamentos já estão disponíveis; cancelados e estornados aparecem marcados e não alteram o saldo.
                  </span>
                </Notice>
              )}
              {run.status === 'canceled' && (
                <Notice tone="info">
                  <span className="inline-flex items-center gap-2">
                    <XCircle className="h-4 w-4" />
                    Importação cancelada. O que já foi importado foi mantido.
                  </span>
                </Notice>
              )}
              {run.errors.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[12px] font-semibold">Pagamentos com erro (reimportar tenta de novo só o que faltou)</p>
                  <ul className="max-h-28 space-y-0.5 overflow-y-auto text-[11px] text-[#72787D]">
                    {run.errors.slice(0, 10).map((er) => (
                      <li key={`${er.ref}-${er.message}`}>
                        <span className="font-mono">{er.ref}</span> — {er.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-2">
                {active && working && (
                  <Button variant="outline" onClick={() => void handleCancel()}>
                    Cancelar importação
                  </Button>
                )}
                {active && !working && (
                  <>
                    <Button variant="outline" onClick={() => void handleCancel()}>
                      Cancelar importação
                    </Button>
                    <Button onClick={() => void handleResume()}>
                      <RotateCw className="h-4 w-4" />
                      Retomar
                    </Button>
                  </>
                )}
                {finished && (
                  <Button variant="outline" onClick={() => setRun(null)}>
                    Nova importação
                  </Button>
                )}
                <Button variant={finished ? 'default' : 'ghost'} onClick={handleClose}>
                  Fechar
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
