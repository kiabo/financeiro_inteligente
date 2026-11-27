# Plan 004 — Importação de histórico por API (Asaas e Mercado Pago)

- **Status:** concluído
- **Spec:** `specs/004-importacao-historico-api/spec.md` (aprovada em 2026-11-27)
- **Criado em:** 2026-11-27
- **Aprovado em:** 2026-11-27

## Abordagem
A importação **reaproveita o núcleo do webhook**: o pagamento do provedor vira o mesmo `NormalizedPaymentEvent`, passa pelo mesmo
`planTransactionsForEvent` (receita bruta + taxa separadas, produto por referência, categorias da conexão) e é gravado por uma função
única de "upsert por pagamento", usada **também pelo webhook**. Assim as regras são idênticas e a idempotência vale nos dois caminhos (CA3, CA4, CA5, CA12).

Pontos centrais:
1. **Chave de deduplicação = (tenant, provedor, id do pagamento, papel)**, gravada em colunas novas de `transactions` com índice único.
   Não depende de conta nem de conexão (CA12) e fecha a corrida entre importação e webhook (o segundo insert falha e vira "já existe").
2. **Execução em lotes dirigida pelo navegador**: o servidor cria uma "execução" (`import_runs`), e o navegador chama `step` repetidamente;
   cada `step` processa **uma página** (100 no Asaas, 50 no Mercado Pago) e devolve o progresso. Sem job em segundo plano (sobrevive a deploy/reinício do container),
   sem requisição longa (nginx), e retomável a partir do cursor gravado (falha parcial não perde nada).
3. **Só leitura no provedor**: o cliente HTTP novo expõe apenas `GET`.
4. **Conta de destino por execução**, obrigatória, validada no servidor (CA10).

Alternativas descartadas (uma linha cada): job em memória no servidor (perde estado a cada deploy e não mostra progresso); importar tudo numa única
requisição (estoura timeout e rate limit); tabela própria de "pagamentos importados" (duplicaria `transactions` e quebraria DRE/saldo); deduplicar só por `notes LIKE` (sem garantia contra corrida).

