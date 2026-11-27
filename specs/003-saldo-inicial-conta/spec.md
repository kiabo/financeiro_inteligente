# Spec 003 — Saldo inicial e edição de conta

- **Status:** rascunho
- **Criada em:** 2026-11-26
- **Aprovada em:** —
- **Responsável pela aprovação:** usuário

## Problema
Uma conta financeira não tem saldo inicial: o saldo atual é só a soma dos lançamentos pagos
(`v_account_balances`, migration 0002). Quem começa a usar o sistema com dinheiro já na conta não consegue
refletir isso. Também não existe tela para editar uma conta depois de criada (só criar).

## Histórias de usuário
- Como titular, quero informar o saldo inicial de uma conta (e a data dele) ao criá-la.
- Como titular, quero alterar o saldo inicial e os dados da conta depois de criada.
- Como titular, quero que o saldo atual e o previsto considerem o saldo inicial.

## Comportamento esperado
- Campos novos na conta: **Saldo inicial** (pode ser negativo, ex.: cheque especial) e **Data do saldo**.
- Saldo atual = saldo inicial + movimentos pagos **a partir da data do saldo** (se a data estiver vazia, todos os movimentos).
- Saldo previsto = idem, incluindo pendentes e vencidos.
- Em Empresas & Contas, cada conta tem ação "Editar" (nome, instituição, tipo, últimos 4 dígitos, saldo inicial, data, ativa/inativa).
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
- [ ] CA7: outro tenant não vê nem altera as contas (RLS); a escrita envia só as colunas permitidas (sem "permission denied").
- [ ] CA8: testes automáticos cobrem a regra de cálculo (com/sem data, negativo, transferência).

## Fora de escopo
- Ajuste de saldo por "lançamento de ajuste" (reconciliação); pode ser spec futura.
- Múltiplas moedas.

## Restrições e princípios aplicáveis
- Constituição nº 5 (NUMERIC), nº 6 (teste de regra de negócio), nº 9 (reversível). Migration `0007` aplicada manualmente.

## Perguntas abertas
- O saldo inicial deve aparecer no extrato/fluxo como uma linha "Saldo inicial", ou só no total?
- Permitir alterar o saldo inicial quando já há lançamentos (afeta histórico)? Proposta: sim, com aviso.

## Registro de verificação
—
