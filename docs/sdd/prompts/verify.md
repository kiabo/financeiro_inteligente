# Prompt SDD — verify

Entrada: `NNN`.

1. Leia a spec de `specs/NNN-*/` e a lista de critérios de aceite.
2. Rode `npx tsc --noEmit`, `npm test` e `npm run build`.
3. Verifique **cada critério de aceite** no ambiente h-cfo (https://h-cfo.cqtl.pro) depois do deploy da `dev`:
   comandos, chamadas à API ou navegação no Chrome. Peça ao usuário para entrar (senha/TOTP são dele).
4. Preencha "Registro de verificação" na spec: critério, resultado (ok/falhou), evidência, data. Marque `[x]` só os que passaram.
5. Se algo falhou, liste e proponha correções como novas tarefas em `tasks.md`; não marque a spec como concluída.
6. Tudo ok: status `concluído` em spec, plan e tasks, atualize `specs/README.md` e pergunte ao usuário
   se pode promover `dev` → `main`. Não promova sem o "sim".
