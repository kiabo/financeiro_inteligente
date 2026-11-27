# Spec 007 — Trocar o segredo do webhook de uma conexão

- **Status:** rascunho
- **Criada em:** 2026-11-27
- **Aprovada em:** —
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
- Depois de salvar, a tela mostra confirmação e a data da última troca ("Segredo trocado em …"), sem exibir o segredo.
- Fica registro de auditoria da troca (sem o valor).
- O histórico de eventos, a URL do webhook e os lançamentos da conexão não mudam.
- A tela de criação de conexão passa a dizer que o segredo pode ser trocado depois.

## Critérios de aceite
- [ ] CA1: trocar o segredo não o exibe em nenhuma tela nem resposta da API; o campo do diálogo sempre abre vazio.
- [ ] CA2: depois da troca, um webhook assinado com o segredo **antigo** é recusado e um assinado com o **novo** é aceito (verificável com "Testar", nos provedores que têm o teste interno, e por teste automático nos demais).
- [ ] CA3: segredo com menos de 8 caracteres é recusado com mensagem clara; cancelar o diálogo não altera nada.
- [ ] CA4: a troca fica na auditoria sem o valor do segredo; a URL do webhook e o histórico de eventos permanecem.
- [ ] CA5: outro tenant não consegue trocar o segredo de uma conexão que não é dele.
- [ ] CA6: o aviso de que o provedor precisa ser atualizado aparece antes de confirmar.

## Fora de escopo
- Gerar o segredo no próprio sistema (quem define o segredo é o provedor ou o usuário).
- Trocar a URL do webhook (já existe "Nova URL").
- Validar o formato do segredo por provedor.

## Restrições e princípios aplicáveis
- Constituição nº 3 (segredos nunca no cliente nem voltam em respostas), nº 2 (tenant do JWT). Sem migration prevista: a coluna cifrada já existe.

## Perguntas abertas
- Mostrar a data da última troca exige uma coluna nova (migration). Prefere só a confirmação no momento da troca (sem coluna nova)?

## Registro de verificação
—
