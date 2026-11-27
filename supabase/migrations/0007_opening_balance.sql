-- ============================================================================
-- 0007 — Saldo inicial da conta (spec 003)
-- Aplicar MANUALMENTE no SQL Editor do Supabase (o mesmo banco serve h-cfo e cfo).
-- Idempotente: pode ser executada mais de uma vez.
--
-- Regra: o saldo inicial é o ponto de partida da conta na `opening_balance_date`.
-- Movimentos com data de caixa ANTERIOR a essa data não entram no saldo (o saldo inicial os resume).
-- Data de caixa = payment_date se o lançamento está pago e tem payment_date; senão due_date.
-- Contas existentes ficam com 0 e sem data: os saldos de hoje não mudam.
-- ============================================================================

ALTER TABLE public.financial_accounts
  ADD COLUMN IF NOT EXISTS opening_balance      NUMERIC(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_balance_date DATE;

-- Saldo diferente de zero exige a data do saldo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_financial_accounts_opening_date'
      AND conrelid = 'public.financial_accounts'::regclass
  ) THEN
    ALTER TABLE public.financial_accounts
      ADD CONSTRAINT chk_financial_accounts_opening_date
      CHECK (opening_balance = 0 OR opening_balance_date IS NOT NULL);
  END IF;
END
$$;

-- View de saldos: mesmas colunas e mesma ordem da 0002; só muda o cálculo.
-- A função get_account_balances_by_context (0002) continua igual (lê desta view).
CREATE OR REPLACE VIEW public.v_account_balances
WITH (security_invoker = true) AS
SELECT
  fa.id AS account_id,
  fa.tenant_id,
  fa.company_id,
  c.group_id,
  fa.name AS account_name,
  fa.analytical_token,
  (fa.opening_balance + COALESCE(SUM(
    CASE
      WHEN t.status = 'paid' AND t.account_id = fa.id AND t.transaction_type = 'income'   THEN t.amount
      WHEN t.status = 'paid' AND t.account_id = fa.id AND t.transaction_type = 'expense'  THEN -t.amount
      WHEN t.status = 'paid' AND t.account_id = fa.id AND t.transaction_type = 'transfer' THEN -t.amount
      WHEN t.status = 'paid' AND t.destination_account_id = fa.id AND t.transaction_type = 'transfer' THEN t.amount
      ELSE 0
    END
  ), 0))::NUMERIC(14, 2) AS current_balance,
  (fa.opening_balance + COALESCE(SUM(
    CASE
      WHEN t.status IN ('paid', 'pending', 'overdue') AND t.account_id = fa.id AND t.transaction_type = 'income'   THEN t.amount
      WHEN t.status IN ('paid', 'pending', 'overdue') AND t.account_id = fa.id AND t.transaction_type = 'expense'  THEN -t.amount
      WHEN t.status IN ('paid', 'pending', 'overdue') AND t.account_id = fa.id AND t.transaction_type = 'transfer' THEN -t.amount
      WHEN t.status IN ('paid', 'pending', 'overdue') AND t.destination_account_id = fa.id AND t.transaction_type = 'transfer' THEN t.amount
      ELSE 0
    END
  ), 0))::NUMERIC(14, 2) AS projected_balance
FROM public.financial_accounts fa
JOIN public.companies c ON c.id = fa.company_id
LEFT JOIN public.transactions t
  ON t.tenant_id = fa.tenant_id
 AND t.status <> 'canceled'
 AND (t.account_id = fa.id OR t.destination_account_id = fa.id)
 AND (
   fa.opening_balance_date IS NULL
   OR (CASE WHEN t.status = 'paid' AND t.payment_date IS NOT NULL THEN t.payment_date ELSE t.due_date END)
      >= fa.opening_balance_date
 )
WHERE public.is_authorized_tenant(fa.tenant_id)
GROUP BY fa.id, fa.tenant_id, fa.company_id, c.group_id, fa.name, fa.analytical_token, fa.opening_balance;

-- ----------------------------------------------------------------------------
-- ROLLBACK (executar manualmente, se necessário):
--
-- CREATE OR REPLACE VIEW public.v_account_balances
-- WITH (security_invoker = true) AS
-- SELECT
--   fa.id AS account_id, fa.tenant_id, fa.company_id, c.group_id,
--   fa.name AS account_name, fa.analytical_token,
--   COALESCE(SUM(CASE
--     WHEN t.status = 'paid' AND t.account_id = fa.id AND t.transaction_type = 'income'   THEN t.amount
--     WHEN t.status = 'paid' AND t.account_id = fa.id AND t.transaction_type = 'expense'  THEN -t.amount
--     WHEN t.status = 'paid' AND t.account_id = fa.id AND t.transaction_type = 'transfer' THEN -t.amount
--     WHEN t.status = 'paid' AND t.destination_account_id = fa.id AND t.transaction_type = 'transfer' THEN t.amount
--     ELSE 0 END), 0)::NUMERIC(14, 2) AS current_balance,
--   COALESCE(SUM(CASE
--     WHEN t.status IN ('paid','pending','overdue') AND t.account_id = fa.id AND t.transaction_type = 'income'   THEN t.amount
--     WHEN t.status IN ('paid','pending','overdue') AND t.account_id = fa.id AND t.transaction_type = 'expense'  THEN -t.amount
--     WHEN t.status IN ('paid','pending','overdue') AND t.account_id = fa.id AND t.transaction_type = 'transfer' THEN -t.amount
--     WHEN t.status IN ('paid','pending','overdue') AND t.destination_account_id = fa.id AND t.transaction_type = 'transfer' THEN t.amount
--     ELSE 0 END), 0)::NUMERIC(14, 2) AS projected_balance
-- FROM public.financial_accounts fa
-- JOIN public.companies c ON c.id = fa.company_id
-- LEFT JOIN public.transactions t
--   ON t.tenant_id = fa.tenant_id AND t.status <> 'canceled'
--  AND (t.account_id = fa.id OR t.destination_account_id = fa.id)
-- WHERE public.is_authorized_tenant(fa.tenant_id)
-- GROUP BY fa.id, fa.tenant_id, fa.company_id, c.group_id, fa.name, fa.analytical_token;
--
-- ALTER TABLE public.financial_accounts DROP CONSTRAINT IF EXISTS chk_financial_accounts_opening_date;
-- ALTER TABLE public.financial_accounts DROP COLUMN IF EXISTS opening_balance_date, DROP COLUMN IF EXISTS opening_balance;
-- ----------------------------------------------------------------------------
