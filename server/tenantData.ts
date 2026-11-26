import type {
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
} from '../src/modules/core/types.ts';
import type { WorkspaceCfoSource } from '../src/modules/ai-cfo/cfoAgent.ts';
import { getSupabaseAdmin } from './supabaseAdmin.ts';

type Row = Record<string, unknown>;

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

async function selectTenantRows(table: string, tenantId: string): Promise<Row[]> {
  const admin = getSupabaseAdmin();
  const pageSize = 1000;
  const rows: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from(table)
      .select('*')
      .eq('tenant_id', tenantId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Falha ao ler ${table}: ${error.message}`);
    const batch = (data ?? []) as Row[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

/**
 * Carrega o workspace completo de UM tenant (service role + filtro explícito por tenant_id),
 * no mesmo formato consumido por `buildAnonymizedCfoContext` e pelos motores analíticos.
 */
export async function loadTenantWorkspace(tenantId: string): Promise<WorkspaceCfoSource> {
  const [
    groups,
    companies,
    accounts,
    vault,
    categories,
    products,
    transactions,
    projects,
    forecast,
    debts,
    installments,
    taxes,
  ] = await Promise.all([
    selectTenantRows('business_groups', tenantId),
    selectTenantRows('companies', tenantId),
    selectTenantRows('financial_accounts', tenantId),
    selectTenantRows('anonymization_vault', tenantId),
    selectTenantRows('categories', tenantId),
    selectTenantRows('products_services', tenantId),
    selectTenantRows('transactions', tenantId),
    selectTenantRows('projects', tenantId),
    selectTenantRows('project_forecast_items', tenantId),
    selectTenantRows('debts', tenantId),
    selectTenantRows('debt_installments', tenantId),
    selectTenantRows('tax_obligations', tenantId),
  ]);

  return {
    groups: groups as unknown as BusinessGroup[],
    companies: companies as unknown as Company[],
    accounts: accounts as unknown as FinancialAccount[],
    vault: vault.map((v) => ({
      ...(v as unknown as VaultEntry),
      secondary_aliases: Array.isArray(v.secondary_aliases) ? (v.secondary_aliases as string[]) : [],
    })),
    categories: categories as unknown as Category[],
    productsServices: products.map((p) => ({
      ...(p as unknown as ProductService),
      base_price: num(p.base_price),
      estimated_direct_cost: num(p.estimated_direct_cost),
      payment_fee_pct: num(p.payment_fee_pct),
      estimated_tax_pct: num(p.estimated_tax_pct),
    })),
    transactions: transactions.map((t) => ({
      ...(t as unknown as Transaction),
      amount: num(t.amount),
    })),
    projects: projects.map((p) => ({
      ...(p as unknown as Project),
      initial_investment: num(p.initial_investment),
      monthly_fixed_cost_allocation: num(p.monthly_fixed_cost_allocation),
    })),
    projectForecastItems: forecast.map((f) => ({
      ...(f as unknown as ProjectForecastItem),
      quantity: num(f.quantity, 1),
      unit_price: num(f.unit_price),
      unit_direct_cost: num(f.unit_direct_cost),
      payment_fee_pct: num(f.payment_fee_pct),
      tax_rate_pct: num(f.tax_rate_pct),
      gross_amount: num(f.gross_amount),
      estimated_direct_cost_total: num(f.estimated_direct_cost_total),
      estimated_deductions_total: num(f.estimated_deductions_total),
    })),
    debts: debts.map((d) => ({
      ...(d as unknown as Debt),
      principal_amount: num(d.principal_amount),
      monthly_interest_rate_pct: num(d.monthly_interest_rate_pct),
      total_installments: num(d.total_installments, 1),
    })),
    debtInstallments: installments.map((i) => ({
      ...(i as unknown as DebtInstallment),
      installment_number: num(i.installment_number, 1),
      principal_portion: num(i.principal_portion),
      interest_portion: num(i.interest_portion),
      total_amount: num(i.total_amount),
      remaining_balance: num(i.remaining_balance),
    })),
    taxObligations: taxes.map((t) => ({
      ...(t as unknown as TaxObligation),
      revenue_base_amount: num(t.revenue_base_amount),
      estimated_rate_pct: num(t.estimated_rate_pct),
      amount: num(t.amount),
    })),
  };
}

export { selectTenantRows };
