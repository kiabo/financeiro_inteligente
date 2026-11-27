# Arquitetura (estado atual)

## Mapa de pastas
| Caminho | Conteúdo |
|---|---|
| `src/App.tsx` | Sessão, workspace e seção ativa (`activeSection`, sem roteador) |
| `src/modules/core/` | `repository.ts` (acesso ao Supabase), `supabase.ts`, `apiClient.ts`, `AppShell`, visão geral e fluxo de caixa, PWA |
| `src/modules/auth/` | Login (senha, Google) e TOTP |
| `src/modules/health/` | Saúde financeira, DRE, dívidas e impostos |
| `src/modules/projects/`, `products/` | Projetos e viabilidade; catálogo de produtos e serviços |
| `src/modules/ai-cfo/` | CFO virtual, contexto anonimizado, servidor MCP e chaves |
| `src/modules/integrations/` | Central de webhooks, conciliação (OFX/CSV/PDF), OCR de recibos, alertas, agenda e backup |
| `src/modules/settings/`, `vault/` | Empresas, contas e grupos; cofre de privacidade; segurança e SQL |
| `server.ts`, `server/` | Express: `/api/cfo/*`, `/api/mcp`, webhooks, automação; `authMiddleware` valida o JWT |
| `server/integrations/` | `webhookRoutes`, `webhooks/` (adaptadores Asaas, Mercado Pago, Stripe, JSON custom), `history/` + `historyRoutes` (importação de histórico por API), `dbBackup/` (backup do banco e uso do plano), `authz.ts`, `alerts/`, `google/`, `backupService`, `dailyJobs` |
| `server/crypto/secretBox.ts` | AES-256-GCM para credenciais e backups |
| `supabase/migrations/` | `0001`…`0009`, aplicadas manualmente |
| `deploy/receive.sh`, `Dockerfile`, `.github/workflows/deploy.yml` | Pipeline de deploy |
| `scripts/` | Testes (`run-tests.ts`) e restauração de backup |

## Autenticação
Supabase Auth, e-mail + senha ou Google, seguidos de TOTP. O app só aceita sessão em **aal2**
(`bootstrapSession` em `App.tsx`). O servidor valida o JWT e usa o `tenant_id` dele; nunca confia no corpo.

## Dados
O navegador consulta tabelas e views do Supabase com RLS. O servidor usa a service role apenas para
integrações (webhooks, importações, alertas, backup). Saldo de conta = soma de lançamentos
(`v_account_balances`, migration 0002).

## Webhooks e eventos
`POST /api/webhooks/:provedor/:segredo` → adaptador normaliza (`NormalizedPaymentEvent`) →
`applyNormalizedEvent` cria ou liquida lançamentos de forma idempotente. A URL pública exibida usa `APP_URL`.
Credenciais por conexão ficam em `integration_connections.credentials_encrypted` (cifradas).
O segredo de assinatura (`signing_secret_encrypted`) pode ser trocado depois pela tela da conexão (`PATCH` com `signing_secret`, validado por `connectionSecrets.ts`); o valor antigo deixa de valer na hora, nada do segredo volta em resposta e a auditoria registra só o nome do campo.

**Idempotência por pagamento (spec 004).** O mesmo pagamento pode chegar por webhook ou por importação, em contas diferentes.
A chave de deduplicação fica em `transactions` (`external_source`, `external_ref`, `external_role` = income | fee | refund)
com índice único `(tenant_id, external_source, external_ref, external_role)`. Quem grava é `server/integrations/history/paymentUpsert.ts`
(`upsertPayment`, intenções `open | settled | void | refund`), usado por `applyNormalizedEvent` (webhook) e pelo executor da importação:
pendente → liquidado atualiza as mesmas linhas (nunca regride, nunca troca valor nem conta); cancelado/estornado importado vira receita
`canceled` (fora do saldo); violação da chave única vira "já existe". Linhas antigas, só com o marcador `webhook:{provedor}:{id}:{estado}` em `notes`,
são reconhecidas e adotam a chave.

## Importação de histórico por API (spec 004)
Asaas e Mercado Pago. A chave de API fica no mesmo campo cifrado da conexão (`credentials_encrypted`, `api_access_token`) e nunca volta ao navegador
(`api_key_configured` é só um booleano).
- **Rotas** (`historyRoutes.ts`, JWT aal2, tenant do JWT): `POST /api/integrations/connections/:id/history/start`, `POST /api/integrations/history/:runId/step`,
  `GET …/history/:runId`, `POST …/cancel`, `GET /api/integrations/connections/:id/history/latest`.
