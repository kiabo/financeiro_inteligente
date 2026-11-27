# Tasks 007 — Trocar o segredo do webhook de uma conexão

- **Status:** em-andamento
- **Plan:** `specs/007-trocar-segredo-webhook/plan.md` (aprovado em 2026-11-27)
- **Branch:** `feat/007-trocar-segredo-webhook` (saindo da `dev`)
- **Aprovado em:** 2026-11-27

Uma tarefa por vez, em ordem. Marque `[x]` ao concluir. Commit: `feat(007): descrição (T01)`.
Antes de cada commit: `npx tsc --noEmit && npm test` (e `npm run build` nas tarefas de tela).
Sem migration nesta spec. Nada é lido nem impresso de segredos; os testes usam valores fictícios.

## Servidor

- [x] T01 — Escrever **antes** os testes de `server/__tests__/connectionSecrets.test.ts` e registrá-los em `scripts/run-tests.ts`
  (suíte "Troca do segredo do webhook (spec 007)"): cifra e decifra com o tenant certo e falha com outro; 7 caracteres, vazio, só espaços e valor não textual são recusados; espaços nas pontas são removidos;
  para Asaas, Mercado Pago, Stripe e JSON customizado, assinatura com o segredo **antigo** passa antes da troca e é **recusada** depois, e a do **novo** é aceita; a conexão apresentada não contém o segredo.
  **Pronto quando:** os testes existem e falham só porque `prepareSigningSecretChange` ainda não existe. (CA1, CA2, CA3)

- [x] T02 — Criar `server/integrations/connectionSecrets.ts` com `prepareSigningSecretChange(raw, tenantId)` e fazer o `PATCH /api/integrations/connections/:id` usá-la
  (mensagem de erro igual à da criação: mínimo de 8 caracteres). Incluir o teste de que a auditoria do `PATCH` lista `signing_secret` em `fields` e não contém o valor.
  **Pronto quando:** `npx tsc --noEmit && npm test` passam, incluindo os testes antigos do webhook sem alterar suas expectativas. (CA1, CA2, CA3, CA4)

## Tela

- [x] T03 — Em `IntegrationsHubView.tsx`: botão **"Trocar segredo do webhook"** ao lado de "Trocar chave de API" (todas as conexões com segredo, menos `google`) e diálogo no desenho do diálogo da chave:
  campo de senha sempre vazio, `autoComplete="off"`, ajuda do provedor (`PROVIDER_SECRET_HELP`), aviso "O segredo anterior deixa de valer imediatamente. Atualize o mesmo valor no painel do {provedor}, ou os avisos dele serão recusados." **visível antes** do botão,
  botão "Trocar segredo" só com 8+ caracteres, cancelar não chama a API, confirmação "Segredo da conexão "{nome}" trocado. Ele foi cifrado e não será exibido novamente." sem data.
  **Pronto quando:** `npm run build` passa e, no navegador local (modo sandbox), o diálogo abre vazio, mostra o aviso, recusa menos de 8 caracteres, cancelar não altera nada e salvar mostra a confirmação. (CA1, CA3, CA6)

- [x] T04 — Na criação de conexão, acrescentar a frase "Você pode trocar este segredo depois, na própria conexão." sob o campo de segredo.
  **Pronto quando:** a frase aparece no diálogo de criação de todos os provedores e `npm run build` passa. (CA6)

## Documentação e publicação

- [x] T05 — `docs/architecture.md`: uma linha na seção de webhooks sobre a troca de segredo; `specs/README.md`: spec 007 `em-andamento`.
  **Pronto quando:** as duas linhas existem. (—)

- [ ] T06 — Publicar: `npx tsc --noEmit && npm test && npm run build` verdes, PR de `feat/007-trocar-segredo-webhook` para `dev`, merge, promoção `dev` → `main` (autorizada) e deploy da `main` acompanhado até o fim.
  **Pronto quando:** a execução de deploy da `main` termina com sucesso e o cfo responde 200. (todos)

- [ ] T07 — Verificação final no **cfo** contra todos os critérios de aceite (`/sdd-verify 007`): abrir uma conexão real, ver o aviso antes de confirmar, cancelar (nada muda), salvar um valor novo,
  usar "Testar" no Asaas (aceito), conferir na auditoria que o valor não aparece, e que o campo abre vazio. CA2 (segredo antigo recusado) e CA5 (outro tenant) ficam por teste automático e leitura do código; o registro diz isso.
  Se o segredo trocado for o de uma conexão real, **você** informa o valor novo; a verificação usa uma conexão de teste "ZZ Teste" e a apago no fim.
  **Pronto quando:** o "Registro de verificação" da spec tem cada CA com resultado, evidência e data; spec, plan e tasks `concluído`. (CA1–CA6)

## Notas de execução
- **T03:** o "Pronto quando" pedia conferir o diálogo no navegador local em modo sandbox. Não é viável: as rotas de conexão do servidor exigem Supabase e a chave de cifra, que o servidor local sem Supabase não tem. Ficou só `tsc` + `build` verdes; o comportamento da tela (campo vazio, aviso antes de confirmar, cancelar sem efeito, confirmação) é conferido no cfo, na T07.
- **T02:** a criação de conexão passou a usar a mesma constante de tamanho mínimo (`MIN_SIGNING_SECRET_LENGTH`); a mensagem é a mesma de antes.
- `buildTestRequest` passou a ser exportada de `webhookRoutes.ts` para os testes montarem requisições assinadas como o botão "Testar".
