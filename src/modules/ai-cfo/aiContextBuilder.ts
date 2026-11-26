import { addMonthsISO, getMonthRangeISO, getTodayISO } from '../../lib/utils';
import { computeAccountBalances, getScopedIds } from '../core/repository';
import type {
  AccountingRegime,
  ActiveContext,
  AiInsight,
  BusinessGroup,
  Category,
  Company,
  Debt,
  DebtInstallment,
  FinancialAccount,
  ProductService,
  Project,
  ProjectForecastItem,
  TaxObligation,
  Transaction,
  VaultEntry,
} from '../core/types';
import {
  computeFinancialHealthDiagnostics,
  resolveComparisonPeriods,
  roundCurrency,
  type PeriodComparisonPreset,
} from '../health/healthEngine';
import {
  calculateProjectFeasibility,
  computeCompanyCashBeforeProject,
} from '../projects/projectCalculator';
import {
  rehydrateFromAI,
  sanitizeForAI,
  verifyZeroLeakage,
  type SanitizationReport,
} from '../vault/anonymizer';

export class ZeroLeakViolationError extends Error {
  public readonly leakedTerms: string[];

  constructor(message: string, leakedTerms: string[] = []) {
    super(message);
    this.name = 'ZeroLeakViolationError';
    this.leakedTerms = leakedTerms;
  }
}

export interface AnonymizedAccountMetric {
  accountToken: string;
  companyToken: string;
  accountType: FinancialAccount['account_type'];
  currency: string;
  currentBalance: number;
  projectedBalance: number;
}

export interface AnonymizedCompanyMetric {
  companyToken: string;
  groupToken: string | null;
  taxRegime: string | null;
  revenueCurrent: number;
  directAndTaxCosts: number;
  operatingExpenses: number;
  netResult: number;
  netMarginPct: number;
  shareOfResultPct: number;
  classification: 'cash_generator' | 'neutral' | 'cash_drain';
}

export interface AnonymizedProductMetric {
  offerToken: string;
  companyToken: string | null;
  groupToken: string | null;
  offerKind: ProductService['offer_kind'];
  unitPrice: number;
  estimatedDirectCost: number;
  paymentFeePct: number;
  estimatedTaxPct: number;
  unitContributionMarginPct: number;
  revenueCurrent: number;
  directCostsCurrent: number;
  taxesCurrent: number;
  netMarginCurrent: number;
  netMarginPctCurrent: number;
  netMarginPctPrevious: number | null;
  marginDeltaPP: number | null;
  classification: 'cash_generator' | 'neutral' | 'cash_drain';
}

export interface AnonymizedProjectMetric {
  projectToken: string;
  companyToken: string;
  status: Project['status'];
  activeScenario: Project['active_scenario'];
  plannedStartDate: string;
  plannedEndDate: string;
  initialInvestment: number;
  monthlyFixedCostAllocation: number;
  totalPlannedRevenue: number;
  totalPlannedOutflows: number;
  netProjectResult: number;
  roiPct: number | null;
  paybackExactMonths: number | null;
  breakEvenRevenue: number | null;
  realizedRevenueTotal: number;
  realizedOutflowsTotal: number;
  realizedNetResult: number;
  plannedNetToDate: number;
  realizedVsPlannedVarianceAmount: number;
  realizedVsPlannedVariancePct: number | null;
  cashExposureAlert: boolean;
  cashExposureShortfall: number;
  budgetHealth: 'healthy' | 'attention' | 'critical';
}

export interface AnonymizedDebtMetric {
  creditorToken: string;
  companyToken: string;
  debtKind: Debt['debt_kind'];
  amortizationSystem: Debt['amortization_system'];
  monthlyInterestRatePct: number;
  remainingPrincipal: number;
  next30dService: number;
  overdueInstallmentsCount: number;
}

export interface AnonymizedTaxMetric {
  companyToken: string;
  taxType: TaxObligation['tax_type'];
  openCount: number;
  overdueCount: number;
  upcoming7dCount: number;
  openAmount: number;
  dueNext45dAmount: number;
}

export interface AnonymizedCashRisk45d {
  horizonDays: 45;
  currentFreeCash: number;
  pendingInflows45d: number;
  pendingOutflows45d: number;
  debtService45d: number;
  taxOutflows45d: number;
  netDelta45d: number;
  projectedCash45d: number;
  hasCashRisk45d: boolean;
  riskSeverity: 'none' | 'moderate' | 'critical';
}

