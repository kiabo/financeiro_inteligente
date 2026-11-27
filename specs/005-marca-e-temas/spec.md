# Spec 005 — Nome e marca do sistema

- **Status:** rascunho
- **Criada em:** 2026-11-26
- **Aprovada em:** —
- **Responsável pela aprovação:** usuário

## Problema
O nome "Vértice" e o logo estão fixos no código (17 ocorrências do nome). O usuário quer **mudar o nome do sistema e a marca** (logo e favicon).

**Decisão do usuário (2026-11-27):** a configuração de **tema** (paletas, cor principal, modo padrão) sai do escopo. Isso elimina a parte mais cara e arriscada da versão anterior desta spec (as ~2.400 cores fixas em 35 arquivos). O alternador claro/escuro que já existe continua como está.

## Histórias de usuário
- Como titular, quero alterar o nome do sistema e ver a mudança no menu, no login, no título da aba e no PWA.
- Como titular, quero enviar meu logo e favicon.
- Como titular, quero pré-visualizar antes de salvar.

## Comportamento esperado
- Nova tela **Configurações → Marca**: nome, nome curto (PWA), logo, favicon e pré-visualização.
- Salvo por tenant; carregado após o login e aplicado ao menu, ao título da aba, ao favicon e ao PWA.
- A tela de login e o PWA usam a marca da instância (definida pelo dono), pois ainda não há usuário logado.
- Sem nenhuma personalização, a aparência é **idêntica** à atual, em claro e escuro.
- Os textos de marca deixam de ser fixos no código ("Vértice" vem da configuração).
- Nenhuma mudança de cores nem de tema.

## Critérios de aceite
- [ ] CA1: sem personalização, as telas principais (claro e escuro) são visualmente idênticas às de hoje.
- [ ] CA2: trocar o nome atualiza menu, login, título da aba e nome do PWA.
- [ ] CA3: logo e favicon enviados aparecem no menu, no login e na aba (limite de tamanho e tipo de arquivo validado).
- [ ] CA4: outro tenant não lê nem altera a marca (RLS); o login público só expõe nome e logo, nada sensível.
- [ ] CA5: a tela de login mostra a marca correta antes de autenticar.
- [ ] CA6: o logo continua legível em fundo claro e escuro (a tela avisa se o arquivo enviado não tiver fundo transparente, quando isso piorar a leitura).

## Fora de escopo
- **Temas, paletas, cor principal e modo padrão** (retirados por decisão do usuário em 2026-11-27).
- Fontes personalizadas e layout alternativo.
- Multi-marca por empresa dentro do mesmo tenant.
- Domínio por marca.

## Restrições e princípios aplicáveis
- Constituição nº 7 (aparência padrão não muda), nº 2 (RLS). Migration **`0009`** (a `0008` já foi usada pela spec 004), aplicada manualmente pelo usuário; bucket de Storage `branding` com RLS.

## Perguntas abertas
- "Por tenant" significa uma marca por usuário/titular. Para o login, a marca vem de uma configuração da instância (`BRANDING_TENANT_ID`): ok?
- O novo nome também vale para e-mails e alertas de WhatsApp enviados pelo sistema?

## Respostas do usuário
- **Temas:** retirar a configuração de tema. Manter só nome e marca (2026-11-27). A pergunta sobre "paletas prontas" deixou de existir.

## Registro de verificação
—
