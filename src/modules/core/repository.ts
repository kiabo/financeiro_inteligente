import { addMonthsISO, getTodayISO, normalizeCNPJ } from '../../lib/utils';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import type {
  AccountBalanceSummary,
  AccountType,
  AccountingRegime,
  ActiveContext,
  AiInsight,
  AiInsightCategory,
  AiInsightSeverity,
  AiInsightStatus,
  AmortizationSystem,
  AppRole,
  AuditAction,
  AuditLogEntry,
  BusinessGroup,
  Category,
  CategoryDirection,
  CategoryGroupType,
  Company,
  Debt,
  DebtInstallment,
  DebtKind,
  FinancialAccount,
  ForecastItemDirection,
  InvitedUser,
  McpAccessToken,
  McpCallLog,
  McpTokenScope,
  OfferKind,
  ProductService,
  Project,
  ProjectForecastItem,
  ProjectScenarioType,
  ProjectStatus,
  TaxObligation,
  TaxType,
  Transaction,
  TransactionStatus,
  TransactionType,
  VaultEntityType,
  VaultEntry,
} from './types';
import { calculateAmortizationSchedule, roundCurrency } from '../health/healthEngine';
import { computeForecastLineTotals } from '../projects/projectCalculator';

export interface WorkspaceSnapshot {
  groups: BusinessGroup[];
  companies: Company[];
  accounts: FinancialAccount[];
  vault: VaultEntry[];
  auditLogs: AuditLogEntry[];
  invitedUsers: InvitedUser[];
  productsServices: ProductService[];
  categories: Category[];
  transactions: Transaction[];
  projects: Project[];
  projectForecastItems: ProjectForecastItem[];
  debts: Debt[];
  debtInstallments: DebtInstallment[];
  taxObligations: TaxObligation[];
  aiInsights: AiInsight[];
  mcpTokens: McpAccessToken[];
  mcpCallLogs: McpCallLog[];
}

export interface CreateGroupInput {
  name: string;
  description?: string;
}

export interface CreateCompanyInput {
  legal_name: string;
  trade_name?: string;
  cnpj: string;
  tax_regime?: string;
  group_id: string | null;
}

export interface CreateAccountInput {
  company_id: string;
  name: string;
  account_type: AccountType;
  institution_name?: string;
  currency?: string;
  last_four?: string;
}

export interface UpsertProductServiceInput {
  company_id: string | null;
  group_id: string | null;
  name: string;
  offer_kind: OfferKind;
  sku_code?: string;
  base_price: number;
  estimated_direct_cost: number;
  payment_fee_pct: number;
  estimated_tax_pct: number;
  description?: string;
}

export type ScheduleMode = 'single' | 'installments' | 'recurring';

export interface CreateTransactionInput {
  company_id: string;
  account_id: string;
  destination_account_id: string | null;
  category_id: string | null;
  product_service_id: string | null;
  project_id?: string | null;
  transaction_type: TransactionType;
  status: 'pending' | 'paid';
  description: string;
  counterparty_name?: string;
  amount: number;
  competence_date: string;
  due_date: string;
  payment_date?: string | null;
  notes?: string;
  schedule_mode: ScheduleMode;
  total_occurrences?: number;
  /** Quando parcelado, define se a competência fica integral na venda ou avança mês a mês */
  competence_follows_installment?: boolean;
}

export interface PeriodSummaryMetrics {
  previousBalance: number;
  inflows: number;
  inflowsRealized: number;
  inflowsPending: number;
  outflows: number;
  outflowsRealized: number;
  outflowsPending: number;
  periodResult: number;
  netTransfersInPeriod: number;
  projectedBalance: number;
  overdueCount: number;
  overdueAmount: number;
}

interface SandboxStore {
  counters: Record<VaultEntityType, number>;
  groups: BusinessGroup[];
  companies: Company[];
  accounts: FinancialAccount[];
  vault: VaultEntry[];
  auditLogs: AuditLogEntry[];
  invitedUsers: InvitedUser[];
  productsServices: ProductService[];
  categories: Category[];
  transactions: Transaction[];
  projects: Project[];
  projectForecastItems: ProjectForecastItem[];
  debts: Debt[];
  debtInstallments: DebtInstallment[];
  taxObligations: TaxObligation[];
  aiInsights: AiInsight[];
  mcpTokens: McpAccessToken[];
  mcpCallLogs: McpCallLog[];
}

export interface CreateProjectInput {
  company_id: string;
  name: string;
  hypothesis?: string;
  status: ProjectStatus;
  active_scenario?: ProjectScenarioType;
  planned_start_date: string;
  planned_end_date: string;
  initial_investment: number;
  monthly_fixed_cost_allocation: number;
}

export interface UpdateProjectInput {
  name?: string;
  hypothesis?: string | null;
  status?: ProjectStatus;
  active_scenario?: ProjectScenarioType;
  planned_start_date?: string;
  planned_end_date?: string;
  initial_investment?: number;
  monthly_fixed_cost_allocation?: number;
}

export interface CreateProjectForecastInput {
  project_id: string;
  scenario: ProjectScenarioType;
  month_date: string;
  product_service_id: string | null;
  direction: ForecastItemDirection;
  label: string;
  quantity: number;
  unit_price: number;
  unit_direct_cost: number;
  payment_fee_pct: number;
  tax_rate_pct: number;
  explicit_amount?: number;
  notes?: string;
}

export type ScenarioCloneProfile = 'exact' | 'conservative' | 'optimistic';

const SANDBOX_STORAGE_KEY = 'vertice_module1_sandbox_v1';

interface CategorySeedSpec {
  code: string;
  name: string;
  group_type: CategoryGroupType;
  direction: CategoryDirection;
  children: Array<{ code: string; name: string }>;
}

const DEFAULT_CATEGORY_TREE: CategorySeedSpec[] = [
  {
    code: '1.0',
    name: 'Receita Operacional',
    group_type: 'operational_revenue',
    direction: 'inflow',
    children: [
      { code: '1.1', name: 'Venda de Produtos' },
      { code: '1.2', name: 'Prestação de Serviços' },
      { code: '1.3', name: 'Receita Recorrente / Assinaturas' },
    ],
  },
  {
    code: '2.0',
    name: 'Deduções & Impostos',
    group_type: 'tax_deduction',
    direction: 'outflow',
    children: [
      { code: '2.1', name: 'Impostos sobre Faturamento (DAS / ISS / PIS / COFINS)' },
      { code: '2.2', name: 'Taxas de Meios de Pagamento e Gateways' },
    ],
  },
  {
    code: '3.0',
    name: 'Custos Diretos (CPV / CSP)',
    group_type: 'direct_cost',
    direction: 'outflow',
    children: [
      { code: '3.1', name: 'Mercadorias, Insumos e Matéria-Prima' },
      { code: '3.2', name: 'Infraestrutura Cloud e Licenças Diretas' },
      { code: '3.3', name: 'Terceirização Direta e Comissões' },
    ],
  },
  {
    code: '4.0',
    name: 'Despesas Fixas',
    group_type: 'fixed_expense',
    direction: 'outflow',
    children: [
      { code: '4.1', name: 'Folha de Pagamento, Encargos e Pró-labore' },
      { code: '4.2', name: 'Ocupação, Aluguel e Utilidades' },
      { code: '4.3', name: 'Software Administrativo e Contabilidade' },
    ],
  },
  {
    code: '5.0',
    name: 'Despesas Variáveis',
    group_type: 'variable_expense',
    direction: 'outflow',
    children: [
      { code: '5.1', name: 'Marketing, Mídia Paga e Aquisição (CAC)' },
      { code: '5.2', name: 'Fretes, Logística e Viagens Comerciais' },
    ],
  },
  {
    code: '6.0',
    name: 'Investimentos / CAPEX',
    group_type: 'capex',
    direction: 'outflow',
    children: [
      { code: '6.1', name: 'Equipamentos, Hardware e Obras' },
      { code: '6.2', name: 'Desenvolvimento e Ativos Intangíveis' },
    ],
  },
  {
    code: '7.0',
    name: 'Movimentação Financeira',
    group_type: 'financial_movement',
    direction: 'neutral',
    children: [
      { code: '7.1', name: 'Transferência Interna entre Contas' },
      { code: '7.2', name: 'Aplicação, Resgate e Amortização de Principal' },
    ],
  },
  {
    code: '8.0',
    name: 'Resultado Financeiro',
    group_type: 'financial_expense',
    direction: 'neutral',
    children: [
      { code: '8.1', name: 'Receitas Financeiras e Rendimentos' },
      { code: '8.2', name: 'Juros, Multas e Encargos Financeiros' },
    ],
  },
];

function seedCategoriesIntoSandbox(store: SandboxStore, tenantId: string, companyId: string): void {
  const now = new Date().toISOString();
  const hasAny = store.categories.some((c) => c.company_id === companyId);

  if (!hasAny) {
    for (const root of DEFAULT_CATEGORY_TREE) {
      const parentId = crypto.randomUUID();
      store.categories.push({
        id: parentId,
        tenant_id: tenantId,
        company_id: companyId,
        parent_id: null,
        code: root.code,
        name: root.name,
        group_type: root.group_type,
        direction: root.direction,
        is_system: true,
        is_active: true,
        created_at: now,
        updated_at: now,
      });

      for (const child of root.children) {
        const childGroupType: CategoryGroupType =
          child.code === '8.1'
            ? 'financial_income'
            : child.code === '8.2'
              ? 'financial_expense'
              : root.group_type;
        const childDirection: CategoryDirection =
          child.code === '8.1'
            ? 'inflow'
            : child.code === '8.2'
              ? 'outflow'
              : root.direction;

        store.categories.push({
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          company_id: companyId,
          parent_id: parentId,
          code: child.code,
          name: child.name,
          group_type: childGroupType,
          direction: childDirection,
          is_system: true,
          is_active: true,
          created_at: now,
          updated_at: now,
        });
      }
    }
    return;
  }

  // Retrocompatibilidade: garante categoria 8.0 / 8.1 / 8.2 em empresas criadas antes do Módulo 4
  if (!store.categories.some((c) => c.company_id === companyId && c.code === '8.0')) {
    const finRootId = crypto.randomUUID();
    store.categories.push(
      {
        id: finRootId,
        tenant_id: tenantId,
        company_id: companyId,
        parent_id: null,
        code: '8.0',
        name: 'Resultado Financeiro',
        group_type: 'financial_expense',
        direction: 'neutral',
        is_system: true,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        company_id: companyId,
        parent_id: finRootId,
        code: '8.1',
        name: 'Receitas Financeiras e Rendimentos',
        group_type: 'financial_income',
        direction: 'inflow',
        is_system: true,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        company_id: companyId,
        parent_id: finRootId,
        code: '8.2',
        name: 'Juros, Multas e Encargos Financeiros',
        group_type: 'financial_expense',
        direction: 'outflow',
        is_system: true,
        is_active: true,
        created_at: now,
        updated_at: now,
      }
    );
  }
}

function createInitialSandboxStore(tenantId: string, userEmail: string): SandboxStore {
  return {
    counters: { group: 0, company: 0, account: 0, product: 0, service: 0, project: 0, creditor: 0 },
    groups: [],
    companies: [],
    accounts: [],
    vault: [],
    auditLogs: [
      {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        actor_id: tenantId,
        action: 'auth.login',
        entity_type: 'session',
        entity_id: tenantId,
        analytical_token: null,
        metadata: { mode: 'sandbox', invite_verified: true },
        created_at: new Date().toISOString(),
      },
    ],
    invitedUsers: [
      {
        id: crypto.randomUUID(),
        email: userEmail,
        role: 'owner',
        is_active: true,
        accepted_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    ],
    productsServices: [],
    categories: [],
    transactions: [],
    projects: [],
    projectForecastItems: [],
    debts: [],
    debtInstallments: [],
    taxObligations: [],
    aiInsights: [],
    mcpTokens: [],
    mcpCallLogs: [],
  };
}

function loadSandboxStore(tenantId: string, userEmail: string): SandboxStore {
  try {
    const raw = localStorage.getItem(SANDBOX_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SandboxStore>;
      if (parsed && parsed.counters && Array.isArray(parsed.companies)) {
        const migrated: SandboxStore = {
          counters: {
            group: parsed.counters.group ?? 0,
            company: parsed.counters.company ?? 0,
            account: parsed.counters.account ?? 0,
            product: parsed.counters.product ?? 0,
            service: parsed.counters.service ?? 0,
            project: parsed.counters.project ?? 0,
            creditor: parsed.counters.creditor ?? 0,
          },
          groups: parsed.groups ?? [],
          companies: parsed.companies ?? [],
          accounts: parsed.accounts ?? [],
          vault: parsed.vault ?? [],
          auditLogs: parsed.auditLogs ?? [],
          invitedUsers: parsed.invitedUsers ?? [],
          productsServices: parsed.productsServices ?? [],
          categories: parsed.categories ?? [],
          transactions: parsed.transactions ?? [],
          projects: parsed.projects ?? [],
          projectForecastItems: parsed.projectForecastItems ?? [],
          debts: parsed.debts ?? [],
          debtInstallments: parsed.debtInstallments ?? [],
          taxObligations: parsed.taxObligations ?? [],
          aiInsights: parsed.aiInsights ?? [],
          mcpTokens: parsed.mcpTokens ?? [],
          mcpCallLogs: parsed.mcpCallLogs ?? [],
        };

        // Garante seed retroativo de categorias (M2 + M4 8.0) para empresas existentes
        let changed = false;
        for (const comp of migrated.companies) {
          const hasCats = migrated.categories.some((c) => c.company_id === comp.id);
          const hasFin = migrated.categories.some((c) => c.company_id === comp.id && c.code === '8.0');
          if (!hasCats || !hasFin) {
            seedCategoriesIntoSandbox(migrated, tenantId, comp.id);
            changed = true;
          }
        }
        if (changed) {
          saveSandboxStore(migrated);
        }
        return migrated;
      }
    }
  } catch {
    // fallback to clean initial store
  }
  const initial = createInitialSandboxStore(tenantId, userEmail);
  saveSandboxStore(initial);
  return initial;
}

function saveSandboxStore(store: SandboxStore): void {
  localStorage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify(store));
}

function nextSandboxToken(store: SandboxStore, type: VaultEntityType): string {
  const nextSeq = (store.counters[type] ?? 0) + 1;
  store.counters[type] = nextSeq;
  const prefix =
    type === 'group'
      ? 'GRP_'
      : type === 'company'
        ? 'EMP_'
        : type === 'account'
          ? 'CTA_'
          : type === 'product'
            ? 'PRD_'
            : type === 'service'
              ? 'SRV_'
              : type === 'project'
                ? 'PRJ_'
                : 'CRD_';
  return `${prefix}${String(nextSeq).padStart(2, '0')}`;
}

function appendSandboxAudit(
  store: SandboxStore,
  tenantId: string,
  action: AuditAction,
  entityType: string,
  entityId: string | null,
  analyticalToken: string | null,
  metadata: Record<string, unknown> = {}
): void {
  store.auditLogs.unshift({
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    actor_id: tenantId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    analytical_token: analyticalToken,
    metadata,
    created_at: new Date().toISOString(),
  });
}

// ============================================================================
// Helpers de Negócio (Status Atrasado Automático, Margem Unitária, Saldos)
// ============================================================================

export function resolveEffectiveStatus(
  tx: Pick<Transaction, 'status' | 'due_date'>,
  todayISO: string = getTodayISO()
): TransactionStatus {
  if (tx.status === 'pending' && tx.due_date < todayISO) {
    return 'overdue';
  }
  return tx.status;
}

export function calculateUnitContribution(item: Pick<
  ProductService,
  'base_price' | 'estimated_direct_cost' | 'payment_fee_pct' | 'estimated_tax_pct'
>): {
  paymentFeeValue: number;
  taxValue: number;
  totalDeductions: number;
  contributionMargin: number;
  contributionMarginPct: number;
} {
  const price = Math.max(0, Number(item.base_price) || 0);
  const directCost = Math.max(0, Number(item.estimated_direct_cost) || 0);
  const feePct = Math.max(0, Number(item.payment_fee_pct) || 0);
  const taxPct = Math.max(0, Number(item.estimated_tax_pct) || 0);

  const paymentFeeValue = price * (feePct / 100);
  const taxValue = price * (taxPct / 100);
  const totalDeductions = directCost + paymentFeeValue + taxValue;
  const contributionMargin = price - totalDeductions;
  const contributionMarginPct = price > 0 ? (contributionMargin / price) * 100 : 0;

  return {
    paymentFeeValue,
    taxValue,
    totalDeductions,
    contributionMargin,
    contributionMarginPct,
  };
}