export interface AnonymizedFinancialContext {
  schemaVersion: '1.0-zero-leak';
  generatedAtDate: string;
  scopeType: ActiveContext['scope'];
  scopeToken: string;
  regime: AccountingRegime;
  periodCurrentLabel: string;
  periodCompareLabel: string;
  healthSummary: {
    healthScore: number;
    classification: string;
    freeCash: number;
    projectedCash: number;
    runwayMonths: number | null;
    runwayMode: string;
    monthlyBurnBase: number;
    grossRevenueCurrent: number;
    grossRevenueCompare: number;
    netRevenueCurrent: number;
    contributionMarginPct: number;
    contributionMarginMoMDeltaPct: number | null;
    ebitdaCurrent: number;
    ebitdaPct: number;
    netResultCurrent: number;
    netResultCompare: number;
    netMarginPct: number;
    netMarginMoMDeltaPct: number | null;
    netMarginYoYDeltaPct: number | null;
    totalDebtBalance: number;
    openTaxesAmount: number;
    overdueTaxesCount: number;
    overdueInstallmentsCount: number;
    pillars: Array<{
      id: string;
      score: number;
      maxScore: number;
      metricDisplay: string;
    }>;
  };
  cashRisk45d: AnonymizedCashRisk45d;
  monthlyEvolution6m: Array<{
    monthKey: string;
    grossRevenue: number;
    totalCostsAndExpenses: number;
    netResult: number;
    netMarginPct: number;
  }>;
  dreCategoryBreakdown: Array<{
    lineId: string;
    code: string;
    currentAmount: number;
    compareAmount: number;
    verticalPct: number | null;
    horizontalDeltaPct: number | null;
  }>;
  accounts: AnonymizedAccountMetric[];
  companies: AnonymizedCompanyMetric[];
  productsAndServices: AnonymizedProductMetric[];
  projects: AnonymizedProjectMetric[];
  debts: AnonymizedDebtMetric[];
  taxesByCompany: AnonymizedTaxMetric[];
}

export interface BuildAnonymizedContextInput {
  groups: readonly BusinessGroup[];
  companies: readonly Company[];
  accounts: readonly FinancialAccount[];
  categories: readonly Category[];
  productsServices: readonly ProductService[];
  projects: readonly Project[];
  projectForecastItems: readonly ProjectForecastItem[];
  transactions: readonly Transaction[];
  debts: readonly Debt[];
  debtInstallments: readonly DebtInstallment[];
  taxObligations: readonly TaxObligation[];
  vault: readonly VaultEntry[];
  activeContext: ActiveContext;
  regime?: AccountingRegime;
  preset?: PeriodComparisonPreset;
  referenceMonth?: string;
  todayISO?: string;
  targetMarginPct?: number;
}

export interface BuildAnonymizedContextOutput {
  context: AnonymizedFinancialContext;
  sanitizationReport: SanitizationReport;
  serializedJson: string;
  tokensDetected: string[];
}

const RAW_PII_PATTERNS = [
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
];

