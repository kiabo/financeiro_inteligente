-- ============================================================================
-- MÓDULO 6: INTEGRAÇÕES, WEBHOOKS ADAPTÁVEIS, CONCILIAÇÃO OFX/CSV/PDF,
--           LANÇAMENTO POR FOTO (OCR), AGENDA, ALERTAS E BACKUP BLINDADO
-- Banco de Dados: PostgreSQL / Supabase (Incremental sobre 0001..0005)
-- Arquitetura: RLS 100% ativo · credenciais cifradas no servidor (AES-256-GCM)
--              · colunas secretas invisíveis para o papel `authenticated`
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Novas ações de auditoria
-- (ADD VALUE dentro de transação é permitido desde que o valor não seja usado
--  nesta mesma transação — nada abaixo usa esses valores.)
-- ----------------------------------------------------------------------------
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'integration.connected';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'integration.updated';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'integration.removed';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'webhook.processed';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'reconciliation.confirmed';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'receipt.confirmed';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'backup.completed';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'backup.failed';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'notification.sent';

-- ----------------------------------------------------------------------------
-- 2. Conexões de integração (gateways, bancos, Google)
-- Segredos (assinatura HMAC, refresh token OAuth) ficam CIFRADOS pelo servidor
-- com CREDENTIALS_ENCRYPTION_KEY e nunca são legíveis pelo navegador.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integration_connections (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider                  TEXT NOT NULL CHECK (provider IN (
                              'stripe', 'mercadopago', 'asaas', 'openfinance_generic',
                              'custom_json_mapping', 'google'
                            )),
  label                     TEXT NOT NULL CHECK (char_length(trim(label)) BETWEEN 2 AND 100),
  company_id                UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  account_id                UUID REFERENCES public.financial_accounts(id) ON DELETE SET NULL,
  -- Identificador público e aleatório usado na URL do webhook (não é o segredo de assinatura)
  webhook_secret_id         TEXT UNIQUE CHECK (webhook_secret_id IS NULL OR webhook_secret_id ~ '^[a-f0-9]{32}$'),
  signing_secret_encrypted  TEXT,
  credentials_encrypted     TEXT,
  config                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                    TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error')),
  last_event_at             TIMESTAMPTZ,
  last_error                TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_integration_webhook_needs_target CHECK (
    provider = 'google' OR (company_id IS NOT NULL AND account_id IS NOT NULL AND webhook_secret_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_integration_google_per_tenant
  ON public.integration_connections (tenant_id)
  WHERE provider = 'google';

CREATE INDEX IF NOT EXISTS idx_integration_connections_tenant
  ON public.integration_connections (tenant_id, provider);

DROP TRIGGER IF EXISTS trg_integration_connections_updated_at ON public.integration_connections;
CREATE TRIGGER trg_integration_connections_updated_at
  BEFORE UPDATE ON public.integration_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.validate_integration_connection_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.company_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.companies c WHERE c.id = NEW.company_id AND c.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Violação de isolamento de tenant: empresa inválida para a integração.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.financial_accounts fa
    WHERE fa.id = NEW.account_id AND fa.tenant_id = NEW.tenant_id
      AND (NEW.company_id IS NULL OR fa.company_id = NEW.company_id)
  ) THEN
    RAISE EXCEPTION 'Conta de destino não pertence à empresa/tenant da integração.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_integration_connection_tenant ON public.integration_connections;
CREATE TRIGGER trg_validate_integration_connection_tenant
  BEFORE INSERT OR UPDATE ON public.integration_connections
  FOR EACH ROW EXECUTE FUNCTION public.validate_integration_connection_tenant();

-- ----------------------------------------------------------------------------
-- 3. Fila/log de eventos de webhook (idempotência por external_event_id)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id     UUID NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,
  external_event_id TEXT NOT NULL CHECK (char_length(external_event_id) BETWEEN 1 AND 200),
  event_type        TEXT,
  status            TEXT NOT NULL DEFAULT 'received'
                      CHECK (status IN ('received', 'processed', 'failed', 'ignored')),
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized        JSONB,
  error_message     TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  transaction_ids   UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,
  CONSTRAINT uq_webhook_events_connection_external UNIQUE (connection_id, external_event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_tenant_received
  ON public.webhook_events (tenant_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_events_connection_status
  ON public.webhook_events (connection_id, status);

-- ----------------------------------------------------------------------------
-- 4. Importações de extrato bancário (OFX / CSV / PDF)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bank_statement_imports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  account_id    UUID NOT NULL REFERENCES public.financial_accounts(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL CHECK (char_length(trim(file_name)) BETWEEN 1 AND 255),
  file_format   TEXT NOT NULL CHECK (file_format IN ('ofx', 'csv', 'pdf')),
  file_sha256   TEXT NOT NULL CHECK (file_sha256 ~ '^[a-f0-9]{64}$'),
  period_start  DATE,
  period_end    DATE,
  total_lines   INTEGER NOT NULL DEFAULT 0 CHECK (total_lines >= 0),
  exact_count   INTEGER NOT NULL DEFAULT 0 CHECK (exact_count >= 0),
  partial_count INTEGER NOT NULL DEFAULT 0 CHECK (partial_count >= 0),
  unmatched_count INTEGER NOT NULL DEFAULT 0 CHECK (unmatched_count >= 0),
  status        TEXT NOT NULL DEFAULT 'reconciling' CHECK (status IN ('reconciling', 'completed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_bank_statement_import_file UNIQUE (tenant_id, account_id, file_sha256)
);

CREATE INDEX IF NOT EXISTS idx_bank_statement_imports_tenant
  ON public.bank_statement_imports (tenant_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_bank_statement_imports_updated_at ON public.bank_statement_imports;
CREATE TRIGGER trg_bank_statement_imports_updated_at
  BEFORE UPDATE ON public.bank_statement_imports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.validate_bank_statement_import_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.financial_accounts fa
    WHERE fa.id = NEW.account_id AND fa.company_id = NEW.company_id AND fa.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Conta do extrato não pertence à empresa/tenant informado.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_bank_statement_import_tenant ON public.bank_statement_imports;
CREATE TRIGGER trg_validate_bank_statement_import_tenant
  BEFORE INSERT OR UPDATE ON public.bank_statement_imports
  FOR EACH ROW EXECUTE FUNCTION public.validate_bank_statement_import_tenant();

-- ----------------------------------------------------------------------------
-- 5. Linhas do extrato e resultado do matching
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reconciliation_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_id               UUID NOT NULL REFERENCES public.bank_statement_imports(id) ON DELETE CASCADE,
  account_id              UUID NOT NULL REFERENCES public.financial_accounts(id) ON DELETE CASCADE,
  line_index              INTEGER NOT NULL CHECK (line_index >= 0),
  line_date               DATE NOT NULL,
  amount                  NUMERIC(14, 2) NOT NULL CHECK (amount <> 0), -- positivo = crédito, negativo = débito
  description             TEXT NOT NULL DEFAULT '',
  fit_id                  TEXT,
  match_status            TEXT NOT NULL CHECK (match_status IN ('exact_match', 'partial_match', 'unmatched')),
  matched_transaction_id  UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  match_score             NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (match_score >= 0 AND match_score <= 100),
  date_diff_days          INTEGER,
  amount_diff             NUMERIC(14, 2),
  match_reasons           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  resolution              TEXT NOT NULL DEFAULT 'pending'
                            CHECK (resolution IN ('pending', 'confirmed', 'created', 'ignored')),
  resolved_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  resolved_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_reconciliation_item_line UNIQUE (import_id, line_index)
);

-- Uma mesma linha OFX (FITID) nunca é conciliada duas vezes na mesma conta
CREATE UNIQUE INDEX IF NOT EXISTS uq_reconciliation_items_account_fitid
  ON public.reconciliation_items (tenant_id, account_id, fit_id)
  WHERE fit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reconciliation_items_import
  ON public.reconciliation_items (import_id, match_status, resolution);

DROP TRIGGER IF EXISTS trg_reconciliation_items_updated_at ON public.reconciliation_items;
CREATE TRIGGER trg_reconciliation_items_updated_at
  BEFORE UPDATE ON public.reconciliation_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.validate_reconciliation_item_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.bank_statement_imports bi
    WHERE bi.id = NEW.import_id AND bi.tenant_id = NEW.tenant_id AND bi.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'Linha de conciliação inválida para a importação/tenant.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.matched_transaction_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.id = NEW.matched_transaction_id AND t.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Lançamento sugerido pertence a outro tenant.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.resolved_transaction_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.id = NEW.resolved_transaction_id AND t.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Lançamento conciliado pertence a outro tenant.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_reconciliation_item_tenant ON public.reconciliation_items;
CREATE TRIGGER trg_validate_reconciliation_item_tenant
  BEFORE INSERT OR UPDATE ON public.reconciliation_items
  FOR EACH ROW EXECUTE FUNCTION public.validate_reconciliation_item_tenant();

-- ----------------------------------------------------------------------------
-- 6. Rascunhos de lançamento por foto (OCR) — nunca entram no saldo sem revisão
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.receipt_drafts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id           UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  storage_path         TEXT,
  file_name            TEXT NOT NULL DEFAULT 'comprovante',
  mime_type            TEXT NOT NULL DEFAULT 'image/jpeg',
  -- Somente texto JÁ SANITIZADO (sem CNPJ/CPF/e-mail/nomes do cofre)
  ocr_text_sanitized   TEXT NOT NULL DEFAULT '',
  ocr_confidence       NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (ocr_confidence >= 0 AND ocr_confidence <= 100),
  extracted            JSONB NOT NULL DEFAULT '{}'::jsonb,
  suggestion           JSONB NOT NULL DEFAULT '{}'::jsonb,
  status               TEXT NOT NULL DEFAULT 'pending_review'
                         CHECK (status IN ('pending_review', 'confirmed', 'discarded')),
  transaction_id       UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receipt_drafts_tenant_status
  ON public.receipt_drafts (tenant_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_receipt_drafts_updated_at ON public.receipt_drafts;
CREATE TRIGGER trg_receipt_drafts_updated_at
  BEFORE UPDATE ON public.receipt_drafts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 7. Preferências de alertas, agenda e backup (1 linha por tenant)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  tenant_id               UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  email_to                TEXT CHECK (email_to IS NULL OR email_to ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  whatsapp_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_number         TEXT CHECK (whatsapp_number IS NULL OR whatsapp_number ~ '^[0-9]{10,15}$'),
  notify_due_today        BOOLEAN NOT NULL DEFAULT TRUE,
  notify_overdue          BOOLEAN NOT NULL DEFAULT TRUE,
  notify_weekly_summary   BOOLEAN NOT NULL DEFAULT TRUE,
  weekly_summary_weekday  SMALLINT NOT NULL DEFAULT 1 CHECK (weekly_summary_weekday BETWEEN 0 AND 6),
  notify_cfo_critical     BOOLEAN NOT NULL DEFAULT TRUE,
  -- FALSE (padrão): mensagens externas usam apenas tokens (EMP_01, CTA_02) e valores
  include_real_labels     BOOLEAN NOT NULL DEFAULT FALSE,
  calendar_sync_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  calendar_id             TEXT NOT NULL DEFAULT 'primary',
  calendar_days_ahead     SMALLINT NOT NULL DEFAULT 60 CHECK (calendar_days_ahead BETWEEN 7 AND 365),
  backup_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  backup_retention_count  SMALLINT NOT NULL DEFAULT 30 CHECK (backup_retention_count BETWEEN 1 AND 365),
  drive_folder_id         TEXT,
  last_daily_run_at       TIMESTAMPTZ,
  last_weekly_summary_at  TIMESTAMPTZ,
  last_calendar_sync_at   TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_notification_preferences_updated_at ON public.notification_preferences;
CREATE TRIGGER trg_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 8. Log de notificações enviadas (dedupe_key evita alerta repetido no mesmo dia)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  kind          TEXT NOT NULL CHECK (kind IN ('due_today', 'overdue', 'weekly_summary', 'cfo_critical', 'test')),
  dedupe_key    TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error_message TEXT,
  items_count   INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_notification_logs_dedupe UNIQUE (tenant_id, channel, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_tenant_created
  ON public.notification_logs (tenant_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 9. Mapeamento de eventos sincronizados no Google Calendar
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.calendar_sync_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type     TEXT NOT NULL CHECK (source_type IN (
                    'transaction', 'debt_installment', 'tax_obligation',
                    'project_start', 'project_end', 'project_payback'
                  )),
  source_id       UUID NOT NULL,
  google_event_id TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  event_date      DATE NOT NULL,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_calendar_sync_source UNIQUE (tenant_id, source_type, source_id)
);

-- ----------------------------------------------------------------------------
-- 10. Log de backups criptografados (AES-256-GCM) com hash SHA-256
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.backup_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('cron', 'manual')),
  destination    TEXT NOT NULL CHECK (destination IN ('google_drive', 'download')),
  status         TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
  file_name      TEXT,
  drive_file_id  TEXT,
  size_bytes     BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
  sha256         TEXT CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
  tables_count   INTEGER,
  rows_count     INTEGER,
  error_message  TEXT,
  verified_at    TIMESTAMPTZ,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_backup_logs_tenant_started
  ON public.backup_logs (tenant_id, started_at DESC);

-- ----------------------------------------------------------------------------
-- 11. Row Level Security (RLS) ativo e forçado em todas as novas tabelas
-- Escritas sensíveis (conexões, eventos, logs de envio/backup) só pelo servidor
-- (service role). O usuário autenticado só lê.
-- ----------------------------------------------------------------------------
ALTER TABLE public.integration_connections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_imports   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_drafts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_sync_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_logs              ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.integration_connections  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events           FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_imports   FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_items     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_drafts           FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_sync_items      FORCE ROW LEVEL SECURITY;
ALTER TABLE public.backup_logs              FORCE ROW LEVEL SECURITY;

-- Conexões: leitura pelo titular; criação/edição/remoção apenas via servidor
DROP POLICY IF EXISTS integration_connections_tenant_select ON public.integration_connections;
CREATE POLICY integration_connections_tenant_select ON public.integration_connections
  FOR SELECT USING (public.is_authorized_tenant(tenant_id));

-- Colunas cifradas invisíveis ao navegador (defesa em profundidade)
REVOKE ALL ON public.integration_connections FROM anon, authenticated;
GRANT SELECT (
  id, tenant_id, provider, label, company_id, account_id, webhook_secret_id,
  config, status, last_event_at, last_error, created_at, updated_at
) ON public.integration_connections TO authenticated;

DROP POLICY IF EXISTS webhook_events_tenant_select ON public.webhook_events;
CREATE POLICY webhook_events_tenant_select ON public.webhook_events
  FOR SELECT USING (public.is_authorized_tenant(tenant_id));
REVOKE INSERT, UPDATE, DELETE ON public.webhook_events FROM anon, authenticated;

DROP POLICY IF EXISTS bank_statement_imports_tenant_all ON public.bank_statement_imports;
CREATE POLICY bank_statement_imports_tenant_all ON public.bank_statement_imports
  FOR ALL
  USING (public.is_authorized_tenant(tenant_id))
  WITH CHECK (public.is_authorized_tenant(tenant_id));

DROP POLICY IF EXISTS reconciliation_items_tenant_all ON public.reconciliation_items;
CREATE POLICY reconciliation_items_tenant_all ON public.reconciliation_items
  FOR ALL
  USING (public.is_authorized_tenant(tenant_id))
  WITH CHECK (public.is_authorized_tenant(tenant_id));

DROP POLICY IF EXISTS receipt_drafts_tenant_all ON public.receipt_drafts;
CREATE POLICY receipt_drafts_tenant_all ON public.receipt_drafts
  FOR ALL
  USING (public.is_authorized_tenant(tenant_id))
  WITH CHECK (public.is_authorized_tenant(tenant_id));

DROP POLICY IF EXISTS notification_preferences_tenant_all ON public.notification_preferences;
CREATE POLICY notification_preferences_tenant_all ON public.notification_preferences
  FOR ALL
  USING (public.is_authorized_tenant(tenant_id))
  WITH CHECK (public.is_authorized_tenant(tenant_id));

-- drive_folder_id e carimbos de execução são mantidos pelo servidor.
-- (Revogar só colunas não basta quando existe grant na tabela: revoga-se a tabela e
--  concede-se apenas as colunas editáveis pelo usuário.)
REVOKE INSERT, UPDATE ON public.notification_preferences FROM anon, authenticated;
GRANT INSERT (
  tenant_id, email_enabled, email_to, whatsapp_enabled, whatsapp_number,
  notify_due_today, notify_overdue, notify_weekly_summary, weekly_summary_weekday,
  notify_cfo_critical, include_real_labels, calendar_sync_enabled, calendar_id,
  calendar_days_ahead, backup_enabled, backup_retention_count
) ON public.notification_preferences TO authenticated;
GRANT UPDATE (
  email_enabled, email_to, whatsapp_enabled, whatsapp_number,
  notify_due_today, notify_overdue, notify_weekly_summary, weekly_summary_weekday,
  notify_cfo_critical, include_real_labels, calendar_sync_enabled, calendar_id,
  calendar_days_ahead, backup_enabled, backup_retention_count
) ON public.notification_preferences TO authenticated;

DROP POLICY IF EXISTS notification_logs_tenant_select ON public.notification_logs;
CREATE POLICY notification_logs_tenant_select ON public.notification_logs
  FOR SELECT USING (public.is_authorized_tenant(tenant_id));
REVOKE INSERT, UPDATE, DELETE ON public.notification_logs FROM anon, authenticated;

DROP POLICY IF EXISTS calendar_sync_items_tenant_select ON public.calendar_sync_items;
CREATE POLICY calendar_sync_items_tenant_select ON public.calendar_sync_items
  FOR SELECT USING (public.is_authorized_tenant(tenant_id));
REVOKE INSERT, UPDATE, DELETE ON public.calendar_sync_items FROM anon, authenticated;

DROP POLICY IF EXISTS backup_logs_tenant_select ON public.backup_logs;
CREATE POLICY backup_logs_tenant_select ON public.backup_logs
  FOR SELECT USING (public.is_authorized_tenant(tenant_id));
REVOKE INSERT, UPDATE, DELETE ON public.backup_logs FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- 12. Storage privado para comprovantes (pasta = auth.uid())
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'receipts',
  'receipts',
  FALSE,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public = FALSE,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS receipts_owner_select ON storage.objects;
CREATE POLICY receipts_owner_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS receipts_owner_insert ON storage.objects;
CREATE POLICY receipts_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS receipts_owner_delete ON storage.objects;
CREATE POLICY receipts_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text);
