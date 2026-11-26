import { addMonthsISO, formatMonthLabelPT } from '../../lib/utils.ts';
import type {
  FinancialAccount,
  Project,
  ProjectForecastItem,
  ProjectScenarioType,
  Transaction,
} from '../core/types';

export interface ProjectMonthlyPoint {
  monthIndex: number;
  monthKey: string;
  monthLabel: string;
  isWithinPlannedWindow: boolean;
  plannedRevenue: number;
  plannedDirectCostsAndTaxes: number;
  plannedFixedCosts: number;
  plannedCapex: number;
  plannedTotalOutflows: number;
  plannedNetCashFlow: number;
  plannedCumulativeCash: number;
  realizedRevenue: number;
  realizedOutflows: number;
  realizedNetCashFlow: number;
  realizedCumulativeCash: number;
  pendingTransactionsNet: number;
  varianceNetAmount: number;
  varianceNetPct: number | null;
  companyCashWithProject: number;
}

export type ProjectBudgetHealth = 'healthy' | 'attention' | 'critical';

export interface ProjectFeasibilitySummary {
  scenario: ProjectScenarioType;
  horizonMonths: number;
  totalPlannedRevenue: number;
  totalPlannedDirectCostsAndTaxes: number;
  contributionMargin: number;
  contributionMarginPct: number;
  totalPlannedFixedCosts: number;
  totalPlannedCapex: number;
  operationalProfitBeforeInvestment: number;
  netProjectResult: number;
  roiPct: number | null;
  breakEvenRevenue: number | null;
  paybackMonthIndex: number | null;
  paybackExactMonths: number | null;
  maxNegativeValley: number;
  companyCashBeforeProject: number;
  minimumCompanyCashWithProject: number;
  cashExposureAlert: boolean;
  cashExposureShortfall: number;
  netImpactOnCompanyCash: number;
  realizedRevenueTotal: number;
  realizedOutflowsTotal: number;
  realizedNetResult: number;
  pendingProjectNet: number;
  plannedNetToDate: number;
  realizedVsPlannedVarianceAmount: number;
  realizedVsPlannedVariancePct: number | null;
  budgetHealth: ProjectBudgetHealth;
  timeline: ProjectMonthlyPoint[];
}

export function roundCurrency(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function computeForecastLineTotals(params: {
  direction: ProjectForecastItem['direction'];
  quantity: number;
  unitPrice: number;
  unitDirectCost: number;
  paymentFeePct: number;
  taxRatePct: number;
  explicitAmount?: number;
}): {
  grossAmount: number;
  estimatedDirectCostTotal: number;
  estimatedDeductionsTotal: number;
} {
  const qty = Math.max(0.01, Number(params.quantity) || 1);
  const unitPrice = Math.max(0, Number(params.unitPrice) || 0);
  const unitDirectCost = Math.max(0, Number(params.unitDirectCost) || 0);
  const feePct = Math.min(100, Math.max(0, Number(params.paymentFeePct) || 0));
  const taxPct = Math.min(100, Math.max(0, Number(params.taxRatePct) || 0));

  if (params.direction === 'revenue') {
    const grossAmount = roundCurrency(qty * unitPrice);
    const estimatedDirectCostTotal = roundCurrency(qty * unitDirectCost);
    const estimatedDeductionsTotal = roundCurrency(grossAmount * ((feePct + taxPct) / 100));
    return {
      grossAmount,
      estimatedDirectCostTotal,
      estimatedDeductionsTotal,
    };
  }

  const baseAmount =
    params.explicitAmount !== undefined && params.explicitAmount > 0
      ? params.explicitAmount
      : qty * (unitDirectCost > 0 ? unitDirectCost : unitPrice);

  return {
    grossAmount: roundCurrency(Math.max(0, baseAmount)),
    estimatedDirectCostTotal: 0,
    estimatedDeductionsTotal: 0,
  };
}

/**
 * Calcula o caixa livre da empresa (saldo realizado + lançamentos pendentes fora do projeto)
 * para evitar dupla contagem na simulação de impacto de caixa do projeto.
 */
export function computeCompanyCashBeforeProject(
  accounts: readonly FinancialAccount[],
  transactions: readonly Transaction[],
  companyId: string,
  excludeProjectId?: string
): number {
  const companyAccountIds = new Set(
    accounts.filter((a) => a.company_id === companyId).map((a) => a.id)
  );
  if (companyAccountIds.size === 0) return 0;

  let cash = 0;
  for (const tx of transactions) {
    if (tx.status === 'canceled') continue;
    // Transações pendentes já vinculadas ao próprio projeto serão comparadas com o plano do projeto
    if (excludeProjectId && tx.project_id === excludeProjectId && tx.status !== 'paid') {
      continue;
    }

    if (tx.transaction_type === 'income' && companyAccountIds.has(tx.account_id)) {
      cash += tx.amount;
    } else if (tx.transaction_type === 'expense' && companyAccountIds.has(tx.account_id)) {
      cash -= tx.amount;
    } else if (tx.transaction_type === 'transfer') {
      if (companyAccountIds.has(tx.account_id)) cash -= tx.amount;
      if (tx.destination_account_id && companyAccountIds.has(tx.destination_account_id)) {
        cash += tx.amount;
      }
    }
  }

  return roundCurrency(cash);
}

function enumerateMonthKeys(startMonth: string, endMonth: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth)) {
    return [];
  }
  const months: string[] = [];
  let cursor = `${startMonth}-01`;
  let guard = 0;
  while (cursor.slice(0, 7) <= endMonth && guard < 120) {
    months.push(cursor.slice(0, 7));
    cursor = addMonthsISO(cursor, 1);
    guard += 1;
  }
  return months;
}

