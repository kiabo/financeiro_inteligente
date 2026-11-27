import {
  AlertTriangle,
  Calculator,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Landmark,
  Plus,
  Receipt,
  Trash2,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input, Label } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { StatusChip } from '../../components/ui/status-chip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { cn, formatCurrencyBRL, formatDateBR, getMonthRangeISO, getTodayISO } from '../../lib/utils';
import { InfoTooltip } from '../core/components/InfoTooltip';
import {
  createDebtWithSchedule,
  createTaxObligation,
  deleteDebt,
  deleteTaxObligation,
  getScopedIds,
  payDebtInstallment,
  payTaxObligation,
} from '../core/repository';
import type {
  ActiveContext,
  AmortizationSystem,
  AppSection,
  AuthSessionState,
  Company,
  Debt,
  DebtInstallment,
  DebtKind,
  FinancialAccount,
  TaxObligation,
  TaxType,
  Transaction,
} from '../core/types';
import { calculateAmortizationSchedule, roundCurrency } from './healthEngine';

interface DebtsTaxesViewProps {
  session: AuthSessionState;
  companies: Company[];
  accounts: FinancialAccount[];
  transactions: Transaction[];
  debts: Debt[];
  debtInstallments: DebtInstallment[];
  taxObligations: TaxObligation[];
  activeContext: ActiveContext;
  onRefresh: () => Promise<void>;
  onNavigate: (section: AppSection) => void;
}

const DEBT_KIND_LABELS: Record<DebtKind, string> = {
  loan: 'Empréstimo / Giro',
  financing: 'Financiamento',
  renegotiation: 'Renegociação',
  credit_line: 'Linha de Crédito',
};

const TAX_TYPE_LABELS: Record<TaxType, string> = {
  simples_nacional: 'Simples Nacional (DAS)',
  iss: 'ISS Municipal',
  irpj_csll: 'IRPJ / CSLL',
  pis_cofins: 'PIS / COFINS',
  inss: 'INSS / Previdenciário',
  fgts: 'FGTS',
  icms: 'ICMS Estadual',
  other: 'Outro Tributo',
};

const DEFAULT_TAX_RATES: Record<TaxType, number> = {
  simples_nacional: 6.0,
  iss: 3.0,
  irpj_csll: 4.8,
  pis_cofins: 3.65,
  inss: 11.0,
  fgts: 8.0,
  icms: 12.0,
  other: 5.0,
};

