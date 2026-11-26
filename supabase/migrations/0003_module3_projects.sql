-- ============================================================================
-- MÓDULO 3: PROJETOS, SIMULADOR DE VIABILIDADE E PREVISTO VS. REALIZADO
-- Banco de Dados: PostgreSQL / Supabase (Incremental sobre 0001 e 0002)
-- Arquitetura: Privacy-by-Design, Tokenização PRJ_XX, RLS 100% Ativo
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extensão de Enums e Novos Tipos do Módulo 3
-- ----------------------------------------------------------------------------
ALTER TYPE public.vault_entity_type ADD VALUE IF NOT EXISTS 'project';

DO $$ BEGIN
  CREATE TYPE public.project_status AS ENUM (
    'idea_simulation',
    'approved',
    'in_progress',
    'completed',
    'canceled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.project_scenario_type AS ENUM (
    'realistic',
    'conservative',
    'optimistic'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.forecast_item_direction AS ENUM (
    'revenue',
    'direct_cost',
    'fixed_cost',
    'capex'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 2. Atualização do Gerador de Tokens Analíticos (GRP_, EMP_, CTA_, PRD_, SRV_, PRJ_)
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
    WHEN 'group'   THEN 'GRP_'
    WHEN 'company' THEN 'EMP_'
    WHEN 'account' THEN 'CTA_'
    WHEN 'product' THEN 'PRD_'
    WHEN 'service' THEN 'SRV_'
    WHEN 'project' THEN 'PRJ_'
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
-- 3. Tabela de Projetos & Simulações (projects)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projects (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id                    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name                          TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 140),
  hypothesis                    TEXT,
  status                        public.project_status NOT NULL DEFAULT 'idea_simulation',
  active_scenario               public.project_scenario_type NOT NULL DEFAULT 'realistic',
  planned_start_date            DATE NOT NULL,
  planned_end_date              DATE NOT NULL,
  initial_investment            NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (initial_investment >= 0),
  monthly_fixed_cost_allocation NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (monthly_fixed_cost_allocation >= 0),
  analytical_token              TEXT NOT NULL,
  is_active                     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_projects_dates CHECK (planned_end_date >= planned_start_date),
  CONSTRAINT uq_projects_tenant_token UNIQUE (tenant_id, analytical_token)
);

CREATE INDEX IF NOT EXISTS idx_projects_tenant_company
  ON public.projects (tenant_id, company_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_projects_tenant_status
  ON public.projects (tenant_id, status);

CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Validação de isolamento de tenant para projects
CREATE OR REPLACE FUNCTION public.validate_project_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = NEW.company_id AND c.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Violação de isolamento de tenant: empresa inválida para o projeto.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_project_tenant
  BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.validate_project_tenant();

-- Tokenização automática imutável (PRJ_XX)
CREATE OR REPLACE FUNCTION public.assign_project_token()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.analytical_token := public.next_analytical_token(NEW.tenant_id, 'project'::public.vault_entity_type);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.analytical_token IS DISTINCT FROM OLD.analytical_token THEN
      RAISE EXCEPTION 'Token analítico de projeto é imutável após criação.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_projects_token
  BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.assign_project_token();

-- Sincronização automática do Cofre de Anonimização + Auditoria para PRJ_XX
CREATE OR REPLACE FUNCTION public.sync_project_to_vault_and_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.anonymization_vault
       SET is_archived = TRUE,
           updated_at  = now()
     WHERE tenant_id   = OLD.tenant_id
       AND entity_type = 'project'::public.vault_entity_type
       AND entity_id   = OLD.id;

    INSERT INTO public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, analytical_token, metadata)
    VALUES (
      OLD.tenant_id,
      auth.uid(),
      'entity.deleted',
      'project',
      OLD.id,
      OLD.analytical_token,
      jsonb_build_object('archived_in_vault', TRUE)
    );

    RETURN OLD;
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
    NEW.tenant_id,
    'project'::public.vault_entity_type,
    NEW.id,
    NEW.analytical_token,
    NEW.name,
    NULL,
    ARRAY[]::TEXT[],
    FALSE
  )
  ON CONFLICT (tenant_id, entity_type, entity_id)
  DO UPDATE SET
    real_label  = EXCLUDED.real_label,
    is_archived = FALSE,
    updated_at  = now();

  INSERT INTO public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, analytical_token, metadata)
  VALUES (
    NEW.tenant_id,
    auth.uid(),
    CASE WHEN TG_OP = 'INSERT' THEN 'entity.created'::public.audit_action ELSE 'entity.updated'::public.audit_action END,
    'project',
    NEW.id,
    NEW.analytical_token,
    jsonb_build_object('op', TG_OP, 'status', NEW.status, 'scenario', NEW.active_scenario)
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_projects_vault_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.sync_project_to_vault_and_audit();

-- ----------------------------------------------------------------------------
-- 4. Tabela de Premissas & Previsões do Projeto (project_forecast_items)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_forecast_items (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id                  UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scenario                    public.project_scenario_type NOT NULL DEFAULT 'realistic',
  month_date                  DATE NOT NULL,
  product_service_id          UUID REFERENCES public.products_services(id) ON DELETE SET NULL,
  direction                   public.forecast_item_direction NOT NULL,
  label                       TEXT NOT NULL CHECK (char_length(trim(label)) BETWEEN 2 AND 160),
  quantity                    NUMERIC(12, 2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price                  NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  unit_direct_cost            NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (unit_direct_cost >= 0),
  payment_fee_pct             NUMERIC(6, 3) NOT NULL DEFAULT 0 CHECK (payment_fee_pct >= 0 AND payment_fee_pct <= 100),
  tax_rate_pct                NUMERIC(6, 3) NOT NULL DEFAULT 0 CHECK (tax_rate_pct >= 0 AND tax_rate_pct <= 100),
  gross_amount                NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (gross_amount >= 0),
  estimated_direct_cost_total NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (estimated_direct_cost_total >= 0),
  estimated_deductions_total  NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (estimated_deductions_total >= 0),
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_forecast_tenant_project_scenario
  ON public.project_forecast_items (tenant_id, project_id, scenario, month_date ASC);

CREATE TRIGGER trg_project_forecast_updated_at
  BEFORE UPDATE ON public.project_forecast_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.validate_project_forecast_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = NEW.project_id AND p.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Violação de isolamento de tenant: projeto inválido para item previsto.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.product_service_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.products_services ps
      WHERE ps.id = NEW.product_service_id AND ps.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'Produto/Serviço inválido para o item previsto do projeto.'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  -- Normaliza mês para o primeiro dia do mês
  NEW.month_date := date_trunc('month', NEW.month_date)::DATE;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_project_forecast_tenant
  BEFORE INSERT OR UPDATE ON public.project_forecast_items
  FOR EACH ROW EXECUTE FUNCTION public.validate_project_forecast_tenant();

-- ----------------------------------------------------------------------------
-- 5. Conexão transactions.project_id -> projects.id + Validação de Integridade
-- ----------------------------------------------------------------------------
UPDATE public.transactions t
   SET project_id = NULL
 WHERE t.project_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.projects p WHERE p.id = t.project_id
   );

DO $$ BEGIN
  ALTER TABLE public.transactions
    ADD CONSTRAINT fk_transactions_project
    FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_tenant_project
  ON public.transactions (tenant_id, project_id)
  WHERE project_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_transaction_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = NEW.company_id AND c.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Violação de isolamento de tenant: empresa inválida para o lançamento.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.financial_accounts fa
    WHERE fa.id = NEW.account_id
      AND fa.company_id = NEW.company_id
      AND fa.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Conta financeira de origem não pertence à empresa/tenant selecionado.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.transaction_type = 'transfer' THEN
    IF NEW.destination_account_id IS NULL OR NEW.destination_account_id = NEW.account_id THEN
      RAISE EXCEPTION 'Transferência interna exige uma conta de destino distinta da origem.'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.financial_accounts fa
      WHERE fa.id = NEW.destination_account_id AND fa.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'Violação de isolamento de tenant: conta de destino inválida.'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  IF NEW.category_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.categories cat
      WHERE cat.id = NEW.category_id AND cat.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'Categoria contábil inválida para o tenant.'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  IF NEW.product_service_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.products_services ps
      WHERE ps.id = NEW.product_service_id AND ps.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'Produto/Serviço inválido para o tenant.'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  IF NEW.project_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.projects prj
      WHERE prj.id = NEW.project_id
        AND prj.tenant_id = NEW.tenant_id
        AND prj.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'Projeto inválido ou pertencente a outra empresa/tenant.'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  -- Coerência de status e data de pagamento (Caixa)
  IF NEW.status = 'paid' AND NEW.payment_date IS NULL THEN
    NEW.payment_date := CURRENT_DATE;
  ELSIF NEW.status IN ('pending', 'overdue') THEN
    IF NEW.due_date < CURRENT_DATE THEN
      NEW.status := 'overdue';
    ELSE
      NEW.status := 'pending';
    END IF;
    NEW.payment_date := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Row Level Security (RLS) Ativo e Forçado nas Novas Tabelas
-- ----------------------------------------------------------------------------
ALTER TABLE public.projects               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_forecast_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.projects               FORCE ROW LEVEL SECURITY;
ALTER TABLE public.project_forecast_items FORCE ROW LEVEL SECURITY;

CREATE POLICY projects_tenant_all ON public.projects
  FOR ALL
  USING (public.is_authorized_tenant(tenant_id))
  WITH CHECK (public.is_authorized_tenant(tenant_id));

CREATE POLICY project_forecast_items_tenant_all ON public.project_forecast_items
  FOR ALL
  USING (public.is_authorized_tenant(tenant_id))
  WITH CHECK (public.is_authorized_tenant(tenant_id));
