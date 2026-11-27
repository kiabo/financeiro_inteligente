import { ArrowRight, CheckCircle2, FileUp, Plus, RefreshCw, XCircle } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input, Label } from '../../components/ui/input';
import { StatusChip } from '../../components/ui/status-chip';
import { cn, formatCurrencyBRL } from '../../lib/utils';
import { isSupabaseConfigured } from '../core/supabase';
import type { AuthSessionState, Category, Company, FinancialAccount, ProductService, Project, Transaction } from '../core/types';
import { formatDateBR, ModuleHeader, NativeSelect, Notice, SandboxGate, StatPill } from './components/moduleUi';
import {
  confirmReconciliationItem,
  createTransactionFromItem,
  fetchKnownFitIds,
  fetchReconciledTransactionIds,
  fetchReconciliationItems,
  fetchStatementImports,
  ignoreReconciliationItem,
  refreshImportStatus,
  saveStatementImport,
  sha256OfBytes,
  type ConfirmMode,
} from './integrationsApi';
import { extractPdfText } from './ocrReceiptParser';
import {
  decodeStatementBytes,
  detectStatementFormat,
  matchStatementLines,
  parseCSV,
  parseOFX,
  parsePdfStatementText,
  type ParsedStatement,
} from './reconciliationEngine';
import type { BankStatementImport, ReconciliationItem } from './types';

interface ReconciliationViewProps {
  session: AuthSessionState;
  companies: Company[];
  accounts: FinancialAccount[];
  categories: Category[];
  productsServices: ProductService[];
  projects: Project[];
  transactions: Transaction[];
  onRefresh: () => Promise<void>;
}

type Filter = 'pending' | 'all' | 'exact_match' | 'partial_match' | 'unmatched';

const STATUS_LABEL: Record<ReconciliationItem['match_status'], string> = {
  exact_match: 'Exato',
  partial_match: 'Parcial',
  unmatched: 'Sem par',
};

