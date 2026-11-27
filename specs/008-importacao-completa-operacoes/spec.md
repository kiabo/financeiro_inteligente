# Spec 008 — Importação completa das operações financeiras (visão geral e regras)

- **Status:** rascunho
- **Criada em:** 2026-11-27
- **Aprovada em:** —
- **Responsável pela aprovação:** usuário

## Problema
A importação da spec 004 traz só **cobranças e pagamentos recebidos** (receita bruta + taxa da cobrança). O dinheiro de uma conta no Asaas ou no Mercado Pago se move por muito mais:
transferências (entre contas próprias e para terceiros), pagamento de contas, Pix enviado, saques, taxas que não são de cobrança (mensalidades, antecipação, envio de SMS/boleto),
estornos e chargebacks, compras feitas com a conta, saldo bloqueado e liberações. Sem isso, o saldo e o resultado no sistema **não batem** com o do provedor.
O usuário quer importar **todas as operações financeiras**, no Mercado Pago, no Asaas e em qualquer outro banco.

## Por que esta spec é só a visão geral
O tema é grande e tem uma dificuldade central: **a mesma entrada de dinheiro pode aparecer duas vezes** (como cobrança paga e como linha do extrato) e **a mesma transferência
pode aparecer nas duas pontas** (saiu do Asaas e entrou no C6). Por isso esta spec fixa o modelo e as regras; a importação de cada fonte vira uma spec própria depois (ver "Divisão sugerida").

## Histórias de usuário
- Como titular, quero que o saldo de cada conta no sistema bata com o saldo no provedor ou no banco, porque hoje só entram as cobranças.
- Como titular, quero ver transferências, pagamentos, taxas e estornos como lançamentos próprios, classificados, e não perdidos.
- Como titular, quero que uma transferência entre duas contas minhas apareça como **transferência** (sem virar receita nem despesa), mesmo que cada ponta venha de uma fonte diferente.
- Como titular, quero que reimportar não duplique nada.
- Como titular, quero importar de qualquer banco, não só do Asaas e do Mercado Pago.

## Comportamento esperado (regras gerais)
1. **Fonte da verdade do caixa é o extrato** da fonte (provedor ou banco). A cobrança (spec 004) continua sendo a fonte da **competência** e do cliente; o extrato confirma o caixa.
2. **Sem dupla contagem:** uma linha do extrato que corresponde a uma cobrança já importada **atualiza/vincula** o lançamento existente (mesma chave por pagamento) e não cria outro.
   Só gera lançamento novo o que não tem cobrança correspondente.
3. **Tipos de operação** reconhecidos e classificados: recebimento de cobrança, taxa, estorno/chargeback, transferência recebida, transferência enviada, pagamento de conta/boleto,
   Pix enviado, saque, compra, tarifa da conta, antecipação, ajuste/outros (cai numa categoria "a classificar").
4. **Transferência entre contas do próprio titular** vira lançamento do tipo transferência (já existe no sistema), com as duas pontas casadas por valor, data próxima e a conta/instituição de contraparte.
   Se só uma ponta foi importada, fica como "transferência pendente de par", visível em uma lista de pendências.
5. **Categorias:** regras por tipo de operação com categoria padrão editável; o que não casar fica "a classificar". Nenhum dado identificável vai a IA externa (tokens analíticos).
6. **Idempotência** por identificador da operação na fonte, independente de conta e de conexão (mesma regra da spec 004).
7. **Saldo:** depois de importar, a tela mostra a diferença entre o saldo do sistema e o saldo informado pela fonte (quando a fonte informa), para o usuário enxergar o que falta.
8. **Fontes sem API** (bancos comuns) entram por **arquivo** (OFX/CSV), reaproveitando a Conciliação Bancária; fontes com API entram por consulta, como na 004.
9. Importação sob demanda, em lotes, com progresso, retomável e só leitura (como na 004). A conta Asaas é real: nada é escrito no provedor.