export function getScopedIds(
  companies: readonly Company[],
  accounts: readonly FinancialAccount[],
  activeContext: ActiveContext
): { companyIds: Set<string>; accountIds: Set<string>; groupId: string | null } {
  if (activeContext.scope === 'group') {
    const compIds = new Set(
      companies.filter((c) => c.group_id === activeContext.groupId).map((c) => c.id)
    );
    const accIds = new Set(
      accounts.filter((a) => compIds.has(a.company_id)).map((a) => a.id)
    );
    return { companyIds: compIds, accountIds: accIds, groupId: activeContext.groupId };
  }

  if (activeContext.scope === 'company') {
    const compIds = new Set([activeContext.companyId]);
    const accIds = new Set(
      accounts.filter((a) => a.company_id === activeContext.companyId).map((a) => a.id)
    );
    const comp = companies.find((c) => c.id === activeContext.companyId);
    return { companyIds: compIds, accountIds: accIds, groupId: comp?.group_id ?? null };
  }

  if (activeContext.scope === 'account') {
    const acc = accounts.find((a) => a.id === activeContext.accountId);
    const compIds = new Set(acc ? [acc.company_id] : []);
    const accIds = new Set([activeContext.accountId]);
    const comp = acc ? companies.find((c) => c.id === acc.company_id) : undefined;
    return { companyIds: compIds, accountIds: accIds, groupId: comp?.group_id ?? null };
  }

  return {
    companyIds: new Set(companies.map((c) => c.id)),
    accountIds: new Set(accounts.map((a) => a.id)),
    groupId: null,
  };
}

export function computeAccountBalances(
  accounts: readonly FinancialAccount[],
  transactions: readonly Transaction[],
  companies: readonly Company[],
  activeContext: ActiveContext
): AccountBalanceSummary[] {
  const { accountIds } = getScopedIds(companies, accounts, activeContext);
  const companyMap = new Map(companies.map((c) => [c.id, c]));

  return accounts
    .filter((acc) => accountIds.has(acc.id))
    .map((acc) => {
      let currentBalance = 0;
      let projectedBalance = 0;

      for (const tx of transactions) {
        if (tx.status === 'canceled') continue;

        let delta = 0;
        if (tx.transaction_type === 'income' && tx.account_id === acc.id) {
          delta = tx.amount;
        } else if (tx.transaction_type === 'expense' && tx.account_id === acc.id) {
          delta = -tx.amount;
        } else if (tx.transaction_type === 'transfer') {
          if (tx.account_id === acc.id) delta -= tx.amount;
          if (tx.destination_account_id === acc.id) delta += tx.amount;
        }

        if (delta === 0) continue;

        projectedBalance += delta;
        if (tx.status === 'paid') {
          currentBalance += delta;
        }
      }

      const comp = companyMap.get(acc.company_id);
      return {
        account_id: acc.id,
        company_id: acc.company_id,
        group_id: comp?.group_id ?? null,
        account_name: acc.name,
        analytical_token: acc.analytical_token,
        current_balance: currentBalance,
        projected_balance: projectedBalance,
      };
    });
}

export function transactionTouchesContext(
  tx: Transaction,
  accountIds: ReadonlySet<string>
): boolean {
  if (accountIds.has(tx.account_id)) return true;
  if (tx.destination_account_id && accountIds.has(tx.destination_account_id)) return true;
  return false;
}

export function getTransactionReferenceDate(tx: Transaction, regime: AccountingRegime): string {
  if (regime === 'competence') {
    return tx.competence_date;
  }
  return tx.status === 'paid' && tx.payment_date ? tx.payment_date : tx.due_date;
}

export function computePeriodMetrics(
  transactions: readonly Transaction[],
  companies: readonly Company[],
  accounts: readonly FinancialAccount[],
  activeContext: ActiveContext,
  regime: AccountingRegime,
  periodStart: string | null,
  periodEnd: string | null,
  todayISO: string = getTodayISO()
): PeriodSummaryMetrics {
  const { accountIds } = getScopedIds(companies, accounts, activeContext);

  let previousBalance = 0;
  let inflows = 0;
  let inflowsRealized = 0;
  let inflowsPending = 0;
  let outflows = 0;
  let outflowsRealized = 0;
  let outflowsPending = 0;
  let netTransfersInPeriod = 0;
  let overdueCount = 0;
  let overdueAmount = 0;

  for (const tx of transactions) {
    if (!transactionTouchesContext(tx, accountIds)) continue;
    if (tx.status === 'canceled') continue;

    const effectiveStatus = resolveEffectiveStatus(tx, todayISO);
    const refDate = getTransactionReferenceDate(tx, regime);

    // Saldo Anterior: movimentações realizadas (ou dentro da linha do tempo do regime) anteriores ao início do período
    if (periodStart && refDate < periodStart) {
      if (tx.status === 'paid') {
        if (tx.transaction_type === 'income' && accountIds.has(tx.account_id)) {
          previousBalance += tx.amount;
        } else if (tx.transaction_type === 'expense' && accountIds.has(tx.account_id)) {
          previousBalance -= tx.amount;
        } else if (tx.transaction_type === 'transfer') {
          if (accountIds.has(tx.account_id)) previousBalance -= tx.amount;
          if (tx.destination_account_id && accountIds.has(tx.destination_account_id)) {
            previousBalance += tx.amount;
          }
        }
      }
      continue;
    }

    if (periodEnd && refDate > periodEnd) {
      continue;
    }

    // Dentro do período selecionado:
    // Regra Crítica: transferências internas movimentam saldo das contas envolvidas, mas NUNCA entram em Entradas/Saídas/Resultado
    if (tx.transaction_type === 'transfer') {
      if (accountIds.has(tx.account_id)) netTransfersInPeriod -= tx.amount;
      if (tx.destination_account_id && accountIds.has(tx.destination_account_id)) {
        netTransfersInPeriod += tx.amount;
      }
      continue;
    }

    if (tx.transaction_type === 'income') {
      inflows += tx.amount;
      if (effectiveStatus === 'paid') {
        inflowsRealized += tx.amount;
      } else {
        inflowsPending += tx.amount;
      }
    } else if (tx.transaction_type === 'expense') {
      outflows += tx.amount;
      if (effectiveStatus === 'paid') {
        outflowsRealized += tx.amount;
      } else {
        outflowsPending += tx.amount;
      }
    }

    if (effectiveStatus === 'overdue') {
      overdueCount += 1;
      overdueAmount += tx.amount;
    }
  }

  const periodResult = inflows - outflows;
  const projectedBalance = previousBalance + periodResult + netTransfersInPeriod;

  return {
    previousBalance,
    inflows,
    inflowsRealized,
    inflowsPending,
    outflows,
    outflowsRealized,
    outflowsPending,
    periodResult,
    netTransfersInPeriod,
    projectedBalance,
    overdueCount,
    overdueAmount,
  };
}

// ============================================================================
// Snapshot Fetch (Módulo 1 + Módulo 2 + Módulo 3)
// ============================================================================