export const ReconciliationView: React.FC<ReconciliationViewProps> = ({
  session,
  companies,
  accounts,
  categories,
  productsServices,
  projects,
  transactions,
  onRefresh,
}) => {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [imports, setImports] = useState<BankStatementImport[]>([]);
  const [activeImportId, setActiveImportId] = useState<string | null>(null);
  const [items, setItems] = useState<ReconciliationItem[]>([]);
  const [filter, setFilter] = useState<Filter>('pending');
  const [busy, setBusy] = useState(false);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error' | 'info' | 'warning'; text: string } | null>(null);
  const [creating, setCreating] = useState<{ itemId: string; description: string; categoryId: string; productId: string; projectId: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const account = accounts.find((a) => a.id === accountId);
  const companyId = account?.company_id ?? '';
  const txById = useMemo(() => new Map(transactions.map((t) => [t.id, t])), [transactions]);
  const leafCategories = useMemo(
    () => categories.filter((c) => c.company_id === companyId && c.parent_id !== null && c.is_active),
    [categories, companyId]
  );
  const feeCategoryId = leafCategories.find((c) => c.code === '2.2')?.id ?? null;

  const loadImports = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      setImports(await fetchStatementImports());
    } catch (err) {
      setFeedback({ tone: 'error', text: err instanceof Error ? err.message : 'Falha ao carregar importações.' });
    }
  }, []);

  const loadItems = useCallback(async (importId: string) => {
    try {
      setItems(await fetchReconciliationItems(importId));
    } catch (err) {
      setFeedback({ tone: 'error', text: err instanceof Error ? err.message : 'Falha ao carregar linhas.' });
    }
  }, []);

  useEffect(() => {
    void loadImports();
  }, [loadImports]);

  useEffect(() => {
    if (activeImportId) void loadItems(activeImportId);
    else setItems([]);
  }, [activeImportId, loadItems]);

  const handleFile = async (file: File) => {
    if (!account) {
      setFeedback({ tone: 'error', text: 'Selecione a conta do extrato.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const bytes = await file.arrayBuffer();
      const hash = await sha256OfBytes(bytes);
      let statement: ParsedStatement;
      if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
        statement = parsePdfStatementText(await extractPdfText(bytes, 30));
      } else {
        const text = decodeStatementBytes(new Uint8Array(bytes));
        const format = detectStatementFormat(file.name, text);
        if (format === 'ofx') statement = parseOFX(text);
        else if (format === 'csv') statement = parseCSV(text);
        else throw new Error('Formato não reconhecido. Envie OFX, CSV ou PDF.');
      }
      if (statement.lines.length === 0) {
        throw new Error(statement.warnings.join(' ') || 'Nenhuma movimentação encontrada no arquivo.');
      }

      const [reconciled, knownFitIds] = await Promise.all([fetchReconciledTransactionIds(account.id), fetchKnownFitIds(account.id)]);
      const matches = matchStatementLines(statement.lines, transactions, account.id, { alreadyReconciledIds: reconciled });
      const { importRow, skippedDuplicates } = await saveStatementImport({
        tenantId: session.userId,
        companyId: account.company_id,
        accountId: account.id,
        fileName: file.name,
        fileSha256: hash,
        statement,
        matches,
        knownFitIds,
      });
      await loadImports();
      setActiveImportId(importRow.id);
      setFilter('pending');
      const warn = [
        skippedDuplicates > 0 ? `${skippedDuplicates} linha(s) já importada(s) antes foram ignoradas.` : '',
        ...statement.warnings,
      ]
        .filter(Boolean)
        .join(' ');
      setFeedback({
        tone: warn ? 'warning' : 'success',
        text: `${importRow.total_lines} linha(s): ${importRow.exact_count} exata(s), ${importRow.partial_count} parcial(is), ${importRow.unmatched_count} sem par. ${warn}`,
      });
    } catch (err) {
      setFeedback({ tone: 'error', text: err instanceof Error ? err.message : 'Falha ao importar extrato.' });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const afterResolve = async () => {
    if (!activeImportId) return;
    await refreshImportStatus(activeImportId);
    await Promise.all([loadItems(activeImportId), loadImports(), onRefresh()]);
  };

  const runItem = async (itemId: string, fn: () => Promise<void>) => {
    setBusyItem(itemId);
    setFeedback(null);
    try {
      await fn();
      await afterResolve();
    } catch (err) {
      setFeedback({ tone: 'error', text: err instanceof Error ? err.message : 'Operação falhou.' });
    } finally {
      setBusyItem(null);
    }
  };

  const confirm = (item: ReconciliationItem, mode: ConfirmMode) => {
    const tx = item.matched_transaction_id ? txById.get(item.matched_transaction_id) : undefined;
    if (!tx) {
      setFeedback({ tone: 'error', text: 'Lançamento sugerido não encontrado (pode ter sido excluído).' });
      return;
    }
    void runItem(item.id, () =>
      confirmReconciliationItem({ tenantId: session.userId, userEmail: session.email, item, transaction: tx, mode, feeCategoryId })
    );
  };

  const confirmAllExact = async () => {
    const exact = items.filter((i) => i.match_status === 'exact_match' && i.resolution === 'pending');
    setBusy(true);
    let done = 0;
    try {
      for (const item of exact) {
        const tx = item.matched_transaction_id ? txById.get(item.matched_transaction_id) : undefined;
        if (!tx) continue;
        await confirmReconciliationItem({ tenantId: session.userId, userEmail: session.email, item, transaction: tx, mode: 'confirm', feeCategoryId });
        done++;
      }
      setFeedback({ tone: 'success', text: `${done} casamento(s) exato(s) confirmado(s).` });
      await afterResolve();
    } catch (err) {
      setFeedback({ tone: 'error', text: err instanceof Error ? err.message : 'Falha na confirmação em lote.' });
    } finally {
      setBusy(false);
    }
  };

  const visible = items.filter((i) =>
    filter === 'all' ? true : filter === 'pending' ? i.resolution === 'pending' : i.match_status === filter && i.resolution === 'pending'
  );
  const activeImport = imports.find((i) => i.id === activeImportId);
  const pendingExact = items.filter((i) => i.match_status === 'exact_match' && i.resolution === 'pending').length;

  return (
    <div className="space-y-6">
      <ModuleHeader
        eyebrow="Conciliação Bancária"
        title="Conciliação Bancária Inteligente"
        glossaryKey="conciliacao_bancaria"
        description="Importe o extrato (OFX, CSV ou PDF). O arquivo é lido no seu navegador e cruzado com os lançamentos por valor, data (±3 dias) e descrição."
      />

      <SandboxGate isSandbox={!isSupabaseConfigured}>
        <Card>
          <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:p-6">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="rec-account">Conta do extrato</Label>
              <NativeSelect
                id="rec-account"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                options={accounts.map((a) => {
                  const comp = companies.find((c) => c.id === a.company_id);
                  return { value: a.id, label: `${a.name} · ${comp?.trade_name || comp?.legal_name || ''}` };
                })}
              />
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".ofx,.qfx,.csv,.txt,.pdf,application/pdf,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
            <Button disabled={busy || !accountId} onClick={() => fileRef.current?.click()}>
              {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              <span>{busy ? 'Processando…' : 'Importar extrato'}</span>
            </Button>
          </CardContent>
        </Card>

        {feedback && <Notice tone={feedback.tone}>{feedback.text}</Notice>}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
          {/* Histórico de importações */}
          <Card className="h-fit">
            <CardHeader className="pb-2">
              <CardTitle className="text-[15px]">Importações</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 pt-0">
              {imports.length === 0 && <p className="text-[12px] text-[#72787D]">Nenhum extrato importado.</p>}
              {imports.map((imp) => (
                <button
                  key={imp.id}
                  type="button"
                  onClick={() => setActiveImportId(imp.id)}
                  className={cn(
                    'w-full rounded-[6px] border px-3 py-2 text-left text-[12px] transition-colors cursor-pointer',
                    imp.id === activeImportId
                      ? 'border-[#0F374A] bg-[#EFF4FF] dark:bg-[#0F374A]/40'
                      : 'border-[#E2E8F0] hover:bg-[#F8FAFC] dark:border-[#1E2F3F] dark:hover:bg-[#162838]'
                  )}
                >
                  <p className="truncate font-medium">{imp.file_name}</p>
                  <p className="text-[#72787D]">
                    {accounts.find((a) => a.id === imp.account_id)?.name ?? '—'} · {formatDateBR(imp.period_start)}–{formatDateBR(imp.period_end)}
                  </p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <StatusChip variant={imp.status === 'completed' ? 'positive' : 'primary'}>{imp.status === 'completed' ? 'Concluída' : 'Em conciliação'}</StatusChip>
                    <span className="text-[#72787D]">{imp.total_lines} linhas</span>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          {/* Extrato vs Sistema */}
          <div className="space-y-4">
            {activeImport ? (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatPill label="Linhas" value={activeImport.total_lines} />
                  <StatPill label="Exatas" value={activeImport.exact_count} tone="positive" />
                  <StatPill label="Parciais" value={activeImport.partial_count} tone="warning" />
                  <StatPill label="Sem par" value={activeImport.unmatched_count} tone="alert" />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {(['pending', 'exact_match', 'partial_match', 'unmatched', 'all'] as Filter[]).map((f) => (
                      <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'} onClick={() => setFilter(f)}>
                        {f === 'pending' ? 'Pendentes' : f === 'all' ? 'Todas' : STATUS_LABEL[f]}
                      </Button>
                    ))}
                  </div>
                  {pendingExact > 0 && (
                    <Button size="sm" disabled={busy} onClick={() => void confirmAllExact()}>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Confirmar {pendingExact} exata(s)
                    </Button>
                  )}
                </div>

                {visible.length === 0 && <Notice tone="success">Nada pendente neste filtro.</Notice>}

                <div className="space-y-2">
                  {visible.map((item) => {
                    const tx = item.matched_transaction_id ? txById.get(item.matched_transaction_id) : undefined;
                    const isBusy = busyItem === item.id;
                    const resolved = item.resolution !== 'pending';
                    return (
                      <Card key={item.id} className={cn(resolved && 'opacity-60')}>
                        <CardContent className="grid grid-cols-1 gap-3 p-3 sm:p-4 md:grid-cols-[1fr_auto_1fr]">
                          {/* Extrato */}
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">Extrato · {formatDateBR(item.line_date)}</p>
                            <p className="truncate text-[13px] font-medium">{item.description}</p>
                            <p className={cn('text-[15px] font-semibold tabular-nums', item.amount < 0 ? 'text-[#B91C1C] dark:text-[#FCA5A5]' : 'text-[#047857] dark:text-[#68DBA9]')}>
                              {formatCurrencyBRL(item.amount)}
                            </p>
                          </div>
                          <div className="flex items-center justify-center">
                            <div className="flex flex-col items-center gap-1">
                              <StatusChip variant={item.match_status === 'exact_match' ? 'positive' : item.match_status === 'partial_match' ? 'primary' : 'alert'}>
                                {STATUS_LABEL[item.match_status]}
                                {item.match_score > 0 ? ` · ${Math.round(item.match_score)}` : ''}
                              </StatusChip>
                              <ArrowRight className="hidden h-4 w-4 text-[#72787D] md:block" />
                            </div>
                          </div>
                          {/* Sistema */}
                          <div className="min-w-0">
                            {tx ? (
                              <>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
                                  Sistema · {formatDateBR(tx.payment_date ?? tx.due_date)} · {tx.status}
                                </p>
                                <p className="truncate text-[13px] font-medium">{tx.description}</p>
                                <p className="text-[15px] font-semibold tabular-nums">{formatCurrencyBRL(tx.amount)}</p>
                              </>
                            ) : (
                              <p className="text-[12px] text-[#72787D]">Nenhum lançamento compatível no sistema.</p>
                            )}
                            {item.match_reasons.length > 0 && <p className="mt-1 text-[11px] text-[#72787D]">{item.match_reasons.join(' · ')}</p>}
                          </div>

                          {/* Ações */}
                          <div className="flex flex-wrap gap-2 md:col-span-3">
                            {resolved ? (
                              <StatusChip variant="neutral">
                                {item.resolution === 'confirmed' ? 'Conciliado' : item.resolution === 'created' ? 'Lançamento criado' : 'Ignorado'}
                              </StatusChip>
                            ) : (
                              <>
                                {tx && (
                                  <Button size="sm" disabled={isBusy} onClick={() => confirm(item, 'confirm')}>
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Confirmar
                                  </Button>
                                )}
                                {tx && item.match_status === 'partial_match' && Math.abs(item.amount_diff ?? 0) >= 0.01 && (
                                  <>
                                    <Button size="sm" variant="outline" disabled={isBusy} onClick={() => confirm(item, 'adjust_amount')}>
                                      Ajustar valor para {formatCurrencyBRL(Math.abs(item.amount))}
                                    </Button>
                                    <Button size="sm" variant="outline" disabled={isBusy} onClick={() => confirm(item, 'record_fee')}>
                                      Lançar diferença como taxa
                                    </Button>
                                  </>
                                )}
                                {!tx && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={isBusy}
                                    onClick={() => setCreating({ itemId: item.id, description: item.description, categoryId: '', productId: '', projectId: '' })}
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                    Criar lançamento
                                  </Button>
                                )}
                                <Button size="sm" variant="ghost" disabled={isBusy} onClick={() => void runItem(item.id, () => ignoreReconciliationItem(item.id))}>
                                  <XCircle className="h-3.5 w-3.5" />
                                  Ignorar
                                </Button>
                              </>
                            )}
                          </div>

                          {creating?.itemId === item.id && (
                            <div className="space-y-3 rounded-[6px] border border-[#E2E8F0] p-3 md:col-span-3 dark:border-[#1E2F3F]">
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div className="space-y-1 sm:col-span-2">
                                  <Label htmlFor={`desc-${item.id}`}>Descrição</Label>
                                  <Input id={`desc-${item.id}`} value={creating.description} onChange={(e) => setCreating({ ...creating, description: e.target.value })} />
                                </div>
                                <div className="space-y-1">
                                  <Label>Categoria</Label>
                                  <NativeSelect
                                    value={creating.categoryId}
                                    onChange={(e) => setCreating({ ...creating, categoryId: e.target.value })}
                                    placeholder="Sem categoria"
                                    options={leafCategories
                                      .filter((c) => (item.amount > 0 ? c.direction !== 'outflow' : c.direction !== 'inflow'))
                                      .map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))}
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label>Produto/serviço</Label>
                                  <NativeSelect
                                    value={creating.productId}
                                    onChange={(e) => setCreating({ ...creating, productId: e.target.value })}
                                    placeholder="Nenhum"
                                    options={productsServices
                                      .filter((p) => p.is_active && (p.company_id === companyId || p.company_id === null))
                                      .map((p) => ({ value: p.id, label: p.name }))}
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label>Projeto</Label>
                                  <NativeSelect
                                    value={creating.projectId}
                                    onChange={(e) => setCreating({ ...creating, projectId: e.target.value })}
                                    placeholder="Nenhum"
                                    options={projects
                                      .filter((p) => p.company_id === companyId && p.status !== 'canceled')
                                      .map((p) => ({ value: p.id, label: p.name }))}
                                  />
                                </div>
                              </div>
                              <div className="flex justify-end gap-2">
                                <Button size="sm" variant="ghost" onClick={() => setCreating(null)}>
                                  Cancelar
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={isBusy || creating.description.trim().length < 2}
                                  onClick={() => {
                                    const c = creating;
                                    setCreating(null);
                                    void runItem(item.id, () =>
                                      createTransactionFromItem({
                                        tenantId: session.userId,
                                        userEmail: session.email,
                                        item,
                                        companyId,
                                        description: c.description,
                                        categoryId: c.categoryId || null,
                                        productServiceId: c.productId || null,
                                        projectId: c.projectId || null,
                                      })
                                    );
                                  }}
                                >
                                  Lançar como {item.amount > 0 ? 'receita' : 'despesa'} paga
                                </Button>
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Como funciona</CardTitle>
                  <CardDescription>Exporte o extrato do internet banking em OFX (recomendado), CSV ou PDF.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 pt-0 text-[13px] text-[#42484C] dark:text-[#9DB0C2]">
                  <p><strong>Exato:</strong> mesmo valor e data em até 3 dias — confirme em 1 clique (ou todos de uma vez).</p>
                  <p><strong>Parcial:</strong> diferença explicável por taxa ou data mais distante — ajuste o valor ou lance a diferença como taxa.</p>
                  <p><strong>Sem par:</strong> movimento novo — crie o lançamento já categorizado, com produto e projeto.</p>
                  <p>Linhas com o mesmo identificador (FITID) nunca são importadas duas vezes, e o mesmo arquivo não pode ser reimportado.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </SandboxGate>
    </div>
  );
};
