# Prompt SDD — tasks

Entrada: `NNN`.

1. Leia `AGENTS.md`, a spec e o plan de `specs/NNN-*/`.
2. **Pare** se o plan não estiver `aprovado`.
3. Crie `specs/NNN-slug/tasks.md` a partir de `docs/sdd/templates/tasks.md`.
4. Quebre em tarefas pequenas (até ~2 h), ordenadas por dependência, cada uma com **"Pronto quando"**
   observável e referência ao critério de aceite (CA) que ela atende. Migrations e passos manuais do usuário
   viram tarefas próprias, marcadas `(usuário)`.
5. A última tarefa é sempre a verificação final no cfo contra todos os critérios.
6. Status: `rascunho`. Atualize `specs/README.md`. Peça aprovação. **Não** escreva código.
