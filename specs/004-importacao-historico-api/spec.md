# Spec 004 — Importação de histórico por API (Asaas e Mercado Pago)

- **Status:** em-andamento
- **Criada em:** 2026-11-26
- **Aprovada em:** 2026-11-27
- **Responsável pela aprovação:** usuário

## Problema
Hoje os pagamentos entram só por webhook, ou seja, a partir do momento em que a conexão é criada. Quem já tem meses
de cobranças no Asaas ou no Mercado Pago não consegue trazer o histórico. É preciso consultar a API do provedor.

## Histórias de usuário
- Como titular, quero informar a chave de API de uma conexão para que o sistema consulte o provedor.
- Como titular, quero importar o histórico de um período (ex.: últimos 12 meses) de cobranças/pagamentos.
- Como titular, quero que reimportar ou receber depois um webhook do mesmo pagamento não duplique lançamentos.

## Comportamento esperado
- Provedores nesta spec: **Asaas** e **Mercado Pago** (Stripe fica para depois).
- Na conexão: campo "Chave de API" (guardada cifrada, nunca exibida de volta; mostra só "configurada").
- Botão "Importar histórico": escolhe o **período** (máx. 12 meses por execução) e a **conta de destino daquela importação**
  (campo obrigatório, escolhido a cada vez; não vem fixo da conexão) e mostra o resultado: importados, atualizados, ignorados, erros.
  É o mesmo comportamento da Conciliação por arquivo, que já pergunta "Conta do extrato" a cada importação.
- Status importados: pagos, confirmados, pendentes e vencidos. Cancelados e estornados entram marcados à parte (não somam no saldo).
- **Cliente nos lançamentos:** o nome do cliente (Asaas: cliente da cobrança; Mercado Pago: pagador) é gravado como contraparte do lançamento.
  Não se cria cadastro de clientes/contatos. O nome é dado identificável e segue as regras de anonimização (já tratado como termo sensível no contexto da IA).
- Os pagamentos viram lançamentos com as mesmas regras do webhook (receita bruta e taxa separadas, produto casado
  por referência, pendente → liquidado quando pago).
- Eventos importados aparecem no log de eventos marcados como origem "API".
- Execução em lotes, com progresso; falhas parciais não perdem o que já foi importado.
- A conta Asaas é real: a importação **só lê** dados do provedor.

## Critérios de aceite
- [ ] CA1: salvar chave de API não a exibe em nenhuma resposta ou tela; ela fica cifrada no banco.
- [ ] CA2: importar 3 meses do Asaas cria os lançamentos esperados (conferir contagem e valores contra o painel do Asaas).
- [ ] CA3: importar o mesmo período de novo resulta em 0 novos lançamentos.
- [ ] CA4: um webhook de pagamento já importado não duplica nem altera o valor.
- [ ] CA5: um pagamento importado como pendente e depois liquidado (webhook ou nova importação) atualiza o mesmo lançamento.
- [ ] CA6: o mesmo fluxo funciona com o Mercado Pago.
- [ ] CA7: chave inválida ou expirada mostra mensagem clara, sem travar.
- [ ] CA8: limites do provedor (rate limit/paginação) são respeitados; períodos acima de 12 meses são recusados.
- [ ] CA9: testes automáticos cobrem mapeamento, idempotência e paginação com respostas de exemplo das duas APIs.
- [ ] CA10: a conta de destino é escolhida em cada importação e é obrigatória; os lançamentos entram nessa conta, mesmo que seja diferente da conta fixa da conexão de webhook.
- [ ] CA11: cada lançamento importado traz o nome do cliente como contraparte; esse nome continua tokenizado em qualquer envio para IA externa.
- [ ] CA12: um pagamento já importado em uma conta e depois recebido por webhook (cuja conexão aponta para outra conta) **não** duplica: atualiza o mesmo lançamento pelo identificador do pagamento.
- [ ] CA13: cancelados e estornados aparecem marcados à parte e não alteram o saldo das contas.

## Fora de escopo
- Sincronização contínua/agendada por API (apenas importação sob demanda).
- Escrever no provedor (criar/alterar cobranças).
- Stripe e Open Finance.

## Restrições e princípios aplicáveis
- Constituição nº 3 (segredos), nº 4 (idempotência), nº 5 (dinheiro), nº 6 (testes).

## Perguntas abertas
Nenhuma. (Respondidas pelo usuário em 2026-11-27; ver abaixo.)

## Respostas às perguntas abertas
- **Quais status?** Conforme a proposta: pagos, confirmados, pendentes e vencidos; cancelados/estornados marcados à parte.
- **Clientes?** A importação pode atribuir o cliente aos lançamentos (nome na contraparte; sem cadastro separado).
- **Em qual conta entra?** Na hora de iniciar a importação (arquivo ou API) escolhe-se a conta daquela importação específica.

## Pontos para o plan (não são perguntas ao usuário)
- Asaas devolve só o id do cliente na cobrança: o nome exige consulta a `/v3/customers/{id}`; cache por importação e respeito ao rate limit.
- Idempotência entre importação (conta escolhida) e webhook (conta da conexão): a chave é o identificador do pagamento do provedor, não a conta (ver CA12).
- A Conciliação por arquivo já escolhe a conta a cada importação; nada a mudar lá.

## Registro de verificação
—
