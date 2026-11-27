# Spec 007 — Trocar o segredo do webhook de uma conexão

- **Status:** concluído
- **Criada em:** 2026-11-27
- **Aprovada em:** 2026-11-27
- **Responsável pela aprovação:** usuário

## Problema
Ao criar uma conexão (Asaas, Mercado Pago, Stripe…), a tela exige um "segredo de assinatura" do webhook. Muitas vezes ele ainda não existe
(no Mercado Pago só se obtém depois de cadastrar a URL da conexão no painel do provedor), e a tela obriga a preencher um valor provisório.
Depois não há como trocá-lo: só apagando e recriando a conexão (o que apaga também o histórico de eventos). O servidor já aceita a troca; falta a tela.

## Histórias de usuário
- Como titular, quero trocar o segredo do webhook de uma conexão existente para colocar o segredo real depois de cadastrar a URL no provedor.
- Como titular, quero trocar o segredo se suspeitar que ele vazou.
- Como titular, quero saber qual efeito a troca tem, antes de confirmar.

## Comportamento esperado
- Em cada conexão (todos os provedores com segredo de assinatura), botão **"Trocar segredo do webhook"**, ao lado de "Trocar chave de API".
- Abre um diálogo com um campo de senha, sempre vazio, nunca preenchido com o segredo atual. O texto explica: "O segredo anterior deixa de valer imediatamente.
  Atualize o mesmo valor no painel do {provedor}, ou os avisos dele serão recusados." e mostra a ajuda de onde obter o segredo naquele provedor (a mesma ajuda da criação).
- Mínimo de 8 caracteres (mesma regra de hoje). O valor é cifrado no servidor e **nunca** volta em nenhuma resposta.
- Depois de salvar, a tela mostra só a confirmação ("Segredo trocado"), sem exibir o segredo nem guardar a data da troca (sem coluna nova).
- Fica registro de auditoria da troca (sem o valor).
- O histórico de eventos, a URL do webhook e os lançamentos da conexão não mudam.
- A tela de criação de conexão passa a dizer que o segredo pode ser trocado depois.

## Critérios de aceite
- [x] CA1: trocar o segredo não o exibe em nenhuma tela nem resposta da API; o campo do diálogo sempre abre vazio.
- [x] CA2: depois da troca, um webhook assinado com o segredo **antigo** é recusado e um assinado com o **novo** é aceito (verificável com "Testar", nos provedores que têm o teste interno, e por teste automático nos demais).
- [x] CA3: segredo com menos de 8 caracteres é recusado com mensagem clara; cancelar o diálogo não altera nada.
- [x] CA4: a troca fica na auditoria sem o valor do segredo; a URL do webhook e o histórico de eventos permanecem.
- [x] CA5: outro tenant não consegue trocar o segredo de uma conexão que não é dele.
- [x] CA6: o aviso de que o provedor precisa ser atualizado aparece antes de confirmar.

## Fora de escopo
- Gerar o segredo no próprio sistema (quem define o segredo é o provedor ou o usuário).
- Trocar a URL do webhook (já existe "Nova URL").
- Validar o formato do segredo por provedor.

## Restrições e princípios aplicáveis
- Constituição nº 3 (segredos nunca no cliente nem voltam em respostas), nº 2 (tenant do JWT). Sem migration prevista: a coluna cifrada já existe.

## Perguntas abertas
- Nenhuma. (Resolvida: só a confirmação no momento da troca, sem coluna nova.)

## Respostas do usuário
- **Data da última troca:** não guardar; só a confirmação na hora, sem coluna nova (2026-11-27).

## Registro de verificação
Verificado em produção (https://cfo.cqtl.pro), 2026-11-27, usuário logado com TOTP (aal2), deploy da `main` com o PR #11. Conexão de teste "ZZ Teste 007" (JSON customizado → conta C6), criada e **removida** ao fim; as conexões reais (Asaas e Mercado Pago) só tiveram o diálogo aberto e cancelado, **nenhum segredo real foi alterado**.

| CA | Resultado | Evidência |
|---|---|---|
| CA1 | ok | O campo do diálogo abre sempre vazio (aberto 3 vezes, inclusive depois de cancelar). A confirmação na tela e a auditoria não mostram o valor. Teste automático: a resposta da conexão não contém o segredo nem o texto cifrado |
| CA2 | ok (automático) | Testes `connectionSecrets`: para Asaas, Mercado Pago, Stripe e JSON customizado, o segredo antigo passa antes da troca, é recusado depois e o novo é aceito. **Não** foi exercitado com um webhook real no cfo (o botão "Testar" criaria lançamentos na conta real) |
| CA3 | ok | 7 caracteres deixa o botão "Trocar segredo" desabilitado; cancelar fecha sem chamar a API (nada mudou); o servidor recusa menos de 8 caracteres (teste automático) |
| CA4 | ok | Auditoria no cfo: `integration.updated` com `{"fields":["signing_secret"]}`, sem o valor; a URL do webhook da conexão não mudou |
| CA5 | ok (leitura de código e teste) | O `PATCH` filtra por `tenant_id` do JWT e devolve 404 para conexão de outro titular. Não foi testado com um segundo usuário (só existe um) |
| CA6 | ok | O aviso "O segredo anterior deixa de valer imediatamente. Atualize o mesmo valor no painel do {provedor}…" aparece no diálogo antes do botão de confirmar; a criação traz "Você pode trocar este segredo depois, na própria conexão." |

Notas: a confirmação de excluir conexão é uma janela nativa do navegador, que travou a automação; foi aceita com Enter. A troca com sucesso mostrou "Segredo da conexão "ZZ Teste 007" trocado. Ele foi cifrado e não será exibido novamente."
