import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Wallet,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { StatusChip } from '../../../components/ui/status-chip';
import {
  addMonthsISO,
  cn,
  formatCurrencyBRL,
  formatDateBR,
  formatMonthLabelPT,
  getMonthRangeISO,
  getTodayISO,
} from '../../../lib/utils';
import { InfoTooltip } from '../components/InfoTooltip';
import { TransactionModal } from '../components/TransactionModal';
import {
  computeAccountBalances,
  computePeriodMetrics,
  deleteTransaction,
  getScopedIds,
  getTransactionReferenceDate,
  markTransactionPaid,
  reopenTransactionPending,
  resolveEffectiveStatus,
  transactionTouchesContext,
} from '../repository';
import type {
  AccountingRegime,
  ActiveContext,
  AuthSessionState,
  BusinessGroup,
  Category,
  Company,
  FinancialAccount,
  ProductService,
  Project,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../types';

interface CashFlowViewProps {
  session: AuthSessionState;
  groups: BusinessGroup[];
  companies: Company[];
  accounts: FinancialAccount[];
  categories: Category[];
  productsServices: ProductService[];
  projects?: Project[];
  transactions: Transaction[];
  activeContext: ActiveContext;
  onRefresh: () => Promise<void>;
  onNavigateHierarchy: () => void;
}

type StatusFilter = 'all' | TransactionStatus;
type TypeFilter = 'all' | TransactionType;

export const CashFlowView: React.FC<CashFlowViewProps> = ({
  session,
  companies,
  accounts,
  categories,
  productsServices,
  projects = [],
  transactions,
  activeContext,
  onRefresh,
  onNavigateHierarchy,
}) => {
  const todayISO = getTodayISO();
  const [regime, setRegime] = useState<AccountingRegime>('cash');
  const [monthKey, setMonthKey] = useState<string>(todayISO.slice(0, 7));
  const [showAllPeriods, setShowAllPeriods] = useState(false);

  // Filtros da tabela
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [productFilter, setProductFilter] = useState('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [modalDefaultType, setModalDefaultType] = useState<TransactionType>('income');
  const [busyTxId, setBusyTxId] = useState<string | null>(null);

  const { accountIds } = useMemo(
    () => getScopedIds(companies, accounts, activeContext),
    [companies, accounts, activeContext]
  );

  const periodBounds = useMemo(() => {
    if (showAllPeriods) return { start: null, end: null };
    return getMonthRangeISO(monthKey);
  }, [monthKey, showAllPeriods]);

  const metrics = useMemo(
    () =>
      computePeriodMetrics(
        transactions,
        companies,
        accounts,
        activeContext,
        regime,
        periodBounds.start,
        periodBounds.end,
        todayISO
      ),
    [transactions, companies, accounts, activeContext, regime, periodBounds, todayISO]
  );

  const accountBalances = useMemo(
    () => computeAccountBalances(accounts, transactions, companies, activeContext),
    [accounts, transactions, companies, activeContext]
  );

  const scopedCategories = useMemo(() => {
    const { companyIds } = getScopedIds(companies, accounts, activeContext);
    const seen = new Map<string, Category>();
    for (const cat of categories) {
      if (cat.parent_id === null) continue;
      if (!companyIds.has(cat.company_id)) continue;
      if (!seen.has(`${cat.code}-${cat.name}`)) {
        seen.set(`${cat.code}-${cat.name}`, cat);
      }
    }
    return Array.from(seen.values());
  }, [categories, companies, accounts, activeContext]);

  const filteredTransactions = useMemo(() => {
    const q = search.trim().toLowerCase();
    const prodMap = new Map(productsServices.map((p) => [p.id, p]));
    const catMap = new Map(categories.map((c) => [c.id, c]));
    const prjMap = new Map(projects.map((p) => [p.id, p]));

    return transactions
      .filter((tx) => {
        if (!transactionTouchesContext(tx, accountIds)) return false;

        const refDate = getTransactionReferenceDate(tx, regime);
        if (periodBounds.start && refDate < periodBounds.start) return false;
        if (periodBounds.end && refDate > periodBounds.end) return false;

        const effStatus = resolveEffectiveStatus(tx, todayISO);
        if (statusFilter !== 'all' && effStatus !== statusFilter) return false;
        if (typeFilter !== 'all' && tx.transaction_type !== typeFilter) return false;

        if (categoryFilter !== 'all') {
          const cat = tx.category_id ? catMap.get(tx.category_id) : undefined;
          if (!cat || `${cat.code}-${cat.name}` !== categoryFilter) return false;
        }

        if (productFilter !== 'all' && tx.product_service_id !== productFilter) return false;

        if (q) {
          const prod = tx.product_service_id ? prodMap.get(tx.product_service_id) : undefined;
          const cat = tx.category_id ? catMap.get(tx.category_id) : undefined;
          const prj = tx.project_id ? prjMap.get(tx.project_id) : undefined;
          const matches =
            tx.description.toLowerCase().includes(q) ||
            (tx.counterparty_name?.toLowerCase().includes(q) ?? false) ||
            (prod?.name.toLowerCase().includes(q) ?? false) ||
            (prod?.analytical_token.toLowerCase().includes(q) ?? false) ||
            (prj?.name.toLowerCase().includes(q) ?? false) ||
            (prj?.analytical_token.toLowerCase().includes(q) ?? false) ||
            (cat?.name.toLowerCase().includes(q) ?? false);
          if (!matches) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const da = getTransactionReferenceDate(a, regime);
        const db = getTransactionReferenceDate(b, regime);
        return db.localeCompare(da);
      });
  }, [
    transactions,
    accountIds,
    regime,
    periodBounds,
    todayISO,
    statusFilter,
    typeFilter,
    categoryFilter,
    productFilter,
    search,
    productsServices,
    categories,
    projects,
  ]);

  const handleShiftMonth = (delta: number) => {
    setShowAllPeriods(false);
    const shifted = addMonthsISO(`${monthKey}-01`, delta);
    setMonthKey(shifted.slice(0, 7));
  };

  const handleMarkPaid = async (tx: Transaction) => {
    setBusyTxId(tx.id);
    try {
      await markTransactionPaid(session.userId, session.email, tx.id, todayISO);
      await onRefresh();
    } finally {
      setBusyTxId(null);
    }
  };

  const handleReopen = async (tx: Transaction) => {
    setBusyTxId(tx.id);
    try {
      await reopenTransactionPending(session.userId, session.email, tx.id);
      await onRefresh();
    } finally {
      setBusyTxId(null);
    }
  };

  const handleDelete = async (tx: Transaction) => {
    setBusyTxId(tx.id);
    try {
      await deleteTransaction(session.userId, session.email, tx.id);
      await onRefresh();
    } finally {
      setBusyTxId(null);
    }
  };

  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const productMap = useMemo(
    () => new Map(productsServices.map((p) => [p.id, p])),
    [productsServices]
  );
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const openModalWithType = (type: TransactionType) => {
    setModalDefaultType(type);
    setModalOpen(true);
  };

  const renderStatusChip = (status: TransactionStatus) => {
    if (status === 'paid') {
      return <StatusChip variant="positive">Pago</StatusChip>;
    }
    if (status === 'overdue') {
      return <StatusChip variant="alert">Atrasado</StatusChip>;
    }
    if (status === 'canceled') {
      return <StatusChip variant="neutral">Cancelado</StatusChip>;
    }
    return <StatusChip variant="neutral">Previsto</StatusChip>;
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho + Alternador Caixa vs Competência */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
            Fluxo &amp; Lançamentos
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-[24px] font-semibold leading-8 tracking-[-0.02em] text-[#0F172A] dark:text-[#EAF1FF]">
              Fluxo de Caixa &amp; Lançamentos
            </h1>
            <InfoTooltip
              glossaryKey={regime === 'cash' ? 'regime_de_caixa' : 'regime_de_competencia'}
            />
          </div>
          <p className="text-[14px] leading-5 text-[#42484C] dark:text-[#9DB0C2]">
            {regime === 'cash'
              ? 'Visão Caixa: considera a data efetiva de pagamento/recebimento ou vencimento previsto nas contas.'
              : 'Visão Competência: considera a data do fato gerador da venda ou despesa, independente da liquidação.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Toggle Caixa vs Competência com InfoTooltip */}
          <div className="flex items-center gap-1.5 rounded-[6px] border border-[#CBD5E1] bg-white p-1 dark:border-[#2A3B4C] dark:bg-[#0D1A26]">
            <button
              type="button"
              onClick={() => setRegime('cash')}
              className={cn(
                'min-h-[34px] rounded-[4px] px-3 text-[12px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                regime === 'cash'
                  ? 'bg-[#0F374A] text-white'
                  : 'text-[#42484C] hover:text-[#0F172A] dark:text-[#9DB0C2] dark:hover:text-[#EAF1FF]'
              )}
            >
              Visão Caixa
            </button>
            <button
              type="button"
              onClick={() => setRegime('competence')}
              className={cn(
                'min-h-[34px] rounded-[4px] px-3 text-[12px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                regime === 'competence'
                  ? 'bg-[#0F374A] text-white'
                  : 'text-[#42484C] hover:text-[#0F172A] dark:text-[#9DB0C2] dark:hover:text-[#EAF1FF]'
              )}
            >
              Visão Competência
            </button>
            <InfoTooltip
              term="Diferença: Caixa vs. Competência"
              category="Regime Contábil"
              summary="Na Visão Caixa, o lançamento entra no período pela data em que o dinheiro efetivamente entra ou sai da conta (payment_date) ou pelo vencimento previsto. Na Visão Competência, entra pela data do fato gerador (emissão da nota / prestação do serviço), ideal para apurar resultado econômico."
              example="Uma venda parcelada em 3x em novembro aparece integralmente em novembro na Competência, e 1/3 por mês no Caixa."
              align="end"
            />
          </div>

          <Button
            variant="primary"
            onClick={() => openModalWithType('income')}
            disabled={companies.length === 0 || accounts.length === 0}
            className="min-h-[42px]"
          >
            <Plus className="h-4 w-4" />
            <span>Novo Lançamento</span>
          </Button>
        </div>
      </div>

      {/* Barra de Período */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[#E2E8F0] bg-white px-4 py-2.5 shadow-[0_1px_2px_0_rgba(15,23,42,0.04)] dark:border-[#1E2F3F] dark:bg-[#0D1A26]">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => handleShiftMonth(-1)}
            aria-label="Mês anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[155px] text-center font-display text-[14px] font-semibold capitalize text-[#0F172A] tabular-nums dark:text-[#EAF1FF]">
            {showAllPeriods ? 'Todos os Períodos' : formatMonthLabelPT(monthKey)}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => handleShiftMonth(1)}
            aria-label="Próximo mês"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant={showAllPeriods ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setShowAllPeriods((prev) => !prev)}
          >
            {showAllPeriods ? 'Filtrar por Mês' : 'Ver Tudo'}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => openModalWithType('transfer')}
            disabled={accounts.length < 2}
          >
            <ArrowLeftRight className="h-3.5 w-3.5 text-[#0F374A] dark:text-[#A7CBE3]" />
            <span>Transferência Interna</span>
          </Button>
        </div>
      </div>

      {/* Alerta de Atrasados */}
      {metrics.overdueCount > 0 && (
        <div className="flex flex-col gap-3 rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-[#991B1B] sm:flex-row sm:items-center sm:justify-between dark:border-[#7F1D1D] dark:bg-[#3B1219] dark:text-[#FCA5A5]">
          <div className="flex items-center gap-2.5 text-[13px]">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              <strong>
                {metrics.overdueCount}{' '}
                {metrics.overdueCount === 1 ? 'lançamento em atraso' : 'lançamentos em atraso'}
              </strong>{' '}
              no período totalizando{' '}
              <strong className="tabular-nums">{formatCurrencyBRL(metrics.overdueAmount)}</strong>.
            </span>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() =>
              setStatusFilter((prev) => (prev === 'overdue' ? 'all' : 'overdue'))
            }
          >
            {statusFilter === 'overdue' ? 'Limpar Filtro Atrasados' : 'Filtrar Atrasados'}
          </Button>
        </div>
      )}

      {/* 5 Cards de Resumo do Período */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
              Saldo Anterior
            </span>
            <p className="mt-1.5 font-display text-[22px] font-semibold leading-7 tracking-[-0.02em] tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
              {formatCurrencyBRL(metrics.previousBalance)}
            </p>
            <p className="mt-1 text-[11px] text-[#42484C] dark:text-[#9DB0C2]">
              Realizado antes do período
            </p>
            {metrics.openingBalanceTotal !== 0 && (
              <p className="mt-0.5 text-[10px] tabular-nums text-[#72787D]">
                inclui saldo inicial de {formatCurrencyBRL(metrics.openingBalanceTotal)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Entradas
              </span>
              <ArrowDownLeft className="h-4 w-4 text-[#059669] dark:text-[#68DBA9]" />
            </div>
            <p className="mt-1.5 font-display text-[22px] font-semibold leading-7 tracking-[-0.02em] tabular-nums text-[#059669] dark:text-[#68DBA9]">
              {formatCurrencyBRL(metrics.inflows)}
            </p>
            <p className="mt-1 text-[11px] tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
              Pago: {formatCurrencyBRL(metrics.inflowsRealized)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Saídas
              </span>
              <ArrowUpRight className="h-4 w-4 text-[#DC2626] dark:text-[#FCA5A5]" />
            </div>
            <p className="mt-1.5 font-display text-[22px] font-semibold leading-7 tracking-[-0.02em] tabular-nums text-[#DC2626] dark:text-[#FCA5A5]">
              {formatCurrencyBRL(metrics.outflows)}
            </p>
            <p className="mt-1 text-[11px] tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
              Pago: {formatCurrencyBRL(metrics.outflowsRealized)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
              Resultado do Período
            </span>
            <p
              className={cn(
                'mt-1.5 font-display text-[22px] font-semibold leading-7 tracking-[-0.02em] tabular-nums',
                metrics.periodResult >= 0
                  ? 'text-[#0F172A] dark:text-[#EAF1FF]'
                  : 'text-[#DC2626] dark:text-[#FCA5A5]'
              )}
            >
              {metrics.periodResult >= 0 ? '+' : ''}
              {formatCurrencyBRL(metrics.periodResult)}
            </p>
            <p className="mt-1 text-[11px] text-[#42484C] dark:text-[#9DB0C2]">
              Exclui transferências internas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Saldo Projetado
                <InfoTooltip glossaryKey="saldo_projetado" align="end" />
              </span>
              <Wallet className="h-4 w-4 text-[#0F374A] dark:text-[#A7CBE3]" />
            </div>
            <p
              className={cn(
                'mt-1.5 font-display text-[22px] font-semibold leading-7 tracking-[-0.02em] tabular-nums',
                metrics.projectedBalance >= 0
                  ? 'text-[#0F374A] dark:text-[#A7CBE3]'
                  : 'text-[#DC2626] dark:text-[#FCA5A5]'
              )}
            >
              {formatCurrencyBRL(metrics.projectedBalance)}
            </p>
            <p className="mt-1 text-[11px] tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
              {metrics.netTransfersInPeriod !== 0
                ? `Transf. líquidas: ${formatCurrencyBRL(metrics.netTransfersInPeriod)}`
                : 'Inclui realizados + previstos'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Saldos por Conta no Escopo */}
      {accountBalances.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accountBalances.map((bal) => (
            <div
              key={bal.account_id}
              className="flex items-center justify-between gap-3 rounded-[8px] border border-[#E2E8F0] bg-white px-4 py-3 dark:border-[#1E2F3F] dark:bg-[#0D1A26]"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-[13px] font-semibold text-[#0F172A] dark:text-[#EAF1FF]">
                    {bal.account_name}
                  </p>
                  <StatusChip variant="neutral">{bal.analytical_token}</StatusChip>
                </div>
                <p className="mt-0.5 text-[11px] tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                  Previsto: {formatCurrencyBRL(bal.projected_balance)}
                </p>
                {bal.opening_balance !== 0 && (
                  <p className="mt-0.5 text-[10px] tabular-nums text-[#72787D]">
                    Saldo inicial: {formatCurrencyBRL(bal.opening_balance)} em {formatDateBR(bal.opening_balance_date)}
                  </p>
                )}
              </div>
              <div className="text-right tabular-nums">
                <p className="text-[10px] uppercase tracking-[0.04em] text-[#72787D]">Saldo Atual</p>
                <p
                  className={cn(
                    'text-[14px] font-semibold',
                    bal.current_balance >= 0
                      ? 'text-[#0F172A] dark:text-[#EAF1FF]'
                      : 'text-[#DC2626] dark:text-[#FCA5A5]'
                  )}
                >
                  {formatCurrencyBRL(bal.current_balance)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Estado sem Empresa/Conta ou Lista de Lançamentos */}
      {companies.length === 0 || accounts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Configure ao menos uma Empresa e Conta Financeira</CardTitle>
            <CardDescription>
              Para registrar entradas, saídas ou transferências internas, cadastre sua empresa e uma
              conta bancária ou caixa.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="primary" onClick={onNavigateHierarchy}>
              Ir para Empresas &amp; Contas
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="border-b border-[#E2E8F0] dark:border-[#1E2F3F]">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Extrato de Lançamentos ({filteredTransactions.length})</CardTitle>
                  <CardDescription>
                    Dê baixa em contas previstas ou atrasadas com 1 clique.
                  </CardDescription>
                </div>

                <div className="relative min-w-[230px]">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[#72787D]" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar descrição, cliente, produto..."
                    className="pl-8"
                  />
                </div>
              </div>

              {/* Barra de Filtros Rápidos */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Select
                  value={statusFilter}
                  onValueChange={(v) => setStatusFilter(v as StatusFilter)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Status: Todos</SelectItem>
                    <SelectItem value="pending">Previstos</SelectItem>
                    <SelectItem value="paid">Pagos / Realizados</SelectItem>
                    <SelectItem value="overdue">Atrasados</SelectItem>
                    <SelectItem value="canceled">Cancelados</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tipo: Todos</SelectItem>
                    <SelectItem value="income">Receitas</SelectItem>
                    <SelectItem value="expense">Despesas</SelectItem>
                    <SelectItem value="transfer">Transferências Internas</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Categoria: Todas</SelectItem>
                    {scopedCategories.map((cat) => (
                      <SelectItem key={cat.id} value={`${cat.code}-${cat.name}`}>
                        {cat.code} · {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={productFilter} onValueChange={setProductFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Produto / Serviço" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Oferta: Todas</SelectItem>
                    {productsServices.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.analytical_token} · {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {filteredTransactions.length === 0 ? (
              <div className="flex flex-col items-start gap-3 p-6">
                <p className="text-[14px] font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                  Nenhum lançamento encontrado neste período ou filtro.
                </p>
                <p className="text-[13px] text-[#42484C] dark:text-[#9DB0C2]">
                  Registre receitas, despesas ou transferências internas, ou altere o mês/visão no
                  topo da tela.
                </p>
                <Button variant="primary" size="sm" onClick={() => openModalWithType('income')}>
                  <Plus className="h-4 w-4" />
                  <span>Registrar Lançamento</span>
                </Button>
              </div>
            ) : (
              <>
                {/* Tabela Desktop */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-[13px]">
                    <thead className="border-b border-[#CBD5E1] bg-[#F8FAFC] text-[12px] font-medium tracking-[0.02em] text-[#64748B] dark:border-[#2A3B4C] dark:bg-[#08131D] dark:text-[#9DB0C2]">
                      <tr>
                        <th className="px-5 py-2.5">
                          {regime === 'cash' ? 'Data Caixa / Venc.' : 'Competência'}
                        </th>
                        <th className="px-4 py-2.5">Descrição &amp; Contraparte</th>
                        <th className="px-4 py-2.5">Categoria &amp; Conta</th>
                        <th className="px-4 py-2.5">Status</th>
                        <th className="px-4 py-2.5 text-right">Valor</th>
                        <th className="px-5 py-2.5 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F1F5F9] dark:divide-[#1E2F3F]">
                      {filteredTransactions.map((tx) => {
                        const effStatus = resolveEffectiveStatus(tx, todayISO);
                        const isOverdue = effStatus === 'overdue';
                        const acc = accountMap.get(tx.account_id);
                        const destAcc = tx.destination_account_id
                          ? accountMap.get(tx.destination_account_id)
                          : undefined;
                        const cat = tx.category_id ? categoryMap.get(tx.category_id) : undefined;
                        const prod = tx.product_service_id
                          ? productMap.get(tx.product_service_id)
                          : undefined;
                        const prj = tx.project_id ? projectMap.get(tx.project_id) : undefined;
                        const isBusy = busyTxId === tx.id;

                        return (
                          <tr
                            key={tx.id}
                            className={cn(
                              'transition-colors',
                              isOverdue
                                ? 'bg-[#FEF2F2]/80 hover:bg-[#FEF2F2] dark:bg-[#3B1219]/40 dark:hover:bg-[#3B1219]/60'
                                : 'hover:bg-[#F1F5F9]/70 dark:hover:bg-[#162838]/50'
                            )}
                          >
                            <td className="whitespace-nowrap px-5 py-3 tabular-nums">
                              <p className="font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                                {regime === 'cash'
                                  ? formatDateBR(tx.payment_date ?? tx.due_date)
                                  : formatDateBR(tx.competence_date)}
                              </p>
                              <p className="text-[11px] text-[#72787D]">
                                {regime === 'cash'
                                  ? `Comp.: ${formatDateBR(tx.competence_date)}`
                                  : `Venc.: ${formatDateBR(tx.due_date)}`}
                              </p>
                            </td>

                            <td className="px-4 py-3">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                                  {tx.description}
                                </span>
                                {prod && (
                                  <StatusChip variant="primary">{prod.analytical_token}</StatusChip>
                                )}
                                {prj && (
                                  <StatusChip variant="neutral">{prj.analytical_token}</StatusChip>
                                )}
                                {tx.is_recurring && (
                                  <StatusChip variant="neutral">Recorrente</StatusChip>
                                )}
                              </div>
                              <p className="text-[11px] text-[#42484C] dark:text-[#9DB0C2]">
                                {tx.transaction_type === 'transfer'
                                  ? 'Movimentação Interna (neutra no resultado)'
                                  : tx.counterparty_name || 'Sem contraparte informada'}
                                {prod ? ` · ${prod.name}` : ''}
                                {prj ? ` · Projeto: ${prj.name}` : ''}
                              </p>
                            </td>

                            <td className="px-4 py-3">
                              <p className="text-[12px] text-[#0F172A] dark:text-[#EAF1FF]">
                                {cat ? `${cat.code} · ${cat.name}` : 'Sem categoria'}
                              </p>
                              <p className="text-[11px] text-[#42484C] dark:text-[#9DB0C2]">
                                {acc?.name ?? 'Conta'} ({acc?.analytical_token})
                                {destAcc
                                  ? ` → ${destAcc.name} (${destAcc.analytical_token})`
                                  : ''}
                              </p>
                            </td>

                            <td className="px-4 py-3">{renderStatusChip(effStatus)}</td>

                            <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
                              <span
                                className={cn(
                                  tx.transaction_type === 'income'
                                    ? 'text-[#059669] dark:text-[#68DBA9]'
                                    : tx.transaction_type === 'expense'
                                      ? 'text-[#DC2626] dark:text-[#FCA5A5]'
                                      : 'text-[#0F374A] dark:text-[#A7CBE3]'
                                )}
                              >
                                {tx.transaction_type === 'income'
                                  ? '+'
                                  : tx.transaction_type === 'expense'
                                    ? '-'
                                    : '⇄ '}
                                {formatCurrencyBRL(tx.amount)}
                              </span>
                            </td>

                            <td className="whitespace-nowrap px-5 py-3 text-right">
                              <div className="inline-flex items-center justify-end gap-1">
                                {(effStatus === 'pending' || effStatus === 'overdue') && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={isBusy}
                                    onClick={() => void handleMarkPaid(tx)}
                                    className="border-[#A7F3D0] text-[#065F46] hover:bg-[#ECFDF5] dark:border-[#005137] dark:text-[#68DBA9] dark:hover:bg-[#003C28]/60"
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    <span>Dar Baixa</span>
                                  </Button>
                                )}
                                {effStatus === 'paid' && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={isBusy}
                                    onClick={() => void handleReopen(tx)}
                                    title="Reabrir como previsto"
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={isBusy}
                                  onClick={() => void handleDelete(tx)}
                                  aria-label={`Excluir ${tx.description}`}
                                  className="text-[#DC2626] hover:bg-[#FEF2F2] hover:text-[#991B1B] dark:text-[#FCA5A5] dark:hover:bg-[#3B1219]"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Cards Mobile (Toque otimizado) */}
                <div className="divide-y divide-[#E2E8F0] md:hidden dark:divide-[#1E2F3F]">
                  {filteredTransactions.map((tx) => {
                    const effStatus = resolveEffectiveStatus(tx, todayISO);
                    const isOverdue = effStatus === 'overdue';
                    const acc = accountMap.get(tx.account_id);
                    const destAcc = tx.destination_account_id
                      ? accountMap.get(tx.destination_account_id)
                      : undefined;
                    const cat = tx.category_id ? categoryMap.get(tx.category_id) : undefined;
                    const prod = tx.product_service_id
                      ? productMap.get(tx.product_service_id)
                      : undefined;
                    const prj = tx.project_id ? projectMap.get(tx.project_id) : undefined;
                    const isBusy = busyTxId === tx.id;

                    return (
                      <div
                        key={tx.id}
                        className={cn(
                          'space-y-3 p-4',
                          isOverdue && 'bg-[#FEF2F2]/80 dark:bg-[#3B1219]/40'
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {renderStatusChip(effStatus)}
                              {prod && (
                                <StatusChip variant="primary">{prod.analytical_token}</StatusChip>
                              )}
                              {prj && (
                                <StatusChip variant="neutral">{prj.analytical_token}</StatusChip>
                              )}
                              <span className="text-[11px] tabular-nums text-[#72787D]">
                                {regime === 'cash'
                                  ? formatDateBR(tx.payment_date ?? tx.due_date)
                                  : formatDateBR(tx.competence_date)}
                              </span>
                            </div>
                            <p className="font-display text-[15px] font-semibold text-[#0F172A] dark:text-[#EAF1FF]">
                              {tx.description}
                            </p>
                            <p className="text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
                              {cat ? `${cat.code} · ${cat.name}` : 'Sem categoria'} ·{' '}
                              {acc?.name ?? ''}
                              {destAcc ? ` → ${destAcc.name}` : ''}
                            </p>
                          </div>

                          <p
                            className={cn(
                              'whitespace-nowrap font-display text-[16px] font-semibold tabular-nums',
                              tx.transaction_type === 'income'
                                ? 'text-[#059669] dark:text-[#68DBA9]'
                                : tx.transaction_type === 'expense'
                                  ? 'text-[#DC2626] dark:text-[#FCA5A5]'
                                  : 'text-[#0F374A] dark:text-[#A7CBE3]'
                            )}
                          >
                            {tx.transaction_type === 'income'
                              ? '+'
                              : tx.transaction_type === 'expense'
                                ? '-'
                                : '⇄ '}
                            {formatCurrencyBRL(tx.amount)}
                          </p>
                        </div>

                        <div className="flex items-center justify-end gap-2">
                          {(effStatus === 'pending' || effStatus === 'overdue') && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => void handleMarkPaid(tx)}
                              className="min-h-[42px] flex-1 border-[#A7F3D0] text-[#065F46] hover:bg-[#ECFDF5] dark:border-[#005137] dark:text-[#68DBA9]"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                              <span>Dar Baixa (Pago)</span>
                            </Button>
                          )}
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => void handleDelete(tx)}
                            className="min-h-[42px]"
                          >
                            <Trash2 className="h-4 w-4" />
                            <span>Excluir</span>
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Modal / Drawer de Novo Lançamento */}
      <TransactionModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        session={session}
        companies={companies}
        accounts={accounts}
        categories={categories}
        productsServices={productsServices}
        projects={projects}
        activeContext={activeContext}
        defaultType={modalDefaultType}
        onCreated={onRefresh}
      />
    </div>
  );
};
