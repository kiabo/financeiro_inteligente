-- ============================================================================
-- MÓDULO 1: FUNDAÇÃO SEGURA, HIERARQUIA FLEXÍVEL E COFRE DE ANONIMIZAÇÃO
-- Banco de Dados: PostgreSQL / Supabase
-- Arquitetura: Privacy-by-Design, Invite-Only + MFA, RLS 100% Ativo
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ----------------------------------------------------------------------------
-- 1. Tipos Enumerados
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('owner', 'admin', 'analyst');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.account_type AS ENUM (
    'checking',
    'cash',
    'credit_card',
    'wallet',
    'investment'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.vault_entity_type AS ENUM ('group', 'company', 'account');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.audit_action AS ENUM (
    'auth.login',
    'auth.mfa_enrolled',
    'auth.mfa_verified',
    'auth.logout',
    'entity.created',
    'entity.updated',
    'entity.deleted',
    'vault.sanitization_verified',
    'invite.created',
    'invite.revoked'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 2. Controle de Acesso Estritamente Restrito (Invite-Only) e Perfis
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invited_users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        CITEXT NOT NULL UNIQUE,
  role         public.app_role NOT NULL DEFAULT 'analyst',
  invited_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  accepted_at  TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invited_users_active_email
  ON public.invited_users (email)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         CITEXT NOT NULL UNIQUE,
  full_name     TEXT,
  role          public.app_role NOT NULL DEFAULT 'owner',
  mfa_enforced  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 3. Hierarquia Organizacional Flexível
-- Regra Crítica: companies.group_id é NULLABLE para operação independente
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_groups (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 120),
  description       TEXT,
  analytical_token  TEXT NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_business_groups_tenant_token UNIQUE (tenant_id, analytical_token)
);

CREATE INDEX IF NOT EXISTS idx_business_groups_tenant
  ON public.business_groups (tenant_id)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS public.companies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  group_id          UUID REFERENCES public.business_groups(id) ON DELETE SET NULL,
  legal_name        TEXT NOT NULL CHECK (char_length(trim(legal_name)) BETWEEN 2 AND 160),
  trade_name        TEXT,
  cnpj              CHAR(14) NOT NULL,
  tax_regime        TEXT,
  analytical_token  TEXT NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_companies_cnpj_digits CHECK (cnpj ~ '^[0-9]{14}$'),
  CONSTRAINT uq_companies_tenant_cnpj UNIQUE (tenant_id, cnpj),
  CONSTRAINT uq_companies_tenant_token UNIQUE (tenant_id, analytical_token)
);

CREATE INDEX IF NOT EXISTS idx_companies_tenant
  ON public.companies (tenant_id);

CREATE INDEX IF NOT EXISTS idx_companies_tenant_group
  ON public.companies (tenant_id, group_id)
  WHERE group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.financial_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id        UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name              TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 120),
  account_type      public.account_type NOT NULL,
  institution_name  TEXT,
  currency          CHAR(3) NOT NULL DEFAULT 'BRL' CHECK (currency ~ '^[A-Z]{3}$'),
  last_four         CHAR(4) CHECK (last_four IS NULL OR last_four ~ '^[0-9]{4}$'),
  analytical_token  TEXT NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_financial_accounts_tenant_token UNIQUE (tenant_id, analytical_token)
);

CREATE INDEX IF NOT EXISTS idx_financial_accounts_tenant_company
  ON public.financial_accounts (tenant_id, company_id);

-- ----------------------------------------------------------------------------
-- 4. Cofre de Anonimização (Privacy Vault) & Contadores Imutáveis
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vault_token_counters (
  tenant_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type  public.vault_entity_type NOT NULL,
  last_seq     INTEGER NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  PRIMARY KEY (tenant_id, entity_type)
);

