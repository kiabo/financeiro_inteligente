# Plan 003 — Saldo inicial e edição de conta

- **Status:** concluído
- **Spec:** `specs/003-saldo-inicial-conta/spec.md` (aprovada em 2026-11-27)
- **Criado em:** 2026-11-27
- **Aprovado em:** 2026-11-27

## Abordagem
O saldo inicial vira **dois campos da conta** (`opening_balance`, `opening_balance_date`), definidos no cadastro e editáveis.
O saldo **não é lançamento**: entra no cálculo como ponto de partida. Movimentos com data de caixa **anterior** à data do saldo
são ignorados no saldo daquela conta (o saldo inicial já os resume).
Alternativa descartada: criar um lançamento "Saldo inicial" por conta (sujaria DRE, extrato e conciliação e contrariaria o pedido de aparecer discretamente).

## Descobertas que afetam o plano
1. **O saldo é calculado em dois lugares**, que precisam ficar iguais:
   - cliente: `computeAccountBalances` ([repository.ts:637](src/modules/core/repository.ts#L637)), usado pelo Fluxo, pelo motor de Saúde
     ([healthEngine.ts:1120](src/modules/health/healthEngine.ts#L1120)) e pelo contexto do CFO virtual ([aiContextBuilder.ts:551](src/modules/ai-cfo/aiContextBuilder.ts#L551));
     e o "Saldo Anterior" do fluxo em `computePeriodMetrics` ([repository.ts:714](src/modules/core/repository.ts#L714));
   - SQL: view `v_account_balances` e função `get_account_balances_by_context` (0002). A função hoje **não tem chamador** no app; atualizo a view para manter paridade.
2. Não há GRANT/REVOKE por coluna em `financial_accounts` (diferente de `notification_preferences`): o `UPDATE` direto funciona. Mesmo assim escrevo **só colunas explícitas**, por convenção.
3. O token analítico é imutável por trigger ([0001…sql:396](supabase/migrations/0001_module1_foundation.sql#L396)); editar a conta não o altera. Atualizações já geram auditoria `entity.updated` por trigger ([0001…sql:470](supabase/migrations/0001_module1_foundation.sql#L470)).
4. O backup e a tela de segurança leem `select *`, então as colunas novas entram sozinhas. Já existe `components/ui/dialog.tsx`: o aviso de confirmação usa o Dialog do app, **não** `window.confirm`.

## Regra de cálculo
- Data de caixa do movimento: `status = 'paid' && payment_date ? payment_date : due_date` (a mesma de `getTransactionReferenceDate` no regime de caixa).
- Um movimento conta no saldo de uma conta se `opening_balance_date` é nula **ou** a data de caixa é ≥ `opening_balance_date`.
- `saldo atual` = `opening_balance` + movimentos **pagos** que contam; `saldo previsto` = `opening_balance` + todos (pagos, pendentes, vencidos) que contam; cancelados nunca.
- Transferências: cada ponta é avaliada pela data da **sua** conta.
- "Saldo anterior" do período: soma dos movimentos pagos anteriores ao início **mais** o `opening_balance` das contas do escopo cuja data do saldo é ≤ fim do período (ou período sem fim). Limitação aceita: lançamentos *dentro* do período mas anteriores à data do saldo ainda aparecem em Entradas/Saídas (são resultado, não saldo).

## Banco de dados — migration `0007_opening_balance.sql` (aplicada **manualmente** pelo usuário)
```sql
ALTER TABLE public.financial_accounts
  ADD COLUMN IF NOT EXISTS opening_balance      NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_balance_date DATE;
-- constraint idempotente: saldo diferente de zero exige a data
-- CREATE OR REPLACE VIEW public.v_account_balances … (colunas existentes na mesma ordem;
--   saldo = opening_balance + soma filtrada pela data de caixa; GROUP BY inclui fa.opening_balance)
```
- Contas existentes ficam com `0`/`NULL`: os saldos de hoje não mudam (CA6).
- RLS e FORCE RLS já cobrem a tabela; nenhuma política nova. `get_account_balances_by_context` mantém a assinatura.
- Rollback SQL (documentado no arquivo): restaurar a view da 0002 e `ALTER TABLE … DROP COLUMN`.
- Ordem de aplicação: **a migration entra no Supabase antes do deploy do front** (o front passa a gravar/ler as colunas). Como h-cfo e cfo dividem o mesmo banco, aplicar uma vez serve aos dois.

## Arquivos afetados
| Arquivo | Mudança |
|---|---|
| `supabase/migrations/0007_opening_balance.sql` (novo) | colunas, constraint, view |
| `src/modules/core/types.ts` | `FinancialAccount` ganha `opening_balance: number` e `opening_balance_date: string \| null`; `AccountBalanceSummary` ganha `opening_balance` e `opening_balance_date` |
| `src/modules/core/repository.ts` | helpers puros `transactionCashDate`, `normalizeOpeningBalance`; `computeAccountBalances` e `computePeriodMetrics` (novo `openingBalanceTotal`); `CreateAccountInput` com os campos novos; `createFinancialAccount` (sandbox e Supabase); nova `updateFinancialAccount` (lista de colunas permitida: nome, tipo, instituição, últimos 4, saldo inicial, data, ativa); seed do sandbox com `0`/`null` |
| `src/modules/settings/HierarchySettingsView.tsx` | campos "Saldo inicial" e "Data do saldo" no cadastro; botão "Editar" por conta abrindo Dialog de edição; **Dialog de confirmação** quando saldo/data mudam e a conta já tem lançamentos; texto discreto "Saldo inicial R$ X em dd/mm/aaaa" sob o nome da conta; recebe `transactions` |
| `src/App.tsx` | repassa `snapshot.transactions` ao `HierarchySettingsView` |
| `src/modules/core/views/CashFlowView.tsx` | observação no cartão "Saldo Anterior" ("inclui saldo inicial de R$ X") e linha pequena no cartão de cada conta |
| `src/modules/health/__tests__/healthEngine.test.ts` | fixtures `ACC_1/ACC_2` com os campos novos |
| `src/modules/core/__tests__/accountBalances.test.ts` (novo) + `scripts/run-tests.ts` | testes da regra |

## Contratos
- `CreateAccountInput`: `opening_balance?: number` (padrão 0) e `opening_balance_date?: string` (padrão hoje quando há saldo).
- `updateFinancialAccount(tenantId, userEmail, accountId, patch)`: erro se o `accountId` não é do tenant (RLS devolve 0 linhas).
- Validação `normalizeOpeningBalance`: número finito, 2 casas, |valor| ≤ 999.999.999.999,99 (`NUMERIC(14,2)`), data ISO válida e **obrigatória** se o valor ≠ 0; data futura rejeitada.

## Riscos e mitigação
- **Front antes da migration**: o insert/select nas colunas novas falharia. Mitigação: o passo "usuário aplica a 0007" fica **antes** do merge na `dev`, nas tasks; sem a migration, não se faz deploy.
- **Divergência entre telas**: todos usam `computeAccountBalances`/`computePeriodMetrics`; testes fixam o resultado; a view SQL espelha a regra e fica documentada.
- **Movimento antes da data do saldo** em período misto (ver limitação): documentado, coberto por teste.
- **Valores monetários**: `NUMERIC` no banco e arredondamento a 2 casas na entrada; sem ponto flutuante no armazenamento.
- **Edição acidental**: confirmação obrigatória quando há lançamentos; cancelar não grava nada.

## Rollback
Código: reverter o commit. Banco: o SQL de rollback do arquivo (as colunas novas não quebram a versão anterior do app, então a migration pode ficar).

## Estratégia de teste
- **Automático** (`accountBalances.test.ts`): CA1 (1.000 em 01/11 sem lançamentos → 1.000), CA2 (despesa paga de 200 em 05/11 → 800), CA3 (pago antes de 01/11 não entra),
  CA5 (negativo), transferência entre contas com datas de saldo diferentes, sem data (conta antiga → igual a hoje), previsto com pendentes, `previousBalance` incluindo o saldo inicial, `normalizeOpeningBalance` (limites, data obrigatória, data futura).
- `npx tsc --noEmit`, `npm test`, `npm run build`.
- **Manual no h-cfo** (após o usuário aplicar a 0007): criar conta com saldo positivo e outra negativo (CA7); conferir Fluxo, Visão Geral e Saúde (CA1, CA4);
  editar o saldo de conta com lançamentos e ver o aviso e o cancelar (CA8); observações discretas no Fluxo (CA9); conta antiga inalterada (CA6);
  consulta SQL em `v_account_balances` comparada com a tela. Apagar as contas de teste ao final.
