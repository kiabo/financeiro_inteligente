-- ============================================================================
-- MÓDULO 4: SAÚDE FINANCEIRA, DRE GERENCIAL, DÍVIDAS E IMPOSTOS
-- Banco de Dados: PostgreSQL / Supabase (Incremental sobre 0001, 0002 e 0003)
-- Arquitetura: Privacy-by-Design, Tokenização CRD_XX para Credores, RLS 100% Ativo
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extensão de Enums e Novos Tipos do Módulo 4
-- ----------------------------------------------------------------------------
ALTER TYPE public.vault_entity_type ADD VALUE IF NOT EXISTS 'creditor';
ALTER TYPE public.category_group_type ADD VALUE IF NOT EXISTS 'financial_income';
ALTER TYPE public.category_group_type ADD VALUE IF NOT EXISTS 'financial_expense';

-- Necessário no PostgreSQL para efetivar os novos valores de ENUM antes de usá-los em INSERTs no mesmo script
COMMIT;
BEGIN;

DO $$ BEGIN
  CREATE TYPE public.debt_kind AS ENUM (
    'loan',
    'financing',
    'renegotiation',
    'credit_line'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.amortization_system AS ENUM ('sac', 'price');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.debt_status AS ENUM ('active', 'settled', 'renegotiated', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.debt_installment_status AS ENUM ('pending', 'paid', 'overdue', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.tax_type AS ENUM (
    'simples_nacional',
    'iss',
    'irpj_csll',
    'pis_cofins',
    'inss',
    'fgts',
    'icms',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.tax_obligation_status AS ENUM ('pending', 'paid', 'overdue', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 2. Atualização do Gerador de Tokens Analíticos (inclui CRD_XX para Credores)
-- ----------------------------------------------------------------------------
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
  v_prefix := CASE p_entity_type::TEXT
    WHEN 'group'    THEN 'GRP_'
    WHEN 'company'  THEN 'EMP_'
    WHEN 'account'  THEN 'CTA_'
    WHEN 'product'  THEN 'PRD_'
    WHEN 'service'  THEN 'SRV_'
    WHEN 'project'  THEN 'PRJ_'
    WHEN 'creditor' THEN 'CRD_'
    ELSE 'ENT_'
  END;

  INSERT INTO public.vault_token_counters (tenant_id, entity_type, last_seq)
  VALUES (p_tenant_id, p_entity_type, 1)
  ON CONFLICT (tenant_id, entity_type)
  DO UPDATE SET last_seq = public.vault_token_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;

  RETURN v_prefix || lpad(v_seq::TEXT, 2, '0');
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Extensão do Plano de Contas (8.0 Resultado Financeiro para DRE Linha 8)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_financial_result_categories_for_company(
  p_tenant_id  UUID,
  p_company_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fin_id UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.categories
    WHERE company_id = p_company_id AND code = '8.0'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.categories (
    tenant_id, company_id, parent_id, code, name, group_type, direction, is_system
  )
  VALUES (
    p_tenant_id, p_company_id, NULL, '8.0', 'Resultado Financeiro', 'financial_expense', 'neutral', TRUE
  )
  RETURNING id INTO v_fin_id;

  INSERT INTO public.categories (
    tenant_id, company_id, parent_id, code, name, group_type, direction, is_system
  ) VALUES
    (p_tenant_id, p_company_id, v_fin_id, '8.1', 'Receitas Financeiras e Rendimentos', 'financial_income', 'inflow', TRUE),
    (p_tenant_id, p_company_id, v_fin_id, '8.2', 'Juros, Multas e Encargos Financeiros', 'financial_expense', 'outflow', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_fn_seed_company_categories()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_default_categories_for_company(NEW.tenant_id, NEW.id);
  PERFORM public.seed_financial_result_categories_for_company(NEW.tenant_id, NEW.id);
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id, tenant_id FROM public.companies LOOP
    PERFORM public.seed_financial_result_categories_for_company(r.tenant_id, r.id);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 4. Tabela de Dívidas, Empréstimos & Renegociações (debts)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.debts (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id                UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  account_id                UUID REFERENCES public.financial_accounts(id) ON DELETE SET NULL,
  title                     TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 2 AND 160),
  creditor_name             TEXT NOT NULL CHECK (char_length(trim(creditor_name)) BETWEEN 2 AND 140),
  contract_code             TEXT CHECK (contract_code IS NULL OR char_length(trim(contract_code)) <= 60),
  debt_kind                 public.debt_kind NOT NULL DEFAULT 'loan',
  amortization_system       public.amortization_system NOT NULL DEFAULT 'price',
  principal_amount          NUMERIC(14, 2) NOT NULL CHECK (principal_amount > 0),
  monthly_interest_rate_pct NUMERIC(7, 4) NOT NULL DEFAULT 0 CHECK (monthly_interest_rate_pct >= 0 AND monthly_interest_rate_pct <= 100),
  total_installments        INTEGER NOT NULL CHECK (total_installments BETWEEN 1 AND 360),
  first_due_date            DATE NOT NULL,
  status                    public.debt_status NOT NULL DEFAULT 'active',
  creditor_token            TEXT NOT NULL,
  notes                     TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_debts_tenant_token UNIQUE (tenant_id, creditor_token)
);

CREATE INDEX IF NOT EXISTS idx_debts_tenant_company
  ON public.debts (tenant_id, company_id, status);

DROP TRIGGER IF EXISTS trg_debts_updated_at ON public.debts;
CREATE TRIGGER trg_debts_updated_at
  BEFORE UPDATE ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.validate_debt_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = NEW.company_id AND c.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Violação de isolamento de tenant: empresa inválida para a dívida.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.account_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.financial_accounts fa
      WHERE fa.id = NEW.account_id
        AND fa.company_id = NEW.company_id
        AND fa.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'Conta financeira inválida para a empresa/tenant da dívida.'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_debt_tenant ON public.debts;
CREATE TRIGGER trg_validate_debt_tenant
  BEFORE INSERT OR UPDATE ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.validate_debt_tenant();

-- Tokenização automática imutável de credor (CRD_XX)
CREATE OR REPLACE FUNCTION public.assign_debt_creditor_token()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.creditor_token := public.next_analytical_token(NEW.tenant_id, 'creditor'::public.vault_entity_type);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.creditor_token IS DISTINCT FROM OLD.creditor_token THEN
      RAISE EXCEPTION 'Token analítico de credor é imutável após criação.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_debts_creditor_token ON public.debts;
CREATE TRIGGER trg_debts_creditor_token
  BEFORE INSERT OR UPDATE ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.assign_debt_creditor_token();

-- Sincronização automática do nome do credor no Cofre de Anonimização + Auditoria (CRD_XX)
CREATE OR REPLACE FUNCTION public.sync_debt_creditor_to_vault_and_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_aliases TEXT[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.anonymization_vault
       SET is_archived = TRUE,
           updated_at  = now()
     WHERE tenant_id   = OLD.tenant_id
       AND entity_type = 'creditor'::public.vault_entity_type
       AND entity_id   = OLD.id;

    INSERT INTO public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, analytical_token, metadata)
    VALUES (
      OLD.tenant_id,
      auth.uid(),
      'entity.deleted',
      'creditor',
      OLD.id,
      OLD.creditor_token,
      jsonb_build_object('archived_in_vault', TRUE, 'debt_kind', OLD.debt_kind)
    );

    RETURN OLD;
  END IF;

  v_aliases := CASE
    WHEN NEW.contract_code IS NOT NULL AND trim(NEW.contract_code) <> ''
      THEN ARRAY[trim(NEW.contract_code)]
    ELSE ARRAY[]::TEXT[]
  END;

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
    NEW.tenant_id,
    'creditor'::public.vault_entity_type,
    NEW.id,
    NEW.creditor_token,
    NEW.creditor_name,
    NEW.contract_code,
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
    NEW.tenant_id,
    auth.uid(),
    CASE WHEN TG_OP = 'INSERT' THEN 'entity.created'::public.audit_action ELSE 'entity.updated'::public.audit_action END,
    'creditor',
    NEW.id,
    NEW.creditor_token,
    jsonb_build_object('op', TG_OP, 'system', NEW.amortization_system, 'installments', NEW.total_installments)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_debts_vault_audit ON public.debts;
CREATE TRIGGER trg_debts_vault_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.sync_debt_creditor_to_vault_and_audit();

-- ----------------------------------------------------------------------------
-- 5. Tabela de Cronograma de Parcelas (debt_installments)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.debt_installments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  debt_id            UUID NOT NULL REFERENCES public.debts(id) ON DELETE CASCADE,
  installment_number INTEGER NOT NULL CHECK (installment_number >= 1),
  due_date           DATE NOT NULL,
  principal_portion  NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (principal_portion >= 0),
  interest_portion   NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (interest_portion >= 0),
  total_amount       NUMERIC(14, 2) NOT NULL CHECK (total_amount >= 0),
  remaining_balance  NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (remaining_balance >= 0),
  status             public.debt_installment_status NOT NULL DEFAULT 'pending',
  paid_date          DATE,
  transaction_id     UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_debt_installment_num UNIQUE (debt_id, installment_number)
);

CREATE INDEX IF NOT EXISTS idx_debt_installments_tenant_debt
  ON public.debt_installments (tenant_id, debt_id, installment_number ASC);

CREATE INDEX IF NOT EXISTS idx_debt_installments_tenant_due
  ON public.debt_installments (tenant_id, status, due_date);

DROP TRIGGER IF EXISTS trg_debt_installments_updated_at ON public.debt_installments;
CREATE TRIGGER trg_debt_installments_updated_at
  BEFORE UPDATE ON public.debt_installments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.validate_debt_installment_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.debts d
    WHERE d.id = NEW.debt_id AND d.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Violação de isolamento de tenant: dívida inválida para parcela.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.transaction_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.id = NEW.transaction_id AND t.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'Transação vinculada à parcela não pertence ao tenant.'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_debt_installment_tenant ON public.debt_installments;
CREATE TRIGGER trg_validate_debt_installment_tenant
  BEFORE INSERT OR UPDATE ON public.debt_installments
  FOR EACH ROW EXECUTE FUNCTION public.validate_debt_installment_tenant();

-- ----------------------------------------------------------------------------
-- 6. Tabela de Obrigações Fiscais e Impostos (tax_obligations)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tax_obligations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  account_id          UUID REFERENCES public.financial_accounts(id) ON DELETE SET NULL,
  tax_name            TEXT NOT NULL CHECK (char_length(trim(tax_name)) BETWEEN 2 AND 140),
  tax_type            public.tax_type NOT NULL DEFAULT 'simples_nacional',
  competence_month    DATE NOT NULL,
  due_date            DATE NOT NULL,
  revenue_base_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (revenue_base_amount >= 0),
  estimated_rate_pct  NUMERIC(6, 3) NOT NULL DEFAULT 0 CHECK (estimated_rate_pct >= 0 AND estimated_rate_pct <= 100),
  amount              NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  status              public.tax_obligation_status NOT NULL DEFAULT 'pending',
  paid_date           DATE,
  is_recurring        BOOLEAN NOT NULL DEFAULT TRUE,
  guide_reference     TEXT,
  transaction_id      UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tax_obligations_tenant_company_due
  ON public.tax_obligations (tenant_id, company_id, due_date ASC);

CREATE INDEX IF NOT EXISTS idx_tax_obligations_tenant_status
  ON public.tax_obligations (tenant_id, status, due_date);

DROP TRIGGER IF EXISTS trg_tax_obligations_updated_at ON public.tax_obligations;
CREATE TRIGGER trg_tax_obligations_updated_at
  BEFORE UPDATE ON public.tax_obligations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.validate_tax_obligation_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = NEW.company_id AND c.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Violação de isolamento de tenant: empresa inválida para guia fiscal.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.account_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.financial_accounts fa
      WHERE fa.id = NEW.account_id
        AND fa.company_id = NEW.company_id
        AND fa.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'Conta financeira inválida para a obrigação fiscal.'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  NEW.competence_month := date_trunc('month', NEW.competence_month)::DATE;

  IF NEW.status = 'paid' AND NEW.paid_date IS NULL THEN
    NEW.paid_date := CURRENT_DATE;
  ELSIF NEW.status IN ('pending', 'overdue') THEN
    IF NEW.due_date < CURRENT_DATE THEN
      NEW.status := 'overdue';
    ELSE
      NEW.status := 'pending';
    END IF;
    NEW.paid_date := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_tax_obligation_tenant ON public.tax_obligations;
CREATE TRIGGER trg_validate_tax_obligation_tenant
  BEFORE INSERT OR UPDATE ON public.tax_obligations
  FOR EACH ROW EXECUTE FUNCTION public.validate_tax_obligation_tenant();

-- ----------------------------------------------------------------------------
-- 7. Funções Otimizadas de Agregação para DRE Gerencial e Ranking de Rentabilidade
-- (100% exclusão de transferências internas + SECURITY INVOKER + RLS)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dre_aggregation(
  p_scope      TEXT DEFAULT 'all_independent',
  p_entity_id  UUID DEFAULT NULL,
  p_regime     TEXT DEFAULT 'cash',
  p_start_date DATE DEFAULT date_trunc('month', CURRENT_DATE)::DATE,
  p_end_date   DATE DEFAULT (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::DATE
)
RETURNS TABLE (
  group_type   TEXT,
  category_id  UUID,
  category_code TEXT,
  category_name TEXT,
  tx_type      public.transaction_type,
  total_amount NUMERIC(14, 2)
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE(cat.group_type::TEXT, CASE WHEN t.transaction_type = 'income' THEN 'operational_revenue' ELSE 'variable_expense' END) AS group_type,
    cat.id AS category_id,
    COALESCE(cat.code, '9.9') AS category_code,
    COALESCE(cat.name, 'Sem Categoria') AS category_name,
    t.transaction_type AS tx_type,
    COALESCE(SUM(t.amount), 0)::NUMERIC(14, 2) AS total_amount
  FROM public.transactions t
  JOIN public.companies c ON c.id = t.company_id
  LEFT JOIN public.categories cat ON cat.id = t.category_id
  WHERE public.is_authorized_tenant(t.tenant_id)
    AND t.status <> 'canceled'
    AND t.transaction_type <> 'transfer'
    AND (p_regime <> 'cash' OR t.status = 'paid')
    AND (
      CASE WHEN p_regime = 'competence' THEN t.competence_date ELSE COALESCE(t.payment_date, t.due_date) END
    ) BETWEEN p_start_date AND p_end_date
    AND (
      p_scope = 'all_independent'
      OR (p_scope = 'group'   AND c.group_id   = p_entity_id)
      OR (p_scope = 'company' AND t.company_id = p_entity_id)
      OR (p_scope = 'account' AND t.account_id = p_entity_id)
    )
  GROUP BY
    COALESCE(cat.group_type::TEXT, CASE WHEN t.transaction_type = 'income' THEN 'operational_revenue' ELSE 'variable_expense' END),
    cat.id,
    COALESCE(cat.code, '9.9'),
    COALESCE(cat.name, 'Sem Categoria'),
    t.transaction_type
  ORDER BY category_code ASC;
$$;

CREATE OR REPLACE FUNCTION public.get_profitability_ranking(
  p_scope      TEXT DEFAULT 'all_independent',
  p_entity_id  UUID DEFAULT NULL,
  p_start_date DATE DEFAULT date_trunc('month', CURRENT_DATE)::DATE,
  p_end_date   DATE DEFAULT (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::DATE
)
RETURNS TABLE (
  dimension        TEXT,
  entity_id        UUID,
  analytical_token TEXT,
  display_name     TEXT,
  gross_revenue    NUMERIC(14, 2),
  direct_costs     NUMERIC(14, 2),
  taxes_deductions NUMERIC(14, 2),
  operating_costs  NUMERIC(14, 2),
  net_result       NUMERIC(14, 2)
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH scoped_paid AS (
    SELECT
      t.*,
      c.group_id,
      c.analytical_token AS company_token,
      COALESCE(NULLIF(trim(c.trade_name), ''), c.legal_name) AS company_label,
      cat.group_type AS cat_group
    FROM public.transactions t
    JOIN public.companies c ON c.id = t.company_id
    LEFT JOIN public.categories cat ON cat.id = t.category_id
    WHERE public.is_authorized_tenant(t.tenant_id)
      AND t.status = 'paid'
      AND t.transaction_type <> 'transfer'
      AND COALESCE(t.payment_date, t.due_date) BETWEEN p_start_date AND p_end_date
      AND (
        p_scope = 'all_independent'
        OR (p_scope = 'group'   AND c.group_id   = p_entity_id)
        OR (p_scope = 'company' AND t.company_id = p_entity_id)
        OR (p_scope = 'account' AND t.account_id = p_entity_id)
      )
  )
  -- Dimensão: Produto / Serviço
  SELECT
    'product'::TEXT AS dimension,
    ps.id AS entity_id,
    ps.analytical_token,
    ps.name AS display_name,
    COALESCE(SUM(CASE WHEN sp.transaction_type = 'income' THEN sp.amount ELSE 0 END), 0)::NUMERIC(14, 2) AS gross_revenue,
    COALESCE(SUM(CASE WHEN sp.transaction_type = 'expense' AND COALESCE(sp.cat_group::TEXT, '') <> 'tax_deduction' THEN sp.amount ELSE 0 END), 0)::NUMERIC(14, 2) AS direct_costs,
    COALESCE(SUM(CASE WHEN sp.transaction_type = 'expense' AND sp.cat_group::TEXT = 'tax_deduction' THEN sp.amount ELSE 0 END), 0)::NUMERIC(14, 2) AS taxes_deductions,
    0::NUMERIC(14, 2) AS operating_costs,
    (
      COALESCE(SUM(CASE WHEN sp.transaction_type = 'income' THEN sp.amount ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN sp.transaction_type = 'expense' THEN sp.amount ELSE 0 END), 0)
    )::NUMERIC(14, 2) AS net_result
  FROM scoped_paid sp
  JOIN public.products_services ps ON ps.id = sp.product_service_id
  GROUP BY ps.id, ps.analytical_token, ps.name

  UNION ALL

  -- Dimensão: Projeto
  SELECT
    'project'::TEXT AS dimension,
    prj.id AS entity_id,
    prj.analytical_token,
    prj.name AS display_name,
    COALESCE(SUM(CASE WHEN sp.transaction_type = 'income' THEN sp.amount ELSE 0 END), 0)::NUMERIC(14, 2) AS gross_revenue,
    COALESCE(SUM(CASE WHEN sp.transaction_type = 'expense' THEN sp.amount ELSE 0 END), 0)::NUMERIC(14, 2) AS direct_costs,
    0::NUMERIC(14, 2) AS taxes_deductions,
    prj.initial_investment AS operating_costs,
    (
      COALESCE(SUM(CASE WHEN sp.transaction_type = 'income' THEN sp.amount ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN sp.transaction_type = 'expense' THEN sp.amount ELSE 0 END), 0)
    )::NUMERIC(14, 2) AS net_result
  FROM scoped_paid sp
  JOIN public.projects prj ON prj.id = sp.project_id
  GROUP BY prj.id, prj.analytical_token, prj.name, prj.initial_investment

  UNION ALL

  -- Dimensão: Empresa
  SELECT
    'company'::TEXT AS dimension,
    sp.company_id AS entity_id,
    sp.company_token AS analytical_token,
    sp.company_label AS display_name,
    COALESCE(SUM(CASE WHEN sp.transaction_type = 'income' THEN sp.amount ELSE 0 END), 0)::NUMERIC(14, 2) AS gross_revenue,
    COALESCE(SUM(CASE WHEN sp.transaction_type = 'expense' AND sp.cat_group::TEXT = 'direct_cost' THEN sp.amount ELSE 0 END), 0)::NUMERIC(14, 2) AS direct_costs,
    COALESCE(SUM(CASE WHEN sp.transaction_type = 'expense' AND sp.cat_group::TEXT = 'tax_deduction' THEN sp.amount ELSE 0 END), 0)::NUMERIC(14, 2) AS taxes_deductions,
    COALESCE(SUM(CASE WHEN sp.transaction_type = 'expense' AND COALESCE(sp.cat_group::TEXT, '') NOT IN ('direct_cost', 'tax_deduction', 'financial_movement') THEN sp.amount ELSE 0 END), 0)::NUMERIC(14, 2) AS operating_costs,
    (
      COALESCE(SUM(CASE WHEN sp.transaction_type = 'income' THEN sp.amount ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN sp.transaction_type = 'expense' AND COALESCE(sp.cat_group::TEXT, '') <> 'financial_movement' THEN sp.amount ELSE 0 END), 0)
    )::NUMERIC(14, 2) AS net_result
  FROM scoped_paid sp
  GROUP BY sp.company_id, sp.company_token, sp.company_label;
$$;

-- ----------------------------------------------------------------------------
-- 8. Row Level Security (RLS) Ativo e Forçado nas Novas Tabelas
-- ----------------------------------------------------------------------------
ALTER TABLE public.debts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debt_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_obligations   ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.debts             FORCE ROW LEVEL SECURITY;
ALTER TABLE public.debt_installments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tax_obligations   FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS debts_tenant_all ON public.debts;
CREATE POLICY debts_tenant_all ON public.debts
  FOR ALL
  USING (public.is_authorized_tenant(tenant_id))
  WITH CHECK (public.is_authorized_tenant(tenant_id));

DROP POLICY IF EXISTS debt_installments_tenant_all ON public.debt_installments;
CREATE POLICY debt_installments_tenant_all ON public.debt_installments
  FOR ALL
  USING (public.is_authorized_tenant(tenant_id))
  WITH CHECK (public.is_authorized_tenant(tenant_id));

DROP POLICY IF EXISTS tax_obligations_tenant_all ON public.tax_obligations;
CREATE POLICY tax_obligations_tenant_all ON public.tax_obligations
  FOR ALL
  USING (public.is_authorized_tenant(tenant_id))
  WITH CHECK (public.is_authorized_tenant(tenant_id));

COMMIT;