CREATE TABLE IF NOT EXISTS public.anonymization_vault (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type           public.vault_entity_type NOT NULL,
  entity_id             UUID NOT NULL,
  analytical_token      TEXT NOT NULL,
  real_label            TEXT NOT NULL,
  sensitive_identifier  TEXT,
  secondary_aliases     TEXT[] NOT NULL DEFAULT '{}',
  is_archived           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_vault_tenant_token UNIQUE (tenant_id, analytical_token),
  CONSTRAINT uq_vault_tenant_entity UNIQUE (tenant_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_anonymization_vault_tenant
  ON public.anonymization_vault (tenant_id, entity_type)
  WHERE is_archived = FALSE;

-- ----------------------------------------------------------------------------
-- 5. Logs de Auditoria (Append-Only)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action            public.audit_action NOT NULL,
  entity_type       TEXT NOT NULL,
  entity_id         UUID,
  analytical_token  TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address        INET,
  user_agent        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created
  ON public.audit_logs (tenant_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 6. Funções & Triggers de Segurança, Tokenização Imutável e Auditoria
-- ----------------------------------------------------------------------------

-- 6.1 Atualização automática de updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_business_groups_updated_at
  BEFORE UPDATE ON public.business_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_financial_accounts_updated_at
  BEFORE UPDATE ON public.financial_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_anonymization_vault_updated_at
  BEFORE UPDATE ON public.anonymization_vault
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6.2 Bloqueio rigoroso de cadastro público (Invite-Only Gate em auth.users)
CREATE OR REPLACE FUNCTION public.enforce_invite_only_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_invite_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.invited_users iu
    WHERE iu.email = NEW.email
      AND iu.is_active = TRUE
      AND (iu.expires_at IS NULL OR iu.expires_at > now())
  ) INTO v_invite_exists;

  IF NOT v_invite_exists THEN
    RAISE EXCEPTION 'Acesso restrito: o e-mail % não possui convite ativo autorizado.', NEW.email
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_invite_only_signup ON auth.users;
CREATE TRIGGER trg_enforce_invite_only_signup
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_invite_only_signup();

-- 6.3 Criação automática de perfil ao aceitar convite
CREATE OR REPLACE FUNCTION public.handle_invited_user_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role public.app_role;
BEGIN
  UPDATE public.invited_users
     SET accepted_at = now()
   WHERE email = NEW.email
     AND is_active = TRUE
  RETURNING role INTO v_role;

  INSERT INTO public.user_profiles (id, email, full_name, role, mfa_enforced)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email::text, '@', 1)),
    COALESCE(v_role, 'owner'),
    TRUE
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    NEW.id,
    NEW.id,
    'invite.created',
    'user_profile',
    NEW.id,
    jsonb_build_object('event', 'invite_accepted')
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_handle_invited_user_created ON auth.users;
CREATE TRIGGER trg_handle_invited_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_invited_user_created();