export async function fetchWorkspaceSnapshot(
  tenantId: string,
  userEmail: string
): Promise<WorkspaceSnapshot> {
  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    return {
      groups: [...store.groups],
      companies: [...store.companies],
      accounts: [...store.accounts],
      vault: [...store.vault],
      auditLogs: [...store.auditLogs],
      invitedUsers: [...store.invitedUsers],
      productsServices: [...store.productsServices],
      categories: [...store.categories],
      transactions: [...store.transactions],
      projects: [...store.projects],
      projectForecastItems: [...store.projectForecastItems],
      debts: [...store.debts],
      debtInstallments: [...store.debtInstallments],
      taxObligations: [...store.taxObligations],
      aiInsights: [...store.aiInsights],
      mcpTokens: [...store.mcpTokens],
      mcpCallLogs: [...store.mcpCallLogs],
    };
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const [
    groupsRes,
    companiesRes,
    accountsRes,
    vaultRes,
    auditRes,
    invitesRes,
    productsRes,
    categoriesRes,
    transactionsRes,
    projectsRes,
    forecastRes,
    debtsRes,
    debtInstallmentsRes,
    taxObligationsRes,
    aiInsightsRes,
    mcpTokensRes,
    mcpLogsRes,
  ] = await Promise.all([
    supabase.from('business_groups').select('*').order('created_at', { ascending: true }),
    supabase.from('companies').select('*').order('created_at', { ascending: true }),
    supabase.from('financial_accounts').select('*').order('created_at', { ascending: true }),
    supabase.from('anonymization_vault').select('*').order('created_at', { ascending: true }),
    supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.from('invited_users').select('*').order('created_at', { ascending: false }),
    supabase.from('products_services').select('*').order('created_at', { ascending: true }),
    supabase.from('categories').select('*').order('code', { ascending: true }),
    supabase
      .from('transactions')
      .select('*')
      .order('due_date', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase.from('projects').select('*').order('created_at', { ascending: false }),
    supabase
      .from('project_forecast_items')
      .select('*')
      .order('month_date', { ascending: true }),
    supabase.from('debts').select('*').order('created_at', { ascending: false }),
    supabase
      .from('debt_installments')
      .select('*')
      .order('installment_number', { ascending: true }),
    supabase.from('tax_obligations').select('*').order('due_date', { ascending: true }),
    supabase.from('ai_insights').select('*').order('created_at', { ascending: false }).limit(80),
    supabase
      .from('mcp_access_tokens')
      .select('*')
      .order('created_at', { ascending: false }),
    supabase
      .from('mcp_call_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  const firstError =
    groupsRes.error ??
    companiesRes.error ??
    accountsRes.error ??
    vaultRes.error ??
    auditRes.error ??
    productsRes.error ??
    categoriesRes.error ??
    transactionsRes.error ??
    projectsRes.error ??
    forecastRes.error ??
    debtsRes.error ??
    debtInstallmentsRes.error ??
    taxObligationsRes.error;
  if (firstError) {
    throw new Error(firstError.message);
  }

  const normalizedProducts = ((productsRes.data ?? []) as Array<Record<string, unknown>>).map(
    (p) => ({
      ...(p as unknown as ProductService),
      base_price: Number(p.base_price ?? 0),
      estimated_direct_cost: Number(p.estimated_direct_cost ?? 0),
      payment_fee_pct: Number(p.payment_fee_pct ?? 0),
      estimated_tax_pct: Number(p.estimated_tax_pct ?? 0),
    })
  );

  const normalizedTransactions = (
    (transactionsRes.data ?? []) as Array<Record<string, unknown>>
  ).map((t) => ({
    ...(t as unknown as Transaction),
    amount: Number(t.amount ?? 0),
  }));

  const normalizedProjects = ((projectsRes.data ?? []) as Array<Record<string, unknown>>).map(
    (p) => ({
      ...(p as unknown as Project),
      initial_investment: Number(p.initial_investment ?? 0),
      monthly_fixed_cost_allocation: Number(p.monthly_fixed_cost_allocation ?? 0),
    })
  );

  const normalizedForecastItems = ((forecastRes.data ?? []) as Array<Record<string, unknown>>).map(
    (f) => ({
      ...(f as unknown as ProjectForecastItem),
      quantity: Number(f.quantity ?? 1),
      unit_price: Number(f.unit_price ?? 0),
      unit_direct_cost: Number(f.unit_direct_cost ?? 0),
      payment_fee_pct: Number(f.payment_fee_pct ?? 0),
      tax_rate_pct: Number(f.tax_rate_pct ?? 0),
      gross_amount: Number(f.gross_amount ?? 0),
      estimated_direct_cost_total: Number(f.estimated_direct_cost_total ?? 0),
      estimated_deductions_total: Number(f.estimated_deductions_total ?? 0),
    })
  );

  const normalizedDebts = ((debtsRes.data ?? []) as Array<Record<string, unknown>>).map((d) => ({
    ...(d as unknown as Debt),
    principal_amount: Number(d.principal_amount ?? 0),
    monthly_interest_rate_pct: Number(d.monthly_interest_rate_pct ?? 0),
    total_installments: Number(d.total_installments ?? 1),
  }));

  const normalizedInstallments = (
    (debtInstallmentsRes.data ?? []) as Array<Record<string, unknown>>
  ).map((inst) => ({
    ...(inst as unknown as DebtInstallment),
    installment_number: Number(inst.installment_number ?? 1),
    principal_portion: Number(inst.principal_portion ?? 0),
    interest_portion: Number(inst.interest_portion ?? 0),
    total_amount: Number(inst.total_amount ?? 0),
    remaining_balance: Number(inst.remaining_balance ?? 0),
  }));

  const normalizedTaxes = ((taxObligationsRes.data ?? []) as Array<Record<string, unknown>>).map(
    (t) => ({
      ...(t as unknown as TaxObligation),
      revenue_base_amount: Number(t.revenue_base_amount ?? 0),
      estimated_rate_pct: Number(t.estimated_rate_pct ?? 0),
      amount: Number(t.amount ?? 0),
    })
  );

  const normalizedAiInsights = (
    (!aiInsightsRes.error && aiInsightsRes.data ? aiInsightsRes.data : []) as Array<
      Record<string, unknown>
    >
  ).map((ins) => ({
    ...(ins as unknown as AiInsight),
    estimated_financial_impact: Number(ins.estimated_financial_impact ?? 0),
    impact_horizon_days: Number(ins.impact_horizon_days ?? 45),
    confidence_pct: Number(ins.confidence_pct ?? 85),
    related_tokens: Array.isArray(ins.related_tokens)
      ? (ins.related_tokens as string[])
      : [],
  }));

  const normalizedMcpTokens = (
    (!mcpTokensRes.error && mcpTokensRes.data ? mcpTokensRes.data : []) as Array<
      Record<string, unknown>
    >
  ).map((tok) => ({
    ...(tok as unknown as McpAccessToken),
    call_count: Number(tok.call_count ?? 0),
  }));

  const normalizedMcpLogs = (
    !mcpLogsRes.error && mcpLogsRes.data ? mcpLogsRes.data : []
  ) as McpCallLog[];

  return {
    groups: (groupsRes.data ?? []) as BusinessGroup[],
    companies: (companiesRes.data ?? []) as Company[],
    accounts: (accountsRes.data ?? []) as FinancialAccount[],
    vault: (vaultRes.data ?? []) as VaultEntry[],
    auditLogs: (auditRes.data ?? []) as AuditLogEntry[],
    invitedUsers: (invitesRes.data ?? []) as InvitedUser[],
    productsServices: normalizedProducts,
    categories: (categoriesRes.data ?? []) as Category[],
    transactions: normalizedTransactions,
    projects: normalizedProjects,
    projectForecastItems: normalizedForecastItems,
    debts: normalizedDebts,
    debtInstallments: normalizedInstallments,
    taxObligations: normalizedTaxes,
    aiInsights: normalizedAiInsights,
    mcpTokens: normalizedMcpTokens,
    mcpCallLogs: normalizedMcpLogs,
  };
}

// ============================================================================
// Módulo 1: Grupos, Empresas, Contas, Convites
// ============================================================================

export async function createBusinessGroup(
  tenantId: string,
  userEmail: string,
  input: CreateGroupInput
): Promise<BusinessGroup> {
  const name = input.name.trim();
  if (name.length < 2) throw new Error('Informe um nome com ao menos 2 caracteres.');

  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const now = new Date().toISOString();
    const token = nextSandboxToken(store, 'group');
    const id = crypto.randomUUID();
    const group: BusinessGroup = {
      id,
      tenant_id: tenantId,
      name,
      description: input.description?.trim() || null,
      analytical_token: token,
      is_active: true,
      created_at: now,
      updated_at: now,
    };
    store.groups.push(group);
    store.vault.push({
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      entity_type: 'group',
      entity_id: id,
      analytical_token: token,
      real_label: name,
      sensitive_identifier: null,
      secondary_aliases: [],
      is_archived: false,
      created_at: now,
      updated_at: now,
    });
    appendSandboxAudit(store, tenantId, 'entity.created', 'group', id, token, { op: 'INSERT' });
    saveSandboxStore(store);
    return group;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const { data, error } = await supabase
    .from('business_groups')
    .insert({
      tenant_id: tenantId,
      name,
      description: input.description?.trim() || null,
      analytical_token: 'PENDING',
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as BusinessGroup;
}

export async function deleteBusinessGroup(
  tenantId: string,
  userEmail: string,
  groupId: string
): Promise<void> {
  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const group = store.groups.find((g) => g.id === groupId);
    if (!group) return;

    store.groups = store.groups.filter((g) => g.id !== groupId);
    store.companies = store.companies.map((c) =>
      c.group_id === groupId ? { ...c, group_id: null, updated_at: new Date().toISOString() } : c
    );
    store.productsServices = store.productsServices.map((p) =>
      p.group_id === groupId ? { ...p, group_id: null, updated_at: new Date().toISOString() } : p
    );
    store.vault = store.vault.map((v) =>
      v.entity_type === 'group' && v.entity_id === groupId
        ? { ...v, is_archived: true, updated_at: new Date().toISOString() }
        : v
    );
    appendSandboxAudit(store, tenantId, 'entity.deleted', 'group', groupId, group.analytical_token, {
      archived_in_vault: true,
    });
    saveSandboxStore(store);
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');
  const { error } = await supabase.from('business_groups').delete().eq('id', groupId);
  if (error) throw new Error(error.message);
}

export async function createCompany(
  tenantId: string,
  userEmail: string,
  input: CreateCompanyInput
): Promise<Company> {
  const legalName = input.legal_name.trim();
  const tradeName = input.trade_name?.trim() || null;
  const cnpj = normalizeCNPJ(input.cnpj);

  if (legalName.length < 2) throw new Error('Razão social inválida.');
  if (cnpj.length !== 14) throw new Error('CNPJ deve conter exatamente 14 dígitos.');

  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    if (store.companies.some((c) => c.cnpj === cnpj)) {
      throw new Error('Já existe uma empresa cadastrada com este CNPJ.');
    }

    const now = new Date().toISOString();
    const token = nextSandboxToken(store, 'company');
    const id = crypto.randomUUID();
    const company: Company = {
      id,
      tenant_id: tenantId,
      group_id: input.group_id || null,
      legal_name: legalName,
      trade_name: tradeName,
      cnpj,
      tax_regime: input.tax_regime?.trim() || null,
      analytical_token: token,
      is_active: true,
      created_at: now,
      updated_at: now,
    };

    store.companies.push(company);
    const aliases =
      tradeName && tradeName !== legalName ? [legalName, tradeName] : [legalName];

    store.vault.push({
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      entity_type: 'company',
      entity_id: id,
      analytical_token: token,
      real_label: tradeName ?? legalName,
      sensitive_identifier: cnpj,
      secondary_aliases: aliases,
      is_archived: false,
      created_at: now,
      updated_at: now,
    });

    // Seed automático de Plano de Contas inicial para a nova empresa
    seedCategoriesIntoSandbox(store, tenantId, id);

    appendSandboxAudit(store, tenantId, 'entity.created', 'company', id, token, {
      has_group: Boolean(input.group_id),
    });
    saveSandboxStore(store);
    return company;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const { data, error } = await supabase
    .from('companies')
    .insert({
      tenant_id: tenantId,
      group_id: input.group_id || null,
      legal_name: legalName,
      trade_name: tradeName,
      cnpj,
      tax_regime: input.tax_regime?.trim() || null,
      analytical_token: 'PENDING',
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Company;
}

export async function updateCompanyGroup(
  tenantId: string,
  userEmail: string,
  companyId: string,
  groupId: string | null
): Promise<void> {
  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const company = store.companies.find((c) => c.id === companyId);
    if (!company) throw new Error('Empresa não encontrada.');
    company.group_id = groupId;
    company.updated_at = new Date().toISOString();
    appendSandboxAudit(store, tenantId, 'entity.updated', 'company', companyId, company.analytical_token, {
      group_linked: Boolean(groupId),
    });
    saveSandboxStore(store);
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const { error } = await supabase
    .from('companies')
    .update({ group_id: groupId })
    .eq('id', companyId);

  if (error) throw new Error(error.message);
}

export async function deleteCompany(
  tenantId: string,
  userEmail: string,
  companyId: string
): Promise<void> {
  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const company = store.companies.find((c) => c.id === companyId);
    if (!company) return;

    const removedAccountIds = new Set(
      store.accounts.filter((a) => a.company_id === companyId).map((a) => a.id)
    );
    const removedProductIds = new Set(
      store.productsServices.filter((p) => p.company_id === companyId).map((p) => p.id)
    );
    const removedProjectIds = new Set(
      store.projects.filter((p) => p.company_id === companyId).map((p) => p.id)
    );
    const removedDebtIds = new Set(
      store.debts.filter((d) => d.company_id === companyId).map((d) => d.id)
    );

    store.companies = store.companies.filter((c) => c.id !== companyId);
    store.accounts = store.accounts.filter((a) => a.company_id !== companyId);
    store.categories = store.categories.filter((c) => c.company_id !== companyId);
    store.productsServices = store.productsServices.filter((p) => p.company_id !== companyId);
    store.projects = store.projects.filter((p) => p.company_id !== companyId);
    store.projectForecastItems = store.projectForecastItems.filter(
      (f) => !removedProjectIds.has(f.project_id)
    );
    store.debts = store.debts.filter((d) => d.company_id !== companyId);
    store.debtInstallments = store.debtInstallments.filter(
      (inst) => !removedDebtIds.has(inst.debt_id)
    );
    store.taxObligations = store.taxObligations.filter((t) => t.company_id !== companyId);
    store.transactions = store.transactions.filter(
      (t) =>
        t.company_id !== companyId &&
        (!t.destination_account_id || !removedAccountIds.has(t.destination_account_id))
    );
    store.vault = store.vault.map((v) =>
      (v.entity_type === 'company' && v.entity_id === companyId) ||
      (v.entity_type === 'account' && removedAccountIds.has(v.entity_id)) ||
      ((v.entity_type === 'product' || v.entity_type === 'service') &&
        removedProductIds.has(v.entity_id)) ||
      (v.entity_type === 'project' && removedProjectIds.has(v.entity_id)) ||
      (v.entity_type === 'creditor' && removedDebtIds.has(v.entity_id))
        ? { ...v, is_archived: true, updated_at: new Date().toISOString() }
        : v
    );
    appendSandboxAudit(store, tenantId, 'entity.deleted', 'company', companyId, company.analytical_token, {
      archived_in_vault: true,
    });
    saveSandboxStore(store);
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');
  const { error } = await supabase.from('companies').delete().eq('id', companyId);
  if (error) throw new Error(error.message);
}

export async function createFinancialAccount(
  tenantId: string,
  userEmail: string,
  input: CreateAccountInput
): Promise<FinancialAccount> {
  const name = input.name.trim();
  if (name.length < 2) throw new Error('Nome da conta deve ter ao menos 2 caracteres.');
  const lastFour = input.last_four?.replace(/\D/g, '').slice(0, 4) || null;
  if (lastFour && lastFour.length !== 4) {
    throw new Error('Os últimos dígitos devem ter exatamente 4 números.');
  }

  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const now = new Date().toISOString();
    const token = nextSandboxToken(store, 'account');
    const id = crypto.randomUUID();
    const institution = input.institution_name?.trim() || null;
    const account: FinancialAccount = {
      id,
      tenant_id: tenantId,
      company_id: input.company_id,
      name,
      account_type: input.account_type,
      institution_name: institution,
      currency: (input.currency ?? 'BRL').toUpperCase(),
      last_four: lastFour,
      analytical_token: token,
      is_active: true,
      created_at: now,
      updated_at: now,
    };

    store.accounts.push(account);
    store.vault.push({
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      entity_type: 'account',
      entity_id: id,
      analytical_token: token,
      real_label: name,
      sensitive_identifier: lastFour,
      secondary_aliases: institution ? [institution] : [],
      is_archived: false,
      created_at: now,
      updated_at: now,
    });
    appendSandboxAudit(store, tenantId, 'entity.created', 'account', id, token, {
      account_type: input.account_type,
    });
    saveSandboxStore(store);
    return account;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const { data, error } = await supabase
    .from('financial_accounts')
    .insert({
      tenant_id: tenantId,
      company_id: input.company_id,
      name,
      account_type: input.account_type,
      institution_name: input.institution_name?.trim() || null,
      currency: (input.currency ?? 'BRL').toUpperCase(),
      last_four: lastFour,
      analytical_token: 'PENDING',
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as FinancialAccount;
}

export async function deleteFinancialAccount(
  tenantId: string,
  userEmail: string,
  accountId: string
): Promise<void> {
  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const account = store.accounts.find((a) => a.id === accountId);
    if (!account) return;
    if (
      store.transactions.some(
        (t) => t.account_id === accountId || t.destination_account_id === accountId
      )
    ) {
      throw new Error(
        'Não é possível excluir uma conta que possui lançamentos vinculados. Exclua ou cancele os lançamentos antes.'
      );
    }
    store.accounts = store.accounts.filter((a) => a.id !== accountId);
    store.vault = store.vault.map((v) =>
      v.entity_type === 'account' && v.entity_id === accountId
        ? { ...v, is_archived: true, updated_at: new Date().toISOString() }
        : v
    );
    appendSandboxAudit(store, tenantId, 'entity.deleted', 'account', accountId, account.analytical_token, {
      archived_in_vault: true,
    });
    saveSandboxStore(store);
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');
  const { error } = await supabase.from('financial_accounts').delete().eq('id', accountId);
  if (error) throw new Error(error.message);
}

// ============================================================================
// Módulo 2: CRUD Catálogo de Produtos e Serviços (com Tokens PRD_XX / SRV_XX)
// ============================================================================

export async function createProductService(
  tenantId: string,
  userEmail: string,
  input: UpsertProductServiceInput
): Promise<ProductService> {
  const name = input.name.trim();
  if (name.length < 2) throw new Error('Informe um nome com ao menos 2 caracteres.');
  if (!input.company_id && !input.group_id) {
    throw new Error('Vincule o item a uma empresa ou a um grupo empresarial.');
  }
  if (input.base_price < 0 || input.estimated_direct_cost < 0) {
    throw new Error('Preço e custo direto não podem ser negativos.');
  }
  if (
    input.payment_fee_pct < 0 ||
    input.payment_fee_pct > 100 ||
    input.estimated_tax_pct < 0 ||
    input.estimated_tax_pct > 100
  ) {
    throw new Error('Taxas e alíquotas devem estar entre 0% e 100%.');
  }

  const itemType = input.offer_kind === 'service' ? 'service' : 'product';
  const skuCode = input.sku_code?.trim() || null;

  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const now = new Date().toISOString();
    const token = nextSandboxToken(store, itemType);
    const id = crypto.randomUUID();
    const item: ProductService = {
      id,
      tenant_id: tenantId,
      company_id: input.company_id,
      group_id: input.group_id,
      name,
      item_type: itemType,
      offer_kind: input.offer_kind,
      sku_code: skuCode,
      base_price: Number(input.base_price.toFixed(2)),
      estimated_direct_cost: Number(input.estimated_direct_cost.toFixed(2)),
      payment_fee_pct: Number(input.payment_fee_pct.toFixed(3)),
      estimated_tax_pct: Number(input.estimated_tax_pct.toFixed(3)),
      description: input.description?.trim() || null,
      analytical_token: token,
      is_active: true,
      created_at: now,
      updated_at: now,
    };

    store.productsServices.push(item);
    store.vault.push({
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      entity_type: itemType,
      entity_id: id,
      analytical_token: token,
      real_label: name,
      sensitive_identifier: skuCode,
      secondary_aliases: skuCode ? [skuCode] : [],
      is_archived: false,
      created_at: now,
      updated_at: now,
    });
    appendSandboxAudit(store, tenantId, 'entity.created', itemType, id, token, {
      offer_kind: input.offer_kind,
    });
    saveSandboxStore(store);
    return item;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const { data, error } = await supabase
    .from('products_services')
    .insert({
      tenant_id: tenantId,
      company_id: input.company_id,
      group_id: input.group_id,
      name,
      item_type: itemType,
      offer_kind: input.offer_kind,
      sku_code: skuCode,
      base_price: input.base_price,
      estimated_direct_cost: input.estimated_direct_cost,
      payment_fee_pct: input.payment_fee_pct,
      estimated_tax_pct: input.estimated_tax_pct,
      description: input.description?.trim() || null,
      analytical_token: 'PENDING',
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return {
    ...(data as ProductService),
    base_price: Number(data.base_price),
    estimated_direct_cost: Number(data.estimated_direct_cost),
    payment_fee_pct: Number(data.payment_fee_pct),
    estimated_tax_pct: Number(data.estimated_tax_pct),
  };
}

export async function updateProductService(
  tenantId: string,
  userEmail: string,
  productId: string,
  input: UpsertProductServiceInput
): Promise<ProductService> {
  const name = input.name.trim();
  if (name.length < 2) throw new Error('Informe um nome com ao menos 2 caracteres.');
  if (!input.company_id && !input.group_id) {
    throw new Error('Vincule o item a uma empresa ou a um grupo empresarial.');
  }

  const skuCode = input.sku_code?.trim() || null;

  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const existing = store.productsServices.find((p) => p.id === productId);
    if (!existing) throw new Error('Item do catálogo não encontrado.');

    const now = new Date().toISOString();
    existing.company_id = input.company_id;
    existing.group_id = input.group_id;
    existing.name = name;
    existing.offer_kind = input.offer_kind;
    // Mantém item_type alinhado ao token imutável se já criado, ou atualiza metadados
    existing.sku_code = skuCode;
    existing.base_price = Number(input.base_price.toFixed(2));
    existing.estimated_direct_cost = Number(input.estimated_direct_cost.toFixed(2));
    existing.payment_fee_pct = Number(input.payment_fee_pct.toFixed(3));
    existing.estimated_tax_pct = Number(input.estimated_tax_pct.toFixed(3));
    existing.description = input.description?.trim() || null;
    existing.updated_at = now;

    store.vault = store.vault.map((v) =>
      v.entity_id === productId && (v.entity_type === 'product' || v.entity_type === 'service')
        ? {
            ...v,
            real_label: name,
            sensitive_identifier: skuCode,
            secondary_aliases: skuCode ? [skuCode] : [],
            updated_at: now,
          }
        : v
    );
    appendSandboxAudit(
      store,
      tenantId,
      'entity.updated',
      existing.item_type,
      productId,
      existing.analytical_token,
      { offer_kind: input.offer_kind }
    );
    saveSandboxStore(store);
    return { ...existing };
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const { data, error } = await supabase
    .from('products_services')
    .update({
      company_id: input.company_id,
      group_id: input.group_id,
      name,
      offer_kind: input.offer_kind,
      sku_code: skuCode,
      base_price: input.base_price,
      estimated_direct_cost: input.estimated_direct_cost,
      payment_fee_pct: input.payment_fee_pct,
      estimated_tax_pct: input.estimated_tax_pct,
      description: input.description?.trim() || null,
    })
    .eq('id', productId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return {
    ...(data as ProductService),
    base_price: Number(data.base_price),
    estimated_direct_cost: Number(data.estimated_direct_cost),
    payment_fee_pct: Number(data.payment_fee_pct),
    estimated_tax_pct: Number(data.estimated_tax_pct),
  };
}

export async function deleteProductService(
  tenantId: string,
  userEmail: string,
  productId: string
): Promise<void> {
  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const existing = store.productsServices.find((p) => p.id === productId);
    if (!existing) return;

    store.productsServices = store.productsServices.filter((p) => p.id !== productId);
    store.transactions = store.transactions.map((t) =>
      t.product_service_id === productId ? { ...t, product_service_id: null } : t
    );
    store.vault = store.vault.map((v) =>
      v.entity_id === productId && (v.entity_type === 'product' || v.entity_type === 'service')
        ? { ...v, is_archived: true, updated_at: new Date().toISOString() }
        : v
    );
    appendSandboxAudit(
      store,
      tenantId,
      'entity.deleted',
      existing.item_type,
      productId,
      existing.analytical_token,
      { archived_in_vault: true }
    );
    saveSandboxStore(store);
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');
  const { error } = await supabase.from('products_services').delete().eq('id', productId);
  if (error) throw new Error(error.message);
}

// ============================================================================
// Módulo 2: Motor de Lançamentos Financeiros (Lote, Parcelamento, Baixa 1-clique)
// ============================================================================

export async function createTransactionsBatch(
  tenantId: string,
  userEmail: string,
  input: CreateTransactionInput
): Promise<Transaction[]> {
  const baseDesc = input.description.trim();
  if (baseDesc.length < 2) throw new Error('Informe uma descrição válida.');
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('O valor do lançamento deve ser maior que zero.');
  }
  if (input.transaction_type === 'transfer') {
    if (!input.destination_account_id || input.destination_account_id === input.account_id) {
      throw new Error('Selecione uma conta de destino distinta da conta de origem.');
    }
  }

  const occurrences =
    input.schedule_mode === 'single'
      ? 1
      : Math.min(60, Math.max(2, Math.floor(input.total_occurrences ?? 2)));
  const groupId = occurrences > 1 ? crypto.randomUUID() : null;
  const todayISO = getTodayISO();
  const now = new Date().toISOString();

  const rowsToCreate: Array<Omit<Transaction, 'id' | 'created_at' | 'updated_at'>> = [];

  for (let i = 0; i < occurrences; i++) {
    const dueDate = i === 0 ? input.due_date : addMonthsISO(input.due_date, i);
    const competenceDate =
      input.schedule_mode === 'recurring' ||
      (input.schedule_mode === 'installments' && input.competence_follows_installment)
        ? addMonthsISO(input.competence_date, i)
        : input.competence_date;

    const isPaid = i === 0 && input.status === 'paid';
    const paymentDate = isPaid ? (input.payment_date || dueDate || todayISO) : null;
    const status: TransactionStatus = isPaid
      ? 'paid'
      : dueDate < todayISO
        ? 'overdue'
        : 'pending';

    const desc =
      input.schedule_mode === 'installments'
        ? `${baseDesc} (${i + 1}/${occurrences})`
        : input.schedule_mode === 'recurring' && occurrences > 1
          ? `${baseDesc} (Rec. ${i + 1}/${occurrences})`
          : baseDesc;

    rowsToCreate.push({
      tenant_id: tenantId,
      company_id: input.company_id,
      account_id: input.account_id,
      destination_account_id:
        input.transaction_type === 'transfer' ? input.destination_account_id : null,
      category_id: input.category_id,
      product_service_id:
        input.transaction_type === 'transfer' ? null : input.product_service_id,
      project_id: input.transaction_type === 'transfer' ? null : (input.project_id ?? null),
      transaction_type: input.transaction_type,
      status,
      description: desc,
      counterparty_name:
        input.transaction_type === 'transfer' ? null : input.counterparty_name?.trim() || null,
      amount: Number(input.amount.toFixed(2)),
      competence_date: competenceDate,
      due_date: dueDate,
      payment_date: paymentDate,
      installment_group_id: groupId,
      installment_number: input.schedule_mode === 'installments' ? i + 1 : null,
      installment_total: input.schedule_mode === 'installments' ? occurrences : null,
      is_recurring: input.schedule_mode === 'recurring',
      recurrence_frequency: input.schedule_mode === 'recurring' ? 'monthly' : null,
      notes: input.notes?.trim() || null,
    });
  }

  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const created: Transaction[] = rowsToCreate.map((row) => ({
      ...row,
      id: crypto.randomUUID(),
      created_at: now,
      updated_at: now,
    }));
    store.transactions = [...created, ...store.transactions];
    appendSandboxAudit(store, tenantId, 'entity.created', 'transaction', created[0]?.id ?? null, null, {
      transaction_type: input.transaction_type,
      batch_count: created.length,
    });
    saveSandboxStore(store);
    return created;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const { data, error } = await supabase.from('transactions').insert(rowsToCreate).select();
  if (error) throw new Error(error.message);

  return ((data ?? []) as Array<Record<string, unknown>>).map((t) => ({
    ...(t as unknown as Transaction),
    amount: Number(t.amount ?? 0),
  }));
}

export async function markTransactionPaid(
  tenantId: string,
  userEmail: string,
  transactionId: string,
  paymentDate: string = getTodayISO()
): Promise<void> {
  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const tx = store.transactions.find((t) => t.id === transactionId);
    if (!tx) throw new Error('Lançamento não encontrado.');
    tx.status = 'paid';
    tx.payment_date = paymentDate;
    tx.updated_at = new Date().toISOString();
    appendSandboxAudit(store, tenantId, 'entity.updated', 'transaction', transactionId, null, {
      action: 'settled',
      payment_date: paymentDate,
    });
    saveSandboxStore(store);
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const { error } = await supabase
    .from('transactions')
    .update({ status: 'paid', payment_date: paymentDate })
    .eq('id', transactionId);
  if (error) throw new Error(error.message);
}

export async function reopenTransactionPending(
  tenantId: string,
  userEmail: string,
  transactionId: string
): Promise<void> {
  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const tx = store.transactions.find((t) => t.id === transactionId);
    if (!tx) throw new Error('Lançamento não encontrado.');
    const todayISO = getTodayISO();
    tx.status = tx.due_date < todayISO ? 'overdue' : 'pending';
    tx.payment_date = null;
    tx.updated_at = new Date().toISOString();
    saveSandboxStore(store);
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const { error } = await supabase
    .from('transactions')
    .update({ status: 'pending', payment_date: null })
    .eq('id', transactionId);
  if (error) throw new Error(error.message);
}

export async function deleteTransaction(
  tenantId: string,
  userEmail: string,
  transactionId: string
): Promise<void> {
  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    store.transactions = store.transactions.filter((t) => t.id !== transactionId);
    appendSandboxAudit(store, tenantId, 'entity.deleted', 'transaction', transactionId, null, {});
    saveSandboxStore(store);
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');
  const { error } = await supabase.from('transactions').delete().eq('id', transactionId);
  if (error) throw new Error(error.message);
}

export async function fetchAccountBalancesByContext(
  activeContext: ActiveContext
): Promise<AccountBalanceSummary[] | null> {
  if (!isSupabaseConfigured) return null;
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const entityId =
    activeContext.scope === 'group'
      ? activeContext.groupId
      : activeContext.scope === 'company'
        ? activeContext.companyId
        : activeContext.scope === 'account'
          ? activeContext.accountId
          : null;

  const { data, error } = await supabase.rpc('get_account_balances_by_context', {
    p_scope: activeContext.scope,
    p_entity_id: entityId,
  });

  if (error || !data) return null;
  return (data as Array<Record<string, unknown>>).map((row) => ({
    account_id: String(row.account_id),
    company_id: String(row.company_id),
    group_id: row.group_id ? String(row.group_id) : null,
    account_name: String(row.account_name),
    analytical_token: String(row.analytical_token),
    current_balance: Number(row.current_balance ?? 0),
    projected_balance: Number(row.projected_balance ?? 0),
  }));
}

// ============================================================================
// Módulo 3: Projetos, Premissas Futuras e Clonagem de Cenários
// ============================================================================

export async function createProject(
  tenantId: string,
  userEmail: string,
  input: CreateProjectInput
): Promise<Project> {
  const name = input.name.trim();
  if (name.length < 2) throw new Error('Informe um nome com ao menos 2 caracteres.');
  if (!input.company_id) throw new Error('Selecione uma empresa para o projeto.');
  if (input.planned_end_date < input.planned_start_date) {
    throw new Error('A data de fim prevista deve ser igual ou posterior à data de início.');
  }

  const initialInvestment = Math.max(0, Number(input.initial_investment) || 0);
  const monthlyFixedCost = Math.max(0, Number(input.monthly_fixed_cost_allocation) || 0);
  const activeScenario: ProjectScenarioType = input.active_scenario ?? 'realistic';

  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const now = new Date().toISOString();
    const token = nextSandboxToken(store, 'project');
    const id = crypto.randomUUID();
    const project: Project = {
      id,
      tenant_id: tenantId,
      company_id: input.company_id,
      name,
      hypothesis: input.hypothesis?.trim() || null,
      status: input.status,
      active_scenario: activeScenario,
      planned_start_date: input.planned_start_date,
      planned_end_date: input.planned_end_date,
      initial_investment: Number(initialInvestment.toFixed(2)),
      monthly_fixed_cost_allocation: Number(monthlyFixedCost.toFixed(2)),
      analytical_token: token,
      is_active: true,
      created_at: now,
      updated_at: now,
    };

    store.projects.unshift(project);
    store.vault.push({
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      entity_type: 'project',
      entity_id: id,
      analytical_token: token,
      real_label: name,
      sensitive_identifier: null,
      secondary_aliases: [],
      is_archived: false,
      created_at: now,
      updated_at: now,
    });
    appendSandboxAudit(store, tenantId, 'entity.created', 'project', id, token, {
      status: input.status,
      scenario: activeScenario,
    });
    saveSandboxStore(store);
    return project;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const { data, error } = await supabase
    .from('projects')
    .insert({
      tenant_id: tenantId,
      company_id: input.company_id,
      name,
      hypothesis: input.hypothesis?.trim() || null,
      status: input.status,
      active_scenario: activeScenario,
      planned_start_date: input.planned_start_date,
      planned_end_date: input.planned_end_date,
      initial_investment: Number(initialInvestment.toFixed(2)),
      monthly_fixed_cost_allocation: Number(monthlyFixedCost.toFixed(2)),
      analytical_token: 'PENDING',
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  const row = data as Record<string, unknown>;
  return {
    ...(row as unknown as Project),
    initial_investment: Number(row.initial_investment ?? 0),
    monthly_fixed_cost_allocation: Number(row.monthly_fixed_cost_allocation ?? 0),
  };
}

export async function updateProject(
  tenantId: string,
  userEmail: string,
  projectId: string,
  patch: UpdateProjectInput
): Promise<void> {
  if (
    patch.planned_start_date &&
    patch.planned_end_date &&
    patch.planned_end_date < patch.planned_start_date
  ) {
    throw new Error('A data de fim prevista deve ser igual ou posterior à data de início.');
  }

  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const project = store.projects.find((p) => p.id === projectId);
    if (!project) throw new Error('Projeto não encontrado.');

    const now = new Date().toISOString();
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (trimmed.length < 2) throw new Error('Nome do projeto deve ter ao menos 2 caracteres.');
      project.name = trimmed;
    }
    if (patch.hypothesis !== undefined) project.hypothesis = patch.hypothesis?.trim() || null;
    if (patch.status !== undefined) project.status = patch.status;
    if (patch.active_scenario !== undefined) project.active_scenario = patch.active_scenario;
    if (patch.planned_start_date !== undefined) project.planned_start_date = patch.planned_start_date;
    if (patch.planned_end_date !== undefined) project.planned_end_date = patch.planned_end_date;
    if (patch.initial_investment !== undefined) {
      project.initial_investment = Number(Math.max(0, patch.initial_investment).toFixed(2));
    }
    if (patch.monthly_fixed_cost_allocation !== undefined) {
      project.monthly_fixed_cost_allocation = Number(
        Math.max(0, patch.monthly_fixed_cost_allocation).toFixed(2)
      );
    }
    project.updated_at = now;

    if (patch.name !== undefined) {
      store.vault = store.vault.map((v) =>
        v.entity_type === 'project' && v.entity_id === projectId
          ? { ...v, real_label: project.name, updated_at: now }
          : v
      );
    }

    appendSandboxAudit(store, tenantId, 'entity.updated', 'project', projectId, project.analytical_token, {
      status: project.status,
      scenario: project.active_scenario,
    });
    saveSandboxStore(store);
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) payload.name = patch.name.trim();
  if (patch.hypothesis !== undefined) payload.hypothesis = patch.hypothesis?.trim() || null;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.active_scenario !== undefined) payload.active_scenario = patch.active_scenario;
  if (patch.planned_start_date !== undefined) payload.planned_start_date = patch.planned_start_date;
  if (patch.planned_end_date !== undefined) payload.planned_end_date = patch.planned_end_date;
  if (patch.initial_investment !== undefined) {
    payload.initial_investment = Number(Math.max(0, patch.initial_investment).toFixed(2));
  }
  if (patch.monthly_fixed_cost_allocation !== undefined) {
    payload.monthly_fixed_cost_allocation = Number(
      Math.max(0, patch.monthly_fixed_cost_allocation).toFixed(2)
    );
  }

  const { error } = await supabase.from('projects').update(payload).eq('id', projectId);
  if (error) throw new Error(error.message);
}

export async function deleteProject(
  tenantId: string,
  userEmail: string,
  projectId: string
): Promise<void> {
  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const project = store.projects.find((p) => p.id === projectId);
    if (!project) return;

    const now = new Date().toISOString();
    store.projects = store.projects.filter((p) => p.id !== projectId);
    store.projectForecastItems = store.projectForecastItems.filter(
      (f) => f.project_id !== projectId
    );
    store.transactions = store.transactions.map((t) =>
      t.project_id === projectId ? { ...t, project_id: null, updated_at: now } : t
    );
    store.vault = store.vault.map((v) =>
      v.entity_type === 'project' && v.entity_id === projectId
        ? { ...v, is_archived: true, updated_at: now }
        : v
    );
    appendSandboxAudit(store, tenantId, 'entity.deleted', 'project', projectId, project.analytical_token, {
      archived_in_vault: true,
    });
    saveSandboxStore(store);
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');
  const { error } = await supabase.from('projects').delete().eq('id', projectId);
  if (error) throw new Error(error.message);
}

export async function createProjectForecastItem(
  tenantId: string,
  userEmail: string,
  input: CreateProjectForecastInput
): Promise<ProjectForecastItem> {
  const label = input.label.trim();
  if (label.length < 2) throw new Error('Informe uma descrição com ao menos 2 caracteres.');

  const monthNormalized = `${input.month_date.slice(0, 7)}-01`;
  const qty = Math.max(0.01, Number(input.quantity) || 1);
  const unitPrice = Math.max(0, Number(input.unit_price) || 0);
  const unitDirectCost = Math.max(0, Number(input.unit_direct_cost) || 0);
  const feePct = Math.min(100, Math.max(0, Number(input.payment_fee_pct) || 0));
  const taxPct = Math.min(100, Math.max(0, Number(input.tax_rate_pct) || 0));

  const totals = computeForecastLineTotals({
    direction: input.direction,
    quantity: qty,
    unitPrice,
    unitDirectCost,
    paymentFeePct: feePct,
    taxRatePct: taxPct,
    explicitAmount: input.explicit_amount,
  });

  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const now = new Date().toISOString();
    const item: ProjectForecastItem = {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      project_id: input.project_id,
      scenario: input.scenario,
      month_date: monthNormalized,
      product_service_id: input.product_service_id,
      direction: input.direction,
      label,
      quantity: Number(qty.toFixed(2)),
      unit_price: Number(unitPrice.toFixed(2)),
      unit_direct_cost: Number(unitDirectCost.toFixed(2)),
      payment_fee_pct: Number(feePct.toFixed(3)),
      tax_rate_pct: Number(taxPct.toFixed(3)),
      gross_amount: totals.grossAmount,
      estimated_direct_cost_total: totals.estimatedDirectCostTotal,
      estimated_deductions_total: totals.estimatedDeductionsTotal,
      notes: input.notes?.trim() || null,
      created_at: now,
      updated_at: now,
    };
    store.projectForecastItems.push(item);
    saveSandboxStore(store);
    return item;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const { data, error } = await supabase
    .from('project_forecast_items')
    .insert({
      tenant_id: tenantId,
      project_id: input.project_id,
      scenario: input.scenario,
      month_date: monthNormalized,
      product_service_id: input.product_service_id,
      direction: input.direction,
      label,
      quantity: Number(qty.toFixed(2)),
      unit_price: Number(unitPrice.toFixed(2)),
      unit_direct_cost: Number(unitDirectCost.toFixed(2)),
      payment_fee_pct: Number(feePct.toFixed(3)),
      tax_rate_pct: Number(taxPct.toFixed(3)),
      gross_amount: totals.grossAmount,
      estimated_direct_cost_total: totals.estimatedDirectCostTotal,
      estimated_deductions_total: totals.estimatedDeductionsTotal,
      notes: input.notes?.trim() || null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  const row = data as Record<string, unknown>;
  return {
    ...(row as unknown as ProjectForecastItem),
    quantity: Number(row.quantity ?? 1),
    unit_price: Number(row.unit_price ?? 0),
    unit_direct_cost: Number(row.unit_direct_cost ?? 0),
    payment_fee_pct: Number(row.payment_fee_pct ?? 0),
    tax_rate_pct: Number(row.tax_rate_pct ?? 0),
    gross_amount: Number(row.gross_amount ?? 0),
    estimated_direct_cost_total: Number(row.estimated_direct_cost_total ?? 0),
    estimated_deductions_total: Number(row.estimated_deductions_total ?? 0),
  };
}

export async function deleteProjectForecastItem(
  tenantId: string,
  userEmail: string,
  itemId: string
): Promise<void> {
  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    store.projectForecastItems = store.projectForecastItems.filter((f) => f.id !== itemId);
    saveSandboxStore(store);
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');
  const { error } = await supabase.from('project_forecast_items').delete().eq('id', itemId);
  if (error) throw new Error(error.message);
}

export async function cloneProjectScenario(
  tenantId: string,
  userEmail: string,
  params: {
    projectId: string;
    sourceScenario: ProjectScenarioType;
    targetScenario: ProjectScenarioType;
    profile: ScenarioCloneProfile;
  }
): Promise<number> {
  const { projectId, sourceScenario, targetScenario, profile } = params;
  if (sourceScenario === targetScenario) {
    throw new Error('Escolha um cenário de destino diferente do cenário de origem.');
  }

  const revenueFactor = profile === 'conservative' ? 0.75 : profile === 'optimistic' ? 1.25 : 1;
  const costFactor = profile === 'conservative' ? 1.1 : profile === 'optimistic' ? 0.95 : 1;

  const transformItem = (item: ProjectForecastItem) => {
    if (item.direction === 'revenue') {
      const scaledQty = Math.max(0.1, Number((item.quantity * revenueFactor).toFixed(2)));
      const scaledDirectCost = Number((item.unit_direct_cost * costFactor).toFixed(2));
      const totals = computeForecastLineTotals({
        direction: 'revenue',
        quantity: scaledQty,
        unitPrice: item.unit_price,
        unitDirectCost: scaledDirectCost,
        paymentFeePct: item.payment_fee_pct,
        taxRatePct: item.tax_rate_pct,
      });
      return {
        quantity: scaledQty,
        unit_price: item.unit_price,
        unit_direct_cost: scaledDirectCost,
        gross_amount: totals.grossAmount,
        estimated_direct_cost_total: totals.estimatedDirectCostTotal,
        estimated_deductions_total: totals.estimatedDeductionsTotal,
      };
    }

    const scaledAmount = Number((item.gross_amount * costFactor).toFixed(2));
    return {
      quantity: item.quantity,
      unit_price: item.unit_price,
      unit_direct_cost: item.unit_direct_cost,
      gross_amount: scaledAmount,
      estimated_direct_cost_total: 0,
      estimated_deductions_total: 0,
    };
  };

  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const sourceItems = store.projectForecastItems.filter(
      (f) => f.project_id === projectId && f.scenario === sourceScenario
    );
    const now = new Date().toISOString();

    // Substitui itens anteriores do cenário de destino para evitar duplicatas ao re-clonar
    store.projectForecastItems = store.projectForecastItems.filter(
      (f) => !(f.project_id === projectId && f.scenario === targetScenario)
    );

    const cloned: ProjectForecastItem[] = sourceItems.map((item) => {
      const scaled = transformItem(item);
      return {
        ...item,
        id: crypto.randomUUID(),
        scenario: targetScenario,
        ...scaled,
        created_at: now,
        updated_at: now,
      };
    });

    store.projectForecastItems.push(...cloned);
    const project = store.projects.find((p) => p.id === projectId);
    if (project) {
      project.active_scenario = targetScenario;
      project.updated_at = now;
    }
    saveSandboxStore(store);
    return cloned.length;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const { data: sourceData, error: fetchErr } = await supabase
    .from('project_forecast_items')
    .select('*')
    .eq('project_id', projectId)
    .eq('scenario', sourceScenario);
  if (fetchErr) throw new Error(fetchErr.message);

  const sourceRows = ((sourceData ?? []) as Array<Record<string, unknown>>).map((f) => ({
    ...(f as unknown as ProjectForecastItem),
    quantity: Number(f.quantity ?? 1),
    unit_price: Number(f.unit_price ?? 0),
    unit_direct_cost: Number(f.unit_direct_cost ?? 0),
    payment_fee_pct: Number(f.payment_fee_pct ?? 0),
    tax_rate_pct: Number(f.tax_rate_pct ?? 0),
    gross_amount: Number(f.gross_amount ?? 0),
    estimated_direct_cost_total: Number(f.estimated_direct_cost_total ?? 0),
    estimated_deductions_total: Number(f.estimated_deductions_total ?? 0),
  }));

  const { error: delErr } = await supabase
    .from('project_forecast_items')
    .delete()
    .eq('project_id', projectId)
    .eq('scenario', targetScenario);
  if (delErr) throw new Error(delErr.message);

  if (sourceRows.length > 0) {
    const insertRows = sourceRows.map((item) => {
      const scaled = transformItem(item);
      return {
        tenant_id: tenantId,
        project_id: projectId,
        scenario: targetScenario,
        month_date: item.month_date,
        product_service_id: item.product_service_id,
        direction: item.direction,
        label: item.label,
        quantity: scaled.quantity,
        unit_price: scaled.unit_price,
        unit_direct_cost: scaled.unit_direct_cost,
        payment_fee_pct: item.payment_fee_pct,
        tax_rate_pct: item.tax_rate_pct,
        gross_amount: scaled.gross_amount,
        estimated_direct_cost_total: scaled.estimated_direct_cost_total,
        estimated_deductions_total: scaled.estimated_deductions_total,
        notes: item.notes,
      };
    });

    const { error: insErr } = await supabase.from('project_forecast_items').insert(insertRows);
    if (insErr) throw new Error(insErr.message);
  }

  await supabase
    .from('projects')
    .update({ active_scenario: targetScenario })
    .eq('id', projectId);

  return sourceRows.length;
}

// ============================================================================
// Módulo 4: Dívidas, Parcelamentos (SAC/Price) & Obrigações Fiscais
// ============================================================================

export interface CreateDebtInput {
  company_id: string;
  account_id: string | null;
  title: string;
  creditor_name: string;
  contract_code?: string;
  debt_kind: DebtKind;
  amortization_system: AmortizationSystem;
  principal_amount: number;
  monthly_interest_rate_pct: number;
  total_installments: number;
  first_due_date: string;
  notes?: string;
}

export async function createDebtWithSchedule(
  tenantId: string,
  userEmail: string,
  input: CreateDebtInput
): Promise<{ debt: Debt; installments: DebtInstallment[] }> {
  const title = input.title.trim();
  const creditorName = input.creditor_name.trim();
  if (title.length < 2) throw new Error('Informe um título com ao menos 2 caracteres.');
  if (creditorName.length < 2) throw new Error('Informe o nome do credor/instituição.');
  if (!input.company_id) throw new Error('Selecione a empresa tomadora da dívida.');
  if (!Number.isFinite(input.principal_amount) || input.principal_amount <= 0) {
    throw new Error('O valor principal deve ser maior que zero.');
  }

  const principal = roundCurrency(input.principal_amount);
  const monthlyRatePct = Math.min(100, Math.max(0, Number(input.monthly_interest_rate_pct) || 0));
  const totalInstallments = Math.min(
    360,
    Math.max(1, Math.floor(Number(input.total_installments) || 1))
  );
  const contractCode = input.contract_code?.trim() || null;

  const schedule = calculateAmortizationSchedule({
    principal,
    monthlyInterestRatePct: monthlyRatePct,
    totalInstallments,
    system: input.amortization_system,
    firstDueDate: input.first_due_date,
  });

  const todayISO = getTodayISO();

  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const now = new Date().toISOString();
    const token = nextSandboxToken(store, 'creditor');
    const debtId = crypto.randomUUID();

    const debt: Debt = {
      id: debtId,
      tenant_id: tenantId,
      company_id: input.company_id,
      account_id: input.account_id || null,
      title,
      creditor_name: creditorName,
      contract_code: contractCode,
      debt_kind: input.debt_kind,
      amortization_system: input.amortization_system,
      principal_amount: principal,
      monthly_interest_rate_pct: Number(monthlyRatePct.toFixed(4)),
      total_installments: totalInstallments,
      first_due_date: input.first_due_date,
      status: 'active',
      creditor_token: token,
      notes: input.notes?.trim() || null,
      created_at: now,
      updated_at: now,
    };

    const installments: DebtInstallment[] = schedule.rows.map((row) => ({
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      debt_id: debtId,
      installment_number: row.installment_number,
      due_date: row.due_date,
      principal_portion: row.principal_portion,
      interest_portion: row.interest_portion,
      total_amount: row.total_amount,
      remaining_balance: row.remaining_balance,
      status: row.due_date < todayISO ? 'overdue' : 'pending',
      paid_date: null,
      transaction_id: null,
      created_at: now,
      updated_at: now,
    }));

    store.debts.unshift(debt);
    store.debtInstallments.push(...installments);
    store.vault.push({
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      entity_type: 'creditor',
      entity_id: debtId,
      analytical_token: token,
      real_label: creditorName,
      sensitive_identifier: contractCode,
      secondary_aliases: contractCode ? [contractCode] : [],
      is_archived: false,
      created_at: now,
      updated_at: now,
    });
    appendSandboxAudit(store, tenantId, 'entity.created', 'creditor', debtId, token, {
      system: input.amortization_system,
      installments: totalInstallments,
    });
    saveSandboxStore(store);
    return { debt, installments };
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const { data: debtData, error: debtErr } = await supabase
    .from('debts')
    .insert({
      tenant_id: tenantId,
      company_id: input.company_id,
      account_id: input.account_id || null,
      title,
      creditor_name: creditorName,
      contract_code: contractCode,
      debt_kind: input.debt_kind,
      amortization_system: input.amortization_system,
      principal_amount: principal,
      monthly_interest_rate_pct: Number(monthlyRatePct.toFixed(4)),
      total_installments: totalInstallments,
      first_due_date: input.first_due_date,
      status: 'active',
      creditor_token: 'PENDING',
      notes: input.notes?.trim() || null,
    })
    .select()
    .single();

  if (debtErr || !debtData) throw new Error(debtErr?.message ?? 'Erro ao cadastrar dívida.');

  const debtRow = debtData as Record<string, unknown>;
  const createdDebt: Debt = {
    ...(debtRow as unknown as Debt),
    principal_amount: Number(debtRow.principal_amount ?? principal),
    monthly_interest_rate_pct: Number(debtRow.monthly_interest_rate_pct ?? monthlyRatePct),
    total_installments: Number(debtRow.total_installments ?? totalInstallments),
  };

  const instPayload = schedule.rows.map((row) => ({
    tenant_id: tenantId,
    debt_id: createdDebt.id,
    installment_number: row.installment_number,
    due_date: row.due_date,
    principal_portion: row.principal_portion,
    interest_portion: row.interest_portion,
    total_amount: row.total_amount,
    remaining_balance: row.remaining_balance,
    status: row.due_date < todayISO ? 'overdue' : 'pending',
  }));

  const { data: instData, error: instErr } = await supabase
    .from('debt_installments')
    .insert(instPayload)
    .select();

  if (instErr) throw new Error(instErr.message);

  const createdInstallments: DebtInstallment[] = (
    (instData ?? []) as Array<Record<string, unknown>>
  ).map((inst) => ({
    ...(inst as unknown as DebtInstallment),
    installment_number: Number(inst.installment_number ?? 1),
    principal_portion: Number(inst.principal_portion ?? 0),
    interest_portion: Number(inst.interest_portion ?? 0),
    total_amount: Number(inst.total_amount ?? 0),
    remaining_balance: Number(inst.remaining_balance ?? 0),
  }));

  return { debt: createdDebt, installments: createdInstallments };
}

export async function payDebtInstallment(
  tenantId: string,
  userEmail: string,
  params: {
    installmentId: string;
    accountId: string;
    paymentDate?: string;
  }
): Promise<void> {
  const payDate = params.paymentDate || getTodayISO();

  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const inst = store.debtInstallments.find((i) => i.id === params.installmentId);
    if (!inst) throw new Error('Parcela não encontrada.');
    if (inst.status === 'paid') throw new Error('Esta parcela já foi baixada.');

    const debt = store.debts.find((d) => d.id === inst.debt_id);
    if (!debt) throw new Error('Contrato de dívida não encontrado.');

    const account = store.accounts.find(
      (a) => a.id === params.accountId && a.company_id === debt.company_id
    );
    if (!account) throw new Error('Selecione uma conta financeira válida da empresa.');

    const findCatId = (code: string) =>
      store.categories.find((c) => c.company_id === debt.company_id && c.code === code)?.id ?? null;

    const interestCatId = findCatId('8.2');
    const principalCatId = findCatId('7.2');
    const now = new Date().toISOString();
    let linkedTxId: string | null = null;

    // 1. Parcela de Juros vai para Resultado Financeiro (8.2 -> DRE Linha 8)
    if (inst.interest_portion > 0) {
      const interestTxId = crypto.randomUUID();
      linkedTxId = interestTxId;
      store.transactions.unshift({
        id: interestTxId,
        tenant_id: tenantId,
        company_id: debt.company_id,
        account_id: account.id,
        destination_account_id: null,
        category_id: interestCatId,
        product_service_id: null,
        project_id: null,
        transaction_type: 'expense',
        status: 'paid',
        description: `Juros · ${debt.title} (${inst.installment_number}/${debt.total_installments})`,
        counterparty_name: debt.creditor_name,
        amount: inst.interest_portion,
        competence_date: inst.due_date,
        due_date: inst.due_date,
        payment_date: payDate,
        installment_group_id: null,
        installment_number: inst.installment_number,
        installment_total: debt.total_installments,
        is_recurring: false,
        recurrence_frequency: null,
        notes: `Credor ${debt.creditor_token} · Encargos financeiros`,
        created_at: now,
        updated_at: now,
      });
    }

    // 2. Amortização de Principal reduz saldo bancário (7.2 -> neutro na DRE operacional)
    if (inst.principal_portion > 0) {
      const principalTxId = crypto.randomUUID();
      if (!linkedTxId) linkedTxId = principalTxId;
      store.transactions.unshift({
        id: principalTxId,
        tenant_id: tenantId,
        company_id: debt.company_id,
        account_id: account.id,
        destination_account_id: null,
        category_id: principalCatId,
        product_service_id: null,
        project_id: null,
        transaction_type: 'expense',
        status: 'paid',
        description: `Amortização Principal · ${debt.title} (${inst.installment_number}/${debt.total_installments})`,
        counterparty_name: debt.creditor_name,
        amount: inst.principal_portion,
        competence_date: inst.due_date,
        due_date: inst.due_date,
        payment_date: payDate,
        installment_group_id: null,
        installment_number: inst.installment_number,
        installment_total: debt.total_installments,
        is_recurring: false,
        recurrence_frequency: null,
        notes: `Credor ${debt.creditor_token} · Amortização de passivo`,
        created_at: now,
        updated_at: now,
      });
    }

    inst.status = 'paid';
    inst.paid_date = payDate;
    inst.transaction_id = linkedTxId;
    inst.updated_at = now;

    const allPaid = store.debtInstallments
      .filter((i) => i.debt_id === debt.id)
      .every((i) => i.status === 'paid' || i.status === 'canceled');
    if (allPaid) {
      debt.status = 'settled';
      debt.updated_at = now;
    }

    appendSandboxAudit(store, tenantId, 'entity.updated', 'debt_installment', inst.id, debt.creditor_token, {
      installment_number: inst.installment_number,
      payment_date: payDate,
    });
    saveSandboxStore(store);
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const { data: instRow, error: instFetchErr } = await supabase
    .from('debt_installments')
    .select('*')
    .eq('id', params.installmentId)
    .single();
  if (instFetchErr || !instRow) throw new Error(instFetchErr?.message ?? 'Parcela não encontrada.');
  if (instRow.status === 'paid') throw new Error('Esta parcela já foi baixada.');

  const { data: debtRow, error: debtFetchErr } = await supabase
    .from('debts')
    .select('*')
    .eq('id', instRow.debt_id)
    .single();
  if (debtFetchErr || !debtRow) throw new Error(debtFetchErr?.message ?? 'Dívida não encontrada.');

  const { data: catsData } = await supabase
    .from('categories')
    .select('id, code')
    .eq('company_id', debtRow.company_id)
    .in('code', ['8.2', '7.2']);
  const interestCatId = catsData?.find((c) => c.code === '8.2')?.id ?? null;
  const principalCatId = catsData?.find((c) => c.code === '7.2')?.id ?? null;

  const txInserts: Array<Record<string, unknown>> = [];
  const interestPortion = Number(instRow.interest_portion ?? 0);
  const principalPortion = Number(instRow.principal_portion ?? 0);

  if (interestPortion > 0) {
    txInserts.push({
      tenant_id: tenantId,
      company_id: debtRow.company_id,
      account_id: params.accountId,
      category_id: interestCatId,
      transaction_type: 'expense',
      status: 'paid',
      description: `Juros · ${debtRow.title} (${instRow.installment_number}/${debtRow.total_installments})`,
      counterparty_name: debtRow.creditor_name,
      amount: interestPortion,
      competence_date: instRow.due_date,
      due_date: instRow.due_date,
      payment_date: payDate,
      installment_number: instRow.installment_number,
      installment_total: debtRow.total_installments,
      notes: `Credor ${debtRow.creditor_token} · Encargos financeiros`,
    });
  }

  if (principalPortion > 0) {
    txInserts.push({
      tenant_id: tenantId,
      company_id: debtRow.company_id,
      account_id: params.accountId,
      category_id: principalCatId,
      transaction_type: 'expense',
      status: 'paid',
      description: `Amortização Principal · ${debtRow.title} (${instRow.installment_number}/${debtRow.total_installments})`,
      counterparty_name: debtRow.creditor_name,
      amount: principalPortion,
      competence_date: instRow.due_date,
      due_date: instRow.due_date,
      payment_date: payDate,
      installment_number: instRow.installment_number,
      installment_total: debtRow.total_installments,
      notes: `Credor ${debtRow.creditor_token} · Amortização de passivo`,
    });
  }

  let linkedTxId: string | null = null;
  if (txInserts.length > 0) {
    const { data: createdTxs, error: txErr } = await supabase
      .from('transactions')
      .insert(txInserts)
      .select('id');
    if (txErr) throw new Error(txErr.message);
    linkedTxId = createdTxs?.[0]?.id ?? null;
  }

  const { error: updInstErr } = await supabase
    .from('debt_installments')
    .update({ status: 'paid', paid_date: payDate, transaction_id: linkedTxId })
    .eq('id', params.installmentId);
  if (updInstErr) throw new Error(updInstErr.message);

  const { data: openInsts } = await supabase
    .from('debt_installments')
    .select('id')
    .eq('debt_id', debtRow.id)
    .in('status', ['pending', 'overdue']);
  if (!openInsts || openInsts.length === 0) {
    await supabase.from('debts').update({ status: 'settled' }).eq('id', debtRow.id);
  }
}

export async function deleteDebt(
  tenantId: string,
  userEmail: string,
  debtId: string
): Promise<void> {
  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const debt = store.debts.find((d) => d.id === debtId);
    if (!debt) return;
    const now = new Date().toISOString();
    store.debts = store.debts.filter((d) => d.id !== debtId);
    store.debtInstallments = store.debtInstallments.filter((i) => i.debt_id !== debtId);
    store.vault = store.vault.map((v) =>
      v.entity_type === 'creditor' && v.entity_id === debtId
        ? { ...v, is_archived: true, updated_at: now }
        : v
    );
    appendSandboxAudit(store, tenantId, 'entity.deleted', 'creditor', debtId, debt.creditor_token, {
      archived_in_vault: true,
    });
    saveSandboxStore(store);
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');
  const { error } = await supabase.from('debts').delete().eq('id', debtId);
  if (error) throw new Error(error.message);
}

export interface CreateTaxObligationInput {
  company_id: string;
  account_id: string | null;
  tax_name: string;
  tax_type: TaxType;
  competence_month: string; // YYYY-MM or YYYY-MM-DD
  due_date: string;
  revenue_base_amount: number;
  estimated_rate_pct: number;
  amount: number;
  is_recurring: boolean;
  guide_reference?: string;
  notes?: string;
}

export async function createTaxObligation(
  tenantId: string,
  userEmail: string,
  input: CreateTaxObligationInput
): Promise<TaxObligation> {
  const taxName = input.tax_name.trim();
  if (taxName.length < 2) throw new Error('Informe o nome da guia ou tributo.');
  if (!input.company_id) throw new Error('Selecione a empresa contribuinte.');
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    throw new Error('O valor da guia fiscal não pode ser negativo.');
  }

  const normalizedMonth = `${input.competence_month.slice(0, 7)}-01`;
  const todayISO = getTodayISO();
  const status = input.due_date < todayISO ? 'overdue' : 'pending';
  const amount = roundCurrency(input.amount);
  const revBase = roundCurrency(Math.max(0, Number(input.revenue_base_amount) || 0));
  const ratePct = Number(Math.min(100, Math.max(0, Number(input.estimated_rate_pct) || 0)).toFixed(3));

  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const now = new Date().toISOString();
    const item: TaxObligation = {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      company_id: input.company_id,
      account_id: input.account_id || null,
      tax_name: taxName,
      tax_type: input.tax_type,
      competence_month: normalizedMonth,
      due_date: input.due_date,
      revenue_base_amount: revBase,
      estimated_rate_pct: ratePct,
      amount,
      status,
      paid_date: null,
      is_recurring: input.is_recurring,
      guide_reference: input.guide_reference?.trim() || null,
      transaction_id: null,
      notes: input.notes?.trim() || null,
      created_at: now,
      updated_at: now,
    };
    store.taxObligations.push(item);
    appendSandboxAudit(store, tenantId, 'entity.created', 'tax_obligation', item.id, null, {
      tax_type: input.tax_type,
      competence_month: normalizedMonth,
    });
    saveSandboxStore(store);
    return item;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const { data, error } = await supabase
    .from('tax_obligations')
    .insert({
      tenant_id: tenantId,
      company_id: input.company_id,
      account_id: input.account_id || null,
      tax_name: taxName,
      tax_type: input.tax_type,
      competence_month: normalizedMonth,
      due_date: input.due_date,
      revenue_base_amount: revBase,
      estimated_rate_pct: ratePct,
      amount,
      status,
      is_recurring: input.is_recurring,
      guide_reference: input.guide_reference?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? 'Erro ao criar guia fiscal.');
  const row = data as Record<string, unknown>;
  return {
    ...(row as unknown as TaxObligation),
    revenue_base_amount: Number(row.revenue_base_amount ?? 0),
    estimated_rate_pct: Number(row.estimated_rate_pct ?? 0),
    amount: Number(row.amount ?? 0),
  };
}

export async function payTaxObligation(
  tenantId: string,
  userEmail: string,
  params: {
    taxId: string;
    accountId: string;
    paymentDate?: string;
  }
): Promise<void> {
  const payDate = params.paymentDate || getTodayISO();

  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const tax = store.taxObligations.find((t) => t.id === params.taxId);
    if (!tax) throw new Error('Obrigação fiscal não encontrada.');
    if (tax.status === 'paid') throw new Error('Esta guia já está marcada como paga.');

    const account = store.accounts.find(
      (a) => a.id === params.accountId && a.company_id === tax.company_id
    );
    if (!account) throw new Error('Selecione uma conta financeira válida da empresa.');

    const taxCatId =
      store.categories.find((c) => c.company_id === tax.company_id && c.code === '2.1')?.id ?? null;

    const now = new Date().toISOString();
    const txId = crypto.randomUUID();
    store.transactions.unshift({
      id: txId,
      tenant_id: tenantId,
      company_id: tax.company_id,
      account_id: account.id,
      destination_account_id: null,
      category_id: taxCatId,
      product_service_id: null,
      project_id: null,
      transaction_type: 'expense',
      status: 'paid',
      description: `Guia Fiscal · ${tax.tax_name} (${tax.competence_month.slice(0, 7)})`,
      counterparty_name: 'Receita / Fazenda Pública',
      amount: tax.amount,
      competence_date: tax.competence_month,
      due_date: tax.due_date,
      payment_date: payDate,
      installment_group_id: null,
      installment_number: null,
      installment_total: null,
      is_recurring: tax.is_recurring,
      recurrence_frequency: tax.is_recurring ? 'monthly' : null,
      notes: tax.guide_reference ? `Guia ${tax.guide_reference}` : null,
      created_at: now,
      updated_at: now,
    });

    tax.status = 'paid';
    tax.paid_date = payDate;
    tax.transaction_id = txId;
    tax.updated_at = now;

    appendSandboxAudit(store, tenantId, 'entity.updated', 'tax_obligation', tax.id, null, {
      action: 'paid',
      payment_date: payDate,
    });
    saveSandboxStore(store);
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const { data: taxRow, error: taxErr } = await supabase
    .from('tax_obligations')
    .select('*')
    .eq('id', params.taxId)
    .single();
  if (taxErr || !taxRow) throw new Error(taxErr?.message ?? 'Obrigação fiscal não encontrada.');
  if (taxRow.status === 'paid') throw new Error('Esta guia já está marcada como paga.');

  const { data: catRow } = await supabase
    .from('categories')
    .select('id')
    .eq('company_id', taxRow.company_id)
    .eq('code', '2.1')
    .maybeSingle();

  const { data: txData, error: txErr } = await supabase
    .from('transactions')
    .insert({
      tenant_id: tenantId,
      company_id: taxRow.company_id,
      account_id: params.accountId,
      category_id: catRow?.id ?? null,
      transaction_type: 'expense',
      status: 'paid',
      description: `Guia Fiscal · ${taxRow.tax_name} (${String(taxRow.competence_month).slice(0, 7)})`,
      counterparty_name: 'Receita / Fazenda Pública',
      amount: Number(taxRow.amount ?? 0),
      competence_date: taxRow.competence_month,
      due_date: taxRow.due_date,
      payment_date: payDate,
      is_recurring: Boolean(taxRow.is_recurring),
      recurrence_frequency: taxRow.is_recurring ? 'monthly' : null,
      notes: taxRow.guide_reference ? `Guia ${taxRow.guide_reference}` : null,
    })
    .select('id')
    .single();
  if (txErr) throw new Error(txErr.message);

  const { error: updErr } = await supabase
    .from('tax_obligations')
    .update({ status: 'paid', paid_date: payDate, transaction_id: txData?.id ?? null })
    .eq('id', params.taxId);
  if (updErr) throw new Error(updErr.message);
}

export async function deleteTaxObligation(
  tenantId: string,
  userEmail: string,
  taxId: string
): Promise<void> {
  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    store.taxObligations = store.taxObligations.filter((t) => t.id !== taxId);
    appendSandboxAudit(store, tenantId, 'entity.deleted', 'tax_obligation', taxId, null, {});
    saveSandboxStore(store);
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');
  const { error } = await supabase.from('tax_obligations').delete().eq('id', taxId);
  if (error) throw new Error(error.message);
}

// ============================================================================
// Convites & Segurança
// ============================================================================

export async function inviteUser(
  tenantId: string,
  userEmail: string,
  inviteEmail: string,
  role: AppRole
): Promise<InvitedUser> {
  const email = inviteEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('E-mail inválido para convite.');
  }

  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    if (store.invitedUsers.some((u) => u.email.toLowerCase() === email && u.is_active)) {
      throw new Error('Este e-mail já possui convite ativo.');
    }
    const invited: InvitedUser = {
      id: crypto.randomUUID(),
      email,
      role,
      is_active: true,
      accepted_at: null,
      created_at: new Date().toISOString(),
    };
    store.invitedUsers.unshift(invited);
    appendSandboxAudit(store, tenantId, 'invite.created', 'invited_user', invited.id, null, {
      role,
    });
    saveSandboxStore(store);
    return invited;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const { data, error } = await supabase
    .from('invited_users')
    .insert({ email, role, invited_by: tenantId, is_active: true })
    .select()
    .single();

  if (error) throw new Error(error.message);
  await supabase.rpc('log_security_event', {
    p_action: 'invite.created',
    p_entity_type: 'invited_user',
    p_metadata: { role },
  });
  return data as InvitedUser;
}

export async function revokeInvite(
  tenantId: string,
  userEmail: string,
  inviteId: string
): Promise<void> {
  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    store.invitedUsers = store.invitedUsers.map((u) =>
      u.id === inviteId ? { ...u, is_active: false } : u
    );
    appendSandboxAudit(store, tenantId, 'invite.revoked', 'invited_user', inviteId, null);
    saveSandboxStore(store);
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const { error } = await supabase
    .from('invited_users')
    .update({ is_active: false })
    .eq('id', inviteId);
  if (error) throw new Error(error.message);
}

export async function recordSecurityEvent(
  tenantId: string,
  userEmail: string,
  action: AuditAction,
  entityType: string,
  analyticalToken: string | null = null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    appendSandboxAudit(store, tenantId, action, entityType, null, analyticalToken, metadata);
    saveSandboxStore(store);
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) return;
  await supabase.rpc('log_security_event', {
    p_action: action,
    p_entity_type: entityType,
    p_analytical_token: analyticalToken,
    p_metadata: metadata,
  });
}

// ============================================================================
// Seed Sandbox (Módulo 1 + Módulo 2)
// ============================================================================

export async function seedSandboxExampleStructure(
  tenantId: string,
  userEmail: string
): Promise<void> {
  if (isSupabaseConfigured) return;

  const group = await createBusinessGroup(tenantId, userEmail, {
    name: 'Horizonte Participações',
    description: 'Holding de controle opcional para empresas do ramo de tecnologia e engenharia.',
  });

  const emp1 = await createCompany(tenantId, userEmail, {
    legal_name: 'Alpha Engenharia e Projetos Ltda',
    trade_name: 'Alpha Engenharia',
    cnpj: '12345678000190',
    tax_regime: 'Lucro Presumido',
    group_id: group.id,
  });

  const emp2 = await createCompany(tenantId, userEmail, {
    legal_name: 'Vértice Consultoria Independente ME',
    trade_name: 'Vértice Consultoria',
    cnpj: '45987654000122',
    tax_regime: 'Simples Nacional',
    group_id: null,
  });

  const acc1 = await createFinancialAccount(tenantId, userEmail, {
    company_id: emp1.id,
    name: 'Conta Corrente Itaú Matriz',
    account_type: 'checking',
    institution_name: 'Itaú Unibanco',
    currency: 'BRL',
    last_four: '4419',
  });

  const acc1Reserve = await createFinancialAccount(tenantId, userEmail, {
    company_id: emp1.id,
    name: 'Reserva CDB Itaú Liquidez',
    account_type: 'investment',
    institution_name: 'Itaú Unibanco',
    currency: 'BRL',
    last_four: '9012',
  });

  const acc2 = await createFinancialAccount(tenantId, userEmail, {
    company_id: emp2.id,
    name: 'Conta PJ Banco Inter',
    account_type: 'checking',
    institution_name: 'Banco Inter',
    currency: 'BRL',
    last_four: '8821',
  });

  // Produtos e Serviços de exemplo
  const prod1 = await createProductService(tenantId, userEmail, {
    company_id: emp1.id,
    group_id: null,
    name: 'Kit Automação Industrial IoT',
    offer_kind: 'physical_product',
    sku_code: 'KIT-IOT-400',
    base_price: 8500,
    estimated_direct_cost: 3400,
    payment_fee_pct: 2.9,
    estimated_tax_pct: 11.33,
    description: 'Controlador físico com telemetria embarcada.',
  });

  const prod2 = await createProductService(tenantId, userEmail, {
    company_id: null,
    group_id: group.id,
    name: 'Plataforma Gestão Cloud SaaS',
    offer_kind: 'digital_product',
    sku_code: 'SAAS-PRO',
    base_price: 2400,
    estimated_direct_cost: 280,
    payment_fee_pct: 3.49,
    estimated_tax_pct: 8.65,
    description: 'Assinatura mensal compartilhada entre empresas do grupo.',
  });

  const srv1 = await createProductService(tenantId, userEmail, {
    company_id: emp2.id,
    group_id: null,
    name: 'Consultoria de Eficiência Fiscal',
    offer_kind: 'service',
    sku_code: 'SRV-FISC',
    base_price: 12000,
    estimated_direct_cost: 2400,
    payment_fee_pct: 0.9,
    estimated_tax_pct: 6.0,
    description: 'Projeto consultivo sob medida para redução de passivo tributário.',
  });

  const store = loadSandboxStore(tenantId, userEmail);
  const findCat = (compId: string, code: string) =>
    store.categories.find((c) => c.company_id === compId && c.code === code)?.id ?? null;

  const today = getTodayISO();
  const prevMonthDate = addMonthsISO(today.slice(0, 7) + '-15', -1);
  const currMonthStart = today.slice(0, 7) + '-05';
  const overdueDate = addMonthsISO(today, 0).slice(0, 8) + '01';
  const safeOverdue = overdueDate < today ? overdueDate : addMonthsISO(today, -1);

  // Saldo anterior do mês passado (realizado)
  await createTransactionsBatch(tenantId, userEmail, {
    company_id: emp1.id,
    account_id: acc1.id,
    destination_account_id: null,
    category_id: findCat(emp1.id, '1.1'),
    product_service_id: prod1.id,
    transaction_type: 'income',
    status: 'paid',
    description: 'Faturamento Lote Inicial IoT',
    counterparty_name: 'Metalúrgica Paulista S.A.',
    amount: 42500,
    competence_date: prevMonthDate,
    due_date: prevMonthDate,
    payment_date: prevMonthDate,
    schedule_mode: 'single',
  });

  await createTransactionsBatch(tenantId, userEmail, {
    company_id: emp1.id,
    account_id: acc1.id,
    destination_account_id: null,
    category_id: findCat(emp1.id, '3.1'),
    product_service_id: prod1.id,
    transaction_type: 'expense',
    status: 'paid',
    description: 'Compra de Sensores & Placas Eletrônicas',
    counterparty_name: 'Distribuidora Componentes Sul',
    amount: 14200,
    competence_date: prevMonthDate,
    due_date: prevMonthDate,
    payment_date: prevMonthDate,
    schedule_mode: 'single',
  });

  // Lançamentos no mês atual (Receita paga + parcelada + atrasada + transferência interna)
  await createTransactionsBatch(tenantId, userEmail, {
    company_id: emp1.id,
    account_id: acc1.id,
    destination_account_id: null,
    category_id: findCat(emp1.id, '1.3'),
    product_service_id: prod2.id,
    transaction_type: 'income',
    status: 'paid',
    description: 'Assinatura Plataforma Gestão Cloud SaaS',
    counterparty_name: 'Rede Logística Atlântico',
    amount: 7200,
    competence_date: currMonthStart,
    due_date: currMonthStart,
    payment_date: today,
    schedule_mode: 'installments',
    total_occurrences: 3,
    competence_follows_installment: false,
  });

  await createTransactionsBatch(tenantId, userEmail, {
    company_id: emp1.id,
    account_id: acc1.id,
    destination_account_id: null,
    category_id: findCat(emp1.id, '4.1'),
    product_service_id: null,
    transaction_type: 'expense',
    status: 'pending',
    description: 'Folha Técnica & Encargos Mensais',
    counterparty_name: 'Equipe Engenharia CLT',
    amount: 16800,
    competence_date: today,
    due_date: addMonthsISO(today, 0),
    schedule_mode: 'single',
  });

  // Lançamento atrasado para demonstrar alerta automático
  await createTransactionsBatch(tenantId, userEmail, {
    company_id: emp1.id,
    account_id: acc1.id,
    destination_account_id: null,
    category_id: findCat(emp1.id, '3.2'),
    product_service_id: prod2.id,
    transaction_type: 'expense',
    status: 'pending',
    description: 'Fatura Servidores Cloud Produção',
    counterparty_name: 'Cloud Hosting Brasil Ltda',
    amount: 2850,
    competence_date: safeOverdue,
    due_date: safeOverdue,
    schedule_mode: 'single',
  });

  // Transferência interna entre Itaú Corrente e Itaú Reserva CDB (NÃO entra em receita/despesa)
  await createTransactionsBatch(tenantId, userEmail, {
    company_id: emp1.id,
    account_id: acc1.id,
    destination_account_id: acc1Reserve.id,
    category_id: findCat(emp1.id, '7.1'),
    product_service_id: null,
    transaction_type: 'transfer',
    status: 'paid',
    description: 'Aplicação Automática Reserva CDB',
    amount: 10000,
    competence_date: today,
    due_date: today,
    payment_date: today,
    schedule_mode: 'single',
  });

  // Lançamento da Empresa 2 (Independente)
  await createTransactionsBatch(tenantId, userEmail, {
    company_id: emp2.id,
    account_id: acc2.id,
    destination_account_id: null,
    category_id: findCat(emp2.id, '1.2'),
    product_service_id: srv1.id,
    transaction_type: 'income',
    status: 'paid',
    description: 'Honorários Consultoria Eficiência Fiscal',
    counterparty_name: 'Grupo Varejo Central',
    amount: 12000,
    competence_date: today,
    due_date: today,
    payment_date: today,
    schedule_mode: 'single',
  });

  // ============================================================================
  // Módulo 3: Projetos de Exemplo (Em Execução com Previsto vs. Realizado + Simulação)
  // ============================================================================
  const prjStart = addMonthsISO(today.slice(0, 7) + '-01', -1);
  const prjEnd = addMonthsISO(prjStart, 4);

  const prj1 = await createProject(tenantId, userEmail, {
    company_id: emp1.id,
    name: 'Expansão Linha Automação IoT Industrial',
    hypothesis:
      'Implantação de célula de montagem e vendas recorrentes B2B do Kit Automação IoT com payback abaixo de 4 meses.',
    status: 'in_progress',
    active_scenario: 'realistic',
    planned_start_date: prjStart,
    planned_end_date: prjEnd,
    initial_investment: 28000,
    monthly_fixed_cost_allocation: 2200,
  });

  // Premissas mensais (5 meses) vinculadas ao Kit Automação Industrial IoT
  const prj1Quantities = [2, 3, 4, 4, 5];
  for (let m = 0; m < prj1Quantities.length; m++) {
    const qty = prj1Quantities[m] ?? 2;
    const monthDate = addMonthsISO(prjStart, m);
    await createProjectForecastItem(tenantId, userEmail, {
      project_id: prj1.id,
      scenario: 'realistic',
      month_date: monthDate,
      product_service_id: prod1.id,
      direction: 'revenue',
      label: `Vendas ${prod1.name}`,
      quantity: qty,
      unit_price: prod1.base_price,
      unit_direct_cost: prod1.estimated_direct_cost,
      payment_fee_pct: prod1.payment_fee_pct,
      tax_rate_pct: prod1.estimated_tax_pct,
    });
  }

  // Cenário Conservador pré-clonado para comparação imediata
  await cloneProjectScenario(tenantId, userEmail, {
    projectId: prj1.id,
    sourceScenario: 'realistic',
    targetScenario: 'conservative',
    profile: 'conservative',
  });
  await updateProject(tenantId, userEmail, prj1.id, { active_scenario: 'realistic' });

  // Transações reais vinculadas ao Projeto 1 (Previsto vs. Realizado)
  await createTransactionsBatch(tenantId, userEmail, {
    company_id: emp1.id,
    account_id: acc1.id,
    destination_account_id: null,
    category_id: findCat(emp1.id, '1.1'),
    product_service_id: prod1.id,
    project_id: prj1.id,
    transaction_type: 'income',
    status: 'paid',
    description: 'Faturamento 2 Kits IoT · Contrato Piloto',
    counterparty_name: 'Indústria MetalMecânica Paulista',
    amount: 17000,
    competence_date: prjStart,
    due_date: prjStart,
    payment_date: prjStart,
    schedule_mode: 'single',
  });

  await createTransactionsBatch(tenantId, userEmail, {
    company_id: emp1.id,
    account_id: acc1.id,
    destination_account_id: null,
    category_id: findCat(emp1.id, '6.1'),
    product_service_id: null,
    project_id: prj1.id,
    transaction_type: 'expense',
    status: 'paid',
    description: 'Setup Inicial Bancada de Testes IoT',
    counterparty_name: 'Equipamentos Técnicos Brasil',
    amount: 26500,
    competence_date: prjStart,
    due_date: prjStart,
    payment_date: prjStart,
    schedule_mode: 'single',
  });

  await createTransactionsBatch(tenantId, userEmail, {
    company_id: emp1.id,
    account_id: acc1.id,
    destination_account_id: null,
    category_id: findCat(emp1.id, '1.1'),
    product_service_id: prod1.id,
    project_id: prj1.id,
    transaction_type: 'income',
    status: 'paid',
    description: 'Faturamento 3 Kits IoT · Lote Mês Atual',
    counterparty_name: 'Logística Sudeste S.A.',
    amount: 25500,
    competence_date: today,
    due_date: today,
    payment_date: today,
    schedule_mode: 'single',
  });

  // Projeto 2: Simulação de Ideia com Alerta de Exposição de Caixa na Empresa 2
  const simStart = addMonthsISO(today.slice(0, 7) + '-01', 1);
  const simEnd = addMonthsISO(simStart, 5);

  const prj2 = await createProject(tenantId, userEmail, {
    company_id: emp2.id,
    name: 'Portal Consultivo Tributário Automatizado',
    hypothesis:
      'Lançamento de vertical digital escalável com investimento inicial em desenvolvimento e tráfego pago.',
    status: 'idea_simulation',
    active_scenario: 'realistic',
    planned_start_date: simStart,
    planned_end_date: simEnd,
    initial_investment: 32000,
    monthly_fixed_cost_allocation: 1800,
  });

  const prj2Quantities = [1, 1, 2, 2, 3, 4];
  for (let m = 0; m < prj2Quantities.length; m++) {
    const qty = prj2Quantities[m] ?? 1;
    const monthDate = addMonthsISO(simStart, m);
    await createProjectForecastItem(tenantId, userEmail, {
      project_id: prj2.id,
      scenario: 'realistic',
      month_date: monthDate,
      product_service_id: srv1.id,
      direction: 'revenue',
      label: `Contratos ${srv1.name}`,
      quantity: qty,
      unit_price: srv1.base_price,
      unit_direct_cost: srv1.estimated_direct_cost,
      payment_fee_pct: srv1.payment_fee_pct,
      tax_rate_pct: srv1.estimated_tax_pct,
    });
  }

  // ============================================================================
  // Módulo 4: Histórico DRE (4 meses), Produto Dreno de Caixa, Dívidas & Impostos
  // ============================================================================
  const prodDrain = await createProductService(tenantId, userEmail, {
    company_id: emp1.id,
    group_id: null,
    name: 'Manutenção Legada On-Site (Baixa Margem)',
    offer_kind: 'service',
    sku_code: 'SRV-LEG-09',
    base_price: 4500,
    estimated_direct_cost: 4200,
    payment_fee_pct: 2.5,
    estimated_tax_pct: 11.33,
    description: 'Contrato legado com alto deslocamento técnico e margem negativa após impostos.',
  });

  // Histórico de meses -3 e -2 para gráfico comparativo de evolução (6 meses)
  for (const offset of [-3, -2]) {
    const mDate = addMonthsISO(`${today.slice(0, 7)}-12`, offset);
    await createTransactionsBatch(tenantId, userEmail, {
      company_id: emp1.id,
      account_id: acc1.id,
      destination_account_id: null,
      category_id: findCat(emp1.id, '1.1'),
      product_service_id: prod1.id,
      transaction_type: 'income',
      status: 'paid',
      description: `Receita Contratos IoT (${mDate.slice(0, 7)})`,
      counterparty_name: 'Indústria MetalMecânica Paulista',
      amount: offset === -3 ? 34000 : 38500,
      competence_date: mDate,
      due_date: mDate,
      payment_date: mDate,
      schedule_mode: 'single',
    });

    await createTransactionsBatch(tenantId, userEmail, {
      company_id: emp1.id,
      account_id: acc1.id,
      destination_account_id: null,
      category_id: findCat(emp1.id, '4.1'),
      product_service_id: null,
      transaction_type: 'expense',
      status: 'paid',
      description: `Folha Técnica (${mDate.slice(0, 7)})`,
      counterparty_name: 'Equipe Engenharia CLT',
      amount: 15800,
      competence_date: mDate,
      due_date: mDate,
      payment_date: mDate,
      schedule_mode: 'single',
    });

    await createTransactionsBatch(tenantId, userEmail, {
      company_id: emp1.id,
      account_id: acc1.id,
      destination_account_id: null,
      category_id: findCat(emp1.id, '2.1'),
      product_service_id: null,
      transaction_type: 'expense',
      status: 'paid',
      description: `Impostos sobre Faturamento (${mDate.slice(0, 7)})`,
      counterparty_name: 'Receita Federal',
      amount: offset === -3 ? 3850 : 4360,
      competence_date: mDate,
      due_date: mDate,
      payment_date: mDate,
      schedule_mode: 'single',
    });
  }

  // Transações do mês atual para DRE completa e Ranking Winners & Losers
  await createTransactionsBatch(tenantId, userEmail, {
    company_id: emp1.id,
    account_id: acc1.id,
    destination_account_id: null,
    category_id: findCat(emp1.id, '1.2'),
    product_service_id: prodDrain.id,
    transaction_type: 'income',
    status: 'paid',
    description: 'Chamados Manutenção Legada On-Site',
    counterparty_name: 'Transportadora Vale Sul',
    amount: 9000,
    competence_date: currMonthStart,
    due_date: currMonthStart,
    payment_date: today,
    schedule_mode: 'single',
  });

  await createTransactionsBatch(tenantId, userEmail, {
    company_id: emp1.id,
    account_id: acc1.id,
    destination_account_id: null,
    category_id: findCat(emp1.id, '3.3'),
    product_service_id: prodDrain.id,
    transaction_type: 'expense',
    status: 'paid',
    description: 'Diárias Técnicas & Peças Substituição Legado',
    counterparty_name: 'Terceirizada Campo Sul',
    amount: 10200,
    competence_date: currMonthStart,
    due_date: currMonthStart,
    payment_date: today,
    schedule_mode: 'single',
  });

  await createTransactionsBatch(tenantId, userEmail, {
    company_id: emp1.id,
    account_id: acc1.id,
    destination_account_id: null,
    category_id: findCat(emp1.id, '2.1'),
    product_service_id: prodDrain.id,
    transaction_type: 'expense',
    status: 'paid',
    description: 'ISS & Retenções Manutenção Legada',
    counterparty_name: 'Prefeitura Municipal',
    amount: 1020,
    competence_date: currMonthStart,
    due_date: currMonthStart,
    payment_date: today,
    schedule_mode: 'single',
  });

  await createTransactionsBatch(tenantId, userEmail, {
    company_id: emp1.id,
    account_id: acc1.id,
    destination_account_id: null,
    category_id: findCat(emp1.id, '5.1'),
    product_service_id: prod2.id,
    transaction_type: 'expense',
    status: 'paid',
    description: 'Mídia Paga & Aquisição B2B SaaS',
    counterparty_name: 'Plataforma Ads Corporativa',
    amount: 3200,
    competence_date: currMonthStart,
    due_date: currMonthStart,
    payment_date: today,
    schedule_mode: 'single',
  });

  await createTransactionsBatch(tenantId, userEmail, {
    company_id: emp1.id,
    account_id: acc1Reserve.id,
    destination_account_id: null,
    category_id: findCat(emp1.id, '8.1'),
    product_service_id: null,
    transaction_type: 'income',
    status: 'paid',
    description: 'Rendimento Líquido Reserva CDB Itaú',
    counterparty_name: 'Itaú Unibanco S.A.',
    amount: 890,
    competence_date: currMonthStart,
    due_date: currMonthStart,
    payment_date: today,
    schedule_mode: 'single',
  });

  await createTransactionsBatch(tenantId, userEmail, {
    company_id: emp2.id,
    account_id: acc2.id,
    destination_account_id: null,
    category_id: findCat(emp2.id, '4.3'),
    product_service_id: null,
    transaction_type: 'expense',
    status: 'paid',
    description: 'Contabilidade & Licenças Administrativas',
    counterparty_name: 'Contábil Digital Paulista',
    amount: 1450,
    competence_date: currMonthStart,
    due_date: currMonthStart,
    payment_date: today,
    schedule_mode: 'single',
  });

  // Dívidas de Exemplo (1 Price + 1 SAC com 1ª parcela quitada)
  const debt1 = await createDebtWithSchedule(tenantId, userEmail, {
    company_id: emp1.id,
    account_id: acc1.id,
    title: 'Capital de Giro Expansão Industrial',
    creditor_name: 'Banco Itaú Empresas',
    contract_code: 'GIRO-99421',
    debt_kind: 'loan',
    amortization_system: 'price',
    principal_amount: 48000,
    monthly_interest_rate_pct: 1.45,
    total_installments: 12,
    first_due_date: addMonthsISO(today.slice(0, 7) + '-15', -1),
    notes: 'Linha BNDES/Giro vinculada à expansão da planta IoT.',
  });

  if (debt1.installments[0]) {
    await payDebtInstallment(tenantId, userEmail, {
      installmentId: debt1.installments[0].id,
      accountId: acc1.id,
      paymentDate: prevMonthDate,
    });
  }

  await createDebtWithSchedule(tenantId, userEmail, {
    company_id: emp2.id,
    account_id: acc2.id,
    title: 'Financiamento Equipamentos & Infraestrutura',
    creditor_name: 'Banco Inter Corporate',
    contract_code: 'FIN-33210',
    debt_kind: 'financing',
    amortization_system: 'sac',
    principal_amount: 24000,
    monthly_interest_rate_pct: 1.15,
    total_installments: 10,
    first_due_date: addMonthsISO(today, 0),
    notes: 'Parcelamento em sistema SAC para redução progressiva de juros.',
  });

  // Obrigações Fiscais de Exemplo (Atrasada, Vencimento próximo 4 dias, Paga)
  const soonDateObj = new Date();
  soonDateObj.setDate(soonDateObj.getDate() + 4);
  const soonISO = `${soonDateObj.getFullYear()}-${String(soonDateObj.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(soonDateObj.getDate()).padStart(2, '0')}`;

  await createTaxObligation(tenantId, userEmail, {
    company_id: emp1.id,
    account_id: acc1.id,
    tax_name: 'PIS / COFINS / CSLL (Lucro Presumido)',
    tax_type: 'pis_cofins',
    competence_month: prevMonthDate.slice(0, 7),
    due_date: soonISO,
    revenue_base_amount: 42500,
    estimated_rate_pct: 3.65,
    amount: 1551.25,
    is_recurring: true,
    guide_reference: 'DARF-2026-11',
    notes: 'Apuração mensal sobre faturamento bruto Alpha Engenharia.',
  });

  await createTaxObligation(tenantId, userEmail, {
    company_id: emp2.id,
    account_id: acc2.id,
    tax_name: 'DAS Simples Nacional · Anexo III',
    tax_type: 'simples_nacional',
    competence_month: today.slice(0, 7),
    due_date: addMonthsISO(today.slice(0, 7) + '-20', 1),
    revenue_base_amount: 12000,
    estimated_rate_pct: 6.0,
    amount: 720,
    is_recurring: true,
    guide_reference: 'DAS-PGDAS-002',
    notes: 'Alíquota efetiva inicial de 6,0% sobre honorários de consultoria.',
  });

  const paidTax = await createTaxObligation(tenantId, userEmail, {
    company_id: emp1.id,
    account_id: acc1.id,
    tax_name: 'ISS Municipal Retido / Próprio',
    tax_type: 'iss',
    competence_month: prevMonthDate.slice(0, 7),
    due_date: prevMonthDate,
    revenue_base_amount: 42500,
    estimated_rate_pct: 3.0,
    amount: 1275,
    is_recurring: true,
    guide_reference: 'DAM-SP-8812',
  });
  await payTaxObligation(tenantId, userEmail, {
    taxId: paidTax.id,
    accountId: acc1.id,
    paymentDate: prevMonthDate,
  });
}

export function resetSandboxStore(): void {
  localStorage.removeItem(SANDBOX_STORAGE_KEY);
}

// ============================================================================
// Módulo 5: Persistência de Insights (ai_insights) & Chaves MCP (mcp_access_tokens)
// ============================================================================

export interface CreateAiInsightInput {
  scope_type: ActiveContext['scope'];
  scope_token: string;
  category: AiInsightCategory;
  severity: AiInsightSeverity;
  title_tokenized: string;
  summary_tokenized: string;
  recommendation_tokenized: string;
  related_tokens: string[];
  estimated_financial_impact: number;
  impact_horizon_days: number;
  confidence_pct: number;
  provider_used: string;
  model_used: string;
  sanitized_context_snapshot: Record<string, unknown>;
}

export async function saveAiInsightsBatch(
  tenantId: string,
  userEmail: string,
  items: CreateAiInsightInput[]
): Promise<AiInsight[]> {
  if (items.length === 0) return [];
  const now = new Date().toISOString();

  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const created: AiInsight[] = items.map((item) => ({
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      scope_type: item.scope_type,
      scope_token: item.scope_token,
      category: item.category,
      severity: item.severity,
      status: 'new',
      title_tokenized: item.title_tokenized,
      summary_tokenized: item.summary_tokenized,
      recommendation_tokenized: item.recommendation_tokenized,
      related_tokens: item.related_tokens,
      estimated_financial_impact: roundCurrency(item.estimated_financial_impact),
      impact_horizon_days: item.impact_horizon_days,
      confidence_pct: item.confidence_pct,
      provider_used: item.provider_used,
      model_used: item.model_used,
      sanitized_context_snapshot: item.sanitized_context_snapshot,
      created_at: now,
      updated_at: now,
    }));

    store.aiInsights = [...created, ...store.aiInsights].slice(0, 100);
    appendSandboxAudit(
      store,
      tenantId,
      'ai.analysis_generated',
      'ai_insights',
      created[0]?.id ?? null,
      items[0]?.scope_token ?? 'GLOBAL',
      {
        count: created.length,
        provider: items[0]?.provider_used,
        model: items[0]?.model_used,
        zero_leak_verified: true,
      }
    );
    saveSandboxStore(store);
    return created;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const rows = items.map((item) => ({
    tenant_id: tenantId,
    scope_type: item.scope_type,
    scope_token: item.scope_token,
    category: item.category,
    severity: item.severity,
    status: 'new' as const,
    title_tokenized: item.title_tokenized,
    summary_tokenized: item.summary_tokenized,
    recommendation_tokenized: item.recommendation_tokenized,
    related_tokens: item.related_tokens,
    estimated_financial_impact: roundCurrency(item.estimated_financial_impact),
    impact_horizon_days: item.impact_horizon_days,
    confidence_pct: item.confidence_pct,
    provider_used: item.provider_used,
    model_used: item.model_used,
    sanitized_context_snapshot: item.sanitized_context_snapshot,
  }));

  const { data, error } = await supabase.from('ai_insights').insert(rows).select();
  if (error) throw new Error(error.message);

  await recordSecurityEvent(
    tenantId,
    userEmail,
    'ai.analysis_generated',
    'ai_insights',
    items[0]?.scope_token ?? 'GLOBAL',
    { count: rows.length, provider: items[0]?.provider_used }
  );

  return (data ?? []) as AiInsight[];
}

export async function updateAiInsightStatus(
  tenantId: string,
  userEmail: string,
  insightId: string,
  status: AiInsightStatus
): Promise<void> {
  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const now = new Date().toISOString();
    store.aiInsights = store.aiInsights.map((ins) =>
      ins.id === insightId ? { ...ins, status, updated_at: now } : ins
    );
    appendSandboxAudit(store, tenantId, 'ai.insight_updated', 'ai_insights', insightId, null, {
      status,
    });
    saveSandboxStore(store);
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const { error } = await supabase
    .from('ai_insights')
    .update({ status })
    .eq('id', insightId)
    .eq('tenant_id', tenantId);
  if (error) throw new Error(error.message);

  await recordSecurityEvent(tenantId, userEmail, 'ai.insight_updated', 'ai_insights', null, {
    insight_id: insightId,
    status,
  });
}

async function sha256HexBrowser(rawText: string): Promise<string> {
  const bytes = new TextEncoder().encode(rawText);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function createMcpAccessToken(
  tenantId: string,
  userEmail: string,
  input: {
    label: string;
    scope: McpTokenScope;
    expiresInDays?: number | null;
  }
): Promise<{ tokenRecord: McpAccessToken; plaintextSecretOnce: string }> {
  const label = input.label.trim();
  if (label.length < 2) {
    throw new Error('Informe um nome identificador com ao menos 2 caracteres.');
  }

  const randomBytes = new Uint8Array(24);
  crypto.getRandomValues(randomBytes);
  const hexSecret = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const plaintextSecretOnce = `vrt_mcp_${hexSecret}`;
  const tokenPrefix = plaintextSecretOnce.slice(0, 16);
  const tokenHash = await sha256HexBrowser(plaintextSecretOnce);

  const expiresAt =
    input.expiresInDays && input.expiresInDays > 0
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

  const now = new Date().toISOString();

  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    const tokenRecord: McpAccessToken = {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      label,
      token_prefix: tokenPrefix,
      token_hash: tokenHash,
      scope: input.scope,
      is_active: true,
      last_used_at: null,
      call_count: 0,
      expires_at: expiresAt,
      revoked_at: null,
      created_at: now,
      updated_at: now,
    };
    store.mcpTokens = [tokenRecord, ...store.mcpTokens];
    appendSandboxAudit(
      store,
      tenantId,
      'mcp.token_created',
      'mcp_access_tokens',
      tokenRecord.id,
      null,
      { scope: input.scope, token_prefix: tokenPrefix }
    );
    saveSandboxStore(store);
    return { tokenRecord, plaintextSecretOnce };
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const { data, error } = await supabase
    .from('mcp_access_tokens')
    .insert({
      tenant_id: tenantId,
      label,
      token_prefix: tokenPrefix,
      token_hash: tokenHash,
      scope: input.scope,
      expires_at: expiresAt,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  const tokenRecord = data as McpAccessToken;
  await recordSecurityEvent(
    tenantId,
    userEmail,
    'mcp.token_created',
    'mcp_access_tokens',
    null,
    { token_id: tokenRecord.id, scope: input.scope, token_prefix: tokenPrefix }
  );

  return { tokenRecord, plaintextSecretOnce };
}

export async function revokeMcpAccessToken(
  tenantId: string,
  userEmail: string,
  tokenId: string
): Promise<void> {
  const now = new Date().toISOString();

  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(tenantId, userEmail);
    store.mcpTokens = store.mcpTokens.map((t) =>
      t.id === tokenId ? { ...t, is_active: false, revoked_at: now, updated_at: now } : t
    );
    appendSandboxAudit(store, tenantId, 'mcp.token_revoked', 'mcp_access_tokens', tokenId, null, {
      revoked_at: now,
    });
    saveSandboxStore(store);
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const { error } = await supabase
    .from('mcp_access_tokens')
    .update({ is_active: false, revoked_at: now })
    .eq('id', tokenId)
    .eq('tenant_id', tenantId);
  if (error) throw new Error(error.message);

  await recordSecurityEvent(tenantId, userEmail, 'mcp.token_revoked', 'mcp_access_tokens', null, {
    token_id: tokenId,
  });
}

export interface PendingMcpDraftPayload {
  draftId: string;
  tenantId: string;
  companyToken: string;
  offerToken: string | null;
  suggestedProjectToken: string;
  plannedStartDate: string;
  plannedEndDate: string;
  initialInvestment: number;
  monthlyFixedCostAllocation: number;
  monthlyRevenue: number;
  durationMonths: number;
  paymentFeePct: number;
  taxRatePct: number;
  unitDirectCostRatio: number;
  createdAt: string;
}

export async function persistMcpServerUpdates(params: {
  tenantId: string;
  userEmail: string;
  companies: Company[];
  productsServices: ProductService[];
  callLogs: McpCallLog[];
  tokenStats: Array<{ id: string; call_count: number; last_used_at: string | null }>;
  pendingDrafts: PendingMcpDraftPayload[];
}): Promise<number> {
  let importedDrafts = 0;

  // 1. Importa rascunhos de projetos criados via MCP simulate_new_project_idea (status = idea_simulation)
  for (const draft of params.pendingDrafts) {
    const company =
      params.companies.find((c) => c.analytical_token === draft.companyToken) ??
      params.companies[0];
    if (!company) continue;

    const offer = draft.offerToken
      ? params.productsServices.find((p) => p.analytical_token === draft.offerToken)
      : undefined;

    const createdProj = await createProject(params.tenantId, params.userEmail, {
      company_id: company.id,
      name: `Simulação MCP ${draft.suggestedProjectToken}${offer ? ` (${offer.analytical_token})` : ''}`,
      hypothesis: `Simulação gerada via Servidor MCP (${draft.durationMonths} meses · Receita mensal ${draft.monthlyRevenue}).`,
      status: 'idea_simulation',
      active_scenario: 'realistic',
      planned_start_date: draft.plannedStartDate,
      planned_end_date: draft.plannedEndDate,
      initial_investment: draft.initialInvestment,
      monthly_fixed_cost_allocation: draft.monthlyFixedCostAllocation,
    });

    for (let m = 0; m < draft.durationMonths; m++) {
      const monthDate = addMonthsISO(draft.plannedStartDate, m);
      await createProjectForecastItem(params.tenantId, params.userEmail, {
        project_id: createdProj.id,
        scenario: 'realistic',
        month_date: monthDate,
        product_service_id: offer?.id ?? null,
        direction: 'revenue',
        label: offer ? `Projeção ${offer.name}` : `Receita Simulada Mês ${m + 1}`,
        quantity: 1,
        unit_price: draft.monthlyRevenue,
        unit_direct_cost: roundCurrency(draft.monthlyRevenue * draft.unitDirectCostRatio),
        payment_fee_pct: draft.paymentFeePct,
        tax_rate_pct: draft.taxRatePct,
      });
    }

    importedDrafts += 1;
  }

  // 2. Sincroniza logs e contadores de uso das chaves MCP
  if (!isSupabaseConfigured) {
    const store = loadSandboxStore(params.tenantId, params.userEmail);
    const existingLogIds = new Set(store.mcpCallLogs.map((l) => l.id));
    const newLogs = params.callLogs.filter((l) => !existingLogIds.has(l.id));
    if (newLogs.length > 0) {
      store.mcpCallLogs = [...newLogs, ...store.mcpCallLogs].slice(0, 100);
    }
    const statMap = new Map(params.tokenStats.map((s) => [s.id, s]));
    store.mcpTokens = store.mcpTokens.map((tok) => {
      const st = statMap.get(tok.id);
      if (!st) return tok;
      return {
        ...tok,
        call_count: Math.max(tok.call_count, st.call_count),
        last_used_at: st.last_used_at ?? tok.last_used_at,
      };
    });
    if (newLogs.length > 0 || params.tokenStats.length > 0) {
      saveSandboxStore(store);
    }
    return importedDrafts;
  }

  const supabase = getSupabaseClient();
  if (supabase && params.callLogs.length > 0) {
    const existingIdsRes = await supabase
      .from('mcp_call_logs')
      .select('id')
      .eq('tenant_id', params.tenantId)
      .limit(100);
    const existingIds = new Set(
      ((existingIdsRes.data ?? []) as Array<{ id: string }>).map((r) => r.id)
    );
    const missingLogs = params.callLogs.filter((l) => !existingIds.has(l.id));
    if (missingLogs.length > 0) {
      await supabase.from('mcp_call_logs').insert(missingLogs);
    }
    for (const st of params.tokenStats) {
      if (st.call_count > 0) {
        await supabase
          .from('mcp_access_tokens')
          .update({ call_count: st.call_count, last_used_at: st.last_used_at })
          .eq('id', st.id)
          .eq('tenant_id', params.tenantId);
      }
    }
  }

  return importedDrafts;
}
