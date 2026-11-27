# Spec 005 — Marca e temas personalizáveis

- **Status:** rascunho
- **Criada em:** 2026-11-26
- **Aprovada em:** —
- **Responsável pela aprovação:** usuário

## Problema
O nome "Vértice", o logo e as cores estão fixos no código (17 ocorrências do nome; ~2.400 cores em 35 arquivos).
O usuário quer mudar o nome do sistema, personalizar a marca e escolher temas.

## Histórias de usuário
- Como titular, quero alterar o nome do sistema e ver a mudança no menu, no login, no título da aba e no PWA.
- Como titular, quero enviar meu logo e favicon.
- Como titular, quero escolher um tema (paleta) e uma cor principal, e definir o modo padrão (claro, escuro, automático).
- Como titular, quero pré-visualizar antes de salvar.

## Comportamento esperado
- Nova tela **Configurações → Marca & Aparência**: nome, nome curto, logo, favicon, tema pronto
  (Vértice atual, Grafite, Esmeralda, Índigo), cor principal livre, modo padrão, pré-visualização.
- Salvo por tenant; carregado após o login e aplicado a toda a interface por variáveis de cor.
- A tela de login e o PWA usam a marca da instância (definida pelo dono), pois ainda não há usuário logado.
- Aviso quando a cor escolhida deixa o texto ilegível (contraste insuficiente).
- Sem nenhuma personalização, a aparência é **idêntica** à atual, em claro e escuro.
- Os textos de marca deixam de ser fixos no código ("Vértice" vem da configuração).

## Critérios de aceite
- [ ] CA1: sem personalização, screenshots antes/depois de todas as telas (claro e escuro) são visualmente idênticos.
- [ ] CA2: trocar o nome atualiza menu, login, título da aba e nome do PWA.
- [ ] CA3: logo e favicon enviados aparecem no menu, no login e na aba (limite de tamanho/tipo validado).
- [ ] CA4: trocar o tema altera todas as telas sem cores "esquecidas" (nenhum bloco com a cor antiga).
- [ ] CA5: modo padrão respeitado no primeiro acesso; o alternador claro/escuro continua funcionando.
- [ ] CA6: contraste mínimo (WCAG AA) validado nos temas prontos; aviso para cor livre ruim.
- [ ] CA7: outro tenant não lê nem altera a marca (RLS); o login público só expõe nome/logo/cores, nada sensível.
- [ ] CA8: tela de login mostra a marca correta antes de autenticar.

## Fora de escopo
- Fontes personalizadas e layout alternativo.
- Multi-marca por empresa dentro do mesmo tenant.
- Domínio por marca.

## Restrições e princípios aplicáveis
- Constituição nº 7 (aparência padrão não muda), nº 2 (RLS). Migration `0008` aplicada manualmente; bucket de Storage `branding` com RLS.

## Perguntas abertas
- "Por tenant" significa uma marca por usuário/titular. Para o login, a marca vem de uma configuração da instância (`BRANDING_TENANT_ID`): ok?
- Quais paletas prontas além das 4 propostas?
- O novo nome também vale para e-mails e alertas de WhatsApp enviados pelo sistema?

## Registro de verificação
—
