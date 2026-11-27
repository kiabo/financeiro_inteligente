# Spec 004 — Importação de histórico por API (Asaas e Mercado Pago)

- **Status:** rascunho
- **Criada em:** 2026-11-26
- **Aprovada em:** —
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
- Botão "Importar histórico": escolhe período (máx. 12 meses por execução) e mostra o resultado:
  importados, atualizados, ignorados, erros.
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

## Fora de escopo
- Sincronização contínua/agendada por API (apenas importação sob demanda).
- Escrever no provedor (criar/alterar cobranças).
- Stripe e Open Finance.

## Restrições e princípios aplicáveis
- Constituição nº 3 (segredos), nº 4 (idempotência), nº 5 (dinheiro), nº 6 (testes).

## Perguntas abertas
- Importar quais status? Proposta: pagos, confirmados, pendentes e vencidos (cancelados/estornados marcados à parte).
- A importação cria clientes/contatos ou só lançamentos?
- Em qual conta o dinheiro entra? Proposta: a conta já configurada na conexão.

## Registro de verificação
—
