import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Calendar,
  FolderKanban,
  Layers,
  Package,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Input, Label } from '../../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { cn, formatCurrencyBRL, getTodayISO } from '../../../lib/utils';
import { createTransactionsBatch, type ScheduleMode } from '../repository';
import type {
  ActiveContext,
  AuthSessionState,
  Category,
  Company,
  FinancialAccount,
  ProductService,
  Project,
  TransactionType,
} from '../types';
import { InfoTooltip } from './InfoTooltip';

interface TransactionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: AuthSessionState;
  companies: Company[];
  accounts: FinancialAccount[];
  categories: Category[];
  productsServices: ProductService[];
  projects?: Project[];
  activeContext: ActiveContext;
  defaultType?: TransactionType;
  defaultProjectId?: string | null;
  onCreated: () => Promise<void>;
}

export const TransactionModal: React.FC<TransactionModalProps> = ({
  open,
  onOpenChange,
  session,
  companies,
  accounts,
  categories,
  productsServices,
  projects = [],
  activeContext,
  defaultType = 'income',
  defaultProjectId = null,
  onCreated,
}) => {
  const [txType, setTxType] = useState<TransactionType>(defaultType);
  const [companyId, setCompanyId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [destinationAccountId, setDestinationAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('none');
  const [productServiceId, setProductServiceId] = useState('none');
  const [projectId, setProjectId] = useState('none');
  const [description, setDescription] = useState('');
  const [counterpartyName, setCounterpartyName] = useState('');
  const [amount, setAmount] = useState('');
  const [competenceDate, setCompetenceDate] = useState(getTodayISO());
  const [dueDate, setDueDate] = useState(getTodayISO());
  const [isPaidNow, setIsPaidNow] = useState(false);
  const [paymentDate, setPaymentDate] = useState(getTodayISO());
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('single');
  const [occurrences, setOccurrences] = useState('3');
  const [competenceFollowsInstallment, setCompetenceFollowsInstallment] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTxType(defaultType);
    const today = getTodayISO();
    setCompetenceDate(today);
    setDueDate(today);
    setPaymentDate(today);
    setIsPaidNow(defaultType === 'transfer');
    setScheduleMode('single');
    setOccurrences('3');
    setDescription('');
    setCounterpartyName('');
    setAmount('');
    setNotes('');
    setProductServiceId('none');

    const defaultProject = defaultProjectId
      ? projects.find((p) => p.id === defaultProjectId)
      : undefined;
    setProjectId(defaultProject ? defaultProject.id : 'none');

    let initialCompanyId = defaultProject?.company_id ?? companies[0]?.id ?? '';
    let initialAccountId = '';
    if (!defaultProject) {
      if (activeContext.scope === 'company') {
        initialCompanyId = activeContext.companyId;
      } else if (activeContext.scope === 'account') {
        const acc = accounts.find((a) => a.id === activeContext.accountId);
        if (acc) {
          initialCompanyId = acc.company_id;
          initialAccountId = acc.id;
        }
      } else if (activeContext.scope === 'group') {
        const firstComp = companies.find((c) => c.group_id === activeContext.groupId);
        if (firstComp) initialCompanyId = firstComp.id;
      }
    }

    setCompanyId(initialCompanyId);
    const compAccounts = accounts.filter((a) => a.company_id === initialCompanyId);
    setAccountId(initialAccountId || compAccounts[0]?.id || '');
    const otherAccount = accounts.find((a) => a.id !== (initialAccountId || compAccounts[0]?.id));
    setDestinationAccountId(otherAccount?.id ?? '');
  }, [open, defaultType, defaultProjectId, projects, companies, accounts, activeContext]);

  const companyAccounts = useMemo(
    () => accounts.filter((a) => a.company_id === companyId),
    [accounts, companyId]
  );

  // Quando mudar a empresa, ajusta conta de origem e limpa projeto incompatível
  useEffect(() => {
    if (!companyId) return;
    if (!companyAccounts.some((a) => a.id === accountId)) {
      setAccountId(companyAccounts[0]?.id ?? '');
    }
    if (projectId !== 'none') {
      const prj = projects.find((p) => p.id === projectId);
      if (prj && prj.company_id !== companyId) {
        setProjectId('none');
      }
    }
  }, [companyId, companyAccounts, accountId, projectId, projects]);

  // Categorias filtradas pela empresa e direção contábil (com fallback hierárquico)
  const availableCategories = useMemo(() => {
    const compCats = categories.filter((c) => c.company_id === companyId && c.parent_id !== null);
    if (txType === 'income') {
      return compCats.filter((c) => c.direction === 'inflow');
    }
    if (txType === 'transfer') {
      return compCats.filter((c) => c.direction === 'neutral');
    }
    return compCats.filter((c) => c.direction === 'outflow');
  }, [categories, companyId, txType]);

  // Auto-seleciona categoria padrão compatível ao trocar tipo/empresa
  useEffect(() => {
    if (availableCategories.length === 0) {
      setCategoryId('none');
      return;
    }
    if (!availableCategories.some((c) => c.id === categoryId)) {
      setCategoryId(availableCategories[0]?.id ?? 'none');
    }
  }, [availableCategories, categoryId]);

  const availableProducts = useMemo(() => {
    const comp = companies.find((c) => c.id === companyId);
    return productsServices.filter(
      (p) => p.company_id === companyId || (comp?.group_id && p.group_id === comp.group_id)
    );
  }, [productsServices, companies, companyId]);

  const availableProjects = useMemo(
    () => projects.filter((p) => p.company_id === companyId && p.status !== 'canceled'),
    [projects, companyId]
  );

  const destinationAccounts = useMemo(() => {
    return accounts.filter((a) => a.id !== accountId);
  }, [accounts, accountId]);

  const selectedProduct = useMemo(
    () => availableProducts.find((p) => p.id === productServiceId) ?? null,
    [availableProducts, productServiceId]
  );

  const handleSelectProduct = (val: string) => {
    setProductServiceId(val);
    if (val === 'none') return;
    const item = availableProducts.find((p) => p.id === val);
    if (!item) return;
    if (!description.trim()) {
      setDescription(
        txType === 'income' ? `Venda · ${item.name}` : `Custo Direto · ${item.name}`
      );
    }
    if ((!amount || Number(amount) <= 0) && txType === 'income' && item.base_price > 0) {
      setAmount(String(item.base_price));
    } else if (
      (!amount || Number(amount) <= 0) &&
      txType === 'expense' &&
      item.estimated_direct_cost > 0
    ) {
      setAmount(String(item.estimated_direct_cost));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createTransactionsBatch(session.userId, session.email, {
        company_id: companyId,
        account_id: accountId,
        destination_account_id: txType === 'transfer' ? destinationAccountId : null,
        category_id: categoryId === 'none' ? null : categoryId,
        product_service_id:
          txType === 'transfer' || productServiceId === 'none' ? null : productServiceId,
        project_id: txType === 'transfer' || projectId === 'none' ? null : projectId,
        transaction_type: txType,
        status: isPaidNow ? 'paid' : 'pending',
        description,
        counterparty_name: txType === 'transfer' ? undefined : counterpartyName,
        amount: Number(amount) || 0,
        competence_date: competenceDate,
        due_date: dueDate,
        payment_date: isPaidNow ? paymentDate : null,
        notes,
        schedule_mode: txType === 'transfer' ? 'single' : scheduleMode,
        total_occurrences: Number(occurrences) || 2,
        competence_follows_installment: competenceFollowsInstallment,
      });

      onOpenChange(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao registrar lançamento.');
    } finally {
      setSubmitting(false);
    }
  };

  const parsedAmount = Number(amount) || 0;
  const parsedCount = Math.min(60, Math.max(2, Number(occurrences) || 2));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:w-full max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-[12px] max-sm:p-4">
        <DialogHeader>
          <DialogTitle>Novo Lançamento Financeiro</DialogTitle>
          <DialogDescription>
            Registre entradas, saídas ou transferências internas com dupla visão de Caixa e
            Competência.
          </DialogDescription>
        </DialogHeader>

        {/* Abas Receita / Despesa / Transferência Interna */}
        <div className="mt-3 grid grid-cols-3 gap-1.5 rounded-[6px] border border-[#E2E8F0] bg-[#F1F5F9] p-1 dark:border-[#1E2F3F] dark:bg-[#08131D]">
          <button
            type="button"
            onClick={() => setTxType('income')}
            className={cn(
              'flex min-h-[40px] items-center justify-center gap-1.5 rounded-[4px] px-2 text-[12px] sm:text-[13px] font-medium transition-colors cursor-pointer',
              txType === 'income'
                ? 'bg-white text-[#059669] shadow-sm dark:bg-[#162838] dark:text-[#68DBA9]'
                : 'text-[#42484C] hover:text-[#0F172A] dark:text-[#9DB0C2]'
            )}
          >
            <ArrowDownLeft className="h-4 w-4 shrink-0" />
            <span>Receita</span>
          </button>

          <button
            type="button"
            onClick={() => setTxType('expense')}
            className={cn(
              'flex min-h-[40px] items-center justify-center gap-1.5 rounded-[4px] px-2 text-[12px] sm:text-[13px] font-medium transition-colors cursor-pointer',
              txType === 'expense'
                ? 'bg-white text-[#DC2626] shadow-sm dark:bg-[#162838] dark:text-[#FCA5A5]'
                : 'text-[#42484C] hover:text-[#0F172A] dark:text-[#9DB0C2]'
            )}
          >
            <ArrowUpRight className="h-4 w-4 shrink-0" />
            <span>Despesa</span>
          </button>

          <button
            type="button"
            onClick={() => setTxType('transfer')}
            className={cn(
              'flex min-h-[40px] items-center justify-center gap-1.5 rounded-[4px] px-2 text-[12px] sm:text-[13px] font-medium transition-colors cursor-pointer',
              txType === 'transfer'
                ? 'bg-white text-[#0F374A] shadow-sm dark:bg-[#162838] dark:text-[#A7CBE3]'
                : 'text-[#42484C] hover:text-[#0F172A] dark:text-[#9DB0C2]'
            )}
          >
            <ArrowLeftRight className="h-4 w-4 shrink-0" />
            <span className="truncate">Transferência</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && (
            <div className="rounded-[4px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12px] font-medium text-[#991B1B] dark:border-[#7F1D1D] dark:bg-[#3B1219] dark:text-[#FCA5A5]">
              {error}
            </div>
          )}

          {txType === 'transfer' && (
            <div className="flex items-start gap-2 rounded-[4px] border border-[#CBD5E1] bg-[#EFF4FF] px-3 py-2.5 text-[12px] text-[#0F374A] dark:border-[#264B5F] dark:bg-[#0F374A]/30 dark:text-[#C4E7FF]">
              <InfoTooltip glossaryKey="transferencia_interna" />
              <p className="leading-4">
                Transferências internas movimentam o saldo das contas de origem e destino, mas{' '}
                <strong>nunca entram como receita ou despesa</strong> nos indicadores de resultado.
              </p>
            </div>
          )}

          {/* Empresa e Conta(s) */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tx-company">
                {txType === 'transfer' ? 'Empresa de Origem *' : 'Empresa *'}
              </Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger id="tx-company" className="min-h-[40px]">
                  <SelectValue placeholder="Selecione a empresa" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.trade_name ?? c.legal_name} ({c.analytical_token})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tx-account">
                {txType === 'transfer' ? 'Conta de Origem (Sai) *' : 'Conta Financeira *'}
              </Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="tx-account" className="min-h-[40px]">
                  <SelectValue placeholder="Selecione a conta" />
                </SelectTrigger>
                <SelectContent>
                  {companyAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} ({a.analytical_token})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {txType === 'transfer' && (
            <div className="space-y-1.5">
              <Label htmlFor="tx-dest-account">
                Conta de Destino (Entra — mesma empresa ou intercompany) *
              </Label>
              <Select value={destinationAccountId} onValueChange={setDestinationAccountId}>
                <SelectTrigger id="tx-dest-account" className="min-h-[40px]">
                  <SelectValue placeholder="Selecione a conta de destino" />
                </SelectTrigger>
                <SelectContent>
                  {destinationAccounts.map((a) => {
                    const destComp = companies.find((c) => c.id === a.company_id);
                    return (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} ({a.analytical_token}) ·{' '}
                        {destComp ? destComp.trade_name ?? destComp.legal_name : ''}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Vínculo com Produto/Serviço (Incentivado em Receitas e Custos Diretos) */}
          {txType !== 'transfer' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tx-product" className="flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5 text-[#0F374A] dark:text-[#A7CBE3]" />
                  <span>Vincular Produto / Serviço (Rentabilidade)</span>
                </Label>
                <Select value={productServiceId} onValueChange={handleSelectProduct}>
                  <SelectTrigger id="tx-product" className="min-h-[40px]">
                    <SelectValue placeholder="Opcional — selecione uma oferta" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem vínculo específico</SelectItem>
                    {availableProducts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.analytical_token} · {p.name} ({formatCurrencyBRL(p.base_price)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tx-category">Categoria (Plano de Contas)</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger id="tx-category" className="min-h-[40px]">
                    <SelectValue placeholder="Selecione a categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem categoria</SelectItem>
                    {availableCategories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.code} · {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {selectedProduct && txType !== 'transfer' && (
            <p className="text-[11px] text-[#059669] dark:text-[#68DBA9]">
              Oferta vinculada: <strong>{selectedProduct.analytical_token}</strong> (Preço base{' '}
              {formatCurrencyBRL(selectedProduct.base_price)} · Custo est.{' '}
              {formatCurrencyBRL(selectedProduct.estimated_direct_cost)}). Rastreável para cálculo
              de margem unitária.
            </p>
          )}

          {/* Vínculo com Projeto (Previsto vs. Realizado) */}
          {txType !== 'transfer' && availableProjects.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="tx-project" className="flex items-center gap-1.5">
                <FolderKanban className="h-3.5 w-3.5 text-[#0F374A] dark:text-[#A7CBE3]" />
                <span>Vincular a Projeto (Previsto vs. Realizado)</span>
              </Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="tx-project" className="min-h-[40px]">
                  <SelectValue placeholder="Opcional — apurar resultado no projeto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Operação geral (sem vínculo a projeto)</SelectItem>
                  {availableProjects.map((prj) => (
                    <SelectItem key={prj.id} value={prj.id}>
                      {prj.analytical_token} · {prj.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Descrição, Valor e Contraparte */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="tx-desc">Descrição do Lançamento *</Label>
              <Input
                id="tx-desc"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  txType === 'transfer'
                    ? 'Ex.: Transferência para conta de aplicação'
                    : txType === 'income'
                      ? 'Ex.: Fatura contrato mensal cliente'
                      : 'Ex.: Pagamento fornecedor infraestrutura'
                }
                className="min-h-[40px]"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tx-amount">
                Valor {scheduleMode === 'installments' ? 'da Parcela' : ''} (R$) *
              </Label>
              <Input
                id="tx-amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
                className="min-h-[40px] tabular-nums"
              />
            </div>
          </div>

          {txType !== 'transfer' && (
            <div className="space-y-1.5">
              <Label htmlFor="tx-counterparty">
                {txType === 'income'
                  ? 'Cliente / Pagador (Anonimizado para IA)'
                  : 'Fornecedor / Favorecido (Anonimizado para IA)'}
              </Label>
              <Input
                id="tx-counterparty"
                value={counterpartyName}
                onChange={(e) => setCounterpartyName(e.target.value)}
                placeholder="Opcional — substituído por token antes de qualquer análise por IA"
                className="min-h-[40px]"
              />
            </div>
          )}

          {/* Datas: Competência, Vencimento & Caixa */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="tx-competence" className="flex items-center gap-1">
                <span>Data Competência *</span>
                <InfoTooltip glossaryKey="regime_de_competencia" />
              </Label>
              <Input
                id="tx-competence"
                type="date"
                required
                value={competenceDate}
                onChange={(e) => setCompetenceDate(e.target.value)}
                className="min-h-[40px] tabular-nums"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tx-due">Vencimento Previsto *</Label>
              <Input
                id="tx-due"
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="min-h-[40px] tabular-nums"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Situação no Caixa</Label>
              <div className="grid grid-cols-2 gap-1 rounded-[4px] border border-[#CBD5E1] bg-[#F8FAFC] p-1 dark:border-[#2A3B4C] dark:bg-[#08131D]">
                <button
                  type="button"
                  onClick={() => setIsPaidNow(false)}
                  className={cn(
                    'min-h-[32px] rounded-[3px] text-[12px] font-medium cursor-pointer',
                    !isPaidNow
                      ? 'bg-white text-[#0F172A] shadow-sm dark:bg-[#162838] dark:text-[#EAF1FF]'
                      : 'text-[#42484C] dark:text-[#9DB0C2]'
                  )}
                >
                  Previsto
                </button>
                <button
                  type="button"
                  onClick={() => setIsPaidNow(true)}
                  className={cn(
                    'min-h-[32px] rounded-[3px] text-[12px] font-medium cursor-pointer',
                    isPaidNow
                      ? 'bg-[#059669] text-white shadow-sm'
                      : 'text-[#42484C] dark:text-[#9DB0C2]'
                  )}
                >
                  Pago
                </button>
              </div>
            </div>
          </div>

          {isPaidNow && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tx-payment-date" className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 text-[#059669]" />
                  <span>Data Efetiva de Pagamento (Caixa) *</span>
                </Label>
                <Input
                  id="tx-payment-date"
                  type="date"
                  required
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="min-h-[40px] tabular-nums"
                />
              </div>
            </div>
          )}

          {/* Parcelamento & Recorrência em Lote */}
          {txType !== 'transfer' && (
            <div className="space-y-3 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 dark:border-[#1E2F3F] dark:bg-[#08131D]">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[#0F172A] dark:text-[#EAF1FF]">
                  <Layers className="h-3.5 w-3.5 text-[#0F374A] dark:text-[#A7CBE3]" />
                  <span>Parcelamento ou Recorrência em Lote</span>
                </span>
                <div className="inline-flex rounded-[4px] border border-[#CBD5E1] bg-white p-0.5 dark:border-[#2A3B4C] dark:bg-[#0D1A26]">
                  {(
                    [
                      { id: 'single', label: 'Único' },
                      { id: 'installments', label: 'Parcelado' },
                      { id: 'recurring', label: 'Recorrente' },
                    ] as Array<{ id: ScheduleMode; label: string }>
                  ).map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setScheduleMode(mode.id)}
                      className={cn(
                        'min-h-[30px] rounded-[3px] px-2.5 text-[12px] font-medium cursor-pointer',
                        scheduleMode === mode.id
                          ? 'bg-[#0F374A] text-white'
                          : 'text-[#42484C] hover:text-[#0F172A] dark:text-[#9DB0C2]'
                      )}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              {scheduleMode !== 'single' && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="tx-occurrences">
                      {scheduleMode === 'installments'
                        ? 'Quantidade de Parcelas (2 a 60)'
                        : 'Meses a Gerar Agora (2 a 60)'}
                    </Label>
                    <Input
                      id="tx-occurrences"
                      type="number"
                      min="2"
                      max="60"
                      value={occurrences}
                      onChange={(e) => setOccurrences(e.target.value)}
                      className="min-h-[40px] tabular-nums"
                    />
                  </div>

                  <div className="flex flex-col justify-end space-y-1.5">
                    <p className="text-[12px] tabular-nums text-[#334155] dark:text-[#B9CADB]">
                      Total previsto:{' '}
                      <strong>{formatCurrencyBRL(parsedAmount * parsedCount)}</strong> ({parsedCount}
                      x de {formatCurrencyBRL(parsedAmount)})
                    </p>
                    {scheduleMode === 'installments' && (
                      <label className="flex items-center gap-2 text-[11px] text-[#42484C] dark:text-[#9DB0C2] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={competenceFollowsInstallment}
                          onChange={(e) => setCompetenceFollowsInstallment(e.target.checked)}
                          className="h-4 w-4 rounded-[2px] border-[#CBD5E1] accent-[#0F374A]"
                        />
                        <span>Avançar competência mês a mês (padrão assinatura)</span>
                      </label>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-[#E2E8F0] pt-4 sm:flex-row sm:justify-end dark:border-[#1E2F3F]">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="min-h-[44px] sm:min-h-[38px]"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={submitting || !companyId || !accountId}
              className="min-h-[44px] sm:min-h-[38px]"
            >
              {submitting
                ? 'Registrando...'
                : txType === 'transfer'
                  ? 'Registrar Transferência Interna'
                  : scheduleMode === 'single'
                    ? 'Salvar Lançamento'
                    : `Gerar ${parsedCount} Lançamentos`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
