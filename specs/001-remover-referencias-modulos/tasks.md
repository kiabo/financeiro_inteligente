# Tasks 001 — Remover referências a "Módulo N" da interface

- **Status:** concluído
- **Plan:** `specs/001-remover-referencias-modulos/plan.md` (aprovado em 2026-11-27)
- **Branch:** `feat/001-remover-modulos` (saindo da `dev`)
- **Aprovado em:** 2026-11-27

Uma tarefa por vez, em ordem. Marque `[x]` ao concluir. Commit: `feat(001): descrição (T01)`.
Antes de cada commit: `npx tsc --noEmit && npm test` (e `npm run build` nas tarefas de front).

- [x] T01 — Criar o teste-guarda `src/modules/core/__tests__/noModuleLabels.test.ts` e registrá-lo em `scripts/run-tests.ts`.
  Varre `src/**/*.{ts,tsx}` (exceto `__tests__`), remove comentários e falha se sobrar `/m[óo]dulo\s*\d/i`.
  **Pronto quando:** `npm test` roda a nova suíte e ela **falha** listando as ocorrências atuais (prova de que detecta). (CA1, CA2)

- [x] T02 — Trocar as etiquetas de seção pelos nomes de menu nos 13 arquivos da tabela do plan
  (Projetos, CFO Virtual, Catálogo, MCP, Visão Geral, Fluxo, Automação, Conciliação, Integrações, Dívidas, Saúde, DRE, Login).
  **Pronto quando:** `grep -rniE "m[óo]dulo [0-9]" src` não retorna mais nenhum literal visível nesses arquivos e `npx tsc --noEmit` passa. (CA1, CA2)

- [x] T03 — Reescrever as duas mensagens com "do Módulo 6" ([integrationsApi.ts:24](src/modules/integrations/integrationsApi.ts#L24) e [moduleUi.tsx:140](src/modules/integrations/components/moduleUi.tsx#L140)).
  **Pronto quando:** ambas dizem "Este recurso exige o Supabase configurado…" sem citar módulo. (CA1, CA3)

- [x] T04 — Criar `fetchOwnRole(userId)` em `src/modules/core/repository.ts` (lê `user_profiles.role`, fallback `'analyst'`, log em erro) e um teste unitário do fallback/mapeamento.
  **Pronto quando:** a função está exportada, tipada e o teste passa. (CA1 — habilita o ocultamento)

- [x] T05 — Usar o papel real nas sessões Supabase: `src/App.tsx` (~134) e `LoginScreen.tsx` (~86 e ~207). Sandbox (~265) permanece `'owner'`.
  **Pronto quando:** `tsc` passa e o rótulo do menu lateral mostra o papel lido do banco. (CA1)

- [x] T06 — Tela Segurança & SQL: títulos descritivos, botões "Copiar SQL", e `canSeeSql(role)` (owner/admin) condicionando os 5 blocos de migration; teste unitário de `canSeeSql`.
  **Pronto quando:** com `owner` os blocos aparecem com títulos sem "Módulo"; com `analyst` não aparecem; testes passam. (CA1, CA4)

- [x] T07 — Rodar tudo: `npx tsc --noEmit`, `npm test` (inclui o teste-guarda, agora verde) e `npm run build`; conferir que o `dist/` não tem literais "Módulo N" de interface.
  **Pronto quando:** os três comandos passam e a busca em `dist/` é limpa (exceto o SQL embutido, se houver). (CA2, CA3, CA4)

- [x] T08 — Subir a branch, abrir PR para a `dev`, merge e aguardar o deploy no h-cfo. **(usuário: confirmar o merge)**
  **Pronto quando:** workflow verde e h-cfo respondendo 200.

- [x] T09 — Verificação final no h-cfo contra todos os critérios de aceite, claro e escuro, incluindo largura mobile:
  percorrer as 15 seções; abrir Segurança & SQL como owner; conferir título da aba, manifesto PWA e mensagens.
  Registrar o resultado em "Registro de verificação" da spec (`/sdd-verify 001`). **(usuário entra no h-cfo; senha/TOTP são dele)**
  **Pronto quando:** CA1–CA4 marcados `[x]` na spec com evidência.

## Notas de execução
- T01 commitada com o teste-guarda **propositalmente falhando** (prova de detecção, 40 ocorrências). Não há push até ficar verde (T07); o CI só roda em `dev`/`main`.
(decisões e descobertas durante a implementação; mudança de escopo → parar e atualizar a spec)
- T02: exceção ao "nome do item de menu": em AutomationCenterView a etiqueta ficaria idêntica ao título ("Alertas, Agenda & Backup"); usado "Automação & Continuidade" (texto original sem o prefixo).
- T07: `tsc`, 51/51 testes e build OK. No `dist/` restam 11 ocorrências, todas dentro de comentários do SQL das migrations embutido via `?raw` (permitido pela spec); 0 fora do SQL.
- T08: PR #1 mergeado na `dev` em 2026-11-27; deploy verde; h-cfo saudável.
- T09: verificação registrada na spec. Itens não verificados manualmente listados lá.