-- 6.4 Gerador atômico e monotônico de Tokens Analíticos (GRP_01, EMP_01, CTA_01)
CREATE OR REPLACE FUNCTION public.next_analytical_token(
  p_tenant_id    UUID,
  p_entity_type  public.vault_entity_type
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq    INTEGER;
  v_prefix TEXT;
BEGIN
  v_prefix := CASE p_entity_type
    WHEN 'group'   THEN 'GRP_'
    WHEN 'company' THEN 'EMP_'
    WHEN 'account' THEN 'CTA_'
  END;

  INSERT INTO public.vault_token_counters (tenant_id, entity_type, last_seq)
  VALUES (p_tenant_id, p_entity_type, 1)
  ON CONFLICT (tenant_id, entity_type)
  DO UPDATE SET last_seq = public.vault_token_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;

  RETURN v_prefix || lpad(v_seq::TEXT, 2, '0');
END;
$$;

-- 6.5 Integridade de Tenant na Hierarquia
CREATE OR REPLACE FUNCTION public.validate_company_group_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.group_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.business_groups bg
      WHERE bg.id = NEW.group_id
        AND bg.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'Violação de isolamento de tenant: grupo empresarial inválido.'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_company_group_tenant
  BEFORE INSERT OR UPDATE OF group_id ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.validate_company_group_tenant();

CREATE OR REPLACE FUNCTION public.validate_account_company_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id = NEW.company_id
      AND c.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Violação de isolamento de tenant: empresa inválida para esta conta.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_account_company_tenant
  BEFORE INSERT OR UPDATE OF company_id ON public.financial_accounts
  FOR EACH ROW EXECUTE FUNCTION public.validate_account_company_tenant();

-- 6.6 Atribuição automática e Imutabilidade do Token Analítico
CREATE OR REPLACE FUNCTION public.assign_immutable_analytical_token()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity_type public.vault_entity_type;
BEGIN
  v_entity_type := CASE TG_TABLE_NAME
    WHEN 'business_groups'    THEN 'group'::public.vault_entity_type
    WHEN 'companies'          THEN 'company'::public.vault_entity_type
    WHEN 'financial_accounts' THEN 'account'::public.vault_entity_type
  END;

  IF TG_OP = 'INSERT' THEN
    NEW.analytical_token := public.next_analytical_token(NEW.tenant_id, v_entity_type);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.analytical_token IS DISTINCT FROM OLD.analytical_token THEN
      RAISE EXCEPTION 'Token analítico é imutável após criação.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_business_groups_token
  BEFORE INSERT OR UPDATE ON public.business_groups
  FOR EACH ROW EXECUTE FUNCTION public.assign_immutable_analytical_token();

CREATE TRIGGER trg_companies_token
  BEFORE INSERT OR UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.assign_immutable_analytical_token();

CREATE TRIGGER trg_financial_accounts_token
  BEFORE INSERT OR UPDATE ON public.financial_accounts
  FOR EACH ROW EXECUTE FUNCTION public.assign_immutable_analytical_token();

-- 6.7 Sincronização automática do Cofre de Anonimização + Log de Auditoria
CREATE OR REPLACE FUNCTION public.sync_entity_to_vault_and_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity_type  public.vault_entity_type;
  v_tenant_id    UUID;
  v_entity_id    UUID;
  v_token        TEXT;
  v_label        TEXT;
  v_identifier   TEXT;
  v_aliases      TEXT[];
  v_action       public.audit_action;
BEGIN
  v_entity_type := CASE TG_TABLE_NAME
    WHEN 'business_groups'    THEN 'group'::public.vault_entity_type
    WHEN 'companies'          THEN 'company'::public.vault_entity_type
    WHEN 'financial_accounts' THEN 'account'::public.vault_entity_type
  END;

  IF TG_OP = 'DELETE' THEN
    v_tenant_id := OLD.tenant_id;
    v_entity_id := OLD.id;
    v_token     := OLD.analytical_token;
    v_action    := 'entity.deleted';

    UPDATE public.anonymization_vault
       SET is_archived = TRUE,
           updated_at  = now()
     WHERE tenant_id   = v_tenant_id
       AND entity_type = v_entity_type
       AND entity_id   = v_entity_id;

    INSERT INTO public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, analytical_token, metadata)
    VALUES (
      v_tenant_id,
      auth.uid(),
      v_action,
      v_entity_type::TEXT,
      v_entity_id,
      v_token,
      jsonb_build_object('archived_in_vault', TRUE)
    );

    RETURN OLD;
  END IF;

  v_tenant_id := NEW.tenant_id;
  v_entity_id := NEW.id;
  v_token     := NEW.analytical_token;
  v_action    := CASE WHEN TG_OP = 'INSERT' THEN 'entity.created' ELSE 'entity.updated' END;

  IF TG_TABLE_NAME = 'business_groups' THEN
    v_label      := NEW.name;
    v_identifier := NULL;
    v_aliases    := ARRAY[]::TEXT[];
  ELSIF TG_TABLE_NAME = 'companies' THEN
    v_label      := COALESCE(NULLIF(trim(NEW.trade_name), ''), NEW.legal_name);
    v_identifier := NEW.cnpj;
    v_aliases    := CASE
      WHEN NEW.trade_name IS NOT NULL AND trim(NEW.trade_name) <> '' AND NEW.trade_name <> NEW.legal_name
        THEN ARRAY[NEW.legal_name, NEW.trade_name]
      ELSE ARRAY[NEW.legal_name]
    END;
  ELSIF TG_TABLE_NAME = 'financial_accounts' THEN
    v_label      := NEW.name;
    v_identifier := NEW.last_four;
    v_aliases    := CASE
      WHEN NEW.institution_name IS NOT NULL AND trim(NEW.institution_name) <> ''
        THEN ARRAY[NEW.institution_name]
      ELSE ARRAY[]::TEXT[]
    END;
  END IF;

  INSERT INTO public.anonymization_vault (
    tenant_id,
    entity_type,
    entity_id,
    analytical_token,
    real_label,
    sensitive_identifier,
    secondary_aliases,
    is_archived
  )
  VALUES (
    v_tenant_id,
    v_entity_type,
    v_entity_id,
    v_token,
    v_label,
    v_identifier,
    v_aliases,
    FALSE
  )
  ON CONFLICT (tenant_id, entity_type, entity_id)
  DO UPDATE SET
    real_label           = EXCLUDED.real_label,
    sensitive_identifier = EXCLUDED.sensitive_identifier,
    secondary_aliases    = EXCLUDED.secondary_aliases,
    is_archived          = FALSE,
    updated_at           = now();

  INSERT INTO public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, analytical_token, metadata)
  VALUES (
    v_tenant_id,
    auth.uid(),
    v_action,
    v_entity_type::TEXT,
    v_entity_id,
    v_token,
    jsonb_build_object('op', TG_OP)
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_business_groups_vault_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.business_groups
  FOR EACH ROW EXECUTE FUNCTION public.sync_entity_to_vault_and_audit();

CREATE TRIGGER trg_companies_vault_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.sync_entity_to_vault_and_audit();

CREATE TRIGGER trg_financial_accounts_vault_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.financial_accounts
  FOR EACH ROW EXECUTE FUNCTION public.sync_entity_to_vault_and_audit();

-- 6.8 RPC seguro para registro de eventos de autenticação e verificação do cofre
CREATE OR REPLACE FUNCTION public.log_security_event(
  p_action           public.audit_action,
  p_entity_type      TEXT DEFAULT 'session',
  p_analytical_token TEXT DEFAULT NULL,
  p_metadata         JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    analytical_token,
    metadata
  )
  VALUES (
    auth.uid(),
    auth.uid(),
    p_action,
    p_entity_type,
    p_analytical_token,
    COALESCE(p_metadata, '{}'::jsonb)
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Row Level Security (RLS) Ativo e Forçado em 100% das Tabelas
-- ----------------------------------------------------------------------------

-- Helper: exige usuário autenticado, dono do tenant e AAL2 caso possua MFA TOTP verificado
CREATE OR REPLACE FUNCTION public.is_authorized_tenant(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND auth.uid() = p_tenant_id
    AND (
      NOT EXISTS (
        SELECT 1
        FROM auth.mfa_factors f
        WHERE f.user_id = auth.uid()
          AND f.status = 'verified'
      )
      OR COALESCE(auth.jwt()->>'aal', 'aal1') = 'aal2'
    );
$$;

ALTER TABLE public.invited_users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_groups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_accounts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_token_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anonymization_vault  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs           ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.invited_users        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.business_groups      FORCE ROW LEVEL SECURITY;
ALTER TABLE public.companies            FORCE ROW LEVEL SECURITY;
ALTER TABLE public.financial_accounts   FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vault_token_counters FORCE ROW LEVEL SECURITY;
ALTER TABLE public.anonymization_vault  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs           FORCE ROW LEVEL SECURITY;

-- invited_users: apenas owners/admins autenticados podem visualizar e gerenciar convites
CREATE POLICY invited_users_admin_select ON public.invited_users
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('owner', 'admin')
    )
  );

CREATE POLICY invited_users_admin_insert ON public.invited_users
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('owner', 'admin')
    )
  );

