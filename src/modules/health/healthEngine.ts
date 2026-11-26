import { addMonthsISO, formatMonthLabelPT, getMonthRangeISO, getTodayISO } from '../../lib/utils';
import { computeAccountBalances, getScopedIds, getTransactionReferenceDate } from '../core/repository';
import type { GlossaryKey } from '../core/glossary';
import type {
  AccountingRegime,
  ActiveContext,
  AmortizationSystem,
  Category,
  CategoryGroupType,
  Company,
  Debt,
  DebtInstallment,
  FinancialAccount,
  ProductService,
  Project,
  TaxObligation,
  Transaction,
} from '../core/types';

export type PeriodComparisonPreset = 'month_mom' | 'month_yoy' | 'quarter' | 'custom';

export interface DateWindow {
  start: string;
  end: string;
  label: string;
}

export interface ResolvedPeriods {
  current: DateWindow;
  compare: DateWindow;
  mom: DateWindow;
  yoy: DateWindow;
}

export interface DreChildLine {
  id: string;
  code: string;
  label: string;
  currentAmount: number;
  compareAmount: number;
  verticalPct: number | null;
  horizontalDeltaAmount: number;
  horizontalDeltaPct: number | null;
}

export interface DreSubGroup {
  id: string;
  label: string;
  currentAmount: number;
  compareAmount: number;
  verticalPct: number | null;
  horizontalDeltaAmount: number;
  horizontalDeltaPct: number | null;
  children: DreChildLine[];
}

export interface DreLine {
  id: string;
  order: number;
  prefix: '(+)' | '(-)' | '(=)' | '(+/-)';
  label: string;
  isSummary: boolean;
  isNegativeDisplay: boolean;
  currentAmount: number;
  compareAmount: number;
  verticalPct: number | null;
  horizontalDeltaAmount: number;
  horizontalDeltaPct: number | null;
  glossaryKey: GlossaryKey;
  subGroups: DreSubGroup[];
  children: DreChildLine[];
}

export interface DreReport {
  regime: AccountingRegime;
  includePendingInCash: boolean;
  grossRevenueCurrent: number;
  grossRevenueCompare: number;
  netRevenueCurrent: number;
  contributionMarginCurrent: number;
  contributionMarginPctCurrent: number;
  contributionMarginPctCompare: number;
  ebitdaCurrent: number;
  ebitdaPctCurrent: number;
  financialResultCurrent: number;
  netResultCurrent: number;
  netResultCompare: number;
  netMarginPctCurrent: number;
  netMarginPctCompare: number;
  capexMemoCurrent: number;
  capexMemoCompare: number;
  lines: DreLine[];
}

export type ProfitabilityClassification = 'cash_generator' | 'neutral' | 'cash_drain';

export interface ProductRankingRow {
  id: string;
  token: string;
  name: string;
  offerKind: ProductService['offer_kind'];
  revenue: number;
  directCosts: number;
  taxes: number;
  netMargin: number;
  netMarginPct: number;
  shareOfResultPct: number;
  txCount: number;
  classification: ProfitabilityClassification;
}

export interface ProjectRankingRow {
  id: string;
  token: string;
  name: string;
  status: Project['status'];
  initialInvestment: number;
  realizedRevenue: number;
  realizedCosts: number;
  realizedNetReturn: number;
  realizedRoiPct: number | null;
  shareOfResultPct: number;
  txCount: number;
  classification: ProfitabilityClassification;
}

export interface CompanyRankingRow {
  id: string;
  token: string;
  name: string;
  revenue: number;
  directAndTaxCosts: number;
  operatingExpenses: number;
  netResult: number;
  netMarginPct: number;
  shareOfResultPct: number;
  txCount: number;
  classification: ProfitabilityClassification;
}

export interface WinnersAndLosersResult {
  targetMarginPct: number;
  products: ProductRankingRow[];
  projects: ProjectRankingRow[];
  companies: CompanyRankingRow[];
}

export interface HealthPillarScore {
  id: 'liquidity' | 'cash_generation' | 'net_margin' | 'leverage';
  label: string;
  score: number;
  maxScore: number;
  metricDisplay: string;
  description: string;
}

export type HealthClassification = 'excellent' | 'healthy' | 'attention' | 'critical';

export interface MonthlyTrendPoint {
  monthKey: string;
  monthLabel: string;
  grossRevenue: number;
  totalCostsAndExpenses: number;
  netResult: number;
  netMarginPct: number;
}

export interface FinancialHealthDiagnostics {
  healthScore: number;
  classification: HealthClassification;
  pillars: HealthPillarScore[];
  freeCash: number;
  projectedCash: number;
  runwayMonths: number | null;
  runwayMode: 'net_burn' | 'fixed_coverage' | 'no_outflow';
  monthlyBurnBase: number;
  isOperatingCashPositive: boolean;
  netResultCurrent: number;
  netResultCompare: number;
  netMarginPct: number;
  netMarginMoMDeltaPct: number | null;
  netMarginYoYDeltaPct: number | null;
  contributionMarginPct: number;
  contributionMarginMoMDeltaPct: number | null;
  contributionMarginYoYDeltaPct: number | null;
  totalDebtBalance: number;
  monthlyDebtService: number;
  openTaxesAmount: number;
  upcomingTaxes7dCount: number;
  overdueTaxesCount: number;
  overdueInstallmentsCount: number;
  monthlyEvolution: MonthlyTrendPoint[];
  dre: DreReport;
  rankings: WinnersAndLosersResult;
}

export interface GeneratedAmortizationRow {
  installment_number: number;
  due_date: string;
  principal_portion: number;
  interest_portion: number;
  total_amount: number;
  remaining_balance: number;
}

export interface AmortizationScheduleSummary {
  rows: GeneratedAmortizationRow[];
  totalInterest: number;
  totalPayable: number;
  firstInstallmentAmount: number;
  lastInstallmentAmount: number;
  effectiveAnnualRatePct: number;
}

