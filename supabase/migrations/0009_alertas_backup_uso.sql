-- ============================================================================
-- 0009 — Alertas de backup do banco e de uso do plano (spec 006)
-- Aplicar MANUALMENTE no SQL Editor do Supabase (o mesmo banco serve h-cfo e cfo).
-- Pode ser aplicada ANTES do deploy: só AMPLIA a lista de tipos aceitos em
-- `notification_logs.kind`; o código atual continua funcionando.
-- Idempotente: pode ser executada mais de uma vez.
-- ============================================================================

ALTER TABLE public.notification_logs DROP CONSTRAINT IF EXISTS notification_logs_kind_check;

ALTER TABLE public.notification_logs
  ADD CONSTRAINT notification_logs_kind_check
  CHECK (kind IN (
    'due_today', 'overdue', 'weekly_summary', 'cfo_critical', 'test',
    'backup_failed', 'usage_high'
  ));

-- ----------------------------------------------------------------------------
-- ROLLBACK (executar manualmente, só depois de reverter o código):
--
-- DELETE FROM public.notification_logs WHERE kind IN ('backup_failed', 'usage_high');
-- ALTER TABLE public.notification_logs DROP CONSTRAINT IF EXISTS notification_logs_kind_check;
-- ALTER TABLE public.notification_logs
--   ADD CONSTRAINT notification_logs_kind_check
--   CHECK (kind IN ('due_today', 'overdue', 'weekly_summary', 'cfo_critical', 'test'));
-- ----------------------------------------------------------------------------
