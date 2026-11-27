# Tasks 004 — Importação de histórico por API (Asaas e Mercado Pago)

- **Status:** em-andamento
- **Plan:** `specs/004-importacao-historico-api/plan.md` (aprovado em 2026-11-27)
- **Branch:** `feat/004-importacao-historico-api` (saindo da `dev`)
- **Aprovado em:** 2026-11-27

Uma tarefa por vez, em ordem. Marque `[x]` ao concluir. Commit: `feat(004): descrição (T01)`.
Antes de cada commit: `npx tsc --noEmit && npm test` (e `npm run build` nas tarefas de front).
Tarefas marcadas **(usuário)** dependem de uma ação sua; eu não as simulo.
Regras duras: só `GET` no provedor; nunca ler/imprimir chaves; nenhuma chamada real à conta Asaas durante o desenvolvimento (só respostas de exemplo).

## Fundamentos

- [x] T01 — Conferir nas **documentações oficiais** do Asaas e do Mercado Pago: lista de status de pagamento, nome dos filtros de data,
  paginação (`offset/limit/hasMore`, `paging.total`), teto de resultados da busca do MP, limites de requisição/`429`/`Retry-After`,
  cabeçalho de autenticação, URL de produção × sandbox, listagem de clientes do Asaas e campos do pagador no MP. Registrar o resultado nas "Notas de execução".
  **Pronto quando:** as Notas listam cada ponto confirmado; se algo contradiz o plan (status, filtro, teto), **paro** e atualizo o plan para você aprovar antes da T02. (CA2, CA6, CA8)

- [x] T02 — Escrever `supabase/migrations/0008_importacao_historico_api.sql`: colunas `external_source/ref/role` em `transactions` + `CHECK` tudo-ou-nada,
  índice único parcial, backfill por `notes` com `DISTINCT ON`, `webhook_events.source`, tabela `import_runs` (RLS + FORCE RLS, política de leitura por tenant,
  `REVOKE` de escrita, índice único de execução ativa por conexão, trigger `updated_at`), valor de auditoria `integration.history_imported` e bloco de rollback comentado.
  **Pronto quando:** o arquivo é idempotente (`IF NOT EXISTS`/`DO $$`), não usa o valor novo do enum na mesma transação e passa em leitura linha a linha contra `0006` e `0007`. (CA1, CA3, CA12)

- [x] T03 — `src/modules/integrations/historyPeriod.ts` (validação do período e janelas mensais) com testes escritos **antes** (registrados em `scripts/run-tests.ts`
  na suíte "Importação de histórico por API (spec 004)").
  **Pronto quando:** `npm test` cobre 12 meses exatos (ok), 12 meses + 1 dia (recusa), fim no futuro, fim antes do início, janelas que cobrem o período sem sobreposição; todos passam. (CA8)

## Normalização e mapeamento

- [x] T04 — Refatorar sem mudar comportamento: `NormalizedPaymentEvent.counterpartyName?`; extrair `normalizeMercadoPagoPayment` (pura) de `mercadopago.ts` e o que for comum em `asaas.ts`;
  o webhook passa a usar as funções extraídas.
  **Pronto quando:** `npx tsc --noEmit` passa e **todos** os testes existentes do webhook (suíte do servidor) continuam verdes sem alterar suas expectativas. (CA6)

- [x] T05 — `server/integrations/history/mappers.ts` (`mapAsaasPayment`, `mapMercadoPagoPayment`: status → `open|settled|canceled|refunded`, vencimento, taxa, cliente/pagador)
  + fixtures `server/__tests__/fixtures/asaas-*.json` e `mercadopago-*.json` (com `hasMore`, pendente, vencido, pago, cancelado, estornado, cliente ausente), testes escritos **antes**.
  **Pronto quando:** os testes de mapeamento passam: valores e taxa corretos, status desconhecido vira "ignorado" com motivo, nome do cliente só em `counterpartyName`, sem e-mail/CPF. (CA2, CA6, CA9, CA11, CA13)

