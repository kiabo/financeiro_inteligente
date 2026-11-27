# Spec 003 — Saldo inicial e edição de conta

- **Status:** concluído
- **Criada em:** 2026-11-26
- **Aprovada em:** 2026-11-27
- **Responsável pela aprovação:** usuário

## Problema
Uma conta financeira não tem saldo inicial: o saldo atual é só a soma dos lançamentos pagos
(`v_account_balances`, migration 0002). Quem começa a usar o sistema com dinheiro já na conta não consegue
refletir isso. Também não existe tela para editar uma conta depois de criada (só criar).

## Histórias de usuário
- Como titular, quero informar, **na abertura da conta**, o saldo (positivo ou negativo) que ela já tinha quando comecei a usar o sistema, e a data desse saldo.
- Como titular, quero alterar o saldo inicial e os dados da conta depois de criada.
- Como titular, quero que o saldo atual e o previsto considerem o saldo inicial.

## Comportamento esperado
- O saldo inicial é informado **no cadastro da conta** (a conta pode já ter movimentação anterior ao uso do sistema). Campos novos: **Saldo inicial** (pode ser negativo, ex.: cheque especial) e **Data do saldo** (padrão: hoje).
- Saldo atual = saldo inicial + movimentos pagos **a partir da data do saldo** (se a data estiver vazia, todos os movimentos).
- Saldo previsto = idem, incluindo pendentes e vencidos.
- Em Empresas & Contas, cada conta tem ação "Editar" (nome, instituição, tipo, últimos 4 dígitos, saldo inicial, data, ativa/inativa).
- **Alterar o saldo inicial é permitido mesmo com lançamentos**, mas antes de salvar o sistema mostra um aviso de confirmação: a mudança altera o saldo atual e o previsto em todas as telas e nos consolidados.
- **Aparição discreta no fluxo**: em Fluxo & Lançamentos o saldo inicial não vira lançamento nem linha de extrato. Ele aparece (a) como uma observação pequena no cartão "Saldo Anterior" ("inclui saldo inicial de R$ X") quando for diferente de zero e (b) como uma linha pequena no cartão de cada conta ("Saldo inicial: R$ X em dd/mm/aaaa"). Ele entra no "Saldo Anterior" dos períodos que terminam em ou depois da data do saldo.
- Visão Geral, Fluxo & Lançamentos, Saúde Financeira e consolidações por empresa/grupo refletem o novo saldo.
- Contas existentes ficam com saldo inicial 0, sem mudança no que o usuário vê hoje.
- Transferências entre contas continuam movimentando saldo sem afetar resultado.

## Critérios de aceite
- [x] CA1: criar conta com saldo inicial R$ 1.000,00 em 01/11 mostra saldo atual 1.000,00 sem lançamentos.
- [x] CA2: um lançamento pago de R$ 200 (despesa) em 05/11 leva o saldo atual a 800,00.
- [x] CA3: lançamento pago **antes** de 01/11 não entra na soma.
- [x] CA4: editar o saldo inicial atualiza imediatamente saldo atual e previsto em todas as telas e nos consolidados.
- [x] CA5: saldo inicial negativo é aceito e exibido corretamente.
- [x] CA6: contas antigas continuam com os mesmos saldos de hoje.
- [x] CA7: criar a conta já com saldo inicial (positivo e negativo) funciona no formulário de cadastro, sem precisar editar depois.
- [x] CA8: alterar o saldo inicial de uma conta com lançamentos pede confirmação com o aviso; cancelar não altera nada.
- [x] CA9: no Fluxo & Lançamentos o saldo inicial aparece só como observação discreta (cartão "Saldo Anterior" e cartão da conta), sem criar lançamento nem linha no extrato.
- [x] CA10 (parcial, aceito pelo usuário em 2026-11-27): outro tenant não vê nem altera as contas (RLS); a escrita envia só as colunas permitidas (sem "permission denied").
- [x] CA11: testes automáticos cobrem a regra de cálculo (com/sem data, negativo, transferência).

## Fora de escopo
- Ajuste de saldo por "lançamento de ajuste" (reconciliação); pode ser spec futura.
- Múltiplas moedas.

## Restrições e princípios aplicáveis
- Constituição nº 5 (NUMERIC), nº 6 (teste de regra de negócio), nº 9 (reversível). Migration `0007` aplicada manualmente.

## Perguntas abertas
Nenhuma. (Respondidas pelo usuário em 2026-11-27; ver abaixo.)

## Respostas às perguntas abertas
- **Saldo inicial no fluxo?** É o saldo que a conta já tinha na abertura, informado no cadastro da conta. No fluxo deve aparecer discretamente (não como lançamento).
- **Alterar com lançamentos existentes?** Sim, com aviso.

## Registro de verificação
Verificado em 2026-11-27 no h-cfo (deploy do PR #3, migration 0007 aplicada), usuário owner aal2, pelo Chrome, com o banco real. Contas de teste "ZZ Teste 003 …" criadas e **apagadas** ao final; as 3 contas reais ficaram em 0 / sem data.

| Critério | Resultado | Evidência |
|---|---|---|
| CA1 | ok | conta nova com saldo inicial (1.500,50) criada pelo formulário; depois editada para 2.000,00, o cartão da conta no Fluxo mostrou "Saldo atual R$ 2.000,00" sem lançamentos |
| CA2, CA3 | ok (teste automático) | cobertos pela suíte (75/75) e pelo Postgres descartável: 1.000 → 760/710; pagamento anterior à data do saldo ignorado. **Não repetido no h-cfo** para não criar lançamentos reais |
| CA4 | ok | com saldos +2.000 e −300: Fluxo "Saldo Anterior" R$ 1.700,00; Visão Geral "Saldo realizado" R$ 46,01 → R$ 1.746,01; Saúde Financeira também mostra R$ 1.746,01 |
| CA5 | ok | conta com −300 exibida como "-R$ 300,00" (linha da conta e cartão no Fluxo) |
| CA6 | ok | consulta ao banco: CTA_01/02/03 com `opening_balance = 0` e data nula; saldos anteriores intactos (Conta SaaS R$ 146,01) |
| CA7 | ok | criação com saldo positivo e com negativo pelo formulário, gravando no Supabase sem "permission denied" |
| CA8 | ok (em parte) | na Conta SaaS (4 lançamentos): ao salvar surgiu o aviso com a prévia "R$ 146,01 → R$ 246,01"; "Voltar" e "Cancelar" não gravaram nada (confirmado no banco). O caminho **confirmar** em conta real com lançamentos não foi executado, para não alterar dados reais; foi validado no sandbox. A gravação pelo Supabase foi validada em conta sem lançamentos |
| CA9 | ok | Fluxo: "inclui saldo inicial de R$ 1.700,00" no Saldo Anterior e linha "Saldo inicial: … em 27/11/2026" nos cartões; 0 linhas no extrato |
| CA10 | **parcial** | escrita com lista explícita de colunas funcionou (sem "permission denied"). Isolamento entre tenants **não testado** (há um único tenant); a RLS da tabela não foi alterada pela 0007 |
| CA11 | ok | `npm test` 75/75 (cálculo, datas, negativo, transferência, `normalizeOpeningBalance`, `parseMoneyInput`, `buildAccountUpdate`, sandbox) |

Também: a view `v_account_balances` não pôde ser comparada com a tela pela service role (filtra por `auth.uid()`); a regra foi validada no Postgres descartável.
