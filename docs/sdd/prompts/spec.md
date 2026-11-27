# Prompt SDD — spec

Entrada: `NNN título livre` (ex.: `003 saldo inicial da conta`) e, se houver, descrição.

1. Leia `AGENTS.md`, `docs/constitution.md`, `docs/architecture.md` e `specs/README.md`.
2. Se `specs/NNN-*/spec.md` já existir, leia e **atualize** (não sobrescreva decisões já aprovadas).
   Se não, crie `specs/NNN-slug/spec.md` a partir de `docs/sdd/templates/spec.md` (slug em minúsculas, sem acentos, com hífens).
3. Explore o código **somente leitura** para fundamentar o problema e os critérios de aceite. Não implemente nada.
4. Escreva em pt-BR, descrevendo **comportamento observável**. Critérios de aceite numerados e verificáveis.
5. Liste dúvidas reais em "Perguntas abertas"; não invente respostas.
6. Status do arquivo: `rascunho`. Atualize a linha da spec em `specs/README.md`.
7. Termine pedindo a aprovação do usuário. **Não** crie plan nem tasks.