- **Execução em lotes** (`historyRunner.ts`): o navegador chama `step` repetidamente; cada passo processa uma página e grava cursor e contadores em `import_runs`
  (leitura pelo titular sem as colunas `cursor` e `customers`). Falha deixa a execução `failed` com o cursor; `step` retoma. Uma execução ativa por conexão.
  Período máximo de 12 meses em janelas mensais (`src/modules/integrations/historyPeriod.ts`); o Mercado Pago só alcança os últimos 12 meses a partir de hoje.
- **Clientes HTTP** (`providerClients.ts`): somente `GET`, espaçamento mínimo, espera no `429` (`RateLimit-Reset`), erro claro para chave recusada. O Asaas passa por uma
  fase de "clientes" (id → nome) porque a cobrança só traz o id.
- **Mapeamento** (`mappers.ts`): pago, em aberto (pendente, confirmado, vencido), cancelado, estornado; status desconhecido é ignorado com motivo.
- **Log**: um evento por pagamento em `webhook_events` com `source = 'api'` e payload reduzido (sem nome, e-mail, documento nem id do cliente).
- **Privacidade**: o nome do cliente é gravado só em `counterparty_name`, que o cofre de anonimização já trata como termo sensível.

## Rotinas diárias
`server/integrations/dailyJobs.ts`, a partir das 7h (America/Sao_Paulo), só com `ENABLE_INTERNAL_SCHEDULER=true`
(produção): alertas por e-mail (Resend) e WhatsApp (Evolution API), sincronização de agenda e backup cifrado no Drive.

## Backup do banco e uso do plano (spec 006)
`server/integrations/dbBackup/`. Todo dia às 03:00 (America/Sao_Paulo, `DB_BACKUP_HOUR`), só na produção (`ENABLE_INTERNAL_SCHEDULER=true`) e com `SUPABASE_DB_URL` definida,
o agendador (`startDbBackupScheduler`) roda `pg_dump --format=custom` (schemas `public` e `auth`), cifra com a mesma `BACKUP_ENCRYPTION_KEY` do backup lógico (formato `.vtxbak`, extensão `.vtxdb`),
grava em `/backups` (no VPS, `/opt/financeiro-inteligente/backups`, montada só no `main`; 14 arquivos) e envia uma cópia ao Drive do titular `OWNER_TENANT_ID` (pasta própria, 14 arquivos). O resultado fica em `status.json`.
A senha do banco só existe em `PGPASSWORD` do processo filho (`pgConnection.ts`); erros passam por `redactConnectionError`. O mesmo job mede o uso (`pg_database_size` e soma de `storage.objects`)
e dispara alertas (`backup_failed`, `usage_high`) pelos canais de e-mail/WhatsApp. A tela é a aba "Banco e backups" em Segurança & SQL (`GET /api/ops/db-status`, `POST /api/ops/db-backup/run`, só `owner`/`admin`, checado em `authz.ts`).
Teste de restauração: `deploy/restore-test.sh` (decifra no contêiner, restaura num Postgres 17 descartável, compara contagens). A imagem instala o `postgresql-client-17` pelo repositório oficial do PostgreSQL
(o cliente 15 do Debian da imagem não copia um servidor 17). Caminho para um Supabase próprio: `docs/supabase-self-host.md`.

## Deploy
`push` em `dev`/`main` → GitHub Actions (tsc, testes, build) → tar por SSH ao usuário `deploy` do VPS →
`receive.sh` (build Docker, container em 127.0.0.1:3101 dev / 3102 main, healthcheck, rollback) →
nginx/CloudPanel com HTTPS. Variáveis em `/opt/financeiro-inteligente/env/*.env`.

## Dívidas conhecidas
- Navegação sem URL por tela (spec 002).
- Cores fixas em ~2.400 pontos, sem tokens de tema (fora do escopo da spec 005 desde 2026-11-27: temas foram retirados).
- Sem saldo inicial de conta (spec 003).
- Textos "Módulo N" na interface (spec 001).
- `npm start` aponta para `node server.ts`, que não funciona em produção.
- Bundle principal ~1,3 MB.
