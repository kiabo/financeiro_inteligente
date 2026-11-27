export type AppRole = 'owner' | 'admin' | 'analyst';

export type AccountType =
  | 'checking'
  | 'cash'
  | 'credit_card'
  | 'wallet'
  | 'investment';

export type VaultEntityType =
  | 'group'
  | 'company'
  | 'account'
  | 'product'
  | 'service'
  | 'project'
  | 'creditor';

export type AuditAction =
  | 'auth.login'
  | 'auth.mfa_enrolled'
  | 'auth.mfa_verified'
  | 'auth.logout'
  | 'entity.created'
  | 'entity.updated'
  | 'entity.deleted'
  | 'vault.sanitization_verified'
  | 'invite.created'
  | 'invite.revoked'
  | 'ai.analysis_generated'
  | 'ai.insight_updated'
  | 'mcp.token_created'
  | 'mcp.token_revoked'
  | 'mcp.tool_called';

export interface BusinessGroup {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  analytical_token: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Company {
  id: string;
  tenant_id: string;
  group_id: string | null;
  legal_name: string;
  trade_name: string | null;
  cnpj: string;
  tax_regime: string | null;
  analytical_token: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FinancialAccount {
  id: string;
  tenant_id: string;
  company_id: string;
  name: string;
  account_type: AccountType;
  institution_name: string | null;
  currency: string;
  last_four: string | null;
  analytical_token: string;
  is_active: boolean;
  /** Saldo que a conta já tinha na abertura (spec 003). Pode ser negativo. */
  opening_balance: number;
  /** Data (AAAA-MM-DD) a partir da qual os movimentos contam no saldo; obrigatória se o saldo inicial ≠ 0. */
  opening_balance_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface VaultEntry {
  id: string;
  tenant_id: string;
  entity_type: VaultEntityType;
  entity_id: string;
  analytical_token: string;
  real_label: string;
  sensitive_identifier: string | null;
  secondary_aliases: string[];
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuditLogEntry {
  id: string;
  tenant_id: string;
  actor_id: string | null;
  action: AuditAction;
  entity_type: string;
  entity_id: string | null;
  analytical_token: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface InvitedUser {
  id: string;
  email: string;
  role: AppRole;
  is_active: boolean;
  accepted_at: string | null;
  created_at: string;
}

// ============================================================================
// Módulo 2: Catálogo de Produtos/Serviços, Plano de Contas & Lançamentos
// ============================================================================

export type ProductServiceType = 'product' | 'service';

export type OfferKind = 'physical_product' | 'digital_product' | 'service';

export interface ProductService {
  id: string;
  tenant_id: string;
  company_id: string | null;
  group_id: string | null;
  name: string;
  item_type: ProductServiceType;
  offer_kind: OfferKind;
  sku_code: string | null;
  base_price: number;
  estimated_direct_cost: number;
  payment_fee_pct: number;
  estimated_tax_pct: number;
  description: string | null;
  analytical_token: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type CategoryGroupType =
  | 'operational_revenue'
  | 'tax_deduction'
  | 'direct_cost'
  | 'fixed_expense'
  | 'variable_expense'
  | 'capex'
  | 'financial_movement'
  | 'financial_income'
  | 'financial_expense';

export type CategoryDirection = 'inflow' | 'outflow' | 'neutral';

export interface Category {
  id: string;
  tenant_id: string;
  company_id: string;
  parent_id: string | null;
  code: string;
  name: string;
  group_type: CategoryGroupType;
  direction: CategoryDirection;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type TransactionType = 'income' | 'expense' | 'transfer';

export type TransactionStatus = 'pending' | 'paid' | 'overdue' | 'canceled';

export type AccountingRegime = 'cash' | 'competence';

export interface Transaction {
  id: string;
  tenant_id: string;
  company_id: string;
  account_id: string;
  destination_account_id: string | null;
  category_id: string | null;
  product_service_id: string | null;
  project_id: string | null;
  transaction_type: TransactionType;
  status: TransactionStatus;
  description: string;
  counterparty_name: string | null;
  amount: number;
  competence_date: string;
  due_date: string;
  payment_date: string | null;
  installment_group_id: string | null;
  installment_number: number | null;
  installment_total: number | null;
  is_recurring: boolean;
  recurrence_frequency: 'monthly' | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountBalanceSummary {
  account_id: string;
  company_id: string;
  group_id: string | null;
  account_name: string;
  analytical_token: string;
  current_balance: number;
  projected_balance: number;
  opening_balance: number;
  opening_balance_date: string | null;
}

// ============================================================================
// Módulo 3: Projetos, Simulador de Viabilidade & Previsto vs. Realizado
// ============================================================================

export type ProjectStatus =
  | 'idea_simulation'
  | 'approved'
  | 'in_progress'
  | 'completed'
  | 'canceled';

export type ProjectScenarioType = 'realistic' | 'conservative' | 'optimistic';

export type ForecastItemDirection = 'revenue' | 'direct_cost' | 'fixed_cost' | 'capex';

export interface Project {
  id: string;
  tenant_id: string;
  company_id: string;
  name: string;
  hypothesis: string | null;
  status: ProjectStatus;
  active_scenario: ProjectScenarioType;
  planned_start_date: string;
  planned_end_date: string;
  initial_investment: number;
  monthly_fixed_cost_allocation: number;
  analytical_token: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectForecastItem {
  id: string;
  tenant_id: string;
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
  gross_amount: number;
  estimated_direct_cost_total: number;
  estimated_deductions_total: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Módulo 4: Saúde Financeira, DRE Gerencial, Dívidas & Obrigações Fiscais
// ============================================================================

export type DebtKind = 'loan' | 'financing' | 'renegotiation' | 'credit_line';

export type AmortizationSystem = 'sac' | 'price';

export type DebtStatus = 'active' | 'settled' | 'renegotiated' | 'canceled';

export type DebtInstallmentStatus = 'pending' | 'paid' | 'overdue' | 'canceled';

export interface Debt {
  id: string;
  tenant_id: string;
  company_id: string;
  account_id: string | null;
  title: string;
  creditor_name: string;
  contract_code: string | null;
  debt_kind: DebtKind;
  amortization_system: AmortizationSystem;
  principal_amount: number;
  monthly_interest_rate_pct: number;
  total_installments: number;
  first_due_date: string;
  status: DebtStatus;
  creditor_token: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DebtInstallment {
  id: string;
  tenant_id: string;
  debt_id: string;
  installment_number: number;
  due_date: string;
  principal_portion: number;
  interest_portion: number;
  total_amount: number;
  remaining_balance: number;
  status: DebtInstallmentStatus;
  paid_date: string | null;
  transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

export type TaxType =
  | 'simples_nacional'
  | 'iss'
  | 'irpj_csll'
  | 'pis_cofins'
  | 'inss'
  | 'fgts'
  | 'icms'
  | 'other';

export type TaxObligationStatus = 'pending' | 'paid' | 'overdue' | 'canceled';

export interface TaxObligation {
  id: string;
  tenant_id: string;
  company_id: string;
  account_id: string | null;
  tax_name: string;
  tax_type: TaxType;
  competence_month: string;
  due_date: string;
  revenue_base_amount: number;
  estimated_rate_pct: number;
  amount: number;
  status: TaxObligationStatus;
  paid_date: string | null;
  is_recurring: boolean;
  guide_reference: string | null;
  transaction_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type ActiveContext =
  | { scope: 'all_independent' }
  | { scope: 'group'; groupId: string }
  | { scope: 'company'; companyId: string }
  | { scope: 'account'; accountId: string };

export type AppSection =
  | 'overview'
  | 'health'
  | 'ai_cfo'
  | 'dre'
  | 'debts_taxes'
  | 'transactions'
  | 'projects'
  | 'catalog'
  | 'hierarchy'
  | 'vault'
  | 'mcp_settings'
  | 'security'
  | 'integrations'
  | 'reconciliation'
  | 'automation';

export interface AuthSessionState {
  mode: 'supabase' | 'sandbox';
  userId: string;
  email: string;
  fullName: string;
  role: AppRole;
  mfaVerified: boolean;
  mfaEnrolled: boolean;
  aal: 'aal1' | 'aal2';
}

// ============================================================================
// Módulo 5: CFO Virtual (IA Zero-Leak) & Servidor MCP
// ============================================================================

export type AiInsightCategory =
  | 'margin_drop'
  | 'budget_deviation'
  | 'cash_risk_45d'
  | 'capital_reallocation'
  | 'debt_optimization'
  | 'tax_alert'
  | 'project_viability';

export type AiInsightSeverity = 'critical' | 'warning' | 'opportunity' | 'info';

export type AiInsightStatus = 'new' | 'acknowledged' | 'dismissed';

export interface AiInsight {
  id: string;
  tenant_id: string;
  scope_type: ActiveContext['scope'];
  scope_token: string;
  category: AiInsightCategory;
  severity: AiInsightSeverity;
  status: AiInsightStatus;
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
  created_at: string;
  updated_at: string;
}

export type McpTokenScope = 'read_only' | 'simulate_drafts';

export interface McpAccessToken {
  id: string;
  tenant_id: string;
  label: string;
  token_prefix: string;
  token_hash: string;
  scope: McpTokenScope;
  is_active: boolean;
  last_used_at: string | null;
  call_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface McpCallLog {
  id: string;
  tenant_id: string;
  token_id: string;
  tool_name: string;
  scope_used: string;
  status: 'success' | 'denied' | 'error';
  zero_leak_verified: boolean;
  sanitized_args: Record<string, unknown>;
  response_summary: string | null;
  created_at: string;
}

export interface CfoChatMessage {
  id: string;
  role: 'user' | 'assistant';
  contentTokenized: string;
  contentRehydrated: string;
  sanitizedPromptPreview?: string;
  referencedTokens?: string[];
  createdAt: string;
}
