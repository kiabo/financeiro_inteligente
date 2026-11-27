-- ============================================================================
-- 0008 — Importação de histórico por API (spec 004)
-- Aplicar MANUALMENTE no SQL Editor do Supabase (o mesmo banco serve h-cfo e cfo).
-- Aplicar ANTES do push da `dev`: o código novo grava colunas que ainda não existiriam.
-- Idempotente: pode ser executada mais de uma vez.
-- Só ADICIONA colunas anuláveis e uma tabela nova: o código antigo (produção atual)
-- continua funcionando depois desta migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Auditoria: nova ação (o valor não é usado nesta mesma transação)
-- ----------------------------------------------------------------------------
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'integration.history_imported';

-- ----------------------------------------------------------------------------
-- 2. Chave de deduplicação por pagamento em `transactions`
-- (provedor + id do pagamento + papel) — independente de conta e de conexão.
-- ----------------------------------------------------------------------------
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS external_source TEXT,
  ADD COLUMN IF NOT EXISTS external_ref    TEXT,
  ADD COLUMN IF NOT EXISTS external_role   TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_transactions_external_role'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT chk_transactions_external_role
      CHECK (external_role IS NULL OR external_role IN ('income', 'fee', 'refund'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_transactions_external_all_or_none'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT chk_transactions_external_all_or_none
      CHECK (
        (external_source IS NULL AND external_ref IS NULL AND external_role IS NULL)
        OR (
          external_source IS NOT NULL AND external_ref IS NOT NULL AND external_role IS NOT NULL
          AND char_length(external_source) BETWEEN 1 AND 40
          AND char_length(external_ref) BETWEEN 1 AND 200
        )
      );
  END IF;
END
$$;

-- Backfill ANTES do índice único: lançamentos criados pelo webhook trazem em `notes`
-- o marcador `webhook:{provedor}:{id do pagamento}:{pending|settled}`.
-- DISTINCT ON garante uma única linha por chave (a mais antiga), então o índice nunca
-- é violado por duplicidade antiga; as demais ficam sem chave (como estão hoje).
-- Papel: receita = income; despesa "Taxa …" = fee; despesa "Estorno …" = refund.
WITH parsed AS (
  SELECT
    t.id,
    t.tenant_id,
    t.created_at,
    substring(t.notes FROM '^webhook:([a-z_]+):')                              AS src,
    substring(t.notes FROM '^webhook:[a-z_]+:(.+):(?:pending|settled)$')       AS ref,
    CASE
      WHEN t.transaction_type = 'income'                              THEN 'income'
      WHEN t.transaction_type = 'expense' AND t.description LIKE 'Taxa %'    THEN 'fee'
      WHEN t.transaction_type = 'expense' AND t.description LIKE 'Estorno %' THEN 'refund'
      ELSE NULL
    END                                                                         AS role
  FROM public.transactions t
  WHERE t.external_ref IS NULL
    AND t.notes LIKE 'webhook:%'
),
candidates AS (
  SELECT DISTINCT ON (p.tenant_id, p.src, p.ref, p.role)
    p.id, p.src, p.ref, p.role
  FROM parsed p
  WHERE p.src IN ('stripe', 'mercadopago', 'asaas', 'openfinance_generic', 'custom_json_mapping')
    AND p.ref IS NOT NULL
    AND char_length(p.ref) BETWEEN 1 AND 200
    AND p.role IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.transactions x
      WHERE x.tenant_id = p.tenant_id
        AND x.external_source = p.src
        AND x.external_ref = p.ref
        AND x.external_role = p.role
    )
  ORDER BY p.tenant_id, p.src, p.ref, p.role, p.created_at, p.id
)
UPDATE public.transactions t
SET external_source = c.src,
    external_ref    = c.ref,
    external_role   = c.role
FROM candidates c
WHERE t.id = c.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_external
  ON public.transactions (tenant_id, external_source, external_ref, external_role)
  WHERE external_ref IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. Log de eventos: origem do evento (webhook × importação por API)
-- ----------------------------------------------------------------------------
ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'webhook';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_webhook_events_source'
      AND conrelid = 'public.webhook_events'::regclass
  ) THEN
    ALTER TABLE public.webhook_events
      ADD CONSTRAINT chk_webhook_events_source CHECK (source IN ('webhook', 'api'));
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 4. Execuções da importação de histórico (progresso, cursor e contadores)
-- Escrita somente pelo servidor (service role); o titular só lê as próprias.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id  UUID NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL CHECK (provider IN ('asaas', 'mercadopago')),
  company_id     UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  account_id     UUID NOT NULL REFERENCES public.financial_accounts(id) ON DELETE CASCADE,
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,
  status         TEXT NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running', 'completed', 'failed', 'canceled')),
  phase          TEXT NOT NULL DEFAULT 'payments'
                   CHECK (phase IN ('customers', 'payments')),
  cursor         JSONB NOT NULL DEFAULT '{}'::jsonb,
  customers      JSONB NOT NULL DEFAULT '{}'::jsonb,
  count_created      INTEGER NOT NULL DEFAULT 0 CHECK (count_created >= 0),
  count_updated      INTEGER NOT NULL DEFAULT 0 CHECK (count_updated >= 0),
  count_ignored      INTEGER NOT NULL DEFAULT 0 CHECK (count_ignored >= 0),
  count_marked_apart INTEGER NOT NULL DEFAULT 0 CHECK (count_marked_apart >= 0),
  count_failed       INTEGER NOT NULL DEFAULT 0 CHECK (count_failed >= 0),
  errors         JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_error     TEXT,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_import_runs_period CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_import_runs_tenant_started
  ON public.import_runs (tenant_id, started_at DESC);

