# Tasks 003 — Saldo inicial e edição de conta

- **Status:** em-andamento
- **Plan:** `specs/003-saldo-inicial-conta/plan.md` (aprovado em 2026-11-27)
- **Branch:** `feat/003-saldo-inicial-conta` (saindo da `dev`)
- **Aprovado em:** 2026-11-27

Uma tarefa por vez, em ordem. Marque `[x]` ao concluir. Commit: `feat(003): descrição (T01)`.
Antes de cada commit: `npx tsc --noEmit && npm test` (e `npm run build` nas tarefas de front).
Tarefas marcadas **(usuário)** dependem de uma ação sua; eu não as simulo.

- [x] T01 — Escrever `supabase/migrations/0007_opening_balance.sql`: colunas `opening_balance` e `opening_balance_date`,
  constraint idempotente (saldo ≠ 0 exige data), `CREATE OR REPLACE VIEW v_account_balances` com a mesma regra do cliente
  e bloco de rollback comentado.
  **Pronto quando:** o arquivo é idempotente (`IF NOT EXISTS`/`DO $$`), mantém a ordem das colunas existentes da view e passa na leitura minuciosa
  (revisão linha a linha contra a view da 0002). (CA6, CA10)

- [x] T02 — Tipos e regra pura: `FinancialAccount` e `AccountBalanceSummary` com os campos novos; em `repository.ts`, helpers
  `transactionCashDate` e `normalizeOpeningBalance`; ajustar fixtures (`healthEngine.test.ts` e demais) para o `tsc` voltar a passar.
  **Pronto quando:** `npx tsc --noEmit` passa. (CA5, CA6)

- [x] T03 — Testes da regra em `src/modules/core/__tests__/accountBalances.test.ts` (registrar em `scripts/run-tests.ts`), escritos **antes**
  da implementação do cálculo: CA1, CA2, CA3, negativo, transferência com datas diferentes, conta antiga igual a hoje, previsto,
  `previousBalance` com saldo inicial, `normalizeOpeningBalance`.
  **Pronto quando:** `npm test` roda a nova suíte e os casos que dependem do cálculo **falham** (prova de que testam). (CA1, CA2, CA3, CA5, CA11)

- [ ] T04 — Implementar o cálculo: `computeAccountBalances` e `computePeriodMetrics` (com `openingBalanceTotal`) usando saldo inicial e data de caixa.
  **Pronto quando:** os testes da T03 passam e `npm test` inteiro continua verde (os saldos de contas sem saldo inicial não mudam). (CA1–CA6, CA11)

- [ ] T05 — Cadastro e edição no repository: `CreateAccountInput` e `createFinancialAccount` (sandbox + Supabase) com os campos novos e validação;
  nova `updateFinancialAccount` com lista explícita de colunas; seed do sandbox com `0`/`null`.
  **Pronto quando:** `tsc` e `npm test` passam; testes do modo sandbox cobrem criar com saldo positivo/negativo e editar. (CA7, CA8, CA10)

- [ ] T06 — Tela Empresas & Contas: campos "Saldo inicial" e "Data do saldo" no cadastro; botão "Editar" por conta (Dialog);
  **Dialog de confirmação** quando saldo/data mudam e a conta tem lançamentos (cancelar não grava); texto discreto sob o nome da conta;
  `App.tsx` repassa `transactions`.
  **Pronto quando:** `tsc` e `build` passam; no sandbox local (`npm run dev`) criar, editar, confirmar e cancelar funcionam. (CA7, CA8)

- [ ] T07 — Fluxo & Lançamentos: observação "inclui saldo inicial de R$ X" no cartão "Saldo Anterior" e linha pequena no cartão de cada conta,
  só quando o saldo inicial ≠ 0.
  **Pronto quando:** `tsc`/`build` passam e, no sandbox, a observação aparece e some com saldo zero; nenhuma linha nova no extrato. (CA9)

- [ ] T08 — Rodar tudo: `npx tsc --noEmit`, `npm test`, `npm run build`; conferir o SQL da T01 uma última vez.
  **Pronto quando:** os três comandos passam. (CA11)

- [ ] T09 — **(usuário)** Aplicar `0007_opening_balance.sql` no SQL Editor do Supabase (o mesmo banco serve h-cfo e cfo) e me avisar.
  Eu entrego o SQL pronto no chat. **Só depois disto** se faz o merge.
  **Pronto quando:** o usuário confirma e uma consulta `select opening_balance, opening_balance_date from financial_accounts limit 1` funciona.

- [ ] T10 — Subir a branch, abrir PR para a `dev`, merge e deploy no h-cfo. **(usuário: confirmar o merge)**
  **Pronto quando:** workflow verde e h-cfo respondendo 200.

- [ ] T11 — Verificação final no h-cfo contra todos os critérios (`/sdd-verify 003`): criar conta com saldo positivo e outra negativo;
  conferir Fluxo, Visão Geral e Saúde; editar conta com lançamentos (aviso, cancelar e confirmar); observações discretas;
  conta antiga inalterada; `v_account_balances` comparada com a tela. Apagar as contas de teste. **(usuário entra no h-cfo)**
  **Pronto quando:** CA1–CA11 marcados `[x]` na spec com evidência.

## Notas de execução
- T01: migration testada em um Postgres 16 **descartável** (container `--rm` no VPS, tabelas mínimas): cenários CA1/CA2/CA3, saldo negativo, transferência, cancelado ignorado, conta antiga inalterada, idempotência (2 execuções) e constraint. Resultado: conta com 1.000 em 01/11 → 760 atual/710 previsto; conta com −500 → −360; conta antiga igual a antes.
(decisões e descobertas durante a implementação; mudança de escopo → parar e atualizar a spec)
- T03: commitada com 8 de 12 testes **falhando de propósito** (o cálculo ainda não usa o saldo inicial) e um erro de `tsc` por `openingBalanceTotal` (campo criado na T04). Sem push até ficar verde (T08).
