# Plan 002 — URL por tela (histórico de navegação)

- **Status:** concluído
- **Spec:** `specs/002-url-por-tela/spec.md` (aprovada em 2026-11-27)
- **Criado em:** 2026-11-27
- **Aprovado em:** 2026-11-27

## Abordagem
Sem biblioteca de roteamento. Um módulo puro `routes.ts` define o mapa seção ↔ caminho; o `App.tsx` mantém o
estado `activeSection` como hoje, mas o **sincroniza com a URL** via `history.pushState` (ao navegar) e `popstate`
(Voltar/Avançar). A seção inicial vem de `location.pathname`. Alternativa descartada: `react-router`
(dependência nova e reescrita de ~15 pontos para ganhar o que dez linhas de `history` já entregam).
O contexto global (empresa/grupo/conta) **fica fora da URL** (decisão do usuário).

## Descobertas que afetam o plano
1. **Service worker intercepta navegações.** `dist/sw.js` contém `NavigationRoute(createHandlerBoundToURL("index.html"))`
   sem `navigateFallbackDenylist`. Com o SW ativo, o navegador que vai a `/api/google/oauth/callback` (retorno do Google)
   recebe o SPA em vez do servidor, e a conexão do Google não conclui. Correção: `navigateFallbackDenylist: [/^\/api\//]`
   em [vite.config.ts](vite.config.ts) (bloco `workbox`). É pré-existente e provavelmente afeta o h-cfo/cfo hoje.
