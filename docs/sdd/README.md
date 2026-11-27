# SDD neste projeto, em uma página

**Ideia:** a especificação manda; o código obedece. Nada é codificado sem que o usuário tenha aprovado
*o quê*, *como* e *em que ordem*.

```
spec.md (o quê/porquê) → plan.md (como) → tasks.md (ordem) → código → verificação → promoção
   ✋ aprova                ✋ aprova         ✋ aprova                      ✋ valida no cfo
```

## Passo a passo
1. **Spec** — `/sdd-spec NNN título` (Claude) ou `/sdd:spec NNN título` (Gemini). Escreve `specs/NNN-slug/spec.md`
   a partir de `docs/sdd/templates/spec.md`. Termina com perguntas abertas, se houver.
2. **Plan** — `/sdd-plan NNN`. Só roda com a spec `aprovado`.
3. **Tasks** — `/sdd-tasks NNN`. Só roda com o plan `aprovado`.
4. **Implement** — `/sdd-implement NNN`. Só roda com as tasks `aprovado`. Faz uma tarefa por vez, marca `[x]`.
5. **Verify** — `/sdd-verify NNN`. Confere cada critério de aceite no cfo (produção) e registra o resultado na spec.
6. **Promover** — PR de `feat/NNN-slug` para `dev` → `dev` para `main` (o agente promove sozinho se tsc/testes/build passam e não há migration pendente) → validar no cfo.

## Status dos arquivos
`rascunho` → `aprovado` → `em-andamento` → `concluído`. Quem aprova é o usuário, dizendo no chat
("aprovo a spec 003"); o agente então troca o status e registra a data.

## Boas práticas
- Spec descreve comportamento observável, não implementação. O "como" é do plan.
- Critério de aceite precisa ser verificável ("saldo = 1.000 + movimentos desde 01/11"), não vago ("saldo correto").
- Tarefas pequenas (até ~2 h), com critério de pronto.
- Mudou o escopo no meio? Volte e atualize a spec; não improvise no código.
- Prompts ficam em `docs/sdd/prompts/`; `.claude/commands/` e `.gemini/commands/` só apontam para eles. Edite sempre lá.
