-- ============================================================================
-- MÓDULO 2: CORE FINANCEIRO (CAIXA & COMPETÊNCIA) + CATÁLOGO DE PRODUTOS/SERVIÇOS
-- Banco de Dados: PostgreSQL / Supabase (Incremental sobre 0001_module1_foundation.sql)
-- Arquitetura: Privacy-by-Design, Tokenização PRD_XX / SRV_XX, RLS 100% Ativo
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extensão de Enums do Módulo 1 e Novos Tipos Enumerados
-- ----------------------------------------------------------------------------
ALTER TYPE public.vault_entity_type ADD VALUE IF NOT EXISTS 'product';
ALTER TYPE public.vault_entity_type ADD VALUE IF NOT EXISTS 'service';

DO $$ BEGIN
  CREATE TYPE public.product_service_type AS ENUM ('product', 'service');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.offer_kind AS ENUM ('physical_product', 'digital_product', 'service');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.category_group_type AS ENUM (
    'operational_revenue',
    'tax_deduction',
    'direct_cost',
    'fixed_expense',
    'variable_expense',
    'capex',
    'financial_movement'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.category_direction AS ENUM ('inflow', 'outflow', 'neutral');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.transaction_type AS ENUM ('income', 'expense', 'transfer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.transaction_status AS ENUM ('pending', 'paid', 'overdue', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 2. Atualização do Gerador de Tokens Analíticos (GRP_, EMP_, CTA_, PRD_, SRV_)
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
-- 3. Catálogo de Produtos e Serviços (products_services)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products_services (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id            UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  group_id              UUID REFERENCES public.business_groups(id) ON DELETE SET NULL,
  name                  TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 140),
  item_type             public.product_service_type NOT NULL,
  offer_kind            public.offer_kind NOT NULL,
  sku_code              TEXT CHECK (sku_code IS NULL OR char_length(trim(sku_code)) <= 40),
  base_price            NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (base_price >= 0),
  estimated_direct_cost NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (estimated_direct_cost >= 0),
  payment_fee_pct       NUMERIC(6, 3) NOT NULL DEFAULT 0 CHECK (payment_fee_pct >= 0 AND payment_fee_pct <= 100),
  estimated_tax_pct     NUMERIC(6, 3) NOT NULL DEFAULT 0 CHECK (estimated_tax_pct >= 0 AND estimated_tax_pct <= 100),
  description           TEXT,
  analytical_token      TEXT NOT NULL,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_products_services_scope CHECK (company_id IS NOT NULL OR group_id IS NOT NULL),
  CONSTRAINT uq_products_services_tenant_token UNIQUE (tenant_id, analytical_token)
);

CREATE INDEX IF NOT EXISTS idx_products_services_tenant_company
  ON public.products_services (tenant_id, company_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_products_services_tenant_group
  ON public.products_services (tenant_id, group_id)
  WHERE group_id IS NOT NULL AND is_active = TRUE;

CREATE TRIGGER trg_products_services_updated_at
  BEFORE UPDATE ON public.products_services
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Validação de isolamento de tenant para products_services
CREATE OR REPLACE FUNCTION public.validate_product_service_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.company_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = NEW.company_id AND c.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'Violação de isolamento de tenant: empresa inválida para o produto/serviço.'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  IF NEW.group_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.business_groups bg
      WHERE bg.id = NEW.group_id AND bg.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'Violação de isolamento de tenant: grupo inválido para o produto/serviço.'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  -- Alinha item_type com offer_kind
  IF NEW.offer_kind = 'service' THEN
    NEW.item_type := 'service'::public.product_service_type;
  ELSE
    NEW.item_type := 'product'::public.product_service_type;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_product_service_tenant
  BEFORE INSERT OR UPDATE ON public.products_services
  FOR EACH ROW EXECUTE FUNCTION public.validate_product_service_tenant();

-- Tokenização automática imutável (PRD_XX / SRV_XX)
CREATE OR REPLACE FUNCTION public.assign_product_service_token()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vault_type public.vault_entity_type;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_vault_type := CASE NEW.item_type
      WHEN 'service' THEN 'service'::public.vault_entity_type
      ELSE 'product'::public.vault_entity_type
    END;
    NEW.analytical_token := public.next_analytical_token(NEW.tenant_id, v_vault_type);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.analytical_token IS DISTINCT FROM OLD.analytical_token THEN
      RAISE EXCEPTION 'Token analítico de produto/serviço é imutável após criação.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_products_services_token
  BEFORE INSERT OR UPDATE ON public.products_services
  FOR EACH ROW EXECUTE FUNCTION public.assign_product_service_token();

-- Sincronização automática do Cofre de Anonimização + Auditoria para PRD_XX / SRV_XX
CREATE OR REPLACE FUNCTION public.sync_product_service_to_vault_and_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vault_type public.vault_entity_type;
  v_aliases    TEXT[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_vault_type := CASE OLD.item_type
      WHEN 'service' THEN 'service'::public.vault_entity_type
      ELSE 'product'::public.vault_entity_type
    END;

    UPDATE public.anonymization_vault
       SET is_archived = TRUE,
           updated_at  = now()
     WHERE tenant_id   = OLD.tenant_id
       AND entity_type = v_vault_type
       AND entity_id   = OLD.id;

    INSERT INTO public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, analytical_token, metadata)
    VALUES (
      OLD.tenant_id,
      auth.uid(),
      'entity.deleted',
      v_vault_type::TEXT,
      OLD.id,
      OLD.analytical_token,
      jsonb_build_object('archived_in_vault', TRUE)
    );

    RETURN OLD;
  END IF;

  v_vault_type := CASE NEW.item_type
    WHEN 'service' THEN 'service'::public.vault_entity_type
    ELSE 'product'::public.vault_entity_type
  END;

  v_aliases := CASE
    WHEN NEW.sku_code IS NOT NULL AND trim(NEW.sku_code) <> ''
      THEN ARRAY[trim(NEW.sku_code)]
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
    v_vault_type,
    NEW.id,
    NEW.analytical_token,
    NEW.name,
    NEW.sku_code,
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
    v_vault_type::TEXT,
    NEW.id,
    NEW.analytical_token,
    jsonb_build_object('op', TG_OP, 'offer_kind', NEW.offer_kind)
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_products_services_vault_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.products_services
  FOR EACH ROW EXECUTE FUNCTION public.sync_product_service_to_vault_and_audit();

-- ----------------------------------------------------------------------------
-- 4. Plano de Contas / Categorias Hierárquicas (categories)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  parent_id   UUID REFERENCES public.categories(id) ON DELETE CASCADE,
  code        TEXT NOT NULL CHECK (char_length(trim(code)) BETWEEN 1 AND 20),
  name        TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 120),
  group_type  public.category_group_type NOT NULL,
  direction   public.category_direction NOT NULL,
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_categories_company_code UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_categories_tenant_company
  ON public.categories (tenant_id, company_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_categories_parent
  ON public.categories (parent_id)
  WHERE parent_id IS NOT NULL;

CREATE TRIGGER trg_categories_updated_at
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.validate_category_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = NEW.company_id AND c.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Violação de isolamento de tenant: empresa inválida para categoria.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.parent_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.categories p
      WHERE p.id = NEW.parent_id
        AND p.company_id = NEW.company_id
        AND p.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'Categoria pai inválida para esta empresa/tenant.'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_category_tenant
  BEFORE INSERT OR UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.validate_category_tenant();

-- Seed automático do Plano de Contas inicial para novas empresas
CREATE OR REPLACE FUNCTION public.seed_default_categories_for_company(
  p_tenant_id  UUID,
  p_company_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rev_id   UUID;
  v_ded_id   UUID;
  v_cost_id  UUID;
  v_fix_id   UUID;
  v_var_id   UUID;
  v_capex_id UUID;
  v_mov_id   UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM public.categories WHERE company_id = p_company_id) THEN
    RETURN;
  END IF;

  INSERT INTO public.categories (tenant_id, company_id, parent_id, code, name, group_type, direction, is_system)
  VALUES (p_tenant_id, p_company_id, NULL, '1.0', 'Receita Operacional', 'operational_revenue', 'inflow', TRUE)
  RETURNING id INTO v_rev_id;

  INSERT INTO public.categories (tenant_id, company_id, parent_id, code, name, group_type, direction, is_system) VALUES
    (p_tenant_id, p_company_id, v_rev_id, '1.1', 'Venda de Produtos', 'operational_revenue', 'inflow', TRUE),
    (p_tenant_id, p_company_id, v_rev_id, '1.2', 'Prestação de Serviços', 'operational_revenue', 'inflow', TRUE),
    (p_tenant_id, p_company_id, v_rev_id, '1.3', 'Receita Recorrente / Assinaturas', 'operational_revenue', 'inflow', TRUE);

  INSERT INTO public.categories (tenant_id, company_id, parent_id, code, name, group_type, direction, is_system)
  VALUES (p_tenant_id, p_company_id, NULL, '2.0', 'Deduções & Impostos', 'tax_deduction', 'outflow', TRUE)
  RETURNING id INTO v_ded_id;

  INSERT INTO public.categories (tenant_id, company_id, parent_id, code, name, group_type, direction, is_system) VALUES
    (p_tenant_id, p_company_id, v_ded_id, '2.1', 'Impostos sobre Faturamento (DAS / ISS / PIS / COFINS)', 'tax_deduction', 'outflow', TRUE),
    (p_tenant_id, p_company_id, v_ded_id, '2.2', 'Taxas de Meios de Pagamento e Gateways', 'tax_deduction', 'outflow', TRUE);

  INSERT INTO public.categories (tenant_id, company_id, parent_id, code, name, group_type, direction, is_system)
  VALUES (p_tenant_id, p_company_id, NULL, '3.0', 'Custos Diretos (CPV / CSP)', 'direct_cost', 'outflow', TRUE)
  RETURNING id INTO v_cost_id;

  INSERT INTO public.categories (tenant_id, company_id, parent_id, code, name, group_type, direction, is_system) VALUES
    (p_tenant_id, p_company_id, v_cost_id, '3.1', 'Mercadorias, Insumos e Matéria-Prima', 'direct_cost', 'outflow', TRUE),
    (p_tenant_id, p_company_id, v_cost_id, '3.2', 'Infraestrutura Cloud e Licenças Diretas', 'direct_cost', 'outflow', TRUE),
    (p_tenant_id, p_company_id, v_cost_id, '3.3', 'Terceirização Direta e Comissões', 'direct_cost', 'outflow', TRUE);

  INSERT INTO public.categories (tenant_id, company_id, parent_id, code, name, group_type, direction, is_system)
  VALUES (p_tenant_id, p_company_id, NULL, '4.0', 'Despesas Fixas', 'fixed_expense', 'outflow', TRUE)
  RETURNING id INTO v_fix_id;

  INSERT INTO public.categories (tenant_id, company_id, parent_id, code, name, group_type, direction, is_system) VALUES
    (p_tenant_id, p_company_id, v_fix_id, '4.1', 'Folha de Pagamento, Encargos e Pró-labore', 'fixed_expense', 'outflow', TRUE),
    (p_tenant_id, p_company_id, v_fix_id, '4.2', 'Ocupação, Aluguel e Utilidades', 'fixed_expense', 'outflow', TRUE),
    (p_tenant_id, p_company_id, v_fix_id, '4.3', 'Software Administrativo e Contabilidade', 'fixed_expense', 'outflow', TRUE);

  INSERT INTO public.categories (tenant_id, company_id, parent_id, code, name, group_type, direction, is_system)
  VALUES (p_tenant_id, p_company_id, NULL, '5.0', 'Despesas Variáveis', 'variable_expense', 'outflow', TRUE)
  RETURNING id INTO v_var_id;

  INSERT INTO public.categories (tenant_id, company_id, parent_id, code, name, group_type, direction, is_system) VALUES
    (p_tenant_id, p_company_id, v_var_id, '5.1', 'Marketing, Mídia Paga e Aquisição (CAC)', 'variable_expense', 'outflow', TRUE),
    (p_tenant_id, p_company_id, v_var_id, '5.2', 'Fretes, Logística e Viagens Comerciais', 'variable_expense', 'outflow', TRUE);

  INSERT INTO public.categories (tenant_id, company_id, parent_id, code, name, group_type, direction, is_system)
  VALUES (p_tenant_id, p_company_id, NULL, '6.0', 'Investimentos / CAPEX', 'capex', 'outflow', TRUE)
  RETURNING id INTO v_capex_id;

  INSERT INTO public.categories (tenant_id, company_id, parent_id, code, name, group_type, direction, is_system) VALUES
    (p_tenant_id, p_company_id, v_capex_id, '6.1', 'Equipamentos, Hardware e Obras', 'capex', 'outflow', TRUE),
    (p_tenant_id, p_company_id, v_capex_id, '6.2', 'Desenvolvimento e Ativos Intangíveis', 'capex', 'outflow', TRUE);

  INSERT INTO public.categories (tenant_id, company_id, parent_id, code, name, group_type, direction, is_system)
  VALUES (p_tenant_id, p_company_id, NULL, '7.0', 'Movimentação Financeira', 'financial_movement', 'neutral', TRUE)
  RETURNING id INTO v_mov_id;

  INSERT INTO public.categories (tenant_id, company_id, parent_id, code, name, group_type, direction, is_system) VALUES
    (p_tenant_id, p_company_id, v_mov_id, '7.1', 'Transferência Interna entre Contas', 'financial_movement', 'neutral', TRUE),
    (p_tenant_id, p_company_id, v_mov_id, '7.2', 'Aplicação e Resgate Financeiro', 'financial_movement', 'neutral', TRUE);
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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_companies_seed_categories ON public.companies;
CREATE TRIGGER trg_companies_seed_categories
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_seed_company_categories();

-- Seed retroativo para empresas já existentes no Módulo 1
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id, tenant_id FROM public.companies LOOP
    PERFORM public.seed_default_categories_for_company(r.tenant_id, r.id);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Motor de Lançamentos Financeiros (transactions)
-- Suporte: Caixa (payment_date) + Competência (competence_date) + Transferências + Parcelamento + project_id UUID NULL
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transactions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id             UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  account_id             UUID NOT NULL REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
  destination_account_id UUID REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
  category_id            UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  product_service_id     UUID REFERENCES public.products_services(id) ON DELETE SET NULL,
  project_id             UUID NULL, -- Preparado para o Módulo 3 (sem FK bloqueante)
  transaction_type       public.transaction_type NOT NULL,
  status                 public.transaction_status NOT NULL DEFAULT 'pending',
  description            TEXT NOT NULL CHECK (char_length(trim(description)) BETWEEN 2 AND 240),
  counterparty_name      TEXT CHECK (counterparty_name IS NULL OR char_length(trim(counterparty_name)) <= 160),
  amount                 NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  competence_date        DATE NOT NULL,
  due_date               DATE NOT NULL,
  payment_date           DATE,
  installment_group_id   UUID,
  installment_number     INTEGER CHECK (installment_number IS NULL OR installment_number >= 1),
  installment_total      INTEGER CHECK (installment_total IS NULL OR installment_total >= 1),
  is_recurring           BOOLEAN NOT NULL DEFAULT FALSE,
  recurrence_frequency   TEXT CHECK (recurrence_frequency IS NULL OR recurrence_frequency IN ('monthly')),
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_transactions_transfer_accounts CHECK (
    (transaction_type = 'transfer' AND destination_account_id IS NOT NULL AND destination_account_id <> account_id)
    OR (transaction_type <> 'transfer' AND destination_account_id IS NULL)
  ),
  CONSTRAINT chk_transactions_installments CHECK (
    (installment_number IS NULL AND installment_total IS NULL)
    OR (installment_number IS NOT NULL AND installment_total IS NOT NULL AND installment_number <= installment_total)
  )
);

CREATE INDEX IF NOT EXISTS idx_transactions_tenant_company_competence
  ON public.transactions (tenant_id, company_id, competence_date DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_tenant_account_payment
  ON public.transactions (tenant_id, account_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_tenant_dest_account
  ON public.transactions (tenant_id, destination_account_id, payment_date DESC)
  WHERE destination_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_tenant_status_due
  ON public.transactions (tenant_id, status, due_date);

CREATE INDEX IF NOT EXISTS idx_transactions_tenant_product
  ON public.transactions (tenant_id, product_service_id)
  WHERE product_service_id IS NOT NULL;

CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Validação de integridade de tenant & regras contábeis na tabela transactions
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

CREATE TRIGGER trg_validate_transaction_integrity
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.validate_transaction_integrity();

-- ----------------------------------------------------------------------------
-- 6. View e Função RPC Segura para Cálculo de Saldo Atual e Previsto por Conta
-- Respeita filtro global de contexto (Conta, Empresa Isolada ou Grupo Consolidado)
-- Regra Crítica: Transferências movimentam saldo das contas, sem afetar resultado
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_account_balances
WITH (security_invoker = true) AS
SELECT
  fa.id AS account_id,
  fa.tenant_id,
  fa.company_id,
  c.group_id,
  fa.name AS account_name,
  fa.analytical_token,
  COALESCE(SUM(
    CASE
      WHEN t.status = 'paid' AND t.account_id = fa.id AND t.transaction_type = 'income'   THEN t.amount
      WHEN t.status = 'paid' AND t.account_id = fa.id AND t.transaction_type = 'expense'  THEN -t.amount
      WHEN t.status = 'paid' AND t.account_id = fa.id AND t.transaction_type = 'transfer' THEN -t.amount
      WHEN t.status = 'paid' AND t.destination_account_id = fa.id AND t.transaction_type = 'transfer' THEN t.amount
      ELSE 0
    END
  ), 0)::NUMERIC(14, 2) AS current_balance,
  COALESCE(SUM(
    CASE
      WHEN t.status IN ('paid', 'pending', 'overdue') AND t.account_id = fa.id AND t.transaction_type = 'income'   THEN t.amount
      WHEN t.status IN ('paid', 'pending', 'overdue') AND t.account_id = fa.id AND t.transaction_type = 'expense'  THEN -t.amount
      WHEN t.status IN ('paid', 'pending', 'overdue') AND t.account_id = fa.id AND t.transaction_type = 'transfer' THEN -t.amount
      WHEN t.status IN ('paid', 'pending', 'overdue') AND t.destination_account_id = fa.id AND t.transaction_type = 'transfer' THEN t.amount
      ELSE 0
    END
  ), 0)::NUMERIC(14, 2) AS projected_balance
FROM public.financial_accounts fa
JOIN public.companies c ON c.id = fa.company_id
LEFT JOIN public.transactions t
  ON t.tenant_id = fa.tenant_id
 AND t.status <> 'canceled'
 AND (t.account_id = fa.id OR t.destination_account_id = fa.id)
WHERE public.is_authorized_tenant(fa.tenant_id)
GROUP BY fa.id, fa.tenant_id, fa.company_id, c.group_id, fa.name, fa.analytical_token;

CREATE OR REPLACE FUNCTION public.get_account_balances_by_context(
  p_scope     TEXT DEFAULT 'all_independent',
  p_entity_id UUID DEFAULT NULL
)
RETURNS TABLE (
  account_id        UUID,
  company_id        UUID,
  group_id          UUID,
  account_name      TEXT,
  analytical_token  TEXT,
  current_balance   NUMERIC(14, 2),
  projected_balance NUMERIC(14, 2)
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    v.account_id,
    v.company_id,
    v.group_id,
    v.account_name,
    v.analytical_token,
    v.current_balance,
    v.projected_balance
  FROM public.v_account_balances v
  WHERE public.is_authorized_tenant(v.tenant_id)
    AND (
      p_scope = 'all_independent'
      OR (p_scope = 'group'   AND v.group_id   = p_entity_id)
      OR (p_scope = 'company' AND v.company_id = p_entity_id)
      OR (p_scope = 'account' AND v.account_id = p_entity_id)
    )
  ORDER BY v.analytical_token ASC;
$$;

-- ----------------------------------------------------------------------------
-- 7. Row Level Security (RLS) Ativo e Forçado em 100% das Novas Tabelas
-- ----------------------------------------------------------------------------
ALTER TABLE public.products_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions      ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.products_services FORCE ROW LEVEL SECURITY;
ALTER TABLE public.categories        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.transactions      FORCE ROW LEVEL SECURITY;

CREATE POLICY products_services_tenant_all ON public.products_services
  FOR ALL
  USING (public.is_authorized_tenant(tenant_id))
  WITH CHECK (public.is_authorized_tenant(tenant_id));

CREATE POLICY categories_tenant_all ON public.categories
  FOR ALL
  USING (public.is_authorized_tenant(tenant_id))
  WITH CHECK (public.is_authorized_tenant(tenant_id));

CREATE POLICY transactions_tenant_all ON public.transactions
  FOR ALL
  USING (public.is_authorized_tenant(tenant_id))
  WITH CHECK (public.is_authorized_tenant(tenant_id));