## Divisão sugerida (plano extra)
Cada item abaixo vira uma spec própria, nesta ordem, **depois** de aprovada esta visão geral:
- **008 (esta):** modelo comum de "operação", tipos, regras de dupla contagem, pares de transferência, classificação e pendências.
- **009 — Asaas:** extrato/movimentações da conta (recebimentos, taxas, transferências, pagamento de contas, antecipações).
- **010 — Mercado Pago:** movimentações da conta (inclui compras feitas pela conta, que hoje a 004 ignora de propósito).
- **011 — Outros bancos:** OFX/CSV pela Conciliação (C6, Sicoob) como importação de operações; e, se o usuário quiser, avaliar Open Finance como fonte futura.

## Critérios de aceite
Verificáveis nesta spec (o modelo e as regras); os de cada fonte ficam nas specs 009–011.
- [ ] CA1: existe uma classificação única de tipos de operação, documentada e testada, usada por todas as fontes.
- [ ] CA2: uma operação de extrato que casa com uma cobrança já importada **não** cria lançamento novo (teste com recebimento importado pelas duas vias; saldo igual ao do provedor).
- [ ] CA3: reimportar o mesmo extrato resulta em 0 lançamentos novos.
- [ ] CA4: uma transferência entre duas contas do titular, com as duas pontas importadas, vira **um** lançamento de transferência e não altera receita nem despesa (DRE inalterada).
- [ ] CA5: uma ponta de transferência sem par fica numa lista de pendências e não distorce receita/despesa.
- [ ] CA6: operações sem regra de categoria entram como "a classificar" e aparecem para revisão.
- [ ] CA7: a diferença entre o saldo do sistema e o saldo da fonte é exibida e igual a 0 quando tudo foi importado.
- [ ] CA8: nenhum dado identificável (nomes de contrapartes, documentos) sai para IA externa.

## Fora de escopo
- Escrever ou movimentar dinheiro nas fontes (só leitura).
- Open Finance como integração implementada (só avaliação futura, na spec 011).
- Conciliação automática de extrato contra lançamentos criados manualmente (já existe a Conciliação Bancária).
- Importação contínua/agendada (continua sob demanda; pode virar spec futura).

## Restrições e princípios aplicáveis
- Constituição nº 3 (segredos), nº 4 (idempotência), nº 5 (dinheiro `NUMERIC`), nº 6 (regra de negócio com teste), nº 1 (privacidade), nº 10 (dados reais com cautela).
- Migrations só aditivas, aplicadas manualmente pelo usuário; conta Asaas real: somente leitura.

## Pontos para o plan (não são perguntas ao usuário)
- Confirmar nas documentações oficiais quais endpoints dão o extrato completo: no Asaas, a listagem de movimentações financeiras; no Mercado Pago, os relatórios de conta/liberações (a busca de pagamentos da 004 não basta).
  Verificar também paginação, limites de requisição e o que cada linha informa de contraparte.
- Reaproveitar a chave por pagamento (`external_source/ref/role`) e acrescentar uma chave de operação; avaliar uma tabela de operações brutas separada dos lançamentos.
- Reaproveitar o motor de pares da Conciliação Bancária (`reconciliationEngine.ts`) para casar pontas de transferência.

## Perguntas abertas
- **Objetivo principal:** é fazer o **saldo** bater com o do provedor, ou ter o **resultado (DRE)** completo, ou os dois? Isso muda a prioridade das fases.
- **Por onde começar:** Asaas, Mercado Pago ou arquivos OFX dos bancos (C6, Sicoob)? Sugestão: Asaas primeiro (já importamos as cobranças dele).
- **Transferências entre as suas contas** (por exemplo Asaas → C6): devem sempre virar "transferência" (sem receita nem despesa)? Sugestão: sim.
- **Compras feitas com a conta** do Mercado Pago (hoje ignoradas na 004): entram como despesas? Em que categoria padrão?
- **Retroatividade:** importar de qualquer data ou manter o limite de 12 meses por execução da 004?
- **"Qualquer outro banco":** além de OFX/CSV, quer que eu avalie Open Finance (um agregador pago) como fonte? Isso envolve custo e termos de uso.

## Registro de verificação
—
