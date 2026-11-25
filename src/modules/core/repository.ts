import { normalizeCNPJ } from '../../lib/utils';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import type {
  AccountType,
  AppRole,
  AuditAction,
  AuditLogEntry,
  BusinessGroup,
  Company,
  FinancialAccount,
  InvitedUser,
  VaultEntityType,
  VaultEntry,
} from './types';

export interface WorkspaceSnapshot {
  groups: BusinessGroup[];
  companies: Company[];
  accounts: FinancialAccount[];
  vault: VaultEntry[];
  auditLogs: AuditLogEntry[];
  invitedUsers: InvitedUser[];
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

interface SandboxStore {
  counters: Record<VaultEntityType, number>;
  groups: BusinessGroup[];
  companies: Company[];
  accounts: FinancialAccount[];
  vault: VaultEntry[];
  auditLogs: AuditLogEntry[];
  invitedUsers: InvitedUser[];
}

const SANDBOX_STORAGE_KEY = 'vertice_module1_sandbox_v1';

function createInitialSandboxStore(tenantId: string, userEmail: string): SandboxStore {
  return {
    counters: { group: 0, company: 0, account: 0 },
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
  };
}

function loadSandboxStore(tenantId: string, userEmail: string): SandboxStore {
  try {
    const raw = localStorage.getItem(SANDBOX_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SandboxStore;
      if (parsed && parsed.counters && Array.isArray(parsed.companies)) {
        return parsed;
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
  const prefix = type === 'group' ? 'GRP_' : type === 'company' ? 'EMP_' : 'CTA_';
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
    };
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Cliente Supabase indisponível.');

  const [groupsRes, companiesRes, accountsRes, vaultRes, auditRes, invitesRes] =
    await Promise.all([
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
    ]);

  const firstError =
    groupsRes.error ??
    companiesRes.error ??
    accountsRes.error ??
    vaultRes.error ??
    auditRes.error;
  if (firstError) {
    throw new Error(firstError.message);
  }

  return {
    groups: (groupsRes.data ?? []) as BusinessGroup[],
    companies: (companiesRes.data ?? []) as Company[],
    accounts: (accountsRes.data ?? []) as FinancialAccount[],
    vault: (vaultRes.data ?? []) as VaultEntry[],
    auditLogs: (auditRes.data ?? []) as AuditLogEntry[],
    invitedUsers: (invitesRes.data ?? []) as InvitedUser[],
  };
}

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
      analytical_token: 'PENDING', // Substituído no trigger BEFORE INSERT
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
    // Empresas vinculadas passam a operar de forma independente (group_id = null)
    store.companies = store.companies.map((c) =>
      c.group_id === groupId ? { ...c, group_id: null, updated_at: new Date().toISOString() } : c
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
    store.companies = store.companies.filter((c) => c.id !== companyId);
    store.accounts = store.accounts.filter((a) => a.company_id !== companyId);
    store.vault = store.vault.map((v) =>
      (v.entity_type === 'company' && v.entity_id === companyId) ||
      (v.entity_type === 'account' && removedAccountIds.has(v.entity_id))
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
    group_id: null, // Demonstra empresa 100% independente sem grupo
  });

  await createFinancialAccount(tenantId, userEmail, {
    company_id: emp1.id,
    name: 'Conta Corrente Itaú Matriz',
    account_type: 'checking',
    institution_name: 'Itaú Unibanco',
    currency: 'BRL',
    last_four: '4419',
  });

  await createFinancialAccount(tenantId, userEmail, {
    company_id: emp2.id,
    name: 'Caixa Operacional & Cartão Corporativo',
    account_type: 'credit_card',
    institution_name: 'Banco Inter',
    currency: 'BRL',
    last_four: '8821',
  });
}

export function resetSandboxStore(): void {
  localStorage.removeItem(SANDBOX_STORAGE_KEY);
}
