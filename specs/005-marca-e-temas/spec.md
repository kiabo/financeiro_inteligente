# Spec 005 — Nome e marca do sistema

- **Status:** aprovado
- **Criada em:** 2026-11-26
- **Aprovada em:** 2026-11-27
- **Responsável pela aprovação:** usuário

## Problema
O nome "Vértice" e o logo estão fixos no código (17 ocorrências do nome). O usuário quer **mudar o nome do sistema e a marca** (logo e favicon).

**Decisão do usuário (2026-11-27):** a configuração de **tema** (paletas, cor principal, modo padrão) sai do escopo. Isso elimina a parte mais cara e arriscada da versão anterior desta spec (as ~2.400 cores fixas em 35 arquivos). O alternador claro/escuro que já existe continua como está.

**Decisão do usuário (2026-11-27):** a marca é **única para a instância inteira** (não por usuário nem por empresa). Só **administradores** (papéis `owner` e `admin`) podem alterá-la; depois de trocada, **todos os usuários** veem a mesma marca. Marca por empresa fica para depois. O novo nome também vale nos e-mails e nos alertas de WhatsApp.

## Histórias de usuário
- Como administrador, quero alterar o nome do sistema e ver a mudança no menu, no login, no título da aba, no PWA, nos e-mails e nos alertas de WhatsApp.
- Como administrador, quero enviar o logo e o favicon.
- Como administrador, quero pré-visualizar antes de salvar.
- Como qualquer usuário, quero ver a marca atual, inclusive na tela de login.

## Comportamento esperado
- Nova tela **Configurações → Marca**, visível e editável só por administradores: nome, nome curto (PWA), logo, favicon e pré-visualização.
- Uma única marca para a instância: carregada antes do login (a tela de login e o PWA já mostram a marca certa) e aplicada ao menu, ao título da aba, ao favicon, ao PWA, aos e-mails e aos alertas de WhatsApp.
- Nomes técnicos internos (formato e extensão do arquivo de backup, chaves do navegador, nome do servidor MCP, metadado `vertice_product` do Stripe) **não mudam**, para não quebrar restauração, sessões e integrações.
- Sem nenhuma personalização, a aparência é **idêntica** à atual, em claro e escuro.
- Os textos de marca deixam de ser fixos no código ("Vértice" vem da configuração).
- Nenhuma mudança de cores nem de tema.

## Critérios de aceite
- [ ] CA1: sem personalização, as telas principais (claro e escuro) são visualmente idênticas às de hoje.
- [ ] CA2: trocar o nome atualiza menu, login, título da aba e nome do PWA.
- [ ] CA3: logo e favicon enviados aparecem no menu, no login e na aba (limite de tamanho e tipo de arquivo validado).
- [ ] CA4: só `owner` e `admin` alteram a marca (um usuário `analyst` não vê a tela e a API recusa); qualquer pessoa lê, mesmo sem login, apenas nome, nome curto, logo e favicon, nada sensível.
- [ ] CA5: a tela de login mostra a marca correta antes de autenticar.
- [ ] CA6: o logo continua legível em fundo claro e escuro (a tela avisa se o arquivo enviado não tiver fundo transparente, quando isso piorar a leitura).
- [ ] CA7: o novo nome aparece nos e-mails e nos alertas de WhatsApp (assunto e rodapé) e nas instruções do CFO virtual.

## Fora de escopo
- **Temas, paletas, cor principal e modo padrão** (retirados por decisão do usuário em 2026-11-27).
- Fontes personalizadas e layout alternativo.
- Marca por empresa ou por usuário (pode virar spec futura).
- Domínio por marca.

## Restrições e princípios aplicáveis
- Constituição nº 7 (aparência padrão não muda), nº 2 (RLS).
- **Exceção à constituição nº 2, a aprovar junto com o plano:** como a marca é única da instância, a tabela dela **não tem `tenant_id`**. RLS e FORCE RLS continuam ligados, sem nenhuma política para `anon` e `authenticated`: só o servidor (service role) lê e grava, e a leitura pública passa por uma rota que devolve apenas os campos de marca.
- Migration aplicada manualmente pelo usuário (o número é definido no plano); bucket de Storage `branding`.

## Perguntas abertas
- Nenhuma. (Resolvidas: marca única da instância, só administradores alteram; o nome vale também em e-mails e WhatsApp.)

## Respostas do usuário
- **Temas:** retirar a configuração de tema. Manter só nome e marca (2026-11-27). A pergunta sobre "paletas prontas" deixou de existir.
- **Alcance da marca:** a mesma para todos os usuários; só administradores alteram; marca por empresa não é necessária por enquanto; o nome novo vale em e-mails e WhatsApp (2026-11-27). Motivo: o usuário não quer que o sistema se chame "Vértice".

## Registro de verificação
—
