# Prompt SDD — implement

Entrada: `NNN` e, opcionalmente, uma tarefa (`T03`). Sem tarefa, execute a próxima pendente.

1. Leia `AGENTS.md`, `docs/constitution.md` e a spec, o plan e as tasks de `specs/NNN-*/`.
2. **Pare** se `tasks.md` não estiver `aprovado` (ou `em-andamento`).
3. Garanta a branch `feat/NNN-slug` saindo da `dev`. Se for a primeira tarefa, mude o status dos três arquivos para `em-andamento`.
4. Execute **uma tarefa por vez**, seguindo o plan. Não faça nada fora do escopo da tarefa.
5. Rode `npx tsc --noEmit && npm test` (e `npm run build` quando tocar no front). Só marque `[x]` com tudo verde
   e o "Pronto quando" atendido.
6. Commit: `feat(NNN): descrição (T0X)` (ou `fix(NNN)`). Nunca commite `.env` ou segredos.
7. Se descobrir algo que muda o escopo: **pare**, registre em "Notas de execução", atualize spec/plan e peça aprovação.
8. Tarefas `(usuário)`: explique o passo e aguarde confirmação; não as simule.
9. Ao concluir todas, não promova: siga para `/sdd-verify`.