export function calculateProjectFeasibility(input: {
  project: Project;
  forecastItems: readonly ProjectForecastItem[];
  transactions: readonly Transaction[];
  companyCashBeforeProject: number;
  scenario?: ProjectScenarioType;
  todayISO?: string;
}): ProjectFeasibilitySummary {
  const { project, companyCashBeforeProject } = input;
  const activeScenario = input.scenario ?? project.active_scenario;
  const todayMonth = (input.todayISO ?? new Date().toISOString().slice(0, 10)).slice(0, 7);

  const scenarioItems = input.forecastItems.filter(
    (item) => item.project_id === project.id && item.scenario === activeScenario
  );

  const projectTxs = input.transactions.filter(
    (tx) =>
      tx.project_id === project.id &&
      tx.status !== 'canceled' &&
      tx.transaction_type !== 'transfer'
  );

  const startMonth = project.planned_start_date.slice(0, 7);
  const endMonth = project.planned_end_date.slice(0, 7);

  const allMonths = new Set<string>(enumerateMonthKeys(startMonth, endMonth));
  for (const item of scenarioItems) {
    allMonths.add(item.month_date.slice(0, 7));
  }
  for (const tx of projectTxs) {
    const ref = tx.status === 'paid' && tx.payment_date ? tx.payment_date : tx.due_date;
    allMonths.add(ref.slice(0, 7));
  }
  if (allMonths.size === 0) {
    allMonths.add(startMonth);
  }

  const sortedMonths = Array.from(allMonths).sort();

  let totalPlannedRevenue = 0;
  let totalPlannedDirectCostsAndTaxes = 0;
  let totalPlannedFixedCosts = 0;
  let totalForecastCapex = 0;

  let realizedRevenueTotal = 0;
  let realizedOutflowsTotal = 0;
  let pendingProjectNet = 0;
  let plannedNetToDate = -project.initial_investment;

  let plannedCumulative = -project.initial_investment;
  let realizedCumulative = 0;
  let maxNegativeValley = -project.initial_investment;

  let paybackMonthIndex: number | null = null;
  let paybackExactMonths: number | null = null;

  const timeline: ProjectMonthlyPoint[] = [];

  sortedMonths.forEach((monthKey, idx) => {
    const monthIndex = idx + 1;
    const isWithinPlannedWindow = monthKey >= startMonth && monthKey <= endMonth;

    const monthItems = scenarioItems.filter((item) => item.month_date.slice(0, 7) === monthKey);
    const monthTxs = projectTxs.filter((tx) => {
      const ref = tx.status === 'paid' && tx.payment_date ? tx.payment_date : tx.due_date;
      return ref.slice(0, 7) === monthKey;
    });

    let plannedRevenue = 0;
    let plannedDirectCostsAndTaxes = 0;
    let plannedFixedCosts = isWithinPlannedWindow ? project.monthly_fixed_cost_allocation : 0;
    let plannedCapex = 0;

    for (const item of monthItems) {
      if (item.direction === 'revenue') {
        plannedRevenue += item.gross_amount;
        plannedDirectCostsAndTaxes +=
          item.estimated_direct_cost_total + item.estimated_deductions_total;
      } else if (item.direction === 'direct_cost') {
        plannedDirectCostsAndTaxes += item.gross_amount;
      } else if (item.direction === 'fixed_cost') {
        plannedFixedCosts += item.gross_amount;
      } else if (item.direction === 'capex') {
        plannedCapex += item.gross_amount;
      }
    }

    const plannedTotalOutflows =
      plannedDirectCostsAndTaxes + plannedFixedCosts + plannedCapex;
    const plannedNetCashFlow = plannedRevenue - plannedTotalOutflows;

    const prevPlannedCumulative = plannedCumulative;
    plannedCumulative = roundCurrency(plannedCumulative + plannedNetCashFlow);

    if (plannedCumulative < maxNegativeValley) {
      maxNegativeValley = plannedCumulative;
    }

    // Payback simples: primeiro mês em que o fluxo acumulado (já descontando CAPEX inicial) fica >= 0
    if (paybackMonthIndex === null && plannedCumulative >= 0) {
      paybackMonthIndex = monthIndex;
      if (prevPlannedCumulative < 0 && plannedCumulative - prevPlannedCumulative > 0) {
        const fraction = Math.abs(prevPlannedCumulative) / (plannedCumulative - prevPlannedCumulative);
        paybackExactMonths = Math.round(((monthIndex - 1) + fraction) * 10) / 10;
      } else {
        paybackExactMonths = monthIndex;
      }
    }

    let realizedRevenue = 0;
    let realizedOutflows = 0;
    let pendingNet = 0;

    for (const tx of monthTxs) {
      if (tx.status === 'paid') {
        if (tx.transaction_type === 'income') {
          realizedRevenue += tx.amount;
        } else if (tx.transaction_type === 'expense') {
          realizedOutflows += tx.amount;
        }
      } else {
        if (tx.transaction_type === 'income') {
          pendingNet += tx.amount;
        } else if (tx.transaction_type === 'expense') {
          pendingNet -= tx.amount;
        }
      }
    }

    const realizedNetCashFlow = roundCurrency(realizedRevenue - realizedOutflows);
    realizedCumulative = roundCurrency(realizedCumulative + realizedNetCashFlow);

    totalPlannedRevenue += plannedRevenue;
    totalPlannedDirectCostsAndTaxes += plannedDirectCostsAndTaxes;
    totalPlannedFixedCosts += plannedFixedCosts;
    totalForecastCapex += plannedCapex;

    realizedRevenueTotal += realizedRevenue;
    realizedOutflowsTotal += realizedOutflows;
    pendingProjectNet += pendingNet;

    if (monthKey <= todayMonth) {
      plannedNetToDate += plannedNetCashFlow;
    }

    const varianceNetAmount = roundCurrency(realizedNetCashFlow - plannedNetCashFlow);
    const varianceNetPct =
      Math.abs(plannedNetCashFlow) > 0.01
        ? Math.round((varianceNetAmount / Math.abs(plannedNetCashFlow)) * 1000) / 10
        : null;

    timeline.push({
      monthIndex,
      monthKey,
      monthLabel: formatMonthLabelPT(monthKey),
      isWithinPlannedWindow,
      plannedRevenue: roundCurrency(plannedRevenue),
      plannedDirectCostsAndTaxes: roundCurrency(plannedDirectCostsAndTaxes),
      plannedFixedCosts: roundCurrency(plannedFixedCosts),
      plannedCapex: roundCurrency(plannedCapex),
      plannedTotalOutflows: roundCurrency(plannedTotalOutflows),
      plannedNetCashFlow: roundCurrency(plannedNetCashFlow),
      plannedCumulativeCash: plannedCumulative,
      realizedRevenue: roundCurrency(realizedRevenue),
      realizedOutflows: roundCurrency(realizedOutflows),
      realizedNetCashFlow,
      realizedCumulativeCash: realizedCumulative,
      pendingTransactionsNet: roundCurrency(pendingNet),
      varianceNetAmount,
      varianceNetPct,
      companyCashWithProject: roundCurrency(companyCashBeforeProject + plannedCumulative),
    });
  });

  totalPlannedRevenue = roundCurrency(totalPlannedRevenue);
  totalPlannedDirectCostsAndTaxes = roundCurrency(totalPlannedDirectCostsAndTaxes);
  totalPlannedFixedCosts = roundCurrency(totalPlannedFixedCosts);
  const totalPlannedCapex = roundCurrency(project.initial_investment + totalForecastCapex);

  const contributionMargin = roundCurrency(totalPlannedRevenue - totalPlannedDirectCostsAndTaxes);
  const contributionMarginPct =
    totalPlannedRevenue > 0
      ? Math.round((contributionMargin / totalPlannedRevenue) * 1000) / 10
      : 0;

  const operationalProfitBeforeInvestment = roundCurrency(
    contributionMargin - totalPlannedFixedCosts
  );
  const netProjectResult = roundCurrency(operationalProfitBeforeInvestment - totalPlannedCapex);

  // ROI Projetado (%): ((Lucro Líquido Operacional do Projeto - Investimento) / Investimento) * 100
  const roiPct =
    totalPlannedCapex > 0
      ? Math.round(
          ((operationalProfitBeforeInvestment - totalPlannedCapex) / totalPlannedCapex) * 1000
        ) / 10
      : null;

  // Ponto de Equilíbrio (Break-even em R$ de faturamento)
  const contributionRatio =
    totalPlannedRevenue > 0 ? contributionMargin / totalPlannedRevenue : 0;
  const breakEvenRevenue =
    contributionRatio > 0
      ? roundCurrency((totalPlannedCapex + totalPlannedFixedCosts) / contributionRatio)
      : null;

  const minimumCompanyCashWithProject = roundCurrency(
    companyCashBeforeProject + maxNegativeValley
  );
  const cashExposureAlert = maxNegativeValley < 0 && minimumCompanyCashWithProject < 0;
  const cashExposureShortfall = cashExposureAlert
    ? roundCurrency(Math.abs(minimumCompanyCashWithProject))
    : 0;

  const realizedNetResult = roundCurrency(realizedRevenueTotal - realizedOutflowsTotal);
  const plannedNetToDateRounded = roundCurrency(plannedNetToDate);
  const realizedVsPlannedVarianceAmount = roundCurrency(
    realizedNetResult - plannedNetToDateRounded
  );
  const realizedVsPlannedVariancePct =
    Math.abs(plannedNetToDateRounded) > 0.01
      ? Math.round((realizedVsPlannedVarianceAmount / Math.abs(plannedNetToDateRounded)) * 1000) /
        10
      : null;

  let budgetHealth: ProjectBudgetHealth = 'healthy';
  if (cashExposureAlert || (roiPct !== null && roiPct < 0)) {
    budgetHealth = 'critical';
  } else if (
    (realizedVsPlannedVariancePct !== null && realizedVsPlannedVariancePct < -15) ||
    paybackMonthIndex === null
  ) {
    budgetHealth = 'attention';
  }

  return {
    scenario: activeScenario,
    horizonMonths: timeline.length,
    totalPlannedRevenue,
    totalPlannedDirectCostsAndTaxes,
    contributionMargin,
    contributionMarginPct,
    totalPlannedFixedCosts,
    totalPlannedCapex,
    operationalProfitBeforeInvestment,
    netProjectResult,
    roiPct,
    breakEvenRevenue,
    paybackMonthIndex,
    paybackExactMonths,
    maxNegativeValley: roundCurrency(maxNegativeValley),
    companyCashBeforeProject: roundCurrency(companyCashBeforeProject),
    minimumCompanyCashWithProject,
    cashExposureAlert,
    cashExposureShortfall,
    netImpactOnCompanyCash: netProjectResult,
    realizedRevenueTotal: roundCurrency(realizedRevenueTotal),
    realizedOutflowsTotal: roundCurrency(realizedOutflowsTotal),
    realizedNetResult,
    pendingProjectNet: roundCurrency(pendingProjectNet),
    plannedNetToDate: plannedNetToDateRounded,
    realizedVsPlannedVarianceAmount,
    realizedVsPlannedVariancePct,
    budgetHealth,
    timeline,
  };
}
