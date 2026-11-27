# Spec 002 — URL por tela (histórico de navegação)

- **Status:** concluído
- **Criada em:** 2026-11-26
- **Aprovada em:** 2026-11-27
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
- [x] CA1: clicar em 5 itens diferentes do menu gera 5 URLs distintas e 5 entradas de histórico.
- [x] CA2: Voltar e Avançar restauram a tela correta.
- [x] CA3: F5 em `/dre` reabre a DRE sem passar pelo login (sessão aal2 válida).
- [x] CA4: abrir `/integracoes` deslogado → login → TOTP → cai em Integrações.
- [x] CA5: caminho inválido leva a `/visao-geral` sem erro.
- [x] CA6: conectar o Google em Alertas, Agenda & Backup retorna à mesma tela com a mensagem de sucesso/erro.
- [x] CA7: título da aba muda por tela.
- [x] CA8: funciona em h-cfo e cfo (nginx → Express devolve o SPA), e em `localhost:3000`.
- [x] CA9 (acrescentado em 2026-11-27, durante o plan): com o service worker do PWA ativo, navegar para `/api/...` (ex.: o callback do Google) chega ao **servidor**, não ao SPA.

## Fora de escopo
- Parâmetros de URL para filtros e contexto (empresa/conta); pode virar spec futura.
- Trocar para uma biblioteca de roteamento.

## Restrições e princípios aplicáveis
- Sem dependência nova; não alterar a lógica de autenticação aal2.

## Notas de alteração
- 2026-11-27: CA9 acrescentado. O service worker gerado hoje (`NavigationRoute` → `index.html`, sem exceção para `/api/`) pode interceptar o retorno do OAuth do Google; está no escopo porque o CA6 depende disso.

## Perguntas abertas
- Os caminhos em português acima estão bons? (sim, estão bons)
- Querem que o contexto global (empresa/grupo/conta) também vá na URL (`?contexto=…`) nesta spec? (não precisa ir para a url)

## Registro de verificação
Verificado em 2026-11-27 no h-cfo (deploy do PR #2), usuário owner aal2, pelo Chrome, com o service worker novo ativo e controlando a página.

| Critério | Resultado | Evidência |
|---|---|---|
| CA1 | ok | 5 cliques (Saúde, Fluxo, Integrações, Segurança, Visão Geral) → 5 URLs distintas e +5 entradas em `history`; clicar no item já ativo não duplica |
| CA2 | ok | `history.back()` ×2 e `forward()` ×1 restauraram `/seguranca` → `/integracoes` → `/seguranca` e o título |
| CA3 | ok | carga direta em `/dre` com sessão abriu a DRE (sem login), título "DRE Gerencial · Vértice" |
| CA4 | ok | usuário abriu `/integracoes` deslogado (janela anônima), entrou com senha + TOTP e caiu em Integrações (confirmado em 2026-11-27) |
| CA5 | ok | `/qualquer-coisa` → `/visao-geral`, sem erro |
| CA6 | ok | `GET /api/google/oauth/callback?error=teste_sdd` no navegador → `/alertas-agenda-backup`, mensagem "Não foi possível conectar o Google: teste_sdd" e query limpa |
| CA7 | ok | título da aba mudou em cada tela ("<Tela> · Vértice") |
| CA8 | ok | h-cfo verificado; `localhost:3000` informado como funcionando pelo usuário; cfo: após a promoção `/dre` responde 200 e a API sem login 401 (`curl`); navegação logada no cfo **não** conferida no Chrome (a sessão do cfo é separada da do h-cfo) |
| CA9 | ok | `sw.js` publicado contém `denylist:[/^\/api\//]`; com o SW controlando a página o callback chegou ao servidor |

Não verificado: login por Google com deep link (T06), só testado por `tsc`.