- [x] T06 — `server/integrations/history/providerClients.ts`: `AsaasClient` e `MercadoPagoClient` só com `GET`, `fetch` injetável, espaçamento mínimo, `429` com `RateLimit-Reset`/`Retry-After` (teto 30 s, 3 tentativas),
  `401/403` → `ProviderAuthError`, timeout de 10 s, listagem de clientes do Asaas; testes com `fetch` falso.
  **Pronto quando:** testes provam: só método `GET`; paginação percorre todas as páginas das fixtures; `429` espera e continua; esgotadas as tentativas devolve erro retomável;
  `401` devolve mensagem clara; a chave de exemplo **não** aparece em nenhuma mensagem de erro. (CA1, CA7, CA8)

## Idempotência e persistência

- [x] T07 — Testes primeiro: `server/__tests__/history.test.ts` com um `TransactionStore` **em memória que simula o índice único**, cobrindo toda a tabela "Upsert por pagamento" do plan
  (criar, pendente→pago, não regredir, mesmo estado, cancelar/estornar, estorno já existente, estorno parcial acumulado, fallback por `notes`) e os cenários CA3, CA4, CA5, CA12, CA13.
  **Pronto quando:** `npm test` roda a suíte e os casos que dependem de `paymentUpsert` **falham** (prova de que testam). (CA3, CA4, CA5, CA12, CA13)

- [x] T08 — Implementar `server/integrations/history/paymentUpsert.ts` (`decidePaymentUpsert` pura + `TransactionStore` Supabase) e ajustar `planTransactionsForEvent`
  (conta de destino por parâmetro, ciclo cancelado/estornado "[Cancelado]/[Estornado]" sem taxa e sem estorno, colunas `external_*`, contraparte).
  **Pronto quando:** os testes da T07 passam e a suíte inteira do servidor continua verde. (CA3, CA5, CA10, CA11, CA12, CA13)

- [x] T09 — Webhook usa o upsert: `applyNormalizedEvent` em `webhookCore.ts` substitui a busca por `webhook_events` (fica o fallback por `notes`); `PAYMENT_CONFIRMED` repetido não insere;
  estorno não cria linha se a receita foi marcada `canceled`; violação `23505` vira "já existe".
  **Pronto quando:** testes novos passam: webhook do mesmo pagamento em conexão/conta diferente atualiza a mesma linha sem duplicar nem alterar o valor; os testes antigos do webhook seguem verdes. (CA4, CA5, CA12, CA13)

## Execução em lotes

- [x] T10 — `server/integrations/history/historyRunner.ts`: `startRun`, `stepRun`, `cancelRun`, `getRun`; fase "clientes" (Asaas) → "pagamentos"; cursor `{janela, offset}`;
  contadores; erro de um pagamento não aborta; falha de página/chave marca `failed` **mantendo o cursor**; um evento por pagamento em `webhook_events` com `source = 'api'` e payload reduzido; auditoria ao concluir.
  Testado com os fakes da T06/T07.
  **Pronto quando:** testes provam: importar 3 meses das fixtures cria o esperado; repetir resulta em 0 criados; falha na página 2 mantém a página 1 e retoma da página 2; cancelar mantém o importado;
  segunda execução ativa da mesma conexão é recusada; conta de outra empresa/tenant ou ausente é recusada. (CA2, CA3, CA6, CA8, CA10)

- [ ] T11 — Rotas: `server/integrations/historyRoutes.ts` (`start`, `step`, `get`, `cancel`) montada em `server.ts`; em `webhookRoutes.ts`: `api_key_configured` na lista de conexões, `api_access_token` aceito também para Asaas no `POST`,
  `source` no `GET /integrations/events`. Tenant sempre do JWT; `start` valida período, conta e testa a chave com 1 consulta.
  **Pronto quando:** testes de rota/serviço provam: chave de exemplo não aparece em nenhuma resposta nem em `last_error`/`errors`; `credentials_encrypted` é `v1:…`; chave inválida devolve mensagem clara sem travar;
  período acima de 12 meses é recusado com mensagem legível. (CA1, CA7, CA8, CA10)

