-- ============================================================================
-- MÓDULO 5: INTELIGÊNCIA FINANCEIRA VIA IA (CFO VIRTUAL) + SERVIDOR MCP
-- Banco de Dados: PostgreSQL / Supabase (Incremental sobre 0001..0004)
-- Arquitetura: Privacy-by-Design Zero-Leak, Tokens Analíticos, RLS 100% Ativo
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extensão de Enums de Auditoria e Novos Tipos do Módulo 5
-- ----------------------------------------------------------------------------
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'ai.analysis_generated';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'ai.insight_updated';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'mcp.token_created';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'mcp.token_revoked';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'mcp.tool_called';

COMMIT;
BEGIN;

DO $$ BEGIN
  CREATE TYPE public.ai_insight_category AS ENUM (
    'margin_drop',
    'budget_deviation',
    'cash_risk_45d',
    'capital_reallocation',
    'debt_optimization',
    'tax_alert',
    'project_viability'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ai_insight_severity AS ENUM (
    'critical',
    'warning',
    'opportunity',
    'info'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ai_insight_status AS ENUM (
    'new',
    'acknowledged',
    'dismissed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.mcp_token_scope AS ENUM (
    'read_only',
    'simulate_drafts'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 2. Tabela de Diagnósticos e Recomendações do CFO Virtual (ai_insights)
-- Regra Crítica: Armazena apenas textos tokenizados (EMP_01, PRD_01, PRJ_01)
-- e o snapshot JSON 100% anonimizado enviado à IA.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_insights (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope_type                 TEXT NOT NULL CHECK (scope_type IN ('all_independent', 'group', 'company', 'account')),
  scope_token                TEXT NOT NULL DEFAULT 'GLOBAL',
  category                   public.ai_insight_category NOT NULL,
  severity                   public.ai_insight_severity NOT NULL DEFAULT 'info',
  status                     public.ai_insight_status NOT NULL DEFAULT 'new',
  title_tokenized            TEXT NOT NULL CHECK (char_length(trim(title_tokenized)) BETWEEN 3 AND 240),
  summary_tokenized          TEXT NOT NULL CHECK (char_length(trim(summary_tokenized)) >= 5),
  recommendation_tokenized   TEXT NOT NULL CHECK (char_length(trim(recommendation_tokenized)) >= 5),
  related_tokens             TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  estimated_financial_impact NUMERIC(14, 2) NOT NULL DEFAULT 0,
  impact_horizon_days        INTEGER NOT NULL DEFAULT 45 CHECK (impact_horizon_days BETWEEN 1 AND 1825),
  confidence_pct             NUMERIC(5, 2) NOT NULL DEFAULT 85 CHECK (confidence_pct >= 0 AND confidence_pct <= 100),
  provider_used              TEXT NOT NULL DEFAULT 'gemini',
  model_used                 TEXT NOT NULL DEFAULT 'gemini-4-hydrogen',
  sanitized_context_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_insights_tenant_status
  ON public.ai_insights (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_insights_tenant_category
  ON public.ai_insights (tenant_id, category, severity);

DROP TRIGGER IF EXISTS trg_ai_insights_updated_at ON public.ai_insights;
CREATE TRIGGER trg_ai_insights_updated_at
  BEFORE UPDATE ON public.ai_insights
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Tabela de Chaves de Acesso Pessoais do Servidor MCP (mcp_access_tokens)
-- Chaves armazenadas exclusivamente por hash SHA-256 + escopo configurável.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mcp_access_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label        TEXT NOT NULL CHECK (char_length(trim(label)) BETWEEN 2 AND 100),
  token_prefix TEXT NOT NULL CHECK (char_length(trim(token_prefix)) BETWEEN 6 AND 24),
  token_hash   TEXT NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
  scope        public.mcp_token_scope NOT NULL DEFAULT 'read_only',
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  call_count   INTEGER NOT NULL DEFAULT 0 CHECK (call_count >= 0),
  expires_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_tenant_active
  ON public.mcp_access_tokens (tenant_id, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_hash
  ON public.mcp_access_tokens (token_hash)
  WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS trg_mcp_access_tokens_updated_at ON public.mcp_access_tokens;
CREATE TRIGGER trg_mcp_access_tokens_updated_at
  BEFORE UPDATE ON public.mcp_access_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Log Imutável de Chamadas do Servidor MCP (mcp_call_logs)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mcp_call_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_id           UUID NOT NULL REFERENCES public.mcp_access_tokens(id) ON DELETE CASCADE,
  tool_name          TEXT NOT NULL CHECK (char_length(trim(tool_name)) BETWEEN 2 AND 100),
  scope_used         TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('success', 'denied', 'error')),
  zero_leak_verified BOOLEAN NOT NULL DEFAULT TRUE,
  sanitized_args     JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_summary   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcp_call_logs_tenant_created
  ON public.mcp_call_logs (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.validate_mcp_call_log_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.mcp_access_tokens t
    WHERE t.id = NEW.token_id AND t.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Violação de isolamento de tenant: token MCP inválido para o log.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_mcp_call_log_tenant ON public.mcp_call_logs;
CREATE TRIGGER trg_validate_mcp_call_log_tenant
  BEFORE INSERT ON public.mcp_call_logs
  FOR EACH ROW EXECUTE FUNCTION public.validate_mcp_call_log_tenant();

-- ----------------------------------------------------------------------------
-- 5. Row Level Security (RLS) Ativo e Forçado em Todas as Novas Tabelas
-- ----------------------------------------------------------------------------
ALTER TABLE public.ai_insights       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_call_logs     ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ai_insights       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_access_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_call_logs     FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_insights_tenant_all ON public.ai_insights;
CREATE POLICY ai_insights_tenant_all ON public.ai_insights
  FOR ALL
  USING (public.is_authorized_tenant(tenant_id))
  WITH CHECK (public.is_authorized_tenant(tenant_id));

DROP POLICY IF EXISTS mcp_access_tokens_tenant_all ON public.mcp_access_tokens;
CREATE POLICY mcp_access_tokens_tenant_all ON public.mcp_access_tokens
  FOR ALL
  USING (public.is_authorized_tenant(tenant_id))
  WITH CHECK (public.is_authorized_tenant(tenant_id));

DROP POLICY IF EXISTS mcp_call_logs_tenant_select ON public.mcp_call_logs;
CREATE POLICY mcp_call_logs_tenant_select ON public.mcp_call_logs
  FOR SELECT
  USING (public.is_authorized_tenant(tenant_id));

DROP POLICY IF EXISTS mcp_call_logs_tenant_insert ON public.mcp_call_logs;
CREATE POLICY mcp_call_logs_tenant_insert ON public.mcp_call_logs
  FOR INSERT
  WITH CHECK (public.is_authorized_tenant(tenant_id));

COMMIT;
