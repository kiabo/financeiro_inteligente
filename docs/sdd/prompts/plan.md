# Prompt SDD — plan

Entrada: `NNN`.

1. Leia `AGENTS.md`, `docs/constitution.md`, `docs/architecture.md` e `specs/NNN-*/spec.md`.
2. **Pare** se a spec não estiver com status `aprovado`: diga ao usuário e não escreva nada.
3. Explore o código para achar o que reaproveitar (funções, componentes, padrões) com caminhos exatos.
4. Crie `specs/NNN-slug/plan.md` a partir de `docs/sdd/templates/plan.md`: abordagem, arquivos afetados,
   banco (migrations; lembrar que o usuário as aplica manualmente), contratos, riscos, rollback, estratégia de teste
   ligada aos critérios de aceite.
5. Respeite a constituição. Se algo exigir exceção, escreva-a explicitamente no plano.
6. Status: `rascunho`. Atualize `specs/README.md`. Peça aprovação. **Não** crie tasks nem código.