## Interface

- [ ] T12 — Cliente: tipos e funções em `integrationsApi.ts`/`types.ts` (`startHistoryImport`, `stepHistoryImport`, `cancelHistoryImport`, `getHistoryImport`, `source` nos eventos, `api_key_configured`).
  **Pronto quando:** `npx tsc --noEmit` passa e as funções têm lista explícita de campos no corpo das requisições. (CA1)

- [ ] T13 — `IntegrationsHubView.tsx`: campo "Chave de API" na criação e na edição (Mercado Pago passa a usar este mesmo campo no lugar de "Access Token"), chip "Chave configurada", troca exige digitar de novo; a chave nunca é exibida.
  **Pronto quando:** `tsc`/`build` passam e, no `npm run dev`, salvar a chave mostra só o chip e recarregar a página não a exibe em lugar nenhum (Rede/DOM). (CA1)

- [ ] T14 — `components/HistoryImportModal.tsx` + botão "Importar histórico" (desabilitado sem chave): atalhos 3/6/12 meses e datas, **"Conta de destino" sem valor pré-selecionado** e só com contas da empresa da conexão, barra "mês N de M",
  contadores (importados, atualizados, ignorados, cancelados/estornados, erros), Cancelar e **Retomar**, mensagens claras de chave inválida e período inválido; selo "API" e filtro de origem nos eventos.
  **Pronto quando:** `tsc`/`build` passam; `noModuleLabels.test.ts` segue verde (nenhum "Módulo N"); no `npm run dev` com o servidor de testes/fakes, o modal bloqueia o início sem conta e com período > 12 meses. (CA7, CA8, CA10, CA13)

## Fechamento

- [ ] T15 — Regressão de privacidade (CA11): caso novo em `aiContextBuilder.test.ts` com `counterparty_name` de lançamento importado → o nome não aparece no contexto enviado à IA, só tokens.
  Atualizar `docs/architecture.md` (importação de histórico, chave por pagamento, tabela `import_runs`). Rodar `npx tsc --noEmit && npm test && npm run build`.
  **Pronto quando:** os três comandos passam e o caso novo falha se `counterparty_name` deixar de ser tratado como sensível. (CA11)

- [ ] T16 — **(usuário)** Aplicar `0008_importacao_historico_api.sql` no SQL Editor do Supabase (o mesmo banco serve h-cfo e cfo) e me avisar.
  Eu entrego o SQL pronto no chat. **Só depois disto** se faz o push/merge na `dev` (o código novo grava colunas que ainda não existiriam).
  **Pronto quando:** o usuário confirma e `select external_ref, external_role from transactions limit 1` e `select count(*) from import_runs` funcionam.

- [ ] T17 — Subir a branch, abrir PR para a `dev`, merge e deploy no h-cfo. **(usuário: confirmar o merge)**
  **Pronto quando:** o deploy do GitHub Actions termina verde e o h-cfo responde ao healthcheck.

- [ ] T18 — **(usuário + verificação)** No h-cfo, o usuário cola a chave de API (Asaas e, se possível, Mercado Pago) e eu conduzo `/sdd-verify` contra **todos** os critérios CA1–CA13, **começando por 1 mês**
  e só depois 3 meses (os dados vão para o mesmo banco da produção). Registrar o resultado no "Registro de verificação" da spec; CA sem como testar (ex.: webhook real sem pagamento novo) fica como **parcial**, explicado.
  **Pronto quando:** cada CA tem resultado registrado; a promoção `dev` → `main` só acontece com o seu "sim".

## Notas de execução
(decisões e descobertas durante a implementação; mudança de escopo → parar e atualizar a spec/plan)

