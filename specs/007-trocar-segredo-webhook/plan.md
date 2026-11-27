# Plan 007 — Trocar o segredo do webhook de uma conexão

- **Status:** concluído
- **Spec:** `specs/007-trocar-segredo-webhook/spec.md` (aprovado em 2026-11-27)
- **Criado em:** 2026-11-27
- **Aprovado em:** 2026-11-27

## Abordagem
O servidor **já aceita** a troca: `PATCH /api/integrations/connections/:id` com `signing_secret` cifra o valor (`encryptSecret(valor, user.id)`),
filtra por `tenant_id` do JWT e grava auditoria `integration.updated` com `fields: ['signing_secret']` (sem o valor). Falta a tela e a garantia por teste.
Duas mudanças pequenas:

1. **Servidor:** extrair a regra de "validar e cifrar o segredo" para uma função pura (`prepareSigningSecretChange`), usada pelo `PATCH`. O comportamento não muda;
   a extração existe para poder **testar sem Supabase** (CA1, CA2, CA3). A mensagem de erro passa a ser a mesma da criação ("mínimo 8 caracteres"), em vez de "Segredo muito curto.".
2. **Tela:** botão **"Trocar segredo do webhook"** em cada conexão (ao lado de "Trocar chave de API") e um diálogo, no mesmo desenho do diálogo da chave de API.

Descartado: nova rota dedicada (o `PATCH` já faz o trabalho e já é autenticado, filtrado por tenant e auditado); coluna "segredo trocado em" (a spec decidiu **sem** coluna nova).

## Arquivos afetados
- `server/integrations/connectionSecrets.ts` — **novo**. `prepareSigningSecretChange(raw, tenantId): { encrypted: string }`; lança erro com mensagem pt-BR se < 8 caracteres.
- `server/integrations/webhookRoutes.ts` — o `PATCH` chama a função nova no lugar do trecho de `signing_secret` (linhas ~341–344). Nada mais muda na rota.
- `src/modules/integrations/IntegrationsHubView.tsx` — botão, estado do diálogo (`secretDialog`, `secretValue`, `secretError`, `secretSaving`), `openSecretDialog`, `handleSaveSecret`, diálogo, e frase na criação ("O segredo pode ser trocado depois").
- `src/modules/integrations/types.ts` — **reaproveitar** `PROVIDER_SECRET_HELP` (já traz a ajuda de cada provedor) e `PROVIDER_LABELS`.
- `src/modules/integrations/integrationsApi.ts` — **reaproveitar** `updateConnection(id, { signing_secret })` (já existe, sem alteração).
- `server/__tests__/connectionSecrets.test.ts` — **novo**; `scripts/run-tests.ts` — registrar a suíte.
- `docs/architecture.md` — uma linha na seção de webhooks.
- Reaproveitar nos testes: `createMercadoPagoAdapter`, `asaasAdapter`, `stripeAdapter`, `customJsonMappingAdapter` (`server/integrations/webhooks/adapters/`) e os helpers de assinatura de `server/__tests__/module6Server.test.ts`.

## Banco de dados
**Nenhuma migration.** `integration_connections.signing_secret_encrypted` já existe e já é escrita só pelo servidor (service role).

## Contratos (API / tipos)
- Rota: **sem mudança** — `PATCH /api/integrations/connections/:id` body `{ signing_secret: string }` → `200 { connection }` (a conexão apresentada por `presentConnection`, que **não** devolve o segredo); `400 { error }` se < 8 caracteres; `404` se a conexão não for do tenant (ou for a conexão `google`).
- Auditoria: `integration.updated`, `metadata.fields = ['signing_secret']`, sem valor. Não criamos ação nova de auditoria (isso exigiria migration no enum).
- Tipo novo: `prepareSigningSecretChange(raw: unknown, tenantId: string): { encrypted: string }`.
- Texto do diálogo (pt-BR): título "Segredo do webhook — {conexão}"; aviso "O segredo anterior deixa de valer imediatamente. Atualize o mesmo valor no painel do {provedor}, ou os avisos dele serão recusados."; ajuda por provedor (`PROVIDER_SECRET_HELP`); botões "Cancelar" e "Trocar segredo"; confirmação "Segredo da conexão "{nome}" trocado. Ele foi cifrado e não será exibido novamente."
- O campo é `type="password"`, `autoComplete="off"`, **sempre vazio** ao abrir (nunca recebe valor do servidor); o botão "Trocar segredo" só habilita com ≥ 8 caracteres.

## Riscos e mitigação
| Risco | Mitigação |
|---|---|
| Trocar o segredo aqui e esquecer de atualizar no provedor: os avisos passam a ser recusados (HTTP 401) até acertar | Aviso destacado **antes** de confirmar (CA6); o evento recusado aparece no log da conexão |
| O segredo vazar para tela, log ou resposta | O campo nunca é preenchido; `presentConnection` já remove `signing_secret_encrypted`; teste confere que a resposta e a auditoria não contêm o valor |
| Provedor Mercado Pago: o segredo real só existe depois de cadastrar a URL no painel | É exatamente o caso de uso: criar a conexão com valor provisório e trocar depois |
| Mercado Pago não tem "Testar" interno | CA2 coberto por teste automático com o adaptador; no cfo, o usuário usa "Simular notificação" do painel do Mercado Pago |
| Mudar o `PATCH` quebrar edição de outros campos | A extração só substitui um trecho; testes existentes + teste novo de "sem `signing_secret` nada muda" |

## Rollback
Código apenas: reverter o commit do PR. Nenhum dado de banco muda de forma; a conexão continua com o segredo que tiver sido salvo por último
(se for preciso voltar ao anterior, basta trocá-lo de novo pela mesma tela).

## Estratégia de teste
Automatizados (`npm test`, suíte `connectionSecrets`):
- **CA1:** o `encrypted` devolvido não contém o valor puro e decifra para ele (com o tenant certo); decifrar com outro tenant falha (AAD); a conexão apresentada não tem `signing_secret_encrypted`.
- **CA2:** para Asaas, Mercado Pago, Stripe e JSON customizado: com o segredo antigo, requisição assinada com o antigo passa; depois da troca (decifrando o novo `encrypted`), a assinada com o **antigo** é recusada e a assinada com o **novo** é aceita.
- **CA3:** 7 caracteres, vazio, só espaços e valor não textual são recusados com mensagem legível; espaços nas pontas são removidos; "sem `signing_secret`" não altera nada.
- **CA4:** o objeto de auditoria montado pelo `PATCH` lista `signing_secret` em `fields` e não contém o valor.
- **CA5 (isolamento):** a consulta do `PATCH` sempre filtra por `tenant_id` do JWT (já é assim; conferido na revisão do código e no cfo: conexão de outro tenant não é testável com um usuário só, então fica por leitura de código, dito no registro de verificação).

Verificação manual no cfo (`/sdd-verify 007`): abrir uma conexão, "Trocar segredo do webhook", ver o aviso antes de confirmar, cancelar (nada muda), salvar um valor novo,
usar "Testar" no Asaas (aceito, pois "Testar" assina com o segredo guardado), conferir na auditoria que o valor não aparece. No cfo o campo abre vazio (CA1).
