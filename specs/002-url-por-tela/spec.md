# Spec 002 — URL por tela (histórico de navegação)

- **Status:** rascunho
- **Criada em:** 2026-11-26
- **Aprovada em:** —
- **Responsável pela aprovação:** usuário

## Problema
A navegação é só estado interno (`activeSection` em `src/App.tsx`): a URL é sempre a mesma, então o histórico
do navegador não registra as telas visitadas, o botão Voltar sai do sistema, não dá para favoritar ou compartilhar
um link de uma tela e o F5 volta sempre para a Visão Geral.

## Histórias de usuário
- Como titular, quero que cada tela tenha sua própria URL para usar Voltar/Avançar e ver o histórico do navegador.
- Como titular, quero favoritar ou abrir direto uma tela (ex.: `/dre`) e cair nela depois do login.
- Como titular, quero que o título da aba mostre a tela em que estou.

## Comportamento esperado
- Cada seção do menu tem um caminho em português: `/visao-geral`, `/saude-financeira`, `/cfo-virtual`, `/dre`,
  `/lancamentos`, `/dividas-impostos`, `/projetos`, `/produtos-servicos`, `/conciliacao`, `/empresas-contas`,
  `/cofre-privacidade`, `/integracoes`, `/alertas-agenda-backup`, `/servidor-mcp`, `/seguranca`.
- Clicar no menu muda a URL sem recarregar a página (cada clique cria uma entrada no histórico).
- Voltar/Avançar do navegador navegam entre as telas.
- F5 numa URL de tela reabre a mesma tela (com sessão válida).
- Abrir uma URL de tela sem sessão mostra o login e, depois do TOTP, leva à tela pedida.
- Caminho desconhecido (ou `/`) leva à Visão Geral.
- O retorno do Google OAuth continua mostrando a mensagem de resultado e cai em `/alertas-agenda-backup`.
- `document.title` = "Nome da tela · Nome do sistema".
- O servidor já devolve o SPA em qualquer caminho; sem mudança no deploy.

## Critérios de aceite
- [ ] CA1: clicar em 5 itens diferentes do menu gera 5 URLs distintas e 5 entradas de histórico.
- [ ] CA2: Voltar e Avançar restauram a tela correta.
- [ ] CA3: F5 em `/dre` reabre a DRE sem passar pelo login (sessão aal2 válida).
- [ ] CA4: abrir `/integracoes` deslogado → login → TOTP → cai em Integrações.
- [ ] CA5: caminho inválido leva a `/visao-geral` sem erro.
- [ ] CA6: conectar o Google em Alertas, Agenda & Backup retorna à mesma tela com a mensagem de sucesso/erro.
- [ ] CA7: título da aba muda por tela.
- [ ] CA8: funciona em h-cfo e cfo (nginx → Express devolve o SPA), e em `localhost:3000`.

## Fora de escopo
- Parâmetros de URL para filtros e contexto (empresa/conta); pode virar spec futura.
- Trocar para uma biblioteca de roteamento.

## Restrições e princípios aplicáveis
- Sem dependência nova; não alterar a lógica de autenticação aal2.

## Perguntas abertas
- Os caminhos em português acima estão bons?
- Querem que o contexto global (empresa/grupo/conta) também vá na URL (`?contexto=…`) nesta spec?

## Registro de verificação
—
