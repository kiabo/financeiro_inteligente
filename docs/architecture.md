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
| `server/integrations/` | `webhookRoutes`, `webhooks/` (adaptadores Asaas, Mercado Pago, Stripe, JSON custom), `alerts/`, `google/`, `backupService`, `dailyJobs` |
| `server/crypto/secretBox.ts` | AES-256-GCM para credenciais e backups |
| `supabase/migrations/` | `0001`…`0006`, aplicadas manualmente |
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

## Rotinas diárias
`server/integrations/dailyJobs.ts`, a partir das 7h (America/Sao_Paulo), só com `ENABLE_INTERNAL_SCHEDULER=true`
(produção): alertas por e-mail (Resend) e WhatsApp (Evolution API), sincronização de agenda e backup cifrado no Drive.

## Deploy
`push` em `dev`/`main` → GitHub Actions (tsc, testes, build) → tar por SSH ao usuário `deploy` do VPS →
`receive.sh` (build Docker, container em 127.0.0.1:3101 dev / 3102 main, healthcheck, rollback) →
nginx/CloudPanel com HTTPS. Variáveis em `/opt/financeiro-inteligente/env/*.env`.

## Dívidas conhecidas
- Navegação sem URL por tela (spec 002).
- Cores fixas em ~2.400 pontos, sem tokens de tema (spec 005).
- Sem saldo inicial de conta (spec 003).
- Textos "Módulo N" na interface (spec 001).
- `npm start` aponta para `node server.ts`, que não funciona em produção.
- Bundle principal ~1,3 MB.