### T10 — Executor em lotes (2026-11-27)
- `server/integrations/history/historyRunner.ts`: `startRun`, `stepRun`, `cancelRun`, `getRun`, `createHistorySource`, `toPublicRun`; dependências injetáveis (`HistoryDeps`). Cursor `{janela, offset, customersOffset}`; Asaas passa pela fase "clientes" (uma página por passo) antes dos pagamentos.
- Regras: `failed` mantém o cursor e `stepRun` numa execução `failed` **retoma** (a chave é relida a cada passo, então pode ter sido corrigida); `canceled`/`completed` não processam mais; uma execução ativa por conexão (409 devolve a execução para retomar); erro em um pagamento conta em "erros" (só o id) e não aborta o lote; auditoria `integration.history_imported` ao concluir.
- **Correção encontrada ao escrever o teste do MP:** o Mercado Pago devolve `net_received_amount = 0` em pagamentos ainda não aprovados; o núcleo tratava isso como líquido real e lançaria uma "taxa" igual ao valor inteiro (o mesmo defeito existia no webhook). `normalizeMercadoPagoPayment` agora só usa líquido e taxa quando o status é `approved`. Teste de regressão adicionado.
- 16 testes novos com fakes em memória (`helpers/memoryRuns.ts`); `npm test`: 157/157.

### T09 — Webhook usa o upsert por pagamento (2026-11-27)
- `applyNormalizedEvent` agora planeja e chama `upsertPayment` (intenção `open|settled|refund`); a busca por `webhook_events.normalized->>paymentRef` foi removida. Recebe `deps` opcional (armazenamento e catálogo) para teste.
- Efeitos: `PAYMENT_CONFIRMED` repetido não insere de novo; pendente → liquidado reaproveita as linhas de qualquer conta/conexão; evento repetido já liquidado retorna 0 lançamentos (antes devolvia os ids); estorno sobre receita cancelada pela importação não cria linha.
- 4 testes novos pelo caminho do webhook; `npm test`: 141/141.

### T08 — Upsert por pagamento e planejador (2026-11-27)
- `paymentUpsert.ts` implementado: decisão por intenção (`open|settled|void|refund`), adoção de linhas antigas pelo marcador em `notes`, e releitura quando outro processo grava o mesmo pagamento no meio do caminho (3 tentativas). Pendente e vencido contam como o mesmo estado (evita "atualizado" a cada reimportação).
- `supabaseTransactionStore.ts`: implementação Supabase (service role, sempre filtrando por `tenant_id`, lista explícita de colunas no update, `23505` → conflito).
- `planTransactionsForEvent`: `accountId` (conta da importação), `voidAs` (receita `canceled` "[Cancelado]/[Estornado]", sem taxa nem estorno) e `counterparty_name` na receita e no estorno.
- Os 17 testes da T07 passam; 3 testes novos do planejador. `npm test`: 137/137.

### T07 — Testes de idempotência primeiro (2026-11-27)
- `server/__tests__/historyUpsert.test.ts` (17 casos) + `server/__tests__/helpers/memoryStore.ts` (armazenamento em memória que simula o índice único e o fallback por `notes`) + esqueleto `server/integrations/history/paymentUpsert.ts` com os tipos e a API (`upsertPayment`, `TransactionStore`, intenções `open|settled|void|refund`).
- **Estado esperado: 17 testes vermelhos** ("upsertPayment ainda não implementado (T08)"). Resultado atual de `npm test`: 117/134. **Não fazer push da branch antes da T08** (o CI ficaria vermelho).
- Contrato decidido aqui: `open` cria se não existe e nunca mexe no existente; `settled` só atualiza pendente/vencido (nunca regride, nunca troca valor nem conta); `void` marca receita e taxa como `canceled`; `refund` não cria linha se a receita já está `canceled`, e atualiza o valor acumulado do estorno parcial.

