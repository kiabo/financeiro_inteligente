export type AppRole = 'owner' | 'admin' | 'analyst';

export type AccountType =
  | 'checking'
  | 'cash'
  | 'credit_card'
  | 'wallet'
  | 'investment';

export type VaultEntityType = 'group' | 'company' | 'account';

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
  | 'invite.revoked';

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

export type ActiveContext =
  | { scope: 'all_independent' }
  | { scope: 'group'; groupId: string }
  | { scope: 'company'; companyId: string }
  | { scope: 'account'; accountId: string };

export type AppSection = 'overview' | 'hierarchy' | 'vault' | 'security';

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
