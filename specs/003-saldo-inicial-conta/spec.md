# Spec 003 — Saldo inicial e edição de conta

- **Status:** em-andamento
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
- [ ] CA1: criar conta com saldo inicial R$ 1.000,00 em 01/11 mostra saldo atual 1.000,00 sem lançamentos.
- [ ] CA2: um lançamento pago de R$ 200 (despesa) em 05/11 leva o saldo atual a 800,00.
- [ ] CA3: lançamento pago **antes** de 01/11 não entra na soma.
- [ ] CA4: editar o saldo inicial atualiza imediatamente saldo atual e previsto em todas as telas e nos consolidados.
- [ ] CA5: saldo inicial negativo é aceito e exibido corretamente.
- [ ] CA6: contas antigas continuam com os mesmos saldos de hoje.
- [ ] CA7: criar a conta já com saldo inicial (positivo e negativo) funciona no formulário de cadastro, sem precisar editar depois.
- [ ] CA8: alterar o saldo inicial de uma conta com lançamentos pede confirmação com o aviso; cancelar não altera nada.
- [ ] CA9: no Fluxo & Lançamentos o saldo inicial aparece só como observação discreta (cartão "Saldo Anterior" e cartão da conta), sem criar lançamento nem linha no extrato.
- [ ] CA10: outro tenant não vê nem altera as contas (RLS); a escrita envia só as colunas permitidas (sem "permission denied").
- [ ] CA11: testes automáticos cobrem a regra de cálculo (com/sem data, negativo, transferência).

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
—