### T06 — Clientes HTTP (2026-11-27)
- `server/integrations/history/providerClients.ts`: `AsaasClient` (`listPayments`, `listCustomers` reduzido a id/nome/removido, `verifyKey`) e `MercadoPagoClient` (`searchPayments`, `verifyKey`); só `GET`, sem corpo. Erros: `ProviderAuthError` (não retomável), `ProviderRateLimitError` e `ProviderRequestError` (retomáveis, exceto 4xx genérico).
- 429: espera `RateLimit-Reset` (ou `Retry-After`), teto 30 s, 3 repetições; sem cabeçalho, espera progressiva. `403` com `Retry-After` = bloqueio temporário (espera); sem ele = chave recusada. Intervalo mínimo entre chamadas 250 ms (~4/s, bem abaixo dos 50 `GET` simultâneos; a importação é sequencial).
- Páginas: Asaas 100, Mercado Pago 50. Chaves `$aact_hmlg_` usam a URL de sandbox; as demais, produção. O `verifyKey` do Mercado Pago usa `begin_date=NOW-30DAYS` como no exemplo da documentação (formato real a confirmar na T18).
- Mensagens de erro são fixas (sem URL, sem corpo da resposta, sem chave); testes confirmam.

### T05 — Mapeadores e fixtures (2026-11-27)
- `server/integrations/history/mappers.ts`: `mapAsaasPayment`, `mapMercadoPagoPayment`, `toHistoryLogPayload` (payload reduzido do log: sem nome, e-mail, documento, id do cliente nem descrição livre) e `ASAAS_KNOWN_STATUSES`.
- Decisões de mapeamento: `AWAITING_CHARGEBACK_REVERSAL` conta como estornado (marcado à parte); `in_mediation` (MP) fica em aberto; `DUNNING_RECEIVED` = pago e `DUNNING_REQUESTED` = em aberto; cobrança `deleted` do Asaas = cancelada.
- Para `canceled`/`refunded`, `normalized.kind` é `payment_pending` só como transporte do valor cheio; a T08 decide pelo `lifecycle`.
- Fixtures com dados fictícios em `server/__tests__/fixtures/` (Asaas: 2 páginas + clientes; Mercado Pago: 2 páginas). As mesmas servirão à paginação (T06) e ao fluxo completo (T10).

### T04 — Normalização compartilhada (2026-11-27)
- `asaasBaseFields` (Asaas) e `normalizeMercadoPagoPayment` + `mercadoPagoPayerName` (Mercado Pago) extraídos; o webhook usa as funções; os 14 testes de webhook existentes seguem verdes sem mudar expectativas.
- Já inclui as duas mudanças aprovadas na decisão 4 do plan: o MP grava `counterpartyName` (nome do pagador) e usa `date_of_expiration` como vencimento de pendentes. Ficam inertes até a T08 (o planejador ainda ignora a contraparte). Testes dessas duas regras: T05.
- Observação (ajuste do plan): `counterpartyName` fica em `webhook_events.normalized` (necessário para o reprocessamento manual reconstruir o lançamento); o **`payload`** do log continua sem dados do pagador. As duas colunas são visíveis só ao titular (RLS) e o backup é cifrado.

### T02 — Migration 0008 (2026-11-27)
- Arquivo escrito e relido linha a linha contra `0006`/`0007` (sem Postgres local para executar; será aplicada por você na T16). Idempotente (`IF NOT EXISTS`, `DO $$`, `DROP … IF EXISTS`), sem usar o valor novo do enum na mesma transação.
- Decisão: `GRANT SELECT` de `import_runs` **por coluna**, sem `customers` (nomes de clientes) e sem `cursor`; o servidor lê tudo com a service role.
- `import_runs` não entra no backup (dado derivado/operacional).