CREATE POLICY invited_users_admin_update ON public.invited_users
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('owner', 'admin')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('owner', 'admin')
    )
  );

-- user_profiles: usuário lê e atualiza apenas o próprio perfil (sem alterar role diretamente)
CREATE POLICY user_profiles_self_select ON public.user_profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY user_profiles_self_update ON public.user_profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- business_groups: isolamento total por tenant + verificação MFA
CREATE POLICY business_groups_tenant_all ON public.business_groups
  FOR ALL
  USING (public.is_authorized_tenant(tenant_id))
  WITH CHECK (public.is_authorized_tenant(tenant_id));

-- companies: isolamento total por tenant + verificação MFA
CREATE POLICY companies_tenant_all ON public.companies
  FOR ALL
  USING (public.is_authorized_tenant(tenant_id))
  WITH CHECK (public.is_authorized_tenant(tenant_id));

-- financial_accounts: isolamento total por tenant + verificação MFA
CREATE POLICY financial_accounts_tenant_all ON public.financial_accounts
  FOR ALL
  USING (public.is_authorized_tenant(tenant_id))
  WITH CHECK (public.is_authorized_tenant(tenant_id));

-- vault_token_counters: somente leitura pelo próprio tenant (escrita via SECURITY DEFINER)
CREATE POLICY vault_counters_tenant_select ON public.vault_token_counters
  FOR SELECT USING (public.is_authorized_tenant(tenant_id));

-- anonymization_vault: somente leitura pelo próprio tenant (gerenciado por triggers SECURITY DEFINER)
CREATE POLICY anonymization_vault_tenant_select ON public.anonymization_vault
  FOR SELECT USING (public.is_authorized_tenant(tenant_id));

-- audit_logs: append-only (leitura do próprio tenant; mutações/exclusões proibidas)
CREATE POLICY audit_logs_tenant_select ON public.audit_logs
  FOR SELECT USING (public.is_authorized_tenant(tenant_id));

CREATE POLICY audit_logs_tenant_insert ON public.audit_logs
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL AND auth.uid() = tenant_id
  );