export function roundCurrency(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function shiftDateDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  if (!y || !m || !d) return dateISO;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
    dt.getDate()
  ).padStart(2, '0')}`;
}

function diffDaysInclusive(startISO: string, endISO: string): number {
  const [y1, m1, d1] = startISO.split('-').map(Number);
  const [y2, m2, d2] = endISO.split('-').map(Number);
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return 30;
  const a = new Date(y1, m1 - 1, d1).getTime();
  const b = new Date(y2, m2 - 1, d2).getTime();
  return Math.max(1, Math.round((b - a) / (1000 * 60 * 60 * 24)) + 1);
}

export function resolveComparisonPeriods(params: {
  preset: PeriodComparisonPreset;
  referenceMonth: string; // YYYY-MM
  customStart?: string;
  customEnd?: string;
  customCompareStart?: string;
  customCompareEnd?: string;
}): ResolvedPeriods {
  const safeMonth = /^\d{4}-\d{2}$/.test(params.referenceMonth)
    ? params.referenceMonth
    : getTodayISO().slice(0, 7);

  const currRange = getMonthRangeISO(safeMonth);
  const prevMonthKey = addMonthsISO(`${safeMonth}-01`, -1).slice(0, 7);
  const prevRange = getMonthRangeISO(prevMonthKey);
  const yoyMonthKey = addMonthsISO(`${safeMonth}-01`, -12).slice(0, 7);
  const yoyRange = getMonthRangeISO(yoyMonthKey);

  const momWindow: DateWindow = {
    start: prevRange.start,
    end: prevRange.end,
    label: formatMonthLabelPT(prevMonthKey),
  };

  const yoyWindow: DateWindow = {
    start: yoyRange.start,
    end: yoyRange.end,
    label: formatMonthLabelPT(yoyMonthKey),
  };

  if (params.preset === 'quarter') {
    const qStartMonth = addMonthsISO(`${safeMonth}-01`, -2).slice(0, 7);
    const qStartRange = getMonthRangeISO(qStartMonth);
    const prevQEndMonth = addMonthsISO(`${safeMonth}-01`, -3).slice(0, 7);
    const prevQStartMonth = addMonthsISO(`${safeMonth}-01`, -5).slice(0, 7);

    return {
      current: {
        start: qStartRange.start,
        end: currRange.end,
        label: `${qStartMonth} a ${safeMonth}`,
      },
      compare: {
        start: getMonthRangeISO(prevQStartMonth).start,
        end: getMonthRangeISO(prevQEndMonth).end,
        label: `${prevQStartMonth} a ${prevQEndMonth}`,
      },
      mom: momWindow,
      yoy: yoyWindow,
    };
  }

  if (params.preset === 'custom' && params.customStart && params.customEnd) {
    const start = params.customStart <= params.customEnd ? params.customStart : params.customEnd;
    const end = params.customStart <= params.customEnd ? params.customEnd : params.customStart;
    const spanDays = diffDaysInclusive(start, end);

    const compareEnd =
      params.customCompareEnd && params.customCompareStart
        ? params.customCompareEnd
        : shiftDateDaysISO(start, -1);
    const compareStart =
      params.customCompareStart && params.customCompareEnd
        ? params.customCompareStart
        : shiftDateDaysISO(compareEnd, -(spanDays - 1));

    return {
      current: {
        start,
        end,
        label: `${start} a ${end}`,
      },
      compare: {
        start: compareStart,
        end: compareEnd,
        label: `${compareStart} a ${compareEnd}`,
      },
      mom: momWindow,
      yoy: yoyWindow,
    };
  }

  const currentWindow: DateWindow = {
    start: currRange.start,
    end: currRange.end,
    label: formatMonthLabelPT(safeMonth),
  };

  return {
    current: currentWindow,
    compare: params.preset === 'month_yoy' ? yoyWindow : momWindow,
    mom: momWindow,
    yoy: yoyWindow,
  };
}

// ============================================================================
// Motor de Amortização de Dívidas (SAC e Tabela Price)
// ============================================================================

export function calculateAmortizationSchedule(input: {
  principal: number;
  monthlyInterestRatePct: number;
  totalInstallments: number;
  system: AmortizationSystem;
  firstDueDate: string;
}): AmortizationScheduleSummary {
  const principal = roundCurrency(Math.max(0.01, Number(input.principal) || 0));
  const n = Math.min(360, Math.max(1, Math.floor(Number(input.totalInstallments) || 1)));
  const monthlyRate = Math.max(0, Number(input.monthlyInterestRatePct) || 0) / 100;

  const rows: GeneratedAmortizationRow[] = [];
  let remaining = principal;
  let totalInterest = 0;
  let totalPayable = 0;

  if (input.system === 'sac') {
    const fixedAmort = roundCurrency(principal / n);
    for (let k = 1; k <= n; k++) {
      const interest = roundCurrency(remaining * monthlyRate);
      const principalPortion =
        k === n ? roundCurrency(remaining) : Math.min(roundCurrency(remaining), fixedAmort);
      const total = roundCurrency(principalPortion + interest);
      remaining = roundCurrency(Math.max(0, remaining - principalPortion));

      totalInterest = roundCurrency(totalInterest + interest);
      totalPayable = roundCurrency(totalPayable + total);

      rows.push({
        installment_number: k,
        due_date: k === 1 ? input.firstDueDate : addMonthsISO(input.firstDueDate, k - 1),
        principal_portion: principalPortion,
        interest_portion: interest,
        total_amount: total,
        remaining_balance: remaining,
      });
    }
  } else {
    const pmt =
      monthlyRate === 0
        ? principal / n
        : (principal * (monthlyRate * Math.pow(1 + monthlyRate, n))) /
          (Math.pow(1 + monthlyRate, n) - 1);

    for (let k = 1; k <= n; k++) {
      const interest = roundCurrency(remaining * monthlyRate);
      let principalPortion: number;
      let total: number;

      if (k === n) {
        principalPortion = roundCurrency(remaining);
        total = roundCurrency(principalPortion + interest);
      } else {
        total = roundCurrency(pmt);
        principalPortion = roundCurrency(Math.max(0, Math.min(remaining, total - interest)));
      }

      remaining = roundCurrency(Math.max(0, remaining - principalPortion));
      totalInterest = roundCurrency(totalInterest + interest);
      totalPayable = roundCurrency(totalPayable + total);

      rows.push({
        installment_number: k,
        due_date: k === 1 ? input.firstDueDate : addMonthsISO(input.firstDueDate, k - 1),
        principal_portion: principalPortion,
        interest_portion: interest,
        total_amount: total,
        remaining_balance: remaining,
      });
    }
  }

  const effectiveAnnualRatePct =
    Math.round((Math.pow(1 + monthlyRate, 12) - 1) * 10000) / 100;

  return {
    rows,
    totalInterest,
    totalPayable,
    firstInstallmentAmount: rows[0]?.total_amount ?? 0,
    lastInstallmentAmount: rows[rows.length - 1]?.total_amount ?? 0,
    effectiveAnnualRatePct,
  };
}

// ============================================================================
// Motor da DRE Gerencial Estruturada (Caixa & Competência)
// ============================================================================

interface CategoryBucketAccum {
  code: string;
  label: string;
  current: number;
  compare: number;
}

interface DrePeriodBuckets {
  operationalRevenue: number;
  taxDeduction: number;
  directCost: number;
  fixedExpense: number;
  variableExpense: number;
  financialIncome: number;
  financialExpense: number;
  capex: number;
  byGroupAndCat: Map<CategoryGroupType, Map<string, { code: string; label: string; amount: number }>>;
}

function classifyTransactionGroup(
  tx: Transaction,
  cat: Category | undefined
): CategoryGroupType {
  if (cat?.group_type) {
    return cat.group_type;
  }
  return tx.transaction_type === 'income' ? 'operational_revenue' : 'variable_expense';
}

function aggregateDreForWindow(params: {
  transactions: readonly Transaction[];
  categoryMap: ReadonlyMap<string, Category>;
  accountIds: ReadonlySet<string>;
  regime: AccountingRegime;
  includePendingInCash: boolean;
  startDate: string;
  endDate: string;
}): DrePeriodBuckets {
  const buckets: DrePeriodBuckets = {
    operationalRevenue: 0,
    taxDeduction: 0,
    directCost: 0,
    fixedExpense: 0,
    variableExpense: 0,
    financialIncome: 0,
    financialExpense: 0,
    capex: 0,
    byGroupAndCat: new Map(),
  };

  for (const tx of params.transactions) {
    // Regra Crítica: transferências internas e cancelados NUNCA entram na DRE
    if (tx.status === 'canceled' || tx.transaction_type === 'transfer') continue;
    if (!params.accountIds.has(tx.account_id)) continue;

    if (params.regime === 'cash' && !params.includePendingInCash && tx.status !== 'paid') {
      continue;
    }

    const refDate = getTransactionReferenceDate(tx, params.regime);
    if (refDate < params.startDate || refDate > params.endDate) continue;

    const cat = tx.category_id ? params.categoryMap.get(tx.category_id) : undefined;
    const groupType = classifyTransactionGroup(tx, cat);

    if (groupType === 'financial_movement') continue;

    const catKey = cat ? `${cat.code}::${cat.name}` : `9.9::Sem Categoria`;
    const catCode = cat?.code ?? '9.9';
    const catLabel = cat?.name ?? 'Sem Categoria';

    if (!buckets.byGroupAndCat.has(groupType)) {
      buckets.byGroupAndCat.set(groupType, new Map());
    }
    const groupMap = buckets.byGroupAndCat.get(groupType)!;
    const prevCat = groupMap.get(catKey);
    groupMap.set(catKey, {
      code: catCode,
      label: catLabel,
      amount: roundCurrency((prevCat?.amount ?? 0) + tx.amount),
    });

    switch (groupType) {
      case 'operational_revenue':
        if (tx.transaction_type === 'income') {
          buckets.operationalRevenue = roundCurrency(buckets.operationalRevenue + tx.amount);
        } else {
          buckets.taxDeduction = roundCurrency(buckets.taxDeduction + tx.amount);
        }
        break;
      case 'tax_deduction':
        buckets.taxDeduction = roundCurrency(buckets.taxDeduction + tx.amount);
        break;
      case 'direct_cost':
        buckets.directCost = roundCurrency(buckets.directCost + tx.amount);
        break;
      case 'fixed_expense':
        buckets.fixedExpense = roundCurrency(buckets.fixedExpense + tx.amount);
        break;
      case 'variable_expense':
        buckets.variableExpense = roundCurrency(buckets.variableExpense + tx.amount);
        break;
      case 'financial_income':
        buckets.financialIncome = roundCurrency(buckets.financialIncome + tx.amount);
        break;
      case 'financial_expense':
        buckets.financialExpense = roundCurrency(buckets.financialExpense + tx.amount);
        break;
      case 'capex':
        buckets.capex = roundCurrency(buckets.capex + tx.amount);
        break;
    }
  }

  return buckets;
}

function calcVerticalPct(value: number, grossRevenue: number): number | null {
  if (grossRevenue <= 0.001) return null;
  return Math.round((value / grossRevenue) * 1000) / 10;
}

function calcHorizontalDeltaPct(current: number, compare: number): number | null {
  if (Math.abs(compare) <= 0.001) return null;
  return Math.round(((current - compare) / Math.abs(compare)) * 1000) / 10;
}

function buildGroupChildren(
  groupType: CategoryGroupType,
  curr: DrePeriodBuckets,
  comp: DrePeriodBuckets,
  grossRevenueCurr: number
): DreChildLine[] {
  const merged = new Map<string, CategoryBucketAccum>();
  const currMap = curr.byGroupAndCat.get(groupType);
  const compMap = comp.byGroupAndCat.get(groupType);

  if (currMap) {
    for (const [k, v] of currMap.entries()) {
      merged.set(k, { code: v.code, label: v.label, current: v.amount, compare: 0 });
    }
  }
  if (compMap) {
    for (const [k, v] of compMap.entries()) {
      const existing = merged.get(k);
      if (existing) {
        existing.compare = v.amount;
      } else {
        merged.set(k, { code: v.code, label: v.label, current: 0, compare: v.amount });
      }
    }
  }

  return Array.from(merged.entries())
    .sort((a, b) => a[1].code.localeCompare(b[1].code))
    .map(([key, val]) => ({
      id: `${groupType}:${key}`,
      code: val.code,
      label: val.label,
      currentAmount: roundCurrency(val.current),
      compareAmount: roundCurrency(val.compare),
      verticalPct: calcVerticalPct(val.current, grossRevenueCurr),
      horizontalDeltaAmount: roundCurrency(val.current - val.compare),
      horizontalDeltaPct: calcHorizontalDeltaPct(val.current, val.compare),
    }));
}

export function computeDreReport(input: {
  transactions: readonly Transaction[];
  categories: readonly Category[];
  companies: readonly Company[];
  accounts: readonly FinancialAccount[];
  activeContext: ActiveContext;
  regime: AccountingRegime;
  includePendingInCash?: boolean;
  startDate: string;
  endDate: string;
  compareStartDate: string;
  compareEndDate: string;
}): DreReport {
  const { accountIds } = getScopedIds(input.companies, input.accounts, input.activeContext);
  const categoryMap = new Map(input.categories.map((c) => [c.id, c]));
  const includePendingInCash = Boolean(input.includePendingInCash);

  const curr = aggregateDreForWindow({
    transactions: input.transactions,
    categoryMap,
    accountIds,
    regime: input.regime,
    includePendingInCash,
    startDate: input.startDate,
    endDate: input.endDate,
  });

  const comp = aggregateDreForWindow({
    transactions: input.transactions,
    categoryMap,
    accountIds,
    regime: input.regime,
    includePendingInCash,
    startDate: input.compareStartDate,
    endDate: input.compareEndDate,
  });

  const grossRevCurr = curr.operationalRevenue;
  const grossRevComp = comp.operationalRevenue;

  const netRevCurr = roundCurrency(grossRevCurr - curr.taxDeduction);
  const netRevComp = roundCurrency(grossRevComp - comp.taxDeduction);

  const contribCurr = roundCurrency(netRevCurr - curr.directCost);
  const contribComp = roundCurrency(netRevComp - comp.directCost);

  const opExCurr = roundCurrency(curr.fixedExpense + curr.variableExpense);
  const opExComp = roundCurrency(comp.fixedExpense + comp.variableExpense);

  const ebitdaCurr = roundCurrency(contribCurr - opExCurr);
  const ebitdaComp = roundCurrency(contribComp - opExComp);

  const finResCurr = roundCurrency(curr.financialIncome - curr.financialExpense);
  const finResComp = roundCurrency(comp.financialIncome - comp.financialExpense);

  const netResCurr = roundCurrency(ebitdaCurr + finResCurr);
  const netResComp = roundCurrency(ebitdaComp + finResComp);

  const makeLine = (
    id: string,
    order: number,
    prefix: DreLine['prefix'],
    label: string,
    isSummary: boolean,
    isNegativeDisplay: boolean,
    currentAmount: number,
    compareAmount: number,
    glossaryKey: GlossaryKey,
    children: DreChildLine[] = [],
    subGroups: DreSubGroup[] = []
  ): DreLine => ({
    id,
    order,
    prefix,
    label,
    isSummary,
    isNegativeDisplay,
    currentAmount: roundCurrency(currentAmount),
    compareAmount: roundCurrency(compareAmount),
    verticalPct: calcVerticalPct(currentAmount, grossRevCurr),
    horizontalDeltaAmount: roundCurrency(currentAmount - compareAmount),
    horizontalDeltaPct: calcHorizontalDeltaPct(currentAmount, compareAmount),
    glossaryKey,
    subGroups,
    children,
  });

  const fixedChildren = buildGroupChildren('fixed_expense', curr, comp, grossRevCurr);
  const variableChildren = buildGroupChildren('variable_expense', curr, comp, grossRevCurr);

  const opExSubGroups: DreSubGroup[] = [
    {
      id: 'fixed_expense',
      label: 'Despesas Fixas',
      currentAmount: roundCurrency(curr.fixedExpense),
      compareAmount: roundCurrency(comp.fixedExpense),
      verticalPct: calcVerticalPct(curr.fixedExpense, grossRevCurr),
      horizontalDeltaAmount: roundCurrency(curr.fixedExpense - comp.fixedExpense),
      horizontalDeltaPct: calcHorizontalDeltaPct(curr.fixedExpense, comp.fixedExpense),
      children: fixedChildren,
    },
    {
      id: 'variable_expense',
      label: 'Despesas Variáveis',
      currentAmount: roundCurrency(curr.variableExpense),
      compareAmount: roundCurrency(comp.variableExpense),
      verticalPct: calcVerticalPct(curr.variableExpense, grossRevCurr),
      horizontalDeltaAmount: roundCurrency(curr.variableExpense - comp.variableExpense),
      horizontalDeltaPct: calcHorizontalDeltaPct(curr.variableExpense, comp.variableExpense),
      children: variableChildren,
    },
  ];

  const finIncChildren = buildGroupChildren('financial_income', curr, comp, grossRevCurr);
  const finExpChildren = buildGroupChildren('financial_expense', curr, comp, grossRevCurr);

  const finSubGroups: DreSubGroup[] = [
    {
      id: 'financial_income',
      label: '(+) Juros e Rendimentos Recebidos',
      currentAmount: roundCurrency(curr.financialIncome),
      compareAmount: roundCurrency(comp.financialIncome),
      verticalPct: calcVerticalPct(curr.financialIncome, grossRevCurr),
      horizontalDeltaAmount: roundCurrency(curr.financialIncome - comp.financialIncome),
      horizontalDeltaPct: calcHorizontalDeltaPct(curr.financialIncome, comp.financialIncome),
      children: finIncChildren,
    },
    {
      id: 'financial_expense',
      label: '(-) Juros Pagos e Encargos Financeiros',
      currentAmount: roundCurrency(curr.financialExpense),
      compareAmount: roundCurrency(comp.financialExpense),
      verticalPct: calcVerticalPct(curr.financialExpense, grossRevCurr),
      horizontalDeltaAmount: roundCurrency(curr.financialExpense - comp.financialExpense),
      horizontalDeltaPct: calcHorizontalDeltaPct(curr.financialExpense, comp.financialExpense),
      children: finExpChildren,
    },
  ];

  const lines: DreLine[] = [
    makeLine(
      'gross_revenue',
      1,
      '(+)',
      'Receita Bruta Operacional',
      false,
      false,
      grossRevCurr,
      grossRevComp,
      'dre_gerencial',
      buildGroupChildren('operational_revenue', curr, comp, grossRevCurr)
    ),
    makeLine(
      'tax_deductions',
      2,
      '(-)',
      'Deduções e Impostos sobre Vendas',
      false,
      true,
      curr.taxDeduction,
      comp.taxDeduction,
      'obrigacoes_fiscais',
      buildGroupChildren('tax_deduction', curr, comp, grossRevCurr)
    ),
    makeLine(
      'net_revenue',
      3,
      '(=)',
      'Receita Líquida',
      true,
      false,
      netRevCurr,
      netRevComp,
      'analise_vertical_horizontal'
    ),
    makeLine(
      'direct_costs',
      4,
      '(-)',
      'Custos Diretos (Produtos/Serviços/Projetos)',
      false,
      true,
      curr.directCost,
      comp.directCost,
      'margem_contribuicao_global',
      buildGroupChildren('direct_cost', curr, comp, grossRevCurr)
    ),
    makeLine(
      'contribution_margin',
      5,
      '(=)',
      'Margem de Contribuição',
      true,
      false,
      contribCurr,
      contribComp,
      'margem_contribuicao_global'
    ),
    makeLine(
      'operating_expenses',
      6,
      '(-)',
      'Despesas Operacionais (Fixas e Variáveis)',
      false,
      true,
      opExCurr,
      opExComp,
      'ebitda',
      [],
      opExSubGroups
    ),
    makeLine(
      'ebitda',
      7,
      '(=)',
      'EBITDA / Resultado Operacional',
      true,
      false,
      ebitdaCurr,
      ebitdaComp,
      'ebitda'
    ),
    makeLine(
      'financial_result',
      8,
      '(+/-)',
      'Resultado Financeiro (Juros pagos/recebidos)',
      false,
      false,
      finResCurr,
      finResComp,
      'amortizacao_sac_price',
      [],
      finSubGroups
    ),
    makeLine(
      'net_result',
      9,
      '(=)',
      'Resultado Líquido do Exercício',
      true,
      false,
      netResCurr,
      netResComp,
      'margem_liquida'
    ),
  ];

  const contribPctCurr = calcVerticalPct(contribCurr, grossRevCurr) ?? 0;
  const contribPctComp = calcVerticalPct(contribComp, grossRevComp) ?? 0;
  const ebitdaPctCurr = calcVerticalPct(ebitdaCurr, grossRevCurr) ?? 0;
  const netMarginPctCurr = calcVerticalPct(netResCurr, grossRevCurr) ?? 0;
  const netMarginPctComp = calcVerticalPct(netResComp, grossRevComp) ?? 0;

  return {
    regime: input.regime,
    includePendingInCash,
    grossRevenueCurrent: grossRevCurr,
    grossRevenueCompare: grossRevComp,
    netRevenueCurrent: netRevCurr,
    contributionMarginCurrent: contribCurr,
    contributionMarginPctCurrent: contribPctCurr,
    contributionMarginPctCompare: contribPctComp,
    ebitdaCurrent: ebitdaCurr,
    ebitdaPctCurrent: ebitdaPctCurr,
    financialResultCurrent: finResCurr,
    netResultCurrent: netResCurr,
    netResultCompare: netResComp,
    netMarginPctCurrent: netMarginPctCurr,
    netMarginPctCompare: netMarginPctComp,
    capexMemoCurrent: curr.capex,
    capexMemoCompare: comp.capex,
    lines,
  };
}

// ============================================================================
// Ranking Multidimensional de Rentabilidade — Winners & Losers (Paid Only)
// ============================================================================

function classifyMargin(
  netResult: number,
  marginPct: number,
  targetMarginPct: number
): ProfitabilityClassification {
  if (netResult < 0 || marginPct < targetMarginPct) return 'cash_drain';
  if (marginPct >= targetMarginPct && netResult > 0) return 'cash_generator';
  return 'neutral';
}

function computeShareOfTotal(itemNet: number, totalNetPool: number, totalGrossRev: number): number {
  const denom = Math.abs(totalNetPool) > 0.01 ? Math.abs(totalNetPool) : Math.max(1, totalGrossRev);
  return Math.round((itemNet / denom) * 1000) / 10;
}

export function computeWinnersAndLosers(input: {
  transactions: readonly Transaction[];
  categories: readonly Category[];
  productsServices: readonly ProductService[];
  projects: readonly Project[];
  companies: readonly Company[];
  accounts: readonly FinancialAccount[];
  activeContext: ActiveContext;
  startDate: string;
  endDate: string;
  targetMarginPct?: number;
}): WinnersAndLosersResult {
  const targetMarginPct = input.targetMarginPct ?? 15;
  const { accountIds } = getScopedIds(input.companies, input.accounts, input.activeContext);
  const categoryMap = new Map(input.categories.map((c) => [c.id, c]));
  const productMap = new Map(input.productsServices.map((p) => [p.id, p]));
  const projectMap = new Map(input.projects.map((p) => [p.id, p]));
  const companyMap = new Map(input.companies.map((c) => [c.id, c]));

  const prodAcc = new Map<
    string,
    { revenue: number; directCosts: number; taxes: number; txCount: number }
  >();
  const projAcc = new Map<
    string,
    { revenue: number; costs: number; txCount: number }
  >();
  const compAcc = new Map<
    string,
    { revenue: number; directAndTax: number; opEx: number; txCount: number }
  >();

  for (const tx of input.transactions) {
    // Somente transações realizadas (paid), excluindo transferências internas
    if (tx.status !== 'paid' || tx.transaction_type === 'transfer') continue;
    if (!accountIds.has(tx.account_id)) continue;

    const refDate = tx.payment_date ?? tx.due_date;
    if (refDate < input.startDate || refDate > input.endDate) continue;

    const cat = tx.category_id ? categoryMap.get(tx.category_id) : undefined;
    if (cat?.group_type === 'financial_movement') continue;

    // 1. Produto / Serviço
    if (tx.product_service_id && productMap.has(tx.product_service_id)) {
      const prev = prodAcc.get(tx.product_service_id) ?? {
        revenue: 0,
        directCosts: 0,
        taxes: 0,
        txCount: 0,
      };
      if (tx.transaction_type === 'income') {
        prev.revenue = roundCurrency(prev.revenue + tx.amount);
      } else if (tx.transaction_type === 'expense') {
        if (cat?.group_type === 'tax_deduction') {
          prev.taxes = roundCurrency(prev.taxes + tx.amount);
        } else {
          prev.directCosts = roundCurrency(prev.directCosts + tx.amount);
        }
      }
      prev.txCount += 1;
      prodAcc.set(tx.product_service_id, prev);
    }

    // 2. Projeto
    if (tx.project_id && projectMap.has(tx.project_id)) {
      const prev = projAcc.get(tx.project_id) ?? { revenue: 0, costs: 0, txCount: 0 };
      if (tx.transaction_type === 'income') {
        prev.revenue = roundCurrency(prev.revenue + tx.amount);
      } else if (tx.transaction_type === 'expense') {
        prev.costs = roundCurrency(prev.costs + tx.amount);
      }
      prev.txCount += 1;
      projAcc.set(tx.project_id, prev);
    }

    // 3. Empresa
    if (companyMap.has(tx.company_id)) {
      const prev = compAcc.get(tx.company_id) ?? {
        revenue: 0,
        directAndTax: 0,
        opEx: 0,
        txCount: 0,
      };
      if (tx.transaction_type === 'income') {
        prev.revenue = roundCurrency(prev.revenue + tx.amount);
      } else if (tx.transaction_type === 'expense') {
        if (cat?.group_type === 'direct_cost' || cat?.group_type === 'tax_deduction') {
          prev.directAndTax = roundCurrency(prev.directAndTax + tx.amount);
        } else {
          prev.opEx = roundCurrency(prev.opEx + tx.amount);
        }
      }
      prev.txCount += 1;
      compAcc.set(tx.company_id, prev);
    }
  }

  // Consolidação Produtos
  const rawProducts = Array.from(prodAcc.entries()).map(([id, agg]) => {
    const prod = productMap.get(id)!;
    const netMargin = roundCurrency(agg.revenue - agg.directCosts - agg.taxes);
    const netMarginPct =
      agg.revenue > 0
        ? Math.round((netMargin / agg.revenue) * 1000) / 10
        : netMargin < 0
          ? -100
          : 0;
    return { prod, agg, netMargin, netMarginPct };
  });
  const totalProdNet = rawProducts.reduce((s, r) => s + r.netMargin, 0);
  const totalProdRev = rawProducts.reduce((s, r) => s + r.agg.revenue, 0);

  const products: ProductRankingRow[] = rawProducts
    .map(({ prod, agg, netMargin, netMarginPct }) => ({
      id: prod.id,
      token: prod.analytical_token,
      name: prod.name,
      offerKind: prod.offer_kind,
      revenue: agg.revenue,
      directCosts: agg.directCosts,
      taxes: agg.taxes,
      netMargin,
      netMarginPct,
      shareOfResultPct: computeShareOfTotal(netMargin, totalProdNet, totalProdRev),
      txCount: agg.txCount,
      classification: classifyMargin(netMargin, netMarginPct, targetMarginPct),
    }))
    .sort((a, b) => b.netMargin - a.netMargin);

  // Consolidação Projetos
  const rawProjects = Array.from(projAcc.entries()).map(([id, agg]) => {
    const prj = projectMap.get(id)!;
    const realizedNetReturn = roundCurrency(agg.revenue - agg.costs);
    const realizedRoiPct =
      prj.initial_investment > 0
        ? Math.round(((realizedNetReturn - prj.initial_investment) / prj.initial_investment) * 1000) / 10
        : null;
    const marginPct =
      agg.revenue > 0
        ? Math.round((realizedNetReturn / agg.revenue) * 1000) / 10
        : realizedNetReturn < 0
          ? -100
          : 0;
    return { prj, agg, realizedNetReturn, realizedRoiPct, marginPct };
  });
  const totalProjNet = rawProjects.reduce((s, r) => s + r.realizedNetReturn, 0);
  const totalProjRev = rawProjects.reduce((s, r) => s + r.agg.revenue, 0);

  const projects: ProjectRankingRow[] = rawProjects
    .map(({ prj, agg, realizedNetReturn, realizedRoiPct, marginPct }) => ({
      id: prj.id,
      token: prj.analytical_token,
      name: prj.name,
      status: prj.status,
      initialInvestment: prj.initial_investment,
      realizedRevenue: agg.revenue,
      realizedCosts: agg.costs,
      realizedNetReturn,
      realizedRoiPct,
      shareOfResultPct: computeShareOfTotal(realizedNetReturn, totalProjNet, totalProjRev),
      txCount: agg.txCount,
      classification: classifyMargin(realizedNetReturn, marginPct, targetMarginPct),
    }))
    .sort((a, b) => b.realizedNetReturn - a.realizedNetReturn);

  // Consolidação Empresas
  const rawCompanies = Array.from(compAcc.entries()).map(([id, agg]) => {
    const comp = companyMap.get(id)!;
    const netResult = roundCurrency(agg.revenue - agg.directAndTax - agg.opEx);
    const netMarginPct =
      agg.revenue > 0
        ? Math.round((netResult / agg.revenue) * 1000) / 10
        : netResult < 0
          ? -100
          : 0;
    return { comp, agg, netResult, netMarginPct };
  });
  const totalCompNet = rawCompanies.reduce((s, r) => s + r.netResult, 0);
  const totalCompRev = rawCompanies.reduce((s, r) => s + r.agg.revenue, 0);

  const companies: CompanyRankingRow[] = rawCompanies
    .map(({ comp, agg, netResult, netMarginPct }) => ({
      id: comp.id,
      token: comp.analytical_token,
      name: comp.trade_name ?? comp.legal_name,
      revenue: agg.revenue,
      directAndTaxCosts: agg.directAndTax,
      operatingExpenses: agg.opEx,
      netResult,
      netMarginPct,
      shareOfResultPct: computeShareOfTotal(netResult, totalCompNet, totalCompRev),
      txCount: agg.txCount,
      classification: classifyMargin(netResult, netMarginPct, targetMarginPct),
    }))
    .sort((a, b) => b.netResult - a.netResult);

  return {
    targetMarginPct,
    products,
    projects,
    companies,
  };
}

// ============================================================================
// Motor de Saúde Financeira (Score 0–100, Runway, Evolução & Indicadores)
// ============================================================================

function clampScore(value: number, max: number): number {
  return Math.round(Math.max(0, Math.min(max, value)));
}

export function computeFinancialHealthDiagnostics(input: {
  transactions: readonly Transaction[];
  categories: readonly Category[];
  companies: readonly Company[];
  accounts: readonly FinancialAccount[];
  productsServices: readonly ProductService[];
  projects: readonly Project[];
  debts: readonly Debt[];
  debtInstallments: readonly DebtInstallment[];
  taxObligations: readonly TaxObligation[];
  activeContext: ActiveContext;
  regime: AccountingRegime;
  periods: ResolvedPeriods;
  todayISO?: string;
  targetMarginPct?: number;
}): FinancialHealthDiagnostics {
  const todayISO = input.todayISO ?? getTodayISO();
  const { companyIds } = getScopedIds(input.companies, input.accounts, input.activeContext);
  const accountBalances = computeAccountBalances(
    input.accounts,
    input.transactions,
    input.companies,
    input.activeContext
  );

  const freeCash = roundCurrency(
    accountBalances.reduce((sum, acc) => sum + acc.current_balance, 0)
  );
  const projectedCash = roundCurrency(
    accountBalances.reduce((sum, acc) => sum + acc.projected_balance, 0)
  );

  // DRE do período comparado selecionado
  const dre = computeDreReport({
    transactions: input.transactions,
    categories: input.categories,
    companies: input.companies,
    accounts: input.accounts,
    activeContext: input.activeContext,
    regime: input.regime,
    includePendingInCash: false,
    startDate: input.periods.current.start,
    endDate: input.periods.current.end,
    compareStartDate: input.periods.compare.start,
    compareEndDate: input.periods.compare.end,
  });

  // DRE auxiliar para variações explícitas MoM e YoY
  const dreMoM = computeDreReport({
    transactions: input.transactions,
    categories: input.categories,
    companies: input.companies,
    accounts: input.accounts,
    activeContext: input.activeContext,
    regime: input.regime,
    includePendingInCash: false,
    startDate: input.periods.current.start,
    endDate: input.periods.current.end,
    compareStartDate: input.periods.mom.start,
    compareEndDate: input.periods.mom.end,
  });

  const dreYoY = computeDreReport({
    transactions: input.transactions,
    categories: input.categories,
    companies: input.companies,
    accounts: input.accounts,
    activeContext: input.activeContext,
    regime: input.regime,
    includePendingInCash: false,
    startDate: input.periods.current.start,
    endDate: input.periods.current.end,
    compareStartDate: input.periods.yoy.start,
    compareEndDate: input.periods.yoy.end,
  });

  const netMarginMoMDeltaPct =
    dreMoM.grossRevenueCompare > 0
      ? Math.round((dre.netMarginPctCurrent - dreMoM.netMarginPctCompare) * 10) / 10
      : null;
  const netMarginYoYDeltaPct =
    dreYoY.grossRevenueCompare > 0
      ? Math.round((dre.netMarginPctCurrent - dreYoY.netMarginPctCompare) * 10) / 10
      : null;

  const contributionMarginMoMDeltaPct =
    dreMoM.grossRevenueCompare > 0
      ? Math.round((dre.contributionMarginPctCurrent - dreMoM.contributionMarginPctCompare) * 10) / 10
      : null;
  const contributionMarginYoYDeltaPct =
    dreYoY.grossRevenueCompare > 0
      ? Math.round((dre.contributionMarginPctCurrent - dreYoY.contributionMarginPctCompare) * 10) / 10
      : null;

  // Rankings Winners & Losers (sempre agregando transações pagas)
  const rankings = computeWinnersAndLosers({
    transactions: input.transactions,
    categories: input.categories,
    productsServices: input.productsServices,
    projects: input.projects,
    companies: input.companies,
    accounts: input.accounts,
    activeContext: input.activeContext,
    startDate: input.periods.current.start,
    endDate: input.periods.current.end,
    targetMarginPct: input.targetMarginPct ?? 15,
  });

  // Dívidas & Impostos no escopo
  const scopedDebts = input.debts.filter(
    (d) =>
      companyIds.has(d.company_id) &&
      d.status === 'active' &&
      (input.activeContext.scope !== 'account' ||
        d.account_id === null ||
        d.account_id === input.activeContext.accountId)
  );
  const scopedDebtIds = new Set(scopedDebts.map((d) => d.id));
  const scopedInstallments = input.debtInstallments.filter((inst) =>
    scopedDebtIds.has(inst.debt_id)
  );

  let totalDebtBalance = 0;
  let monthlyDebtService = 0;
  let overdueInstallmentsCount = 0;
  const currentMonthKey = todayISO.slice(0, 7);
  const in30DaysISO = shiftDateDaysISO(todayISO, 30);
  const in7DaysISO = shiftDateDaysISO(todayISO, 7);

  let debtDueNext30d = 0;
  for (const inst of scopedInstallments) {
    if (inst.status === 'paid' || inst.status === 'canceled') continue;
    totalDebtBalance = roundCurrency(totalDebtBalance + inst.principal_portion);
    if (inst.due_date.slice(0, 7) === currentMonthKey) {
      monthlyDebtService = roundCurrency(monthlyDebtService + inst.total_amount);
    }
    if (inst.due_date < todayISO) {
      overdueInstallmentsCount += 1;
    }
    if (inst.due_date <= in30DaysISO) {
      debtDueNext30d = roundCurrency(debtDueNext30d + inst.total_amount);
    }
  }

  const scopedTaxes = input.taxObligations.filter(
    (t) =>
      companyIds.has(t.company_id) &&
      t.status !== 'canceled' &&
      (input.activeContext.scope !== 'account' ||
        t.account_id === null ||
        t.account_id === input.activeContext.accountId)
  );

  let openTaxesAmount = 0;
  let upcomingTaxes7dCount = 0;
  let overdueTaxesCount = 0;
  let taxesDueNext30d = 0;

  for (const tax of scopedTaxes) {
    if (tax.status === 'paid') continue;
    openTaxesAmount = roundCurrency(openTaxesAmount + tax.amount);
    if (tax.due_date < todayISO) {
      overdueTaxesCount += 1;
    } else if (tax.due_date <= in7DaysISO) {
      upcomingTaxes7dCount += 1;
    }
    if (tax.due_date <= in30DaysISO) {
      taxesDueNext30d = roundCurrency(taxesDueNext30d + tax.amount);
    }
  }

  // Evolução Mensal (últimos 6 meses terminando no mês final do período atual)
  const anchorMonth = input.periods.current.end.slice(0, 7);
  const monthlyEvolution: MonthlyTrendPoint[] = [];
  for (let i = -5; i <= 0; i++) {
    const mKey = addMonthsISO(`${anchorMonth}-01`, i).slice(0, 7);
    const range = getMonthRangeISO(mKey);
    const mDre = computeDreReport({
      transactions: input.transactions,
      categories: input.categories,
      companies: input.companies,
      accounts: input.accounts,
      activeContext: input.activeContext,
      regime: input.regime,
      includePendingInCash: false,
      startDate: range.start,
      endDate: range.end,
      compareStartDate: range.start,
      compareEndDate: range.end,
    });
    const totalCostsAndExpenses = roundCurrency(
      Math.max(0, mDre.grossRevenueCurrent - mDre.netResultCurrent)
    );
    monthlyEvolution.push({
      monthKey: mKey,
      monthLabel: formatMonthLabelPT(mKey),
      grossRevenue: mDre.grossRevenueCurrent,
      totalCostsAndExpenses,
      netResult: mDre.netResultCurrent,
      netMarginPct: mDre.netMarginPctCurrent,
    });
  }

  // Runway: média dos últimos 3 meses com atividade (ou despesas fixas + dívida mensal)
  const activeTrendMonths = monthlyEvolution.filter(
    (m) => m.grossRevenue > 0 || m.totalCostsAndExpenses > 0
  );
  const trailing3 = activeTrendMonths.slice(-3);
  const avgNetCashFlow =
    trailing3.length > 0
      ? trailing3.reduce((s, m) => s + m.netResult, 0) / trailing3.length
      : dre.netResultCurrent;

  const fixedLine = dre.lines.find((l) => l.id === 'operating_expenses')?.subGroups.find(
    (s) => s.id === 'fixed_expense'
  );
  const periodMonths = Math.max(
    1,
    Math.round(diffDaysInclusive(input.periods.current.start, input.periods.current.end) / 30)
  );
  const monthlyFixedCosts = roundCurrency((fixedLine?.currentAmount ?? 0) / periodMonths);
  const fixedPlusDebt = roundCurrency(monthlyFixedCosts + monthlyDebtService);

  let runwayMonths: number | null = null;
  let runwayMode: FinancialHealthDiagnostics['runwayMode'] = 'no_outflow';
  let monthlyBurnBase = 0;
  const isOperatingCashPositive = avgNetCashFlow >= 0;

  if (avgNetCashFlow < -0.01) {
    runwayMode = 'net_burn';
    monthlyBurnBase = roundCurrency(Math.abs(avgNetCashFlow));
    runwayMonths =
      freeCash <= 0 ? 0 : Math.round((freeCash / monthlyBurnBase) * 10) / 10;
  } else if (fixedPlusDebt > 0.01) {
    runwayMode = 'fixed_coverage';
    monthlyBurnBase = fixedPlusDebt;
    runwayMonths =
      freeCash <= 0 ? 0 : Math.round((freeCash / fixedPlusDebt) * 10) / 10;
  }

  // Score de Saúde Financeira (0 a 100 em 4 pilares de 25 pts)
  // 1. Liquidez Imediata (0-25)
  const shortTermNeed = Math.max(1000, debtDueNext30d + taxesDueNext30d + monthlyFixedCosts);
  const liquidityRatio = freeCash / shortTermNeed;
  const liquidityScore =
    freeCash <= 0 ? 0 : clampScore((liquidityRatio / 2.5) * 25, 25);

  // 2. Geração de Caixa & Runway (0-25)
  const runwayScorePart =
    runwayMonths === null ? 10 : Math.min(10, (runwayMonths / 6) * 10);
  const cashFlowScorePart = isOperatingCashPositive
    ? 15
    : dre.grossRevenueCurrent > 0
      ? Math.max(0, 10 + (avgNetCashFlow / dre.grossRevenueCurrent) * 25)
      : 0;
  const cashGenScore = clampScore(cashFlowScorePart + runwayScorePart, 25);

  // 3. Margem Líquida (0-25)
  const marginPct = dre.netMarginPctCurrent;
  const marginScore =
    dre.grossRevenueCurrent <= 0
      ? freeCash > 0
        ? 12
        : 4
      : marginPct <= -10
        ? 0
        : marginPct < 0
          ? clampScore(((marginPct + 10) / 10) * 10, 10)
          : clampScore(10 + (marginPct / 20) * 15, 25);

  // 4. Grau de Endividamento (0-25)
  const totalLiabilities = roundCurrency(totalDebtBalance + openTaxesAmount);
  const equityProxy = Math.max(1000, freeCash + dre.grossRevenueCurrent * 3);
  const debtRatio = totalLiabilities / equityProxy;
  const leverageScore =
    totalLiabilities === 0
      ? 25
      : clampScore(25 - (debtRatio / 2.0) * 25, 25);

  const healthScore = clampScore(
    liquidityScore + cashGenScore + marginScore + leverageScore,
    100
  );

  let classification: HealthClassification = 'critical';
  if (healthScore >= 80) classification = 'excellent';
  else if (healthScore >= 60) classification = 'healthy';
  else if (healthScore >= 40) classification = 'attention';

  const pillars: HealthPillarScore[] = [
    {
      id: 'liquidity',
      label: 'Liquidez Imediata',
      score: liquidityScore,
      maxScore: 25,
      metricDisplay: `${liquidityRatio.toFixed(1).replace('.', ',')}x cobertura`,
      description: 'Relação entre Caixa Livre e compromissos dos próximos 30 dias + custos fixos.',
    },
    {
      id: 'cash_generation',
      label: 'Geração de Caixa & Runway',
      score: cashGenScore,
      maxScore: 25,
      metricDisplay:
        runwayMonths !== null
          ? `${runwayMonths.toFixed(1).replace('.', ',')} meses`
          : 'Sem queima ativa',
      description: 'Capacidade de geração operacional mensal combinada ao fôlego do caixa.',
    },
    {
      id: 'net_margin',
      label: 'Margem Líquida',
      score: marginScore,
      maxScore: 25,
      metricDisplay: `${dre.netMarginPctCurrent.toFixed(1).replace('.', ',')}%`,
      description: 'Percentual de lucro líquido convertido sobre a Receita Bruta Operacional.',
    },
    {
      id: 'leverage',
      label: 'Grau de Endividamento',
      score: leverageScore,
      maxScore: 25,
      metricDisplay:
        totalLiabilities === 0
          ? 'Sem dívidas ativas'
          : `${Math.round(debtRatio * 100)}% do lastro`,
      description: 'Peso do saldo devedor total e impostos em aberto frente ao caixa e receita.',
    },
  ];

  return {
    healthScore,
    classification,
    pillars,
    freeCash,
    projectedCash,
    runwayMonths,
    runwayMode,
    monthlyBurnBase,
    isOperatingCashPositive,
    netResultCurrent: dre.netResultCurrent,
    netResultCompare: dre.netResultCompare,
    netMarginPct: dre.netMarginPctCurrent,
    netMarginMoMDeltaPct,
    netMarginYoYDeltaPct,
    contributionMarginPct: dre.contributionMarginPctCurrent,
    contributionMarginMoMDeltaPct,
    contributionMarginYoYDeltaPct,
    totalDebtBalance,
    monthlyDebtService,
    openTaxesAmount,
    upcomingTaxes7dCount,
    overdueTaxesCount,
    overdueInstallmentsCount,
    monthlyEvolution,
    dre,
    rankings,
  };
}