### T01 — Conferência nas documentações oficiais (2026-11-27)
**Asaas** (docs.asaas.com, páginas "Listar cobranças", "Listar clientes", "Limites da API"; chaves de API):
- `GET /v3/payments`: `limit` máx. **100**; `offset`; envelope `object, hasMore, totalCount, limit, offset, data`. Filtros de data: `dateCreated[ge]/[le]`, `dueDate[ge]/[le]`, `paymentDate[ge]/[le]`, `estimatedCreditDate[ge]/[le]` (formato da data não informado; usar `YYYY-MM-DD`).
- 14 status: PENDING, RECEIVED, CONFIRMED, OVERDUE, REFUNDED, RECEIVED_IN_CASH, REFUND_REQUESTED, REFUND_IN_PROGRESS, CHARGEBACK_REQUESTED, CHARGEBACK_DISPUTE, AWAITING_CHARGEBACK_REVERSAL, DUNNING_REQUESTED, DUNNING_RECEIVED, AWAITING_RISK_ANALYSIS (os mesmos no filtro e na resposta).
- Campos da cobrança: `id, customer, value, netValue, status, dueDate, originalDueDate, dateCreated, paymentDate, clientPaymentDate, creditDate, estimatedCreditDate, externalReference, description, billingType, deleted, refunds[]`. **Não existe `confirmedDate`.** Se cobranças removidas (`deleted`) vêm por padrão: **não informado** → o mapeamento trata `deleted: true` como cancelada e tolera a ausência.
- `GET /v3/customers`: `limit` máx. 100, `hasMore`, `totalCount`; cada item tem `id`, `name`, `deleted`.
- Autenticação: cabeçalho **`access_token: <chave>`** (sem `Bearer`). Produção `https://api.asaas.com/v3`; sandbox `https://api-sandbox.asaas.com/v3`; chaves `$aact_prod_…` (produção) e `$aact_hmlg_…` (sandbox) — a chave de um ambiente não funciona no outro (401). O cliente escolhe a URL pelo prefixo; sem prefixo reconhecido usa produção. `User-Agent` não é exigido pelas páginas lidas; o cliente envia um nome genérico por precaução.
- Limites: **25.000 requisições por conta a cada 12 h**; até **50 `GET` simultâneos**; limites próprios por endpoint. `429` traz `RateLimit-Limit/Remaining/Reset` (`Reset` em segundos) e **não** traz `Retry-After` (este só vem no `403` de bloqueio temporário). Orientação: não repetir de imediato após `429`.
- `401` = chave inválida (`invalid_access_token`); `403` também ocorre se um `GET` for enviado com corpo.

**Mercado Pago** (`GET https://api.mercadopago.com/v1/payments/search`; autenticação `Authorization: Bearer <access token>`):
- Parâmetros: `sort` e `criteria` (`asc|desc`), `range` (`date_created`, `date_last_updated`, `date_approved`, `money_release_date`), `begin_date`/`end_date` (formato `yyyy-MM-dd'T'HH:mm:ss.SSSZ`), `limit`, `offset`; envelope `paging { total, limit, offset }` + `results`.
- **Restrições:** a busca "retorna pagamentos feitos nos últimos 12 meses a partir da data da consulta"; intervalo ≥ 365 dias dá erro `9062`. Teto de linhas existe (erro `1000`) sem número oficial; fontes secundárias citam `limit` máx. 50 e `offset` máx. 10.000.
- Status: `approved` (inclui `partially_refunded`), `authorized`, `in_process`, `pending`, `in_mediation`, `cancelled`, `rejected`, `refunded`, `charged_back` — batem com a tabela do plan.
- Campos: `id, status, status_detail, transaction_amount, transaction_amount_refunded, transaction_details.net_received_amount, date_created, date_approved, money_release_date, payer.{id,email,identification}, external_reference, description, currency_id`. **Não confirmados nas páginas lidas:** `fee_details`, `date_of_expiration`, `payer.first_name/last_name` (o webhook atual já usa `fee_details` do `GET /v1/payments/{id}`). O mapeamento trata os três como opcionais (nome ausente → contraparte nula; sem `date_of_expiration` → usa as datas já usadas pelo webhook) e a **T18** confere com uma resposta real.
- Limite de requisições: não documentado nas páginas lidas.

**Divergências com o plan (ajustes feitos no `plan.md`, a aprovar):**
1. Asaas não envia `Retry-After` no `429` → espera por `RateLimit-Reset`.
2. Mercado Pago só pesquisa os **últimos 12 meses a partir de hoje** → para o MP, início anterior a `hoje − 12 meses` é recusado com mensagem clara (nova regra no `historyPeriod`, T03).
3. Página do Mercado Pago = 50 (Asaas = 100).
4. Asaas: sem `confirmedDate`; competência = `paymentDate`/`clientPaymentDate`/`dateCreated`.
