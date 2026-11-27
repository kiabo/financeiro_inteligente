# Tasks 004 — Importação de histórico por API (Asaas e Mercado Pago)

- **Status:** rascunho
- **Plan:** `specs/004-importacao-historico-api/plan.md` (aprovado em 2026-11-27)
- **Branch:** `feat/004-importacao-historico-api` (saindo da `dev`)
- **Aprovado em:** —

Uma tarefa por vez, em ordem. Marque `[x]` ao concluir. Commit: `feat(004): descrição (T01)`.
Antes de cada commit: `npx tsc --noEmit && npm test` (e `npm run build` nas tarefas de front).
Tarefas marcadas **(usuário)** dependem de uma ação sua; eu não as simulo.
Regras duras: só `GET` no provedor; nunca ler/imprimir chaves; nenhuma chamada real à conta Asaas durante o desenvolvimento (só respostas de exemplo).

## Fundamentos

- [ ] T01 — Conferir nas **documentações oficiais** do Asaas e do Mercado Pago: lista de status de pagamento, nome dos filtros de data,
  paginação (`offset/limit/hasMore`, `paging.total`), teto de resultados da busca do MP, limites de requisição/`429`/`Retry-After`,
  cabeçalho de autenticação, URL de produção × sandbox, listagem de clientes do Asaas e campos do pagador no MP. Registrar o resultado nas "Notas de execução".
  **Pronto quando:** as Notas listam cada ponto confirmado; se algo contradiz o plan (status, filtro, teto), **paro** e atualizo o plan para você aprovar antes da T02. (CA2, CA6, CA8)

- [ ] T02 — Escrever `supabase/migrations/0008_importacao_historico_api.sql`: colunas `external_source/ref/role` em `transactions` + `CHECK` tudo-ou-nada,
  índice único parcial, backfill por `notes` com `DISTINCT ON`, `webhook_events.source`, tabela `import_runs` (RLS + FORCE RLS, política de leitura por tenant,
  `REVOKE` de escrita, índice único de execução ativa por conexão, trigger `updated_at`), valor de auditoria `integration.history_imported` e bloco de rollback comentado.
  **Pronto quando:** o arquivo é idempotente (`IF NOT EXISTS`/`DO $$`), não usa o valor novo do enum na mesma transação e passa em leitura linha a linha contra `0006` e `0007`. (CA1, CA3, CA12)

- [ ] T03 — `src/modules/integrations/historyPeriod.ts` (validação do período e janelas mensais) com testes escritos **antes** (registrados em `scripts/run-tests.ts`
  na suíte "Importação de histórico por API (spec 004)").
  **Pronto quando:** `npm test` cobre 12 meses exatos (ok), 12 meses + 1 dia (recusa), fim no futuro, fim antes do início, janelas que cobrem o período sem sobreposição; todos passam. (CA8)

## Normalização e mapeamento

- [ ] T04 — Refatorar sem mudar comportamento: `NormalizedPaymentEvent.counterpartyName?`; extrair `normalizeMercadoPagoPayment` (pura) de `mercadopago.ts` e o que for comum em `asaas.ts`;
  o webhook passa a usar as funções extraídas.
  **Pronto quando:** `npx tsc --noEmit` passa e **todos** os testes existentes do webhook (suíte do servidor) continuam verdes sem alterar suas expectativas. (CA6)

- [ ] T05 — `server/integrations/history/mappers.ts` (`mapAsaasPayment`, `mapMercadoPagoPayment`: status → `open|settled|canceled|refunded`, vencimento, taxa, cliente/pagador)
  + fixtures `server/__tests__/fixtures/asaas-*.json` e `mercadopago-*.json` (com `hasMore`, pendente, vencido, pago, cancelado, estornado, cliente ausente), testes escritos **antes**.
  **Pronto quando:** os testes de mapeamento passam: valores e taxa corretos, status desconhecido vira "ignorado" com motivo, nome do cliente só em `counterpartyName`, sem e-mail/CPF. (CA2, CA6, CA9, CA11, CA13)

- [ ] T06 — `server/integrations/history/providerClients.ts`: `AsaasClient` e `MercadoPagoClient` só com `GET`, `fetch` injetável, espaçamento mínimo, `429` com `Retry-After` (teto 30 s, 3 tentativas),
  `401/403` → `ProviderAuthError`, timeout de 10 s, listagem de clientes do Asaas; testes com `fetch` falso.
  **Pronto quando:** testes provam: só método `GET`; paginação percorre todas as páginas das fixtures; `429` espera e continua; esgotadas as tentativas devolve erro retomável;
  `401` devolve mensagem clara; a chave de exemplo **não** aparece em nenhuma mensagem de erro. (CA1, CA7, CA8)

## Idempotência e persistência

- [ ] T07 — Testes primeiro: `server/__tests__/history.test.ts` com um `TransactionStore` **em memória que simula o índice único**, cobrindo toda a tabela "Upsert por pagamento" do plan
  (criar, pendente→pago, não regredir, mesmo estado, cancelar/estornar, estorno já existente, estorno parcial acumulado, fallback por `notes`) e os cenários CA3, CA4, CA5, CA12, CA13.
  **Pronto quando:** `npm test` roda a suíte e os casos que dependem de `paymentUpsert` **falham** (prova de que testam). (CA3, CA4, CA5, CA12, CA13)

- [ ] T08 — Implementar `server/integrations/history/paymentUpsert.ts` (`decidePaymentUpsert` pura + `TransactionStore` Supabase) e ajustar `planTransactionsForEvent`
  (conta de destino por parâmetro, ciclo cancelado/estornado "[Cancelado]/[Estornado]" sem taxa e sem estorno, colunas `external_*`, contraparte).
  **Pronto quando:** os testes da T07 passam e a suíte inteira do servidor continua verde. (CA3, CA5, CA10, CA11, CA12, CA13)

- [ ] T09 — Webhook usa o upsert: `applyNormalizedEvent` em `webhookCore.ts` substitui a busca por `webhook_events` (fica o fallback por `notes`); `PAYMENT_CONFIRMED` repetido não insere;
  estorno não cria linha se a receita foi marcada `canceled`; violação `23505` vira "já existe".
  **Pronto quando:** testes novos passam: webhook do mesmo pagamento em conexão/conta diferente atualiza a mesma linha sem duplicar nem alterar o valor; os testes antigos do webhook seguem verdes. (CA4, CA5, CA12, CA13)

## Execução em lotes

- [ ] T10 — `server/integrations/history/historyRunner.ts`: `startRun`, `stepRun`, `cancelRun`, `getRun`; fase "clientes" (Asaas) → "pagamentos"; cursor `{janela, offset}`;
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