function shiftDaysISO(baseISO: string, days: number): string {
  const [y, m, d] = baseISO.split('-').map(Number);
  if (!y || !m || !d) return baseISO;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
    dt.getDate()
  ).padStart(2, '0')}`;
}

/**
 * Coleta TODOS os termos sensíveis do workspace para validar que nenhum deles
 * sobreviveu na camada de saída para IA ou MCP.
 */
export function collectAllSensitiveTerms(
  input: Pick<
    BuildAnonymizedContextInput,
    | 'groups'
    | 'companies'
    | 'accounts'
    | 'productsServices'
    | 'projects'
    | 'transactions'
    | 'debts'
    | 'taxObligations'
    | 'vault'
  >
): string[] {
  const terms = new Set<string>();
  const add = (val: string | null | undefined) => {
    if (!val) return;
    const trimmed = val.trim();
    if (trimmed.length >= 2) terms.add(trimmed);
  };

  for (const v of input.vault) {
    add(v.real_label);
    add(v.sensitive_identifier);
    for (const alias of v.secondary_aliases) add(alias);
  }
  for (const g of input.groups) add(g.name);
  for (const c of input.companies) {
    add(c.legal_name);
    add(c.trade_name);
    add(c.cnpj);
  }
  for (const a of input.accounts) {
    add(a.name);
    add(a.institution_name);
  }
  for (const p of input.productsServices) {
    add(p.name);
    add(p.sku_code);
  }
  for (const prj of input.projects) {
    add(prj.name);
    add(prj.hypothesis);
  }
  for (const d of input.debts) {
    add(d.title);
    add(d.creditor_name);
    add(d.contract_code);
  }
  for (const t of input.taxObligations) {
    add(t.tax_name);
    add(t.guide_reference);
  }
  for (const tx of input.transactions) {
    add(tx.counterparty_name);
    add(tx.description);
    add(tx.notes);
  }

  return Array.from(terms);
}

/**
 * Constrói uma matriz de VaultEntry completa (incluindo fallback caso alguma
 * entidade ainda não esteja sincronizada no array vault).
 */
function buildEffectiveVault(input: BuildAnonymizedContextInput): VaultEntry[] {
  const existingKeys = new Set(input.vault.map((v) => `${v.entity_type}:${v.entity_id}`));
  const merged: VaultEntry[] = [...input.vault];
  const now = new Date().toISOString();

  const ensureEntry = (
    entityType: VaultEntry['entity_type'],
    entityId: string,
    token: string,
    realLabel: string,
    sensitiveId: string | null = null,
    aliases: string[] = []
  ) => {
    const key = `${entityType}:${entityId}`;
    if (existingKeys.has(key)) return;
    existingKeys.add(key);
    merged.push({
      id: `synth-${key}`,
      tenant_id: 'tenant',
      entity_type: entityType,
      entity_id: entityId,
      analytical_token: token,
      real_label: realLabel,
      sensitive_identifier: sensitiveId,
      secondary_aliases: aliases,
      is_archived: false,
      created_at: now,
      updated_at: now,
    });
  };

  for (const g of input.groups) ensureEntry('group', g.id, g.analytical_token, g.name);
  for (const c of input.companies) {
    ensureEntry('company', c.id, c.analytical_token, c.trade_name ?? c.legal_name, c.cnpj, [
      c.legal_name,
    ]);
  }
  for (const a of input.accounts) {
    ensureEntry(
      'account',
      a.id,
      a.analytical_token,
      a.name,
      a.last_four,
      a.institution_name ? [a.institution_name] : []
    );
  }
  for (const p of input.productsServices) {
    ensureEntry(
      p.item_type === 'service' ? 'service' : 'product',
      p.id,
      p.analytical_token,
      p.name,
      p.sku_code,
      p.sku_code ? [p.sku_code] : []
    );
  }
  for (const prj of input.projects) {
    ensureEntry('project', prj.id, prj.analytical_token, prj.name);
  }
  for (const d of input.debts) {
    ensureEntry(
      'creditor',
      d.id,
      d.creditor_token,
      d.creditor_name,
      d.contract_code,
      [d.title, ...(d.contract_code ? [d.contract_code] : [])]
    );
  }

  return merged;
}

/**
 * Gate obrigatório de verificação Zero-Leak. Rejeita e lança ZeroLeakViolationError
 * se qualquer dado sensível real (empresa, CNPJ, conta, produto, projeto, cliente, CPF, email)
 * for detectado no payload.
 */
export function assertZeroLeakagePayload<T>(
  payload: T,
  vault: readonly VaultEntry[],
  extraSensitiveTerms: readonly string[] = [],
  options: { rejectIfUnsanitized?: boolean } = {}
): SanitizationResultLike<T> {
  if (options.rejectIfUnsanitized) {
    const rawSerialized =
      typeof payload === 'string' ? payload : (JSON.stringify(payload) ?? '');
    const rawCheck = verifyZeroLeakage(payload, vault, extraSensitiveTerms);
    const rawPiiHits: string[] = [];
    for (const pat of RAW_PII_PATTERNS) {
      const match = rawSerialized.match(pat);
      if (match?.[0]) rawPiiHits.push(match[0]);
    }
    if (!rawCheck.clean || rawPiiHits.length > 0) {
      const rawLeaks = Array.from(new Set([...rawCheck.leakedTerms, ...rawPiiHits]));
      throw new ZeroLeakViolationError(
        `Barreira Zero-Leak rejeitou payload não anonimizado: termos sensíveis detectados (${rawLeaks.join(', ')}).`,
        rawLeaks
      );
    }
  }

  const sanitizedResult = sanitizeForAI(payload, vault, {
    counterpartyNames: [...extraSensitiveTerms],
    redactTransactionDescriptions: true,
  });

  const serialized = JSON.stringify(sanitizedResult.sanitized) ?? '';
  const verification = verifyZeroLeakage(sanitizedResult.sanitized, vault, extraSensitiveTerms);

  const piiHits: string[] = [];
  for (const pat of RAW_PII_PATTERNS) {
    const match = serialized.match(pat);
    if (match?.[0]) piiHits.push(match[0]);
  }

  if (!sanitizedResult.report.zeroLeakageVerified || !verification.clean || piiHits.length > 0) {
    const allLeaks = Array.from(
      new Set([...sanitizedResult.report.leakedTerms, ...verification.leakedTerms, ...piiHits])
    );
    throw new ZeroLeakViolationError(
      `Barreira Zero-Leak bloqueou envio externo: termos sensíveis detectados (${allLeaks.join(', ')}).`,
      allLeaks
    );
  }

  return {
    sanitized: sanitizedResult.sanitized,
    report: sanitizedResult.report,
    serializedJson: serialized,
  };
}

export interface SanitizationResultLike<T> {
  sanitized: T;
  report: SanitizationReport;
  serializedJson: string;
}

/**
 * Constrói o payload 100% anonimizado para o CFO Virtual e para as Tools do Servidor MCP.
 * NENHUM nome real, CNPJ, instituição bancária, cliente ou descrição livre entra no objeto.
 */
export function buildAnonymizedCfoContext(
  input: BuildAnonymizedContextInput
): BuildAnonymizedContextOutput {
  const todayISO = input.todayISO ?? getTodayISO();
  const referenceMonth = input.referenceMonth ?? todayISO.slice(0, 7);
  const regime: AccountingRegime = input.regime ?? 'cash';
  const preset: PeriodComparisonPreset = input.preset ?? 'month_mom';
  const targetMarginPct = input.targetMarginPct ?? 15;

  const effectiveVault = buildEffectiveVault(input);
  const allSensitiveTerms = collectAllSensitiveTerms(input);

  const groupMap = new Map(input.groups.map((g) => [g.id, g]));
  const companyMap = new Map(input.companies.map((c) => [c.id, c]));
  const { companyIds, accountIds } = getScopedIds(
    input.companies,
    input.accounts,
    input.activeContext
  );

  let scopeToken = 'GLOBAL';
  if (input.activeContext.scope === 'group') {
    scopeToken = groupMap.get(input.activeContext.groupId)?.analytical_token ?? 'GRP_SCOPE';
  } else if (input.activeContext.scope === 'company') {
    scopeToken = companyMap.get(input.activeContext.companyId)?.analytical_token ?? 'EMP_SCOPE';
  } else if (input.activeContext.scope === 'account') {
    const targetAccountId = input.activeContext.accountId;
    const acc = input.accounts.find((a) => a.id === targetAccountId);
    scopeToken = acc?.analytical_token ?? 'CTA_SCOPE';
  }

  const periods = resolveComparisonPeriods({
    preset,
    referenceMonth,
  });

  const diagnostics = computeFinancialHealthDiagnostics({
    transactions: input.transactions,
    categories: input.categories,
    companies: input.companies,
    accounts: input.accounts,
    productsServices: input.productsServices,
    projects: input.projects,
    debts: input.debts,
    debtInstallments: input.debtInstallments,
    taxObligations: input.taxObligations,
    activeContext: input.activeContext,
    regime,
    periods,
    todayISO,
    targetMarginPct,
  });

  // Diagnóstico do mês anterior para detectar queda de margem por produto (marginDeltaPP)
  const prevMonthKey = addMonthsISO(`${referenceMonth}-01`, -1).slice(0, 7);
  const prevRange = getMonthRangeISO(prevMonthKey);
  const prevPeriods = resolveComparisonPeriods({
    preset: 'month_mom',
    referenceMonth: prevMonthKey,
  });
  const prevDiagnostics = computeFinancialHealthDiagnostics({
    transactions: input.transactions,
    categories: input.categories,
    companies: input.companies,
    accounts: input.accounts,
    productsServices: input.productsServices,
    projects: input.projects,
    debts: input.debts,
    debtInstallments: input.debtInstallments,
    taxObligations: input.taxObligations,
    activeContext: input.activeContext,
    regime,
    periods: prevPeriods,
    todayISO,
    targetMarginPct,
  });
  const prevProdMarginMap = new Map(
    prevDiagnostics.rankings.products.map((p) => [p.id, p.netMarginPct])
  );

  // Saldos anonimizados por conta (apenas CTA_XX / EMP_XX)
  const accountBalances = computeAccountBalances(
    input.accounts,
    input.transactions,
    input.companies,
    input.activeContext
  );
  const accountEntityMap = new Map(input.accounts.map((a) => [a.id, a]));
  const anonymizedAccounts: AnonymizedAccountMetric[] = accountBalances.map((bal) => {
    const acc = accountEntityMap.get(bal.account_id);
    const comp = companyMap.get(bal.company_id);
    return {
      accountToken: bal.analytical_token,
      companyToken: comp?.analytical_token ?? 'EMP_00',
      accountType: acc?.account_type ?? 'checking',
      currency: acc?.currency ?? 'BRL',
      currentBalance: bal.current_balance,
      projectedBalance: bal.projected_balance,
    };
  });

  // Empresas anonimizadas
  const anonymizedCompanies: AnonymizedCompanyMetric[] = diagnostics.rankings.companies.map(
    (row) => {
      const comp = companyMap.get(row.id);
      const grpToken = comp?.group_id
        ? (groupMap.get(comp.group_id)?.analytical_token ?? null)
        : null;
      return {
        companyToken: row.token,
        groupToken: grpToken,
        taxRegime: comp?.tax_regime ?? null,
        revenueCurrent: row.revenue,
        directAndTaxCosts: row.directAndTaxCosts,
        operatingExpenses: row.operatingExpenses,
        netResult: row.netResult,
        netMarginPct: row.netMarginPct,
        shareOfResultPct: row.shareOfResultPct,
        classification: row.classification,
      };
    }
  );

  // Produtos e Serviços anonimizados (com variação MoM de margem + economia unitária)
  const prodRankMap = new Map(diagnostics.rankings.products.map((p) => [p.id, p]));
  const scopedProducts = input.productsServices.filter((p) => {
    if (!p.is_active) return false;
    if (p.company_id && companyIds.has(p.company_id)) return true;
    if (p.group_id) {
      return input.companies.some((c) => companyIds.has(c.id) && c.group_id === p.group_id);
    }
    return input.activeContext.scope === 'all_independent';
  });

  const anonymizedProducts: AnonymizedProductMetric[] = scopedProducts.map((prod) => {
    const rank = prodRankMap.get(prod.id);
    const prevPct = prevProdMarginMap.get(prod.id) ?? null;
    const currPct = rank?.netMarginPct ?? 0;
    const deltaPP =
      rank && prevPct !== null ? Math.round((currPct - prevPct) * 10) / 10 : null;
    const unitMargin =
      prod.base_price -
      prod.estimated_direct_cost -
      prod.base_price * ((prod.payment_fee_pct + prod.estimated_tax_pct) / 100);
    const unitMarginPct =
      prod.base_price > 0 ? Math.round((unitMargin / prod.base_price) * 1000) / 10 : 0;

    return {
      offerToken: prod.analytical_token,
      companyToken: prod.company_id
        ? (companyMap.get(prod.company_id)?.analytical_token ?? null)
        : null,
      groupToken: prod.group_id ? (groupMap.get(prod.group_id)?.analytical_token ?? null) : null,
      offerKind: prod.offer_kind,
      unitPrice: prod.base_price,
      estimatedDirectCost: prod.estimated_direct_cost,
      paymentFeePct: prod.payment_fee_pct,
      estimatedTaxPct: prod.estimated_tax_pct,
      unitContributionMarginPct: unitMarginPct,
      revenueCurrent: rank?.revenue ?? 0,
      directCostsCurrent: rank?.directCosts ?? 0,
      taxesCurrent: rank?.taxes ?? 0,
      netMarginCurrent: rank?.netMargin ?? 0,
      netMarginPctCurrent: currPct,
      netMarginPctPrevious: prevPct,
      marginDeltaPP: deltaPP,
      classification: rank?.classification ?? 'neutral',
    };
  });

  // Projetos anonimizados (previsto vs realizado + ROI + payback + exposição de caixa)
  const scopedProjects = input.projects.filter(
    (prj) => prj.is_active && companyIds.has(prj.company_id)
  );
  const cashBeforeCache = new Map<string, number>();

  const anonymizedProjects: AnonymizedProjectMetric[] = scopedProjects.map((prj) => {
    const cacheKey = `${prj.company_id}:${prj.id}`;
    if (!cashBeforeCache.has(cacheKey)) {
      cashBeforeCache.set(
        cacheKey,
        computeCompanyCashBeforeProject(input.accounts, input.transactions, prj.company_id, prj.id)
      );
    }
    const feasibility = calculateProjectFeasibility({
      project: prj,
      forecastItems: input.projectForecastItems,
      transactions: input.transactions,
      companyCashBeforeProject: cashBeforeCache.get(cacheKey) ?? 0,
      scenario: prj.active_scenario,
      todayISO,
    });

    const totalPlannedOutflows = roundCurrency(
      feasibility.totalPlannedDirectCostsAndTaxes +
        feasibility.totalPlannedFixedCosts +
        feasibility.totalPlannedCapex
    );

    return {
      projectToken: prj.analytical_token,
      companyToken: companyMap.get(prj.company_id)?.analytical_token ?? 'EMP_00',
      status: prj.status,
      activeScenario: prj.active_scenario,
      plannedStartDate: prj.planned_start_date,
      plannedEndDate: prj.planned_end_date,
      initialInvestment: prj.initial_investment,
      monthlyFixedCostAllocation: prj.monthly_fixed_cost_allocation,
      totalPlannedRevenue: feasibility.totalPlannedRevenue,
      totalPlannedOutflows,
      netProjectResult: feasibility.netProjectResult,
      roiPct: feasibility.roiPct,
      paybackExactMonths: feasibility.paybackExactMonths,
      breakEvenRevenue: feasibility.breakEvenRevenue,
      realizedRevenueTotal: feasibility.realizedRevenueTotal,
      realizedOutflowsTotal: feasibility.realizedOutflowsTotal,
      realizedNetResult: feasibility.realizedNetResult,
      plannedNetToDate: feasibility.plannedNetToDate,
      realizedVsPlannedVarianceAmount: feasibility.realizedVsPlannedVarianceAmount,
      realizedVsPlannedVariancePct: feasibility.realizedVsPlannedVariancePct,
      cashExposureAlert: feasibility.cashExposureAlert,
      cashExposureShortfall: feasibility.cashExposureShortfall,
      budgetHealth: feasibility.budgetHealth,
    };
  });

  // Dívidas anonimizadas (por CRD_XX)
  const in30DaysISO = shiftDaysISO(todayISO, 30);
  const in45DaysISO = shiftDaysISO(todayISO, 45);
  const in7DaysISO = shiftDaysISO(todayISO, 7);

  const scopedDebts = input.debts.filter(
    (d) =>
      d.status === 'active' &&
      companyIds.has(d.company_id) &&
      (input.activeContext.scope !== 'account' ||
        d.account_id === null ||
        d.account_id === input.activeContext.accountId)
  );

  let debtService45d = 0;
  const anonymizedDebts: AnonymizedDebtMetric[] = scopedDebts.map((debt) => {
    const insts = input.debtInstallments.filter(
      (i) => i.debt_id === debt.id && i.status !== 'paid' && i.status !== 'canceled'
    );
    let remainingPrincipal = 0;
    let next30dService = 0;
    let overdueCount = 0;
    for (const inst of insts) {
      remainingPrincipal = roundCurrency(remainingPrincipal + inst.principal_portion);
      if (inst.due_date <= in30DaysISO) {
        next30dService = roundCurrency(next30dService + inst.total_amount);
      }
      if (inst.due_date <= in45DaysISO) {
        debtService45d = roundCurrency(debtService45d + inst.total_amount);
      }
      if (inst.due_date < todayISO) overdueCount += 1;
    }

    return {
      creditorToken: debt.creditor_token,
      companyToken: companyMap.get(debt.company_id)?.analytical_token ?? 'EMP_00',
      debtKind: debt.debt_kind,
      amortizationSystem: debt.amortization_system,
      monthlyInterestRatePct: debt.monthly_interest_rate_pct,
      remainingPrincipal,
      next30dService,
      overdueInstallmentsCount: overdueCount,
    };
  });

  // Obrigações fiscais anonimizadas por empresa & tipo
  const taxBucketMap = new Map<string, AnonymizedTaxMetric>();
  let taxOutflows45d = 0;

  for (const tax of input.taxObligations) {
    if (tax.status === 'paid' || tax.status === 'canceled') continue;
    if (!companyIds.has(tax.company_id)) continue;
    if (
      input.activeContext.scope === 'account' &&
      tax.account_id !== null &&
      tax.account_id !== input.activeContext.accountId
    ) {
      continue;
    }
    const compToken = companyMap.get(tax.company_id)?.analytical_token ?? 'EMP_00';
    const key = `${compToken}:${tax.tax_type}`;
    const existing = taxBucketMap.get(key) ?? {
      companyToken: compToken,
      taxType: tax.tax_type,
      openCount: 0,
      overdueCount: 0,
      upcoming7dCount: 0,
      openAmount: 0,
      dueNext45dAmount: 0,
    };

    existing.openCount += 1;
    existing.openAmount = roundCurrency(existing.openAmount + tax.amount);
    if (tax.due_date < todayISO) {
      existing.overdueCount += 1;
    } else if (tax.due_date <= in7DaysISO) {
      existing.upcoming7dCount += 1;
    }
    if (tax.due_date <= in45DaysISO) {
      existing.dueNext45dAmount = roundCurrency(existing.dueNext45dAmount + tax.amount);
      taxOutflows45d = roundCurrency(taxOutflows45d + tax.amount);
    }
    taxBucketMap.set(key, existing);
  }

  // Risco de Caixa nos Próximos 45 Dias (considera pendentes no fluxo + dívidas + impostos)
  let pendingInflows45d = 0;
  let pendingOutflows45d = 0;
  for (const tx of input.transactions) {
    if (tx.status === 'paid' || tx.status === 'canceled' || tx.transaction_type === 'transfer') {
      continue;
    }
    if (!accountIds.has(tx.account_id)) continue;
    if (tx.due_date <= in45DaysISO) {
      if (tx.transaction_type === 'income') {
        pendingInflows45d = roundCurrency(pendingInflows45d + tx.amount);
      } else {
        pendingOutflows45d = roundCurrency(pendingOutflows45d + tx.amount);
      }
    }
  }

  const netDelta45d = roundCurrency(
    pendingInflows45d - pendingOutflows45d - debtService45d - taxOutflows45d
  );
  const projectedCash45d = roundCurrency(diagnostics.freeCash + netDelta45d);
  const riskSeverity: AnonymizedCashRisk45d['riskSeverity'] =
    projectedCash45d < 0
      ? 'critical'
      : projectedCash45d < diagnostics.monthlyBurnBase * 0.75
        ? 'moderate'
        : 'none';

  // Linhas DRE sem nomes personalizados sensíveis (apenas códigos contábeis padrão e IDs estruturais)
  const dreCategoryBreakdown = diagnostics.dre.lines.map((line) => ({
    lineId: line.id,
    code: `${line.order}.0`,
    currentAmount: line.currentAmount,
    compareAmount: line.compareAmount,
    verticalPct: line.verticalPct,
    horizontalDeltaPct: line.horizontalDeltaPct,
  }));

  const rawContext: AnonymizedFinancialContext = {
    schemaVersion: '1.0-zero-leak',
    generatedAtDate: todayISO,
    scopeType: input.activeContext.scope,
    scopeToken,
    regime,
    periodCurrentLabel: prevRange ? periods.current.label : referenceMonth,
    periodCompareLabel: periods.compare.label,
    healthSummary: {
      healthScore: diagnostics.healthScore,
      classification: diagnostics.classification,
      freeCash: diagnostics.freeCash,
      projectedCash: diagnostics.projectedCash,
      runwayMonths: diagnostics.runwayMonths,
      runwayMode: diagnostics.runwayMode,
      monthlyBurnBase: diagnostics.monthlyBurnBase,
      grossRevenueCurrent: diagnostics.dre.grossRevenueCurrent,
      grossRevenueCompare: diagnostics.dre.grossRevenueCompare,
      netRevenueCurrent: diagnostics.dre.netRevenueCurrent,
      contributionMarginPct: diagnostics.contributionMarginPct,
      contributionMarginMoMDeltaPct: diagnostics.contributionMarginMoMDeltaPct,
      ebitdaCurrent: diagnostics.dre.ebitdaCurrent,
      ebitdaPct: diagnostics.dre.ebitdaPctCurrent,
      netResultCurrent: diagnostics.netResultCurrent,
      netResultCompare: diagnostics.netResultCompare,
      netMarginPct: diagnostics.netMarginPct,
      netMarginMoMDeltaPct: diagnostics.netMarginMoMDeltaPct,
      netMarginYoYDeltaPct: diagnostics.netMarginYoYDeltaPct,
      totalDebtBalance: diagnostics.totalDebtBalance,
      openTaxesAmount: diagnostics.openTaxesAmount,
      overdueTaxesCount: diagnostics.overdueTaxesCount,
      overdueInstallmentsCount: diagnostics.overdueInstallmentsCount,
      pillars: diagnostics.pillars.map((p) => ({
        id: p.id,
        score: p.score,
        maxScore: p.maxScore,
        metricDisplay: p.metricDisplay,
      })),
    },
    cashRisk45d: {
      horizonDays: 45,
      currentFreeCash: diagnostics.freeCash,
      pendingInflows45d,
      pendingOutflows45d,
      debtService45d,
      taxOutflows45d,
      netDelta45d,
      projectedCash45d,
      hasCashRisk45d: riskSeverity !== 'none',
      riskSeverity,
    },
    monthlyEvolution6m: diagnostics.monthlyEvolution.map((m) => ({
      monthKey: m.monthKey,
      grossRevenue: m.grossRevenue,
      totalCostsAndExpenses: m.totalCostsAndExpenses,
      netResult: m.netResult,
      netMarginPct: m.netMarginPct,
    })),
    dreCategoryBreakdown,
    accounts: anonymizedAccounts,
    companies: anonymizedCompanies,
    productsAndServices: anonymizedProducts,
    projects: anonymizedProjects,
    debts: anonymizedDebts,
    taxesByCompany: Array.from(taxBucketMap.values()),
  };

  // Gate estrito Zero-Leakage antes de qualquer envio externo
  const gate = assertZeroLeakagePayload(rawContext, effectiveVault, allSensitiveTerms);

  const tokenMatches = gate.serializedJson.match(/\b(?:GRP|EMP|CTA|PRD|SRV|PRJ|CRD)_\d{2,}\b/g);
  const tokensDetected = Array.from(new Set(tokenMatches ?? [])).sort();

  return {
    context: gate.sanitized,
    sanitizationReport: gate.report,
    serializedJson: gate.serializedJson,
    tokensDetected,
  };
}

/**
 * Sanitiza perguntas digitadas pelo usuário no chat do CFO Virtual antes do envio à IA,
 * convertendo nomes reais e CNPJs em tokens do Cofre e bloqueando qualquer vazamento residual.
 */
export function sanitizeUserQuestionForAI(
  question: string,
  vault: readonly VaultEntry[],
  extraSensitiveTerms: readonly string[] = []
): { sanitizedQuestion: string; report: SanitizationReport } {
  const gate = assertZeroLeakagePayload({ question }, vault, extraSensitiveTerms);
  return {
    sanitizedQuestion: gate.sanitized.question,
    report: gate.report,
  };
}

/**
 * Re-hidrata recomendações do CFO Virtual exclusivamente no ambiente autenticado do cliente.
 */
export function rehydrateAiInsightForDisplay(
  insight: AiInsight,
  vault: readonly VaultEntry[],
  isAuthenticatedClient: boolean
): {
  title: string;
  summary: string;
  recommendation: string;
  relatedLabels: Array<{ token: string; label: string }>;
} {
  const restored = rehydrateFromAI(
    {
      title: insight.title_tokenized,
      summary: insight.summary_tokenized,
      recommendation: insight.recommendation_tokenized,
    },
    vault,
    { isAuthenticatedClient, includeFormattedCnpj: false }
  );

  const vaultMap = new Map(vault.map((v) => [v.analytical_token, v.real_label]));
  const relatedLabels = insight.related_tokens.map((tok) => ({
    token: tok,
    label: vaultMap.get(tok) ?? tok,
  }));

  return {
    title: restored.title,
    summary: restored.summary,
    recommendation: restored.recommendation,
    relatedLabels,
  };
}