function diffDays(fromISO: string, toISO: string): number {
  const [y1, m1, d1] = fromISO.split('-').map(Number);
  const [y2, m2, d2] = toISO.split('-').map(Number);
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return 0;
  const a = new Date(y1, m1 - 1, d1).getTime();
  const b = new Date(y2, m2 - 1, d2).getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

export const DebtsTaxesView: React.FC<DebtsTaxesViewProps> = ({
  session,
  companies,
  accounts,
  transactions,
  debts,
  debtInstallments,
  taxObligations,
  activeContext,
  onRefresh,
  onNavigate,
}) => {
  const todayISO = getTodayISO();

  const { companyIds } = useMemo(
    () => getScopedIds(companies, accounts, activeContext),
    [companies, accounts, activeContext]
  );

  const scopedCompanies = useMemo(
    () => companies.filter((c) => companyIds.has(c.id)),
    [companies, companyIds]
  );

  const scopedDebts = useMemo(
    () =>
      debts.filter(
        (d) =>
          companyIds.has(d.company_id) &&
          (activeContext.scope !== 'account' ||
            d.account_id === null ||
            d.account_id === activeContext.accountId)
      ),
    [debts, companyIds, activeContext]
  );

  const scopedTaxes = useMemo(
    () =>
      taxObligations.filter(
        (t) =>
          companyIds.has(t.company_id) &&
          (activeContext.scope !== 'account' ||
            t.account_id === null ||
            t.account_id === activeContext.accountId)
      ),
    [taxObligations, companyIds, activeContext]
  );

  // KPIs consolidados
  const summary = useMemo(() => {
    const activeDebtIds = new Set(
      scopedDebts.filter((d) => d.status === 'active').map((d) => d.id)
    );
    const activeInstallments = debtInstallments.filter((i) => activeDebtIds.has(i.debt_id));
    const currentMonth = todayISO.slice(0, 7);

    let totalDebtBalance = 0;
    let totalFutureInterest = 0;
    let currentMonthService = 0;
    let overdueInstallments = 0;

    for (const inst of activeInstallments) {
      if (inst.status === 'paid' || inst.status === 'canceled') continue;
      totalDebtBalance = roundCurrency(totalDebtBalance + inst.principal_portion);
      totalFutureInterest = roundCurrency(totalFutureInterest + inst.interest_portion);
      if (inst.due_date.slice(0, 7) === currentMonth) {
        currentMonthService = roundCurrency(currentMonthService + inst.total_amount);
      }
      if (inst.due_date < todayISO) {
        overdueInstallments += 1;
      }
    }

    // Taxa média ponderada de juros mensais
    const activeDebts = scopedDebts.filter((d) => d.status === 'active');
    const totalPrincipalWeighted = activeDebts.reduce((s, d) => s + d.principal_amount, 0);
    const avgMonthlyRate =
      totalPrincipalWeighted > 0
        ? activeDebts.reduce((s, d) => s + d.monthly_interest_rate_pct * d.principal_amount, 0) /
          totalPrincipalWeighted
        : 0;

    let openTaxesAmount = 0;
    let overdueTaxesCount = 0;
    let dueSoonTaxesCount = 0;

    for (const tax of scopedTaxes) {
      if (tax.status === 'paid' || tax.status === 'canceled') continue;
      openTaxesAmount = roundCurrency(openTaxesAmount + tax.amount);
      const delta = diffDays(todayISO, tax.due_date);
      if (delta < 0) overdueTaxesCount += 1;
      else if (delta <= 7) dueSoonTaxesCount += 1;
    }

    return {
      totalDebtBalance,
      totalFutureInterest,
      currentMonthService,
      overdueInstallments,
      avgMonthlyRate,
      openTaxesAmount,
      overdueTaxesCount,
      dueSoonTaxesCount,
    };
  }, [scopedDebts, debtInstallments, scopedTaxes, todayISO]);

  // Estados de Modais
  const [selectedDebtId, setSelectedDebtId] = useState<string | null>(null);
  const [debtModalOpen, setDebtModalOpen] = useState(false);
  const [taxModalOpen, setTaxModalOpen] = useState(false);
  const [settleModal, setSettleModal] = useState<
    | { kind: 'installment'; installment: DebtInstallment; debt: Debt }
    | { kind: 'tax'; tax: TaxObligation }
    | null
  >(null);
  const [settleAccountId, setSettleAccountId] = useState<string>('');
  const [settleDate, setSettleDate] = useState<string>(todayISO);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Formulário Nova Dívida
  const defaultCompanyId = scopedCompanies[0]?.id ?? '';
  const [debtCompanyId, setDebtCompanyId] = useState<string>(defaultCompanyId);
  const [debtAccountId, setDebtAccountId] = useState<string>('');
  const [debtTitle, setDebtTitle] = useState('');
  const [debtCreditor, setDebtCreditor] = useState('');
  const [debtContract, setDebtContract] = useState('');
  const [debtKind, setDebtKind] = useState<DebtKind>('loan');
  const [debtSystem, setDebtSystem] = useState<AmortizationSystem>('price');
  const [debtPrincipal, setDebtPrincipal] = useState('30000');
  const [debtRate, setDebtRate] = useState('1.4');
  const [debtInstallmentsCount, setDebtInstallmentsCount] = useState('12');
  const [debtFirstDue, setDebtFirstDue] = useState(todayISO);

  // Preview ao vivo SAC / Price
  const debtPreview = useMemo(() => {
    const p = Math.max(1, Number(debtPrincipal) || 0);
    const r = Math.max(0, Number(debtRate) || 0);
    const n = Math.min(360, Math.max(1, Math.floor(Number(debtInstallmentsCount) || 1)));
    return calculateAmortizationSchedule({
      principal: p,
      monthlyInterestRatePct: r,
      totalInstallments: n,
      system: debtSystem,
      firstDueDate: debtFirstDue || todayISO,
    });
  }, [debtPrincipal, debtRate, debtInstallmentsCount, debtSystem, debtFirstDue, todayISO]);

  // Formulário Novo Imposto
  const [taxCompanyId, setTaxCompanyId] = useState<string>(defaultCompanyId);
  const [taxAccountId, setTaxAccountId] = useState<string>('');
  const [taxType, setTaxType] = useState<TaxType>('simples_nacional');
  const [taxName, setTaxName] = useState('DAS Simples Nacional');
  const [taxCompetenceMonth, setTaxCompetenceMonth] = useState(todayISO.slice(0, 7));
  const [taxDueDate, setTaxDueDate] = useState(todayISO);
  const [taxRevenueBase, setTaxRevenueBase] = useState('0');
  const [taxRatePct, setTaxRatePct] = useState('6');
  const [taxAmount, setTaxAmount] = useState('0');
  const [taxGuideRef, setTaxGuideRef] = useState('');
  const [taxRecurring, setTaxRecurring] = useState(true);

  const activeDebtCompanyId = debtCompanyId || defaultCompanyId;
  const activeTaxCompanyId = taxCompanyId || defaultCompanyId;

  const estimateTaxFromRevenue = (compId: string, monthKey: string, rateVal: number) => {
    const range = getMonthRangeISO(monthKey);
    const rev = transactions
      .filter(
        (tx) =>
          tx.company_id === compId &&
          tx.status !== 'canceled' &&
          tx.transaction_type === 'income' &&
          tx.competence_date >= range.start &&
          tx.competence_date <= range.end
      )
      .reduce((sum, tx) => sum + tx.amount, 0);

    const roundedBase = roundCurrency(rev);
    const estimated = roundCurrency(roundedBase * (Math.max(0, rateVal) / 100));
    setTaxRevenueBase(String(roundedBase));
    setTaxAmount(String(estimated));
  };

  const handleOpenDebtModal = () => {
    setFormError(null);
    const compId = scopedCompanies[0]?.id ?? '';
    setDebtCompanyId(compId);
    setDebtAccountId(accounts.find((a) => a.company_id === compId)?.id ?? '');
    setDebtModalOpen(true);
  };

  const handleOpenTaxModal = () => {
    setFormError(null);
    const compId = scopedCompanies[0]?.id ?? '';
    setTaxCompanyId(compId);
    setTaxAccountId(accounts.find((a) => a.company_id === compId)?.id ?? '');
    estimateTaxFromRevenue(compId, taxCompetenceMonth, Number(taxRatePct) || 6);
    setTaxModalOpen(true);
  };

  const handleCreateDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setBusyId('create-debt');
    try {
      await createDebtWithSchedule(session.userId, session.email, {
        company_id: activeDebtCompanyId,
        account_id: debtAccountId || null,
        title: debtTitle,
        creditor_name: debtCreditor,
        contract_code: debtContract || undefined,
        debt_kind: debtKind,
        amortization_system: debtSystem,
        principal_amount: Number(debtPrincipal),
        monthly_interest_rate_pct: Number(debtRate),
        total_installments: Number(debtInstallmentsCount),
        first_due_date: debtFirstDue,
      });
      setDebtModalOpen(false);
      setDebtTitle('');
      setDebtCreditor('');
      setDebtContract('');
      await onRefresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao cadastrar dívida.');
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateTax = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setBusyId('create-tax');
    try {
      await createTaxObligation(session.userId, session.email, {
        company_id: activeTaxCompanyId,
        account_id: taxAccountId || null,
        tax_name: taxName,
        tax_type: taxType,
        competence_month: taxCompetenceMonth,
        due_date: taxDueDate,
        revenue_base_amount: Number(taxRevenueBase) || 0,
        estimated_rate_pct: Number(taxRatePct) || 0,
        amount: Number(taxAmount) || 0,
        is_recurring: taxRecurring,
        guide_reference: taxGuideRef || undefined,
      });
      setTaxModalOpen(false);
      setTaxGuideRef('');
      await onRefresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao registrar obrigação fiscal.');
    } finally {
      setBusyId(null);
    }
  };

  const openSettleInstallment = (inst: DebtInstallment, debt: Debt) => {
    setFormError(null);
    const defaultAcc =
      debt.account_id ?? accounts.find((a) => a.company_id === debt.company_id)?.id ?? '';
    setSettleAccountId(defaultAcc);
    setSettleDate(todayISO);
    setSettleModal({ kind: 'installment', installment: inst, debt });
  };

  const openSettleTax = (tax: TaxObligation) => {
    setFormError(null);
    const defaultAcc =
      tax.account_id ?? accounts.find((a) => a.company_id === tax.company_id)?.id ?? '';
    setSettleAccountId(defaultAcc);
    setSettleDate(todayISO);
    setSettleModal({ kind: 'tax', tax });
  };

  const handleConfirmSettle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settleModal || !settleAccountId) {
      setFormError('Selecione a conta bancária que realizou o pagamento.');
      return;
    }
    setFormError(null);
    setBusyId('settle');
    try {
      if (settleModal.kind === 'installment') {
        await payDebtInstallment(session.userId, session.email, {
          installmentId: settleModal.installment.id,
          accountId: settleAccountId,
          paymentDate: settleDate,
        });
      } else {
        await payTaxObligation(session.userId, session.email, {
          taxId: settleModal.tax.id,
          accountId: settleAccountId,
          paymentDate: settleDate,
        });
      }
      setSettleModal(null);
      await onRefresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao registrar pagamento.');
    } finally {
      setBusyId(null);
    }
  };

  const selectedDebt = useMemo(
    () => scopedDebts.find((d) => d.id === selectedDebtId) ?? null,
    [scopedDebts, selectedDebtId]
  );

  const selectedDebtSchedule = useMemo(
    () =>
      selectedDebt
        ? debtInstallments
            .filter((i) => i.debt_id === selectedDebt.id)
            .sort((a, b) => a.installment_number - b.installment_number)
        : [],
    [selectedDebt, debtInstallments]
  );

  const companyNameMap = useMemo(
    () => new Map(companies.map((c) => [c.id, `${c.trade_name ?? c.legal_name} (${c.analytical_token})`])),
    [companies]
  );

  if (companies.length === 0) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
            Dívidas &amp; Impostos
          </span>
          <h1 className="font-display text-[24px] font-semibold leading-8 tracking-[-0.02em] text-[#0F172A] dark:text-[#EAF1FF]">
            Dívidas, Parcelamentos &amp; Impostos
          </h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Cadastre uma empresa antes de lançar dívidas ou tributos</CardTitle>
            <CardDescription>
              Cada contrato de dívida tokeniza automaticamente o credor (`CRD_XX`) no Cofre de
              Privacidade e vincula as baixas ao Fluxo de Caixa.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="primary" onClick={() => onNavigate('hierarchy')}>
              Ir para Empresas &amp; Contas
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
            Dívidas &amp; Impostos
          </span>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-[24px] font-semibold leading-8 tracking-[-0.02em] text-[#0F172A] dark:text-[#EAF1FF]">
              Dívidas, Parcelamentos &amp; Impostos
            </h1>
            <InfoTooltip glossaryKey="amortizacao_sac_price" />
          </div>
          <p className="text-[14px] leading-5 text-[#42484C] dark:text-[#9DB0C2]">
            Amortização SAC/Price integrada à DRE (juros em Resultado Financeiro) e apuração de
            guias fiscais sobre faturamento.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={handleOpenTaxModal}>
            <Receipt className="h-4 w-4" />
            <span>Nova Guia Fiscal</span>
          </Button>
          <Button variant="primary" onClick={handleOpenDebtModal}>
            <Plus className="h-4 w-4" />
            <span>Nova Dívida / Empréstimo</span>
          </Button>
        </div>
      </div>

      {/* 4 KPIs Consolidados */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Saldo Devedor (Principal)
              </span>
              <Landmark className="h-4 w-4 text-[#72787D]" />
            </div>
            <p className="mt-2 font-display text-[24px] font-semibold leading-8 tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
              {formatCurrencyBRL(summary.totalDebtBalance)}
            </p>
            <p className="mt-1 text-[12px] tabular-nums text-[#72787D]">
              +{formatCurrencyBRL(summary.totalFutureInterest)} de juros futuros
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Custo Efetivo &amp; Parcelas
              </span>
              <CreditCard className="h-4 w-4 text-[#72787D]" />
            </div>
            <p className="mt-2 font-display text-[24px] font-semibold leading-8 tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
              {summary.avgMonthlyRate.toFixed(2).replace('.', ',')}% a.m.
            </p>
            <p className="mt-1 text-[12px] tabular-nums text-[#72787D]">
              Serviço do mês: {formatCurrencyBRL(summary.currentMonthService)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Impostos em Aberto
                <InfoTooltip glossaryKey="obrigacoes_fiscais" />
              </span>
              <Receipt className="h-4 w-4 text-[#72787D]" />
            </div>
            <p className="mt-2 font-display text-[24px] font-semibold leading-8 tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
              {formatCurrencyBRL(summary.openTaxesAmount)}
            </p>
            <p className="mt-1 text-[12px] tabular-nums text-[#72787D]">
              {scopedTaxes.filter((t) => t.status !== 'paid' && t.status !== 'canceled').length}{' '}
              guia(s) pendente(s)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Alertas de Vencimento
              </span>
              <CalendarClock className="h-4 w-4 text-[#72787D]" />
            </div>
            <p
              className={cn(
                'mt-2 font-display text-[24px] font-semibold leading-8 tabular-nums',
                summary.overdueTaxesCount + summary.overdueInstallments > 0
                  ? 'text-[#DC2626] dark:text-[#FCA5A5]'
                  : 'text-[#059669] dark:text-[#68DBA9]'
              )}
            >
              {summary.overdueTaxesCount + summary.dueSoonTaxesCount + summary.overdueInstallments}
            </p>
            <p className="mt-1 text-[12px] tabular-nums text-[#72787D]">
              {summary.overdueTaxesCount + summary.overdueInstallments} vencido(s) ·{' '}
              {summary.dueSoonTaxesCount} em 7 dias
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs: Dívidas vs Impostos */}
      <Tabs defaultValue="debts">
        <TabsList>
          <TabsTrigger value="debts" className="gap-1.5 tabular-nums">
            <Landmark className="h-3.5 w-3.5" />
            <span>Dívidas &amp; Parcelamentos ({scopedDebts.length})</span>
          </TabsTrigger>
          <TabsTrigger value="taxes" className="gap-1.5 tabular-nums">
            <Receipt className="h-3.5 w-3.5" />
            <span>Impostos &amp; Calendário Fiscal ({scopedTaxes.length})</span>
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: DÍVIDAS & AMORTIZAÇÃO */}
        <TabsContent value="debts" className="mt-4 space-y-4">
          {scopedDebts.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center">
                <p className="text-[14px] font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                  Nenhuma dívida ou financiamento cadastrado neste escopo.
                </p>
                <p className="mt-1 text-[12px] text-[#72787D]">
                  Cadastre um contrato SAC ou Tabela Price para acompanhar o cronograma automático
                  de amortização e juros.
                </p>
                <Button variant="primary" size="sm" className="mt-4" onClick={handleOpenDebtModal}>
                  <Plus className="h-3.5 w-3.5" />
                  <span>Cadastrar Contrato</span>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {scopedDebts.map((debt) => {
                const insts = debtInstallments
                  .filter((i) => i.debt_id === debt.id)
                  .sort((a, b) => a.installment_number - b.installment_number);
                const paidCount = insts.filter((i) => i.status === 'paid').length;
                const openPrincipal = insts
                  .filter((i) => i.status !== 'paid' && i.status !== 'canceled')
                  .reduce((s, i) => s + i.principal_portion, 0);
                const nextInst = insts.find((i) => i.status !== 'paid' && i.status !== 'canceled');
                const annualRate =
                  (Math.pow(1 + debt.monthly_interest_rate_pct / 100, 12) - 1) * 100;

                return (
                  <Card key={debt.id}>
                    <CardHeader className="border-b border-[#E2E8F0] pb-3 dark:border-[#1E2F3F]">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusChip variant="primary">{debt.creditor_token}</StatusChip>
                            <StatusChip variant="neutral">
                              {debt.amortization_system.toUpperCase()}
                            </StatusChip>
                            <StatusChip
                              variant={debt.status === 'settled' ? 'positive' : 'neutral'}
                            >
                              {debt.status === 'settled' ? 'Quitada' : DEBT_KIND_LABELS[debt.debt_kind]}
                            </StatusChip>
                          </div>
                          <CardTitle className="text-[16px]">{debt.title}</CardTitle>
                          <CardDescription>
                            Credor: <strong className="font-medium">{debt.creditor_name}</strong> ·{' '}
                            {companyNameMap.get(debt.company_id) ?? ''}
                          </CardDescription>
                        </div>

                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Excluir ${debt.title}`}
                          onClick={async () => {
                            setBusyId(debt.id);
                            try {
                              await deleteDebt(session.userId, session.email, debt.id);
                              if (selectedDebtId === debt.id) setSelectedDebtId(null);
                              await onRefresh();
                            } finally {
                              setBusyId(null);
                            }
                          }}
                          disabled={busyId === debt.id}
                        >
                          <Trash2 className="h-4 w-4 text-[#DC2626]" />
                        </Button>
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-4 pt-4">
                      <div className="grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-4">
                        <div>
                          <span className="block text-[#72787D]">Principal Original</span>
                          <span className="font-semibold tabular-nums">
                            {formatCurrencyBRL(debt.principal_amount)}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[#72787D]">Saldo Devedor</span>
                          <span className="font-semibold tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
                            {formatCurrencyBRL(openPrincipal)}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[#72787D]">Taxa Efetiva</span>
                          <span className="font-semibold tabular-nums">
                            {debt.monthly_interest_rate_pct.toFixed(2).replace('.', ',')}% a.m. (
                            {annualRate.toFixed(1).replace('.', ',')}% a.a.)
                          </span>
                        </div>
                        <div>
                          <span className="block text-[#72787D]">Parcelas</span>
                          <span className="font-semibold tabular-nums">
                            {paidCount} / {debt.total_installments} pagas
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#F1F5F9] pt-3 dark:border-[#1E2F3F]">
                        <div className="text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
                          {nextInst ? (
                            <span className="tabular-nums">
                              Próxima ({nextInst.installment_number}ª):{' '}
                              <strong
                                className={cn(
                                  nextInst.due_date < todayISO
                                    ? 'text-[#DC2626] dark:text-[#FCA5A5]'
                                    : ''
                                )}
                              >
                                {formatDateBR(nextInst.due_date)} ·{' '}
                                {formatCurrencyBRL(nextInst.total_amount)}
                              </strong>
                            </span>
                          ) : (
                            <span className="text-[#059669] dark:text-[#68DBA9]">
                              Todas as parcelas liquidadas
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {nextInst && (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => openSettleInstallment(nextInst, debt)}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>Pagar Próxima</span>
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedDebtId(debt.id)}
                          >
                            Ver Cronograma
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* TAB 2: OBRIGAÇÕES FISCAIS & IMPOSTOS */}
        <TabsContent value="taxes" className="mt-4">
          <Card>
            <CardHeader className="border-b border-[#E2E8F0] dark:border-[#1E2F3F]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Calendário Fiscal &amp; Guias Apuradas</CardTitle>
                  <CardDescription>
                    Ao dar baixa em uma guia, a transação de imposto é lançada automaticamente em{' '}
                    <span className="font-mono">2.1</span> (Deduções da DRE).
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={handleOpenTaxModal}>
                  <Calculator className="h-3.5 w-3.5" />
                  <span>Apurar Nova Guia</span>
                </Button>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {scopedTaxes.length === 0 ? (
                <p className="py-10 text-center text-[13px] text-[#72787D]">
                  Nenhuma guia fiscal cadastrada neste contexto.
                </p>
              ) : (
                <>
                  {/* Desktop Table */}
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-left text-[13px]">
                      <thead className="border-b border-[#CBD5E1] bg-[#F8FAFC] text-[12px] font-medium text-[#64748B] dark:border-[#2A3B4C] dark:bg-[#08131D] dark:text-[#9DB0C2]">
                        <tr>
                          <th className="px-4 py-2.5">Competência</th>
                          <th className="px-4 py-2.5">Tributo / Guia</th>
                          <th className="px-4 py-2.5">Empresa</th>
                          <th className="px-4 py-2.5">Vencimento</th>
                          <th className="px-4 py-2.5 text-right">Base Faturam.</th>
                          <th className="px-4 py-2.5 text-right">Alíq. %</th>
                          <th className="px-4 py-2.5 text-right">Valor Guia</th>
                          <th className="px-4 py-2.5">Status</th>
                          <th className="px-4 py-2.5 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F1F5F9] dark:divide-[#1E2F3F]">
                        {scopedTaxes.map((tax) => {
                          const daysLeft = diffDays(todayISO, tax.due_date);
                          const isPaid = tax.status === 'paid';
                          const isOverdue = !isPaid && daysLeft < 0;
                          const isSoon = !isPaid && daysLeft >= 0 && daysLeft <= 7;

                          return (
                            <tr
                              key={tax.id}
                              className="hover:bg-[#F1F5F9]/70 dark:hover:bg-[#162838]/50"
                            >
                              <td className="px-4 py-3 font-mono text-[12px] tabular-nums">
                                {tax.competence_month.slice(0, 7)}
                              </td>
                              <td className="px-4 py-3">
                                <p className="font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                                  {tax.tax_name}
                                </p>
                                <p className="text-[11px] text-[#72787D]">
                                  {TAX_TYPE_LABELS[tax.tax_type]}
                                  {tax.guide_reference ? ` · ${tax.guide_reference}` : ''}
                                </p>
                              </td>
                              <td className="px-4 py-3 text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
                                {companyNameMap.get(tax.company_id) ?? '—'}
                              </td>
                              <td className="px-4 py-3 tabular-nums">
                                {formatDateBR(tax.due_date)}
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                                {formatCurrencyBRL(tax.revenue_base_amount)}
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                                {tax.estimated_rate_pct.toFixed(2).replace('.', ',')}%
                              </td>
                              <td className="px-4 py-3 text-right font-semibold tabular-nums">
                                {formatCurrencyBRL(tax.amount)}
                              </td>
                              <td className="px-4 py-3">
                                {isPaid ? (
                                  <StatusChip variant="positive">
                                    Pago {tax.paid_date ? formatDateBR(tax.paid_date) : ''}
                                  </StatusChip>
                                ) : isOverdue ? (
                                  <StatusChip variant="alert">
                                    Vencido ({Math.abs(daysLeft)}d)
                                  </StatusChip>
                                ) : isSoon ? (
                                  <StatusChip variant="alert">
                                    Vence em {daysLeft}d
                                  </StatusChip>
                                ) : (
                                  <StatusChip variant="neutral">A vencer</StatusChip>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="inline-flex items-center gap-1.5">
                                  {!isPaid && (
                                    <Button
                                      variant="primary"
                                      size="sm"
                                      onClick={() => openSettleTax(tax)}
                                    >
                                      Dar Baixa
                                    </Button>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={`Excluir ${tax.tax_name}`}
                                    onClick={async () => {
                                      setBusyId(tax.id);
                                      try {
                                        await deleteTaxObligation(
                                          session.userId,
                                          session.email,
                                          tax.id
                                        );
                                        await onRefresh();
                                      } finally {
                                        setBusyId(null);
                                      }
                                    }}
                                    disabled={busyId === tax.id}
                                  >
                                    <Trash2 className="h-3.5 w-3.5 text-[#DC2626]" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards */}
                  <div className="divide-y divide-[#E2E8F0] md:hidden dark:divide-[#1E2F3F]">
                    {scopedTaxes.map((tax) => {
                      const daysLeft = diffDays(todayISO, tax.due_date);
                      const isPaid = tax.status === 'paid';
                      const isOverdue = !isPaid && daysLeft < 0;
                      const isSoon = !isPaid && daysLeft >= 0 && daysLeft <= 7;

                      return (
                        <div key={tax.id} className="space-y-2 p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-[13px] font-semibold text-[#0F172A] dark:text-[#EAF1FF]">
                                {tax.tax_name}
                              </p>
                              <p className="text-[11px] text-[#72787D]">
                                Comp. {tax.competence_month.slice(0, 7)} · Venc.{' '}
                                {formatDateBR(tax.due_date)}
                              </p>
                            </div>
                            {isPaid ? (
                              <StatusChip variant="positive">Pago</StatusChip>
                            ) : isOverdue ? (
                              <StatusChip variant="alert">Vencido</StatusChip>
                            ) : isSoon ? (
                              <StatusChip variant="alert">Vence {daysLeft}d</StatusChip>
                            ) : (
                              <StatusChip variant="neutral">A vencer</StatusChip>
                            )}
                          </div>
                          <div className="flex items-center justify-between pt-1">
                            <span className="font-display text-[16px] font-semibold tabular-nums">
                              {formatCurrencyBRL(tax.amount)}
                            </span>
                            <div className="flex items-center gap-2">
                              {!isPaid && (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => openSettleTax(tax)}
                                >
                                  Dar Baixa
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={async () => {
                                  await deleteTaxObligation(session.userId, session.email, tax.id);
                                  await onRefresh();
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-[#DC2626]" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog: Cronograma de Amortização da Dívida */}
      <Dialog
        open={Boolean(selectedDebt)}
        onOpenChange={(open) => {
          if (!open) setSelectedDebtId(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          {selectedDebt && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip variant="primary">{selectedDebt.creditor_token}</StatusChip>
                  <StatusChip variant="neutral">
                    Sistema {selectedDebt.amortization_system.toUpperCase()}
                  </StatusChip>
                </div>
                <DialogTitle className="mt-1">{selectedDebt.title}</DialogTitle>
                <DialogDescription>
                  Credor: {selectedDebt.creditor_name} · Principal{' '}
                  {formatCurrencyBRL(selectedDebt.principal_amount)} a{' '}
                  {selectedDebt.monthly_interest_rate_pct.toFixed(2).replace('.', ',')}% a.m.
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 max-h-[60vh] overflow-auto rounded-[6px] border border-[#E2E8F0] dark:border-[#1E2F3F]">
                <table className="w-full text-left text-[12px]">
                  <thead className="sticky top-0 border-b border-[#CBD5E1] bg-[#F8FAFC] text-[#64748B] dark:border-[#2A3B4C] dark:bg-[#08131D] dark:text-[#9DB0C2]">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Vencimento</th>
                      <th className="px-3 py-2 text-right">Amortização</th>
                      <th className="px-3 py-2 text-right">Juros</th>
                      <th className="px-3 py-2 text-right">Parcela</th>
                      <th className="px-3 py-2 text-right">Saldo Dev.</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9] dark:divide-[#1E2F3F]">
                    {selectedDebtSchedule.map((inst) => {
                      const isPaid = inst.status === 'paid';
                      const isOverdue = !isPaid && inst.due_date < todayISO;
                      return (
                        <tr key={inst.id}>
                          <td className="px-3 py-2 font-mono tabular-nums">
                            {inst.installment_number}
                          </td>
                          <td className="px-3 py-2 tabular-nums">{formatDateBR(inst.due_date)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatCurrencyBRL(inst.principal_portion)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                            {formatCurrencyBRL(inst.interest_portion)}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">
                            {formatCurrencyBRL(inst.total_amount)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-[#72787D]">
                            {formatCurrencyBRL(inst.remaining_balance)}
                          </td>
                          <td className="px-3 py-2">
                            {isPaid ? (
                              <StatusChip variant="positive">Paga</StatusChip>
                            ) : isOverdue ? (
                              <StatusChip variant="alert">Atrasada</StatusChip>
                            ) : (
                              <StatusChip variant="neutral">Aberta</StatusChip>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {!isPaid && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openSettleInstallment(inst, selectedDebt)}
                              >
                                Pagar
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog: Nova Dívida com Simulação SAC/Price */}
      <Dialog open={debtModalOpen} onOpenChange={setDebtModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Cadastrar Dívida ou Parcelamento</DialogTitle>
            <DialogDescription>
              O nome do credor recebe um token imutável (<span className="font-mono">CRD_XX</span>) no
              Cofre de Privacidade e o cronograma SAC/Price é gerado automaticamente.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateDebt} className="mt-4 space-y-4">
            {formError && (
              <div className="rounded-[4px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#991B1B] dark:border-[#7F1D1D] dark:bg-[#3B1219] dark:text-[#FCA5A5]">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="debt-company">Empresa Tomadora *</Label>
                <Select
                  value={activeDebtCompanyId}
                  onValueChange={(v) => {
                    setDebtCompanyId(v);
                    setDebtAccountId(accounts.find((a) => a.company_id === v)?.id ?? '');
                  }}
                >
                  <SelectTrigger id="debt-company">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {scopedCompanies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.trade_name ?? c.legal_name} ({c.analytical_token})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="debt-account">Conta Padrão para Débito</Label>
                <Select value={debtAccountId} onValueChange={setDebtAccountId}>
                  <SelectTrigger id="debt-account">
                    <SelectValue placeholder="Selecione uma conta" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts
                      .filter((a) => a.company_id === activeDebtCompanyId)
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name} ({a.analytical_token})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="debt-title">Título do Contrato *</Label>
                <Input
                  id="debt-title"
                  required
                  value={debtTitle}
                  onChange={(e) => setDebtTitle(e.target.value)}
                  placeholder="Ex.: Capital de Giro Expansão"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="debt-creditor">Credor / Instituição *</Label>
                <Input
                  id="debt-creditor"
                  required
                  value={debtCreditor}
                  onChange={(e) => setDebtCreditor(e.target.value)}
                  placeholder="Ex.: Banco Itaú Empresas"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="debt-kind">Modalidade</Label>
                <Select value={debtKind} onValueChange={(v) => setDebtKind(v as DebtKind)}>
                  <SelectTrigger id="debt-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="loan">Empréstimo / Giro</SelectItem>
                    <SelectItem value="financing">Financiamento</SelectItem>
                    <SelectItem value="renegotiation">Renegociação</SelectItem>
                    <SelectItem value="credit_line">Linha de Crédito</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="debt-system">Sistema de Amortização</Label>
                <Select
                  value={debtSystem}
                  onValueChange={(v) => setDebtSystem(v as AmortizationSystem)}
                >
                  <SelectTrigger id="debt-system">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="price">Tabela Price (Parcelas Fixas)</SelectItem>
                    <SelectItem value="sac">SAC (Amortização Constante)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="debt-principal">Valor Principal (R$) *</Label>
                <Input
                  id="debt-principal"
                  type="number"
                  step="0.01"
                  min="1"
                  required
                  value={debtPrincipal}
                  onChange={(e) => setDebtPrincipal(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="debt-rate">Taxa de Juros (% a.m.) *</Label>
                <Input
                  id="debt-rate"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  required
                  value={debtRate}
                  onChange={(e) => setDebtRate(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="debt-inst">Total de Parcelas *</Label>
                <Input
                  id="debt-inst"
                  type="number"
                  min="1"
                  max="360"
                  required
                  value={debtInstallmentsCount}
                  onChange={(e) => setDebtInstallmentsCount(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="debt-due">1º Vencimento *</Label>
                <Input
                  id="debt-due"
                  type="date"
                  required
                  value={debtFirstDue}
                  onChange={(e) => setDebtFirstDue(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="debt-contract">Número do Contrato (opcional)</Label>
              <Input
                id="debt-contract"
                value={debtContract}
                onChange={(e) => setDebtContract(e.target.value)}
                placeholder="Ex.: CTR-2026-0041"
              />
            </div>

            {/* Pré-visualização ao vivo */}
            <div className="rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 dark:border-[#1E2F3F] dark:bg-[#08131D]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
                Prévia do Cronograma ({debtSystem.toUpperCase()})
              </p>
              <div className="mt-2 grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-4 tabular-nums">
                <div>
                  <span className="block text-[#72787D]">1ª Parcela</span>
                  <span className="font-semibold">
                    {formatCurrencyBRL(debtPreview.firstInstallmentAmount)}
                  </span>
                </div>
                <div>
                  <span className="block text-[#72787D]">Última Parcela</span>
                  <span className="font-semibold">
                    {formatCurrencyBRL(debtPreview.lastInstallmentAmount)}
                  </span>
                </div>
                <div>
                  <span className="block text-[#72787D]">Juros Totais</span>
                  <span className="font-semibold text-[#DC2626] dark:text-[#FCA5A5]">
                    {formatCurrencyBRL(debtPreview.totalInterest)}
                  </span>
                </div>
                <div>
                  <span className="block text-[#72787D]">Custo Anual Efetivo</span>
                  <span className="font-semibold">
                    {debtPreview.effectiveAnnualRatePct.toFixed(1).replace('.', ',')}% a.a.
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setDebtModalOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={busyId === 'create-debt'}>
                {busyId === 'create-debt' ? 'Gerando...' : 'Gerar Cronograma e Salvar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: Nova Obrigação Fiscal / Imposto */}
      <Dialog open={taxModalOpen} onOpenChange={setTaxModalOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Registrar Obrigação Fiscal / Imposto</DialogTitle>
            <DialogDescription>
              Estime automaticamente o tributo sobre o faturamento da competência ou informe o
              valor exato da guia emitida.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateTax} className="mt-4 space-y-4">
            {formError && (
              <div className="rounded-[4px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#991B1B] dark:border-[#7F1D1D] dark:bg-[#3B1219] dark:text-[#FCA5A5]">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tax-company">Empresa *</Label>
                <Select
                  value={activeTaxCompanyId}
                  onValueChange={(v) => {
                    setTaxCompanyId(v);
                    setTaxAccountId(accounts.find((a) => a.company_id === v)?.id ?? '');
                    estimateTaxFromRevenue(v, taxCompetenceMonth, Number(taxRatePct) || 0);
                  }}
                >
                  <SelectTrigger id="tax-company">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {scopedCompanies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.trade_name ?? c.legal_name} ({c.analytical_token})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tax-type">Tributo *</Label>
                <Select
                  value={taxType}
                  onValueChange={(v) => {
                    const nextType = v as TaxType;
                    setTaxType(nextType);
                    setTaxName(TAX_TYPE_LABELS[nextType]);
                    const nextRate = DEFAULT_TAX_RATES[nextType];
                    setTaxRatePct(String(nextRate));
                    estimateTaxFromRevenue(activeTaxCompanyId, taxCompetenceMonth, nextRate);
                  }}
                >
                  <SelectTrigger id="tax-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TAX_TYPE_LABELS).map(([k, label]) => (
                      <SelectItem key={k} value={k}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="tax-name">Descrição da Guia *</Label>
                <Input
                  id="tax-name"
                  required
                  value={taxName}
                  onChange={(e) => setTaxName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tax-comp">Mês de Competência *</Label>
                <Input
                  id="tax-comp"
                  type="month"
                  required
                  value={taxCompetenceMonth}
                  onChange={(e) => {
                    setTaxCompetenceMonth(e.target.value);
                    if (e.target.value) {
                      estimateTaxFromRevenue(
                        activeTaxCompanyId,
                        e.target.value,
                        Number(taxRatePct) || 0
                      );
                    }
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tax-due">Vencimento *</Label>
                <Input
                  id="tax-due"
                  type="date"
                  required
                  value={taxDueDate}
                  onChange={(e) => setTaxDueDate(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tax-base">Base de Faturamento (R$)</Label>
                <Input
                  id="tax-base"
                  type="number"
                  step="0.01"
                  min="0"
                  value={taxRevenueBase}
                  onChange={(e) => {
                    setTaxRevenueBase(e.target.value);
                    const base = Number(e.target.value) || 0;
                    const rate = Number(taxRatePct) || 0;
                    setTaxAmount(String(roundCurrency(base * (rate / 100))));
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tax-rate">Alíquota Estimada (%)</Label>
                <Input
                  id="tax-rate"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={taxRatePct}
                  onChange={(e) => {
                    setTaxRatePct(e.target.value);
                    const base = Number(taxRevenueBase) || 0;
                    const rate = Number(e.target.value) || 0;
                    setTaxAmount(String(roundCurrency(base * (rate / 100))));
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tax-amount">Valor Final da Guia (R$) *</Label>
                <Input
                  id="tax-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={taxAmount}
                  onChange={(e) => setTaxAmount(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tax-ref">Código / Nº Guia (opcional)</Label>
                <Input
                  id="tax-ref"
                  value={taxGuideRef}
                  onChange={(e) => setTaxGuideRef(e.target.value)}
                  placeholder="Ex.: DARF-2026-11"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  estimateTaxFromRevenue(
                    activeTaxCompanyId,
                    taxCompetenceMonth,
                    Number(taxRatePct) || 0
                  )
                }
              >
                <Calculator className="h-3.5 w-3.5" />
                <span>Recalcular pelo Faturamento Real do Mês</span>
              </Button>

              <label className="inline-flex items-center gap-2 text-[12px] text-[#334155] dark:text-[#B9CADB] cursor-pointer">
                <input
                  type="checkbox"
                  checked={taxRecurring}
                  onChange={(e) => setTaxRecurring(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[#0F374A]"
                />
                <span>Guia mensal recorrente</span>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setTaxModalOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={busyId === 'create-tax'}>
                {busyId === 'create-tax' ? 'Salvando...' : 'Salvar Obrigação Fiscal'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: Confirmar Pagamento / Baixa (Parcela ou Imposto) */}
      <Dialog
        open={Boolean(settleModal)}
        onOpenChange={(open) => {
          if (!open) setSettleModal(null);
        }}
      >
        <DialogContent className="max-w-md">
          {settleModal && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {settleModal.kind === 'installment'
                    ? `Pagar ${settleModal.installment.installment_number}ª Parcela`
                    : 'Dar Baixa em Guia Fiscal'}
                </DialogTitle>
                <DialogDescription>
                  {settleModal.kind === 'installment'
                    ? `${settleModal.debt.title} · Principal ${formatCurrencyBRL(
                        settleModal.installment.principal_portion
                      )} + Juros ${formatCurrencyBRL(
                        settleModal.installment.interest_portion
                      )} (lançados na DRE Linha 8).`
                    : `${settleModal.tax.tax_name} · Valor ${formatCurrencyBRL(
                        settleModal.tax.amount
                      )} (lançado em Deduções 2.1 da DRE).`}
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleConfirmSettle} className="mt-4 space-y-4">
                {formError && (
                  <div className="rounded-[4px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#991B1B] dark:border-[#7F1D1D] dark:bg-[#3B1219] dark:text-[#FCA5A5]">
                    {formError}
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="settle-acc">Conta Bancária Pagadora *</Label>
                  <Select value={settleAccountId} onValueChange={setSettleAccountId}>
                    <SelectTrigger id="settle-acc">
                      <SelectValue placeholder="Selecione a conta" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts
                        .filter((a) =>
                          settleModal.kind === 'installment'
                            ? a.company_id === settleModal.debt.company_id
                            : a.company_id === settleModal.tax.company_id
                        )
                        .map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name} ({a.analytical_token})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="settle-date">Data do Pagamento *</Label>
                  <Input
                    id="settle-date"
                    type="date"
                    required
                    value={settleDate}
                    onChange={(e) => setSettleDate(e.target.value)}
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setSettleModal(null)}>
                    Cancelar
                  </Button>
                  <Button type="submit" variant="primary" disabled={busyId === 'settle'}>
                    {busyId === 'settle' ? 'Registrando...' : 'Confirmar Pagamento'}
                  </Button>
                </div>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