2. **Retorno do Google** redireciona para `/?google=connected|error` em
   [automationRoutes.ts:90, 95, 98](server/integrations/automationRoutes.ts#L90) e o App lê isso em
   [App.tsx:73-86](src/App.tsx#L73). Passa a redirecionar para `/alertas-agenda-backup?google=…`; o leitor continua
   aceitando a forma antiga (`/?google=…`) por compatibilidade.
3. **Login com Google** usa `redirectTo: window.location.origin` ([LoginScreen.tsx:154](src/modules/auth/LoginScreen.tsx#L154)):
   um deep link se perderia. Passa a `origin + pathname`. A allow-list do Supabase já cobre caminhos: tem `https://h-cfo.cqtl.pro/**`, `https://cfo.cqtl.pro/**` e `http://localhost:3000/**`.
4. Express já devolve o SPA para qualquer caminho ([server.ts:201-202](server.ts#L201)) e o nginx repassa tudo
   (`/integrations` respondeu 200). **Sem mudança de servidor/deploy.**

## Arquivos afetados
| Arquivo | Mudança |
|---|---|
| `src/modules/core/routes.ts` (novo) | `SECTION_PATHS: Record<AppSection, string>`, `SECTION_TITLES: Record<AppSection, string>`, `sectionFromPath(pathname)`, `pathFromSection(section)` |
| `src/App.tsx` | estado inicial por `location.pathname`; `navigate(section, {replace?})`; listener `popstate`; `document.title`; troca de todos os `setActiveSection`/`onNavigate={setActiveSection}` (linhas 71, 85, 278, 315, 337, 377, 400, 412, 426, 441, 457, 474, 487, 522) por `navigate` |
| `src/modules/core/components/AppShell.tsx` | `NAV_ITEMS[].label` passa a ler `SECTION_TITLES` (fonte única do nome da tela; não muda o texto atual) |
| `src/modules/auth/LoginScreen.tsx` | `redirectTo: origin + pathname` |
| `server/integrations/automationRoutes.ts` | redirects do callback para `/alertas-agenda-backup?google=…` |
| `vite.config.ts` | `navigateFallbackDenylist: [/^\/api\//]` |
| `scripts/run-tests.ts` + `src/modules/core/__tests__/routes.test.ts` (novo) | testes do mapa e das funções puras |

## Detalhe do `routes.ts`
- Caminhos (tabela da spec): `overview→/visao-geral`, `health→/saude-financeira`, `ai_cfo→/cfo-virtual`, `dre→/dre`,
  `transactions→/lancamentos`, `debts_taxes→/dividas-impostos`, `projects→/projetos`, `catalog→/produtos-servicos`,
  `reconciliation→/conciliacao`, `hierarchy→/empresas-contas`, `vault→/cofre-privacidade`, `integrations→/integracoes`,
  `automation→/alertas-agenda-backup`, `mcp_settings→/servidor-mcp`, `security→/seguranca`.
- `Record<AppSection, string>` faz o `tsc` falhar se uma seção nova for criada sem caminho.
- `sectionFromPath`: ignora barra final, compara em minúsculas, devolve `null` para `/` ou desconhecido.
- Títulos = os rótulos atuais do menu (`Visão Geral`, `Saúde Financeira`, …), reutilizados em `document.title`.

## Comportamento no `App.tsx`
- `navigate(section, opts)`: `setActiveSection`; se o caminho atual difere, `history.pushState` (ou `replaceState` com `opts.replace`).
  Não duplica entrada quando já está na mesma URL.
- Carga: seção = `sectionFromPath(pathname)`. Se o caminho é `/` ou desconhecido → `replaceState('/visao-geral')` e seção `overview` (CA5).
  Caminho **conhecido** sem sessão fica como está: o login aparece nessa URL e, depois do TOTP, a seção já é a pedida (CA4).
- Retorno do Google: o inicializador existente limpa a query; o efeito chama `navigate('automation', {replace: true})` (CA6).
- `popstate`: `setActiveSection(sectionFromPath(pathname) ?? 'overview')`.
- `document.title = "<Tela> · Vértice"` com sessão verificada; sem sessão volta ao título padrão do `index.html`.
  (O nome "Vértice" sai de uma constante única que a spec 005 depois liga à marca.)
- Logout: `navigate('overview', {replace: true})`.

## Banco de dados
Nenhuma migration. Nenhuma ação manual do usuário.

## Contratos
- Rotas HTTP: só muda o destino dos redirects do callback do Google. Nenhuma rota nova.
- Tipos: nenhum tipo novo além dos `Record` de `routes.ts`.

## Riscos e mitigação
- **SW antigo em cache** no navegador de quem já usa o PWA: com `registerType: 'autoUpdate'` ele se atualiza no próximo carregamento;
  até lá o comportamento é o de hoje (sem URL por tela), sem quebra.
- **Redirect infinito ou perda do deep link no login**: coberto pelo teste manual CA4 e por `normalizar só caminhos desconhecidos`.
- **`pushState` sem recarga e o sandbox**: o modo sandbox usa o mesmo App; nenhuma diferença.
- **Rótulo único no `AppShell`**: refator mínimo; o teste-guarda da spec 001 e o `tsc` protegem contra textos errados.

## Rollback
Reverter o commit. Sem estado persistido novo; URLs antigas continuam abrindo a Visão Geral.

## Estratégia de teste
- **Automático** (`routes.test.ts`): cobertura total do mapa (toda `AppSection` tem caminho único em minúsculas, sem acento);
  ida e volta `sectionFromPath(pathFromSection(s)) === s`; barra final e maiúsculas; `/` e desconhecido → `null`.
- `npx tsc --noEmit`, `npm test`, `npm run build`; conferir no `dist/sw.js` que a `NavigationRoute` tem a denylist de `/api/`.
- **Manual no h-cfo** (Chrome; ligado aos CA):
  - CA1/CA2: clicar em 5 itens, conferir `location.pathname` e `history.length`; `history.back()`/`forward()` restauram a tela.
  - CA3: recarregar em `/dre` (sessão aal2) reabre a DRE sem login.
  - CA4: deslogado, abrir `/integracoes`, entrar (senha + TOTP — pelo usuário) e cair em Integrações.
  - CA5: abrir `/qualquer-coisa` e `/` → `/visao-geral` sem erro.
  - CA6/CA9: `/api/google/oauth/callback?error=teste` no navegador devolve o redirect do servidor para
    `/alertas-agenda-backup?google=error…` (e a tela mostra a mensagem), e não o SPA.
  - CA7: título da aba por tela. CA8: mesmo teste em `localhost:3000` e depois no cfo.
