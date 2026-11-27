# Tasks 002 — URL por tela (histórico de navegação)

- **Status:** em-andamento
- **Plan:** `specs/002-url-por-tela/plan.md` (aprovado em 2026-11-27)
- **Branch:** `feat/002-url-por-tela` (saindo da `dev`)
- **Aprovado em:** 2026-11-27

Uma tarefa por vez, em ordem. Marque `[x]` ao concluir. Commit: `feat(002): descrição (T01)`.
Antes de cada commit: `npx tsc --noEmit && npm test` (e `npm run build` nas tarefas de front).

- [x] T01 — Criar `src/modules/core/routes.ts` (`SECTION_PATHS`, `SECTION_TITLES`, `sectionFromPath`, `pathFromSection`) e
  `src/modules/core/__tests__/routes.test.ts`, registrado em `scripts/run-tests.ts`.
  **Pronto quando:** testes verdes cobrindo caminho único em minúsculas e sem acento para toda `AppSection`, ida e volta,
  barra final, maiúsculas, `/` e desconhecido → `null`. (CA1, CA5)

- [x] T02 — `AppShell.tsx`: os rótulos do menu passam a ler `SECTION_TITLES` (fonte única, sem mudar nenhum texto).
  **Pronto quando:** `tsc` passa e o menu mostra exatamente os mesmos 15 nomes de hoje. (CA7)

- [x] T03 — `App.tsx`: seção inicial por `location.pathname`; `navigate(section, {replace?})` com `pushState`/`replaceState`
  sem duplicar entrada; normalização de `/` e desconhecido para `/visao-geral`; listener `popstate`; troca de todos os
  `setActiveSection` / `onNavigate={setActiveSection}` por `navigate`; logout navega para `/visao-geral` com replace.
  **Pronto quando:** `tsc` passa e não resta nenhum `setActiveSection` fora do próprio `navigate`/`popstate`. (CA1, CA2, CA3, CA5)

- [x] T04 — `App.tsx`: `document.title = "<Tela> · Vértice"` com sessão verificada (constante única para o nome),
  título padrão sem sessão.
  **Pronto quando:** `tsc` passa e a lógica usa `SECTION_TITLES`. (CA7)

- [x] T05 — Retorno do Google: `automationRoutes.ts` redireciona para `/alertas-agenda-backup?google=…`;
  `App.tsx` mantém o leitor da query (aceita também a forma antiga `/?google=…`) e usa `navigate('automation', {replace: true})`;
  `server/__tests__/module6Server.test.ts` atualizado se cobrir os redirects.
  **Pronto quando:** testes verdes e o redirect aponta para o novo caminho. (CA6)

- [ ] T06 — `LoginScreen.tsx`: `redirectTo` do login com Google passa a `origin + pathname`.
  **Pronto quando:** `tsc` passa; no teste manual, o deep link sobrevive ao login com Google quando aplicável. (CA4)

- [ ] T07 — `vite.config.ts`: `workbox.navigateFallbackDenylist: [/^\/api\//]`.
  **Pronto quando:** após `npm run build`, o `dist/sw.js` contém a denylist na `NavigationRoute`. (CA9)

- [ ] T08 — Rodar tudo: `npx tsc --noEmit`, `npm test`, `npm run build`; conferir a denylist no `dist/sw.js`.
  **Pronto quando:** os três comandos passam e a denylist aparece no `dist/sw.js`. (CA9)

- [ ] T09 — Subir a branch, abrir PR para a `dev`, merge e deploy no h-cfo. **(usuário: confirmar o merge)**
  **Pronto quando:** workflow verde e h-cfo respondendo 200.

- [ ] T10 — Verificação final no h-cfo contra todos os critérios (`/sdd-verify 002`): cliques no menu e `history`, Voltar/Avançar,
  F5 em `/dre`, caminho inválido, retorno do Google/callback pelo navegador com o SW ativo, título da aba.
  **(usuário: entrar no h-cfo; o teste de deep link deslogado — senha e TOTP — é dele)**
  **Pronto quando:** CA1–CA9 marcados `[x]` na spec com evidência (CA8 inclui `localhost:3000`).

## Notas de execução
(decisões e descobertas durante a implementação; mudança de escopo → parar e atualizar a spec)