## Descobertas que afetam o plano
1. **O webhook hoje deduplica por evento, não por pagamento**: `webhook_events` tem `UNIQUE (connection_id, external_event_id)` e o "pendente → liquidado" acha os lançamentos
   por `webhook_events.normalized->>paymentRef` **dentro da mesma conexão** ([webhookCore.ts:262](server/integrations/webhooks/webhookCore.ts#L262)). Isso não enxerga lançamentos de outra conexão/conta (CA12) nem os criados por importação. Por isso a chave por pagamento é necessária.
2. **`PAYMENT_CONFIRMED` do Asaas hoje insere de novo** (`kind: payment_pending` sempre cai no `insert`); com o upsert por chave isso vira "sem alteração".
3. `transactions` **não tem GRANT por coluna** (só a política `transactions_tenant_all`): colunas novas ficam legíveis/gravaveis pelo titular dentro do próprio tenant. Aceito (RLS isola); o app grava com lista explícita de colunas e o servidor usa service role.
4. O trigger `validate_transaction_integrity` ([0002…sql:580](supabase/migrations/0002_module2_financial_core.sql#L580)) já força: `paid` sem `payment_date` → hoje; `pending` com `due_date` passada → `overdue`. Logo "vencido" **não precisa de status próprio**: importar como `pending` com a data de vencimento real já resulta em `overdue`. `canceled` já existe e **já é ignorado** por `v_account_balances` e `computeAccountBalances` (CA13).
5. O nome do cliente cai em `counterparty_name`, que o anonimizador **já** trata como termo sensível ([anonymizer.ts:41](src/modules/vault/anonymizer.ts#L41), [aiContextBuilder.ts:314](src/modules/ai-cfo/aiContextBuilder.ts#L314)). CA11 vira teste de regressão, sem código novo no cofre.
6. `integration_connections.credentials_encrypted` já guarda `{ "api_access_token": "..." }` cifrado (AES-256-GCM, AAD = tenant) e **já é obrigatório no Mercado Pago**. Reaproveito **o mesmo campo** para a "Chave de API" dos dois provedores (Asaas passa a usá-lo). Nenhuma coluna nova de credencial, e a view pública de conexões já não o expõe (CA1).
7. O adaptador Mercado Pago tem a normalização **embutida** em `resolve` ([mercadopago.ts:107-150](server/integrations/webhooks/adapters/mercadopago.ts#L107)): extraio para função pura reutilizada (webhook e importação não podem divergir).

## Regras de negócio

### Mapeamento de status (importação)
| Situação no provedor | Asaas (`payment.status`) | Mercado Pago (`status`) | Resultado em `transactions` |
|---|---|---|---|
| Pago | `RECEIVED`, `RECEIVED_IN_CASH`, `DUNNING_RECEIVED` | `approved` | receita + taxa; `paid` se a data de crédito ≤ hoje, senão `pending` até lá (igual ao webhook) |
| Confirmado (a receber) | `CONFIRMED` | — | receita `pending`, vencimento = crédito estimado |
| Pendente | `PENDING`, `AWAITING_RISK_ANALYSIS` | `pending`, `in_process`, `authorized`, `in_mediation` | receita `pending`, vencimento = data de vencimento/expiração |
| Vencido | `OVERDUE`, `DUNNING_REQUESTED` | `pending` com expiração passada | `pending` → o trigger grava `overdue` |
| Cancelado | `deleted = true` | `cancelled`, `rejected` | receita com `status = canceled`, descrição "[Cancelado]", **sem** linha de taxa |
| Estornado | `REFUNDED`, `REFUND_REQUESTED`, `REFUND_IN_PROGRESS`, `CHARGEBACK_*` | `refunded`, `charged_back` | receita (e taxa, se já existir) com `status = canceled`, descrição "[Estornado]", **sem** linha de estorno |
| Desconhecido | qualquer outro | qualquer outro | não importa; conta em "ignorados" com o motivo `status <X>` |

Os status foram **conferidos na documentação oficial na T01** (ver `tasks.md`, Notas de execução): os 14 status do Asaas e os do Mercado Pago (`approved`, `authorized`, `in_process`, `pending`, `in_mediation`, `cancelled`, `rejected`, `refunded`, `charged_back`) batem com a tabela. No Asaas o campo `confirmedDate` **não existe** na cobrança; a competência usa `paymentDate`/`clientPaymentDate`/`dateCreated`.

### Upsert por pagamento (função única, também usada pelo webhook)
Para um pagamento com chave `(tenant, provedor, ref)`, busca as linhas existentes (por colunas novas; **fallback** por `notes = 'webhook:{provedor}:{ref}:pending|settled'` para linhas criadas antes da migration, que passam a receber as colunas) e decide:

| Existente | Evento/estado do provedor | Ação | Contagem |
|---|---|---|---|
| nada | aberto/pago | cria receita (+ taxa) na conta escolhida | importado |
| nada | cancelado/estornado | cria receita `canceled` | marcado à parte |
| `pending`/`overdue` | pago | atualiza status, `payment_date`, `due_date`, `notes` (valor **não** muda; igual ao fluxo atual do webhook) | atualizado |
| `paid` | pendente/confirmado | **não regride** | ignorado |
| qualquer | mesmo estado | nenhuma escrita | ignorado |
| `pending`/`paid` sem linha de estorno | cancelado/estornado | marca receita e taxa como `canceled` | marcado à parte |
| já tem linha de estorno (webhook) | estornado | nenhuma escrita (evita contar duas vezes) | ignorado |
| receita `canceled` por importação | webhook de estorno chega | **não cria** linha de estorno | ignorado |
| linha de estorno existente | novo estorno parcial (valor acumulado maior) | atualiza o valor do mesmo lançamento de estorno | atualizado |

A conta usada em criações é a **da execução** (importação) ou a **da conexão** (webhook). Atualizações **nunca trocam a conta** do lançamento existente (CA12).

### Período e janelas
- Período recusado se: `fim < início`, `fim` no futuro, ou mais de 12 meses (`fim ≥ início + 12 meses`) — CA8.
  **Ajuste da T01 (Mercado Pago):** a busca do MP só devolve pagamentos **dos últimos 12 meses contados de hoje** e recusa intervalo ≥ 365 dias por consulta. Para o Mercado Pago o início também não pode ser anterior a `hoje − 12 meses` (mensagem clara na tela). As janelas mensais já respeitam o limite por consulta. Regra pura em `src/modules/integrations/historyPeriod.ts` (usada pelo cliente para validar e pelo servidor para decidir).
- **Filtro por data de criação** da cobrança/pagamento (`dateCreated` no Asaas; `date_created` no Mercado Pago). Documentado na tela: "cobranças criadas no período". Decisão aberta a aprovar (ver "Decisões para aprovação").
- O período é fatiado em **janelas mensais**: mantém cada consulta pequena e evita o teto de resultados da busca do Mercado Pago. O cursor é `{ janela, offset }`.

### Cliente (contraparte)
- **Mercado Pago:** nome do pagador (`payer.first_name` + `payer.last_name`); sem e-mail/CPF; ausente → `null`.
- **Asaas:** a cobrança traz só o id do cliente. Antes dos pagamentos há uma **fase "clientes"** que pagina `GET /v3/customers` e guarda `id → nome` na própria execução (`import_runs.customers`). Evita uma chamada por cobrança (rate limit). Nome ausente → `null`, nunca aborta.
- Gravado só em `counterparty_name` (sem cadastro de clientes). Nunca aparece em `webhook_events.payload` (o payload do log é reduzido a campos não identificáveis: id, status, valores, datas).

## Arquivos afetados

### Novos
- `supabase/migrations/0008_importacao_historico_api.sql` — ver "Banco de dados".
- `src/modules/integrations/historyPeriod.ts` — validação pura do período (≤12 meses, sem futuro) e janelas mensais; compartilhado cliente/servidor.
- `server/integrations/history/providerClients.ts` — `AsaasClient` e `MercadoPagoClient` **somente GET**; `fetch` injetável; espaçamento mínimo entre chamadas; `429` com espera (Asaas **não envia** `Retry-After` no 429: usa `RateLimit-Reset`, em segundos; `Retry-After` só vem no `403` de bloqueio temporário; nunca repetir de imediato; teto 30 s, 3 tentativas; sem cabeçalho, espera progressiva); `401/403` → `ProviderAuthError` (mensagem clara, CA7); timeout de 10 s por chamada. A chave **nunca** entra em mensagem de erro, log ou `last_error`.
- `server/integrations/history/mappers.ts` — `mapAsaasPayment` e `mapMercadoPagoPayment` → `{ normalized, lifecycle: 'open'|'settled'|'canceled'|'refunded', counterpartyName, providerStatus }`.
- `server/integrations/history/paymentUpsert.ts` — decisão **pura** (`decidePaymentUpsert`) + interface `TransactionStore` (achar por chave, inserir, atualizar) + implementação Supabase. A interface permite testar idempotência sem banco.
- `server/integrations/history/historyRunner.ts` — `startRun`, `stepRun`, `cancelRun`, `getRun` (fases clientes → pagamentos; cursor; contadores; erros por pagamento sem abortar; falha de página/chave marca a execução `failed` mantendo o cursor).
- `server/integrations/historyRoutes.ts` — rotas autenticadas (ver "Contratos"); montada em `server.ts` ao lado de `createWebhookRouter`.
- `src/modules/integrations/components/HistoryImportModal.tsx` — período, conta de destino, progresso, resultado.
- `server/__tests__/history.test.ts` + `server/__tests__/fixtures/asaas-*.json`, `mercadopago-*.json` — respostas de exemplo das duas APIs.

### Alterados
- `server/integrations/webhooks/webhookCore.ts` — `planTransactionsForEvent` ganha `accountId` opcional (override), `counterpartyName` e `lifecycle` canceled; `applyNormalizedEvent` passa a usar `paymentUpsert` (substitui a busca por `webhook_events`); linhas planejadas ganham `external_source/ref/role`.
- `server/integrations/webhooks/types.ts` — `NormalizedPaymentEvent.counterpartyName?: string | null`.
- `server/integrations/webhooks/adapters/mercadopago.ts` — extrai `normalizeMercadoPagoPayment` (pura); webhook e importação a usam.
- `server/integrations/webhooks/adapters/asaas.ts` — extrai `normalizeAsaasPayment` para o que for comum (valor, taxa, datas, descrição, produto).
- `server/integrations/webhookRoutes.ts` — `PATCH` já aceita `api_access_token` (mantém); lista de conexões passa a devolver `api_key_configured: boolean` (derivado de `credentials_encrypted IS NOT NULL`, sem expor o conteúdo); `POST` aceita `api_access_token` opcional também para Asaas; `GET /integrations/events` aceita `source` e devolve a coluna.
- `src/modules/integrations/integrationsApi.ts` e `types.ts` — funções/tipos da importação; `WebhookEventRow.source`; `IntegrationConnection.api_key_configured`.
- `src/modules/integrations/IntegrationsHubView.tsx` — campo "Chave de API" (criação e edição), chip "Chave configurada", botão "Importar histórico", selo "API" nos eventos e filtro por origem.
- `scripts/run-tests.ts` — registra a suíte da 004.
- `docs/architecture.md` — seção "Importação de histórico" (rotas, tabela, regra de chave por pagamento).

### Reaproveitar (caminhos exatos)
- `planTransactionsForEvent`, `resolveFeeAmount`, `matchProductFromHint`, `loadTenantCatalog` — `server/integrations/webhooks/webhookCore.ts`.
- `encryptSecret`/`decryptSecret` — `server/crypto/secretBox.ts`; `decryptConnectionSecrets` — `webhookCore.ts`.
- `roundMoney`, `toISODateBR`, `toNumberOrNull` — `server/integrations/webhooks/utils.ts`.
- `requireUser`, `getAuthUser` — `server/authMiddleware.ts` (tenant sempre do JWT, nunca do corpo).
- `apiJson` — `src/modules/core/apiClient.ts`; padrão de diálogo e chips — `components/moduleUi.tsx` e `components/ui/dialog.tsx`.
- Gancho de teste: `scripts/testHarness.ts` (`runCases`, `assert*`).

## Banco de dados
Migration **`0008_importacao_historico_api.sql`**, numeração sequencial, idempotente, **aplicada manualmente pelo usuário** no SQL Editor do Supabase.
**Ordem obrigatória:** aplicar a 0008 **antes** do push da `dev` (o código novo grava colunas que ainda não existiriam). A 0008 só **adiciona** colunas anuláveis e tabela nova; o código antigo (produção atual) continua funcionando depois dela.

1. `transactions`: `external_source TEXT`, `external_ref TEXT`, `external_role TEXT CHECK (external_role IN ('income','fee','refund'))` + `CHECK` "os três preenchidos ou os três nulos" (idempotente, via `DO $$`).
   Índice único parcial: `UNIQUE (tenant_id, external_source, external_ref, external_role) WHERE external_ref IS NOT NULL`.
2. **Backfill** das linhas de webhook existentes a partir de `notes` (`webhook:{provedor}:{ref}:{estado}`), com `DISTINCT ON` para nunca violar o índice único se houver duplicidade antiga; papel inferido por `description` (`Taxa …` → fee, `Estorno …` → refund, senão income).
3. `webhook_events`: `source TEXT NOT NULL DEFAULT 'webhook' CHECK (source IN ('webhook','api'))` — log "origem API".
4. Nova tabela **`import_runs`** (`tenant_id`, `connection_id`, `provider`, `company_id`, `account_id`, `period_start`, `period_end`, `status` `running|completed|failed|canceled`, `phase` `customers|payments`, `cursor JSONB`, `customers JSONB`, contadores `created/updated/ignored/marked_apart/failed`, `errors JSONB` (máx. 50, sem dados pessoais), `last_error`, `started_at`, `finished_at`, `updated_at`).
   RLS **e FORCE RLS**, política `SELECT` por tenant (`is_authorized_tenant`), `REVOKE INSERT, UPDATE, DELETE` de `anon, authenticated` (escrita só pelo servidor com service role), trigger `set_updated_at`.
   Índice único parcial `(connection_id) WHERE status = 'running'` → uma execução ativa por conexão.
5. `ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'integration.history_imported'` (fora de uso na mesma transação).
6. Bloco de **rollback** comentado ao final do arquivo (padrão da 0007).

## Contratos (API / tipos)
Todas as rotas exigem `requireUser` (JWT aal2); o `tenant_id` vem do JWT. Mensagens em pt-BR.

| Rota | Corpo | Resposta |
|---|---|---|
| `POST /api/integrations/connections/:id/history/start` | `{ period_start, period_end, account_id }` | `201 { run }` — valida período (CA8), conta (do tenant **e da empresa da conexão**), chave configurada e **testa a chave** com 1 consulta (CA7). Se já houver execução `running` da conexão, devolve `409 { run }` (a tela oferece "Retomar"). |
| `POST /api/integrations/history/:runId/step` | — | `200 { run, done }` — processa **uma página**; idempotente se repetido. |
| `GET /api/integrations/history/:runId` | — | `200 { run }` |
| `POST /api/integrations/history/:runId/cancel` | — | `200 { run }` (mantém o que já foi importado) |
| `GET /api/integrations/connections` | — | cada conexão ganha `api_key_configured: boolean` (a chave **nunca** volta) |
| `GET /api/integrations/events?source=api` | — | eventos filtrados por origem; linhas ganham `source` |

Tipo da execução devolvida ao navegador: `{ id, connection_id, status, phase, period_start, period_end, account_id, window_index, window_total, counts: { created, updated, ignored, marked_apart, failed }, errors: Array<{ ref: string; message: string }>, last_error, finished_at }`. `ref` é o id do pagamento no provedor; **nunca** nome de cliente.

`NormalizedPaymentEvent` ganha `counterpartyName?: string | null`.

## Interface (pt-BR, sem jargão)
- Conexão: campo **"Chave de API"** (criação e edição; no Mercado Pago substitui o atual "Access Token"); depois de salva aparece só o chip **"Chave configurada"**; trocar exige digitar de novo.
- Botão **"Importar histórico"** (desabilitado sem chave). Modal: atalhos "Últimos 3 / 6 / 12 meses" + datas; **"Conta de destino"** sem valor pré-selecionado (obrigatória, só contas da empresa da conexão); texto "cobranças criadas no período; nada é alterado no {Asaas|Mercado Pago}".
- Durante a execução: barra por mês ("mês 3 de 12"), contadores **Importados · Atualizados · Ignorados · Cancelados/estornados · Erros**, botão Cancelar; ao falhar: mensagem clara e **"Retomar"**.
- Eventos: selo "API" e filtro de origem.

## Riscos e mitigação
- **Dados reais compartilhados entre h-cfo e cfo.** Uma importação no h-cfo escreve no mesmo banco da produção. Mitigação: verificar primeiro com **1 mês**; usar a conta e o período que o usuário indicar; rollback por SQL (abaixo).
- **Conta Asaas real.** Cliente só `GET` (teste automático impede outro método); a chave é colada pelo usuário na tela; nada é gravado no provedor; o webhook "Gestão Comoequetalá" não é tocado.
- **Rate limit / 429.** Espaçamento mínimo entre chamadas, espera por `RateLimit-Reset` (ou `Retry-After`, quando houver), no máximo 3 tentativas; esgotadas, a execução fica `failed` **resumível**. Limites do Asaas (documentação, T01): 25.000 requisições por 12 h por conta, até 50 `GET` simultâneos (a importação é sequencial, 1 por vez) e limites próprios por endpoint. Mercado Pago: limite não documentado nas páginas lidas; mesmo tratamento de `429`.
- **Teto de resultados da busca do Mercado Pago.** Janelas mensais; se uma janela ainda tiver mais resultados que o teto documentado, ela é fatiada por semana. A documentação oficial não informa o teto; fontes secundárias citam `offset` máximo 10.000 e `limit` 50, então o Mercado Pago usa **50 por página** (menor que qualquer teto) e a regra de fatiar fica como proteção.
- **Duplicidade entre importação e webhook (corrida).** Índice único parcial por pagamento; violação (`23505`) vira "já existe" e reexecuta a decisão.
- **Linhas criadas pelo webhook antigo entre a migration e o deploy** (sem colunas novas). Fallback por `notes` na busca + adoção das colunas.
- **Vazamento de chave.** Cifrada (AES-256-GCM, AAD = tenant); fora de `PUBLIC_CONNECTION_COLUMNS`; fora de logs, `last_error`, `errors` e respostas; teste procura a chave de exemplo em todas as respostas/erros (CA1).
- **Vazamento de nome de cliente.** Só em `counterparty_name`; payload do log reduzido; erros por pagamento citam só o id do pagamento; regressão do anonimizador (CA11).
- **Mudança de comportamento do webhook** (aprovar): deixa de inserir de novo no `PAYMENT_CONFIRMED`; passa a deduplicar por pagamento entre contas; o webhook do Mercado Pago passa a gravar o nome do pagador e usar a data de expiração em pendentes (efeito do código compartilhado).
- **Execução abandonada** (aba fechada): fica `running`; ao reabrir o modal, oferece "Retomar" ou "Cancelar". Sem processamento em segundo plano.
- **Janela de preço/limite da API muda** (fora do nosso controle): os testes usam respostas de exemplo gravadas; a verificação real no h-cfo confere contagem/valores contra o painel (CA2/CA6).

## Rollback
- **Código:** `git revert` dos commits `feat(004)`; a migration 0008 é aditiva e o código antigo ignora as colunas/tabela novas.
- **Desfazer uma importação** (SQL manual, só se necessário, com confirmação do usuário):
  ```sql
  -- lançamentos CRIADOS por uma execução (ajustar :run_id):
  DELETE FROM public.transactions t
  USING public.import_runs r
  WHERE r.id = :run_id AND t.tenant_id = r.tenant_id
    AND t.external_source = r.provider AND t.created_at >= r.started_at
    AND t.id IN (SELECT unnest(transaction_ids) FROM public.webhook_events
                 WHERE source = 'api' AND connection_id = r.connection_id AND received_at >= r.started_at);
  ```
  Atualizações feitas em linhas já existentes (pendente → liquidado) não são desfeitas por esse comando.
- **Banco:** bloco de rollback comentado na 0008 (remove índice, colunas e tabela). Fazê-lo só após reverter o código.
- **Deploy:** o rollback automático do `deploy/receive.sh` já cobre falha de healthcheck.

## Estratégia de teste
Suíte nova **"Importação de histórico por API (spec 004)"** em `npm test` (`server/__tests__/history.test.ts`), com respostas de exemplo das duas APIs (CA9) e um `TransactionStore` em memória que **simula o índice único**:

| Critério | Teste automatizado | Verificação no h-cfo |
|---|---|---|
| CA1 | resposta de `GET connections` não contém a chave de exemplo; `credentials_encrypted` é `v1:…` e não contém a chave; erros/`last_error`/`errors` nunca a contêm | salvar a chave; abrir a tela e a aba Rede: só `api_key_configured` |
| CA2 | fixture Asaas (3 páginas, `hasMore`) → contagem e soma bruta/taxa esperadas | importar 3 meses e conferir contagem e valores com o painel do Asaas |
| CA3 | executar o mesmo lote duas vezes → 0 criados na segunda | repetir a importação: "0 importados" |
| CA4 | importar pago, depois evento de webhook do mesmo pagamento → mesmas linhas, mesmo valor | (webhook real só quando houver pagamento; usar "Enviar teste" não cobre — registrar como parcial se não houver) |
| CA5 | importar pendente, depois pago (webhook e reimportação) → mesma linha vira `paid` | idem; reimportar após pagamento |
| CA6 | fixtures Mercado Pago equivalentes a CA2–CA5 | importar com token do MP (sandbox ou real) |
| CA7 | `401/403` → `ProviderAuthError` com mensagem clara, sem exceção não tratada; `start` devolve erro 4xx legível | chave errada na tela |
| CA8 | `429` espera (`RateLimit-Reset`/`Retry-After`) e continua; Mercado Pago recusa início anterior a hoje − 12 meses; esgotadas as tentativas, execução `failed` resumível; paginação (`offset`/`hasMore`, `paging.total`); períodos de 12 meses ok, 12 meses + 1 dia, futuro e invertido recusados | tentar 13 meses |
| CA9 | a própria suíte (mapeamento, idempotência, paginação) | — |
| CA10 | `start` sem `account_id` → recusa; conta de outra empresa/tenant → recusa; linhas entram na conta da execução, ≠ conta da conexão | importar escolhendo conta diferente da conexão |
| CA11 | `counterparty_name` preenchido (Asaas via lista de clientes, MP via pagador); anonimizador remove o nome do contexto da IA (caso novo em `aiContextBuilder.test.ts`) | ver contraparte no lançamento; pedir resumo ao CFO virtual e conferir que só há tokens |
| CA12 | importar na conta A; webhook (conexão com conta B) do mesmo pagamento → atualiza a linha, 0 novas | idem com 1 pagamento real |
| CA13 | cancelado/estornado → linha `canceled`, sem taxa, sem estorno; `computeAccountBalances` não os soma (reusa `accountBalances.test.ts`); webhook de estorno posterior não cria linha | conferir saldo da conta antes/depois |
| Extra | cliente HTTP usa **só GET**; fallback por `notes`; falha de uma página mantém o cursor e o que já entrou | cancelar no meio e retomar |

Também: `noModuleLabels.test.ts` continua verde (nenhum texto "Módulo N" na tela nova); `npx tsc --noEmit && npm test && npm run build` antes de cada commit.

## Decisões para aprovação
1. **Filtro por data de criação** da cobrança/pagamento (e não por vencimento ou data de pagamento). Efeito: um pagamento criado antes do período e pago dentro dele **não** entra nessa execução.
2. **Conta de destino restrita às contas da empresa da conexão** (os lançamentos herdam a empresa da conexão). Contas de outra empresa exigem outra conexão.
3. **Chave de API no mesmo campo cifrado já existente** (`api_access_token`), para Asaas e Mercado Pago.
4. **Alterar o comportamento do webhook** conforme a seção de riscos (dedupe por pagamento; `PAYMENT_CONFIRMED` deixa de inserir de novo; MP grava o pagador).
5. **Cancelado/estornado importado vira receita `canceled`** (sem linha de estorno), e não "receita paga + estorno".