-- No máximo uma execução ativa por conexão
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_runs_one_running
  ON public.import_runs (connection_id)
  WHERE status = 'running';

DROP TRIGGER IF EXISTS trg_import_runs_updated_at ON public.import_runs;
CREATE TRIGGER trg_import_runs_updated_at
  BEFORE UPDATE ON public.import_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Conta e empresa da execução pertencem ao tenant (mesma defesa das demais tabelas)
CREATE OR REPLACE FUNCTION public.validate_import_run_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.financial_accounts fa
    WHERE fa.id = NEW.account_id AND fa.company_id = NEW.company_id AND fa.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Conta de destino não pertence à empresa/tenant da importação.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.integration_connections ic
    WHERE ic.id = NEW.connection_id AND ic.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Conexão não pertence ao tenant da importação.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_import_run_tenant ON public.import_runs;
CREATE TRIGGER trg_validate_import_run_tenant
  BEFORE INSERT OR UPDATE ON public.import_runs
  FOR EACH ROW EXECUTE FUNCTION public.validate_import_run_tenant();

ALTER TABLE public.import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_runs_tenant_select ON public.import_runs;
CREATE POLICY import_runs_tenant_select ON public.import_runs
  FOR SELECT USING (public.is_authorized_tenant(tenant_id));

-- Grants mínimos: o navegador lê só o progresso. `customers` (nomes de clientes) e `cursor`
-- ficam invisíveis ao papel `authenticated`; o servidor (service role) lê tudo.
REVOKE ALL ON public.import_runs FROM anon, authenticated;
GRANT SELECT (
  id, tenant_id, connection_id, provider, company_id, account_id, period_start, period_end,
  status, phase, count_created, count_updated, count_ignored, count_marked_apart, count_failed,
  errors, last_error, started_at, finished_at, updated_at
) ON public.import_runs TO authenticated;

-- ----------------------------------------------------------------------------
-- ROLLBACK (executar manualmente, se necessário — só depois de reverter o código):
--
-- DROP TABLE IF EXISTS public.import_runs;
-- DROP FUNCTION IF EXISTS public.validate_import_run_tenant();
-- ALTER TABLE public.webhook_events DROP CONSTRAINT IF EXISTS chk_webhook_events_source;
-- ALTER TABLE public.webhook_events DROP COLUMN IF EXISTS source;
-- DROP INDEX IF EXISTS public.uq_transactions_external;
-- ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS chk_transactions_external_all_or_none;
-- ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS chk_transactions_external_role;
-- ALTER TABLE public.transactions
--   DROP COLUMN IF EXISTS external_role,
--   DROP COLUMN IF EXISTS external_ref,
--   DROP COLUMN IF EXISTS external_source;
-- (o valor 'integration.history_imported' do enum audit_action não é removível; é inofensivo.)
-- ----------------------------------------------------------------------------
