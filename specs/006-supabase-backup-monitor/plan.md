# Plan 006 — Supabase Free com backup e monitor de uso

- **Status:** rascunho
- **Spec:** `specs/006-supabase-backup-monitor/spec.md` (aprovado em 2026-11-27)
- **Criado em:** 2026-11-27
- **Aprovado em:** —

## Abordagem
O `pg_dump` roda **dentro do contêiner do app** (produção), no agendador interno que já existe, e não em um cron separado no VPS. Motivo: o contêiner já tem a chave de backup,
a conexão Google (para enviar ao Drive), os canais de alerta (e-mail/WhatsApp) e só ele conhece o `ENABLE_INTERNAL_SCHEDULER=true` da produção. Um cron no VPS teria que duplicar tudo isso.
Descartados: cron no VPS (duplica a lógica de Drive e alerta); Supabase CLI (mais uma dependência); backup só lógico (já existe, mas não reproduz o banco inteiro: auth, índices, políticas).

Peças:
1. **Imagem:** o `Dockerfile` instala `postgresql-client` (traz `pg_dump`, `pg_restore` e `psql`).
2. **Job do banco** (`server/integrations/dbBackup/`): às **03:00** (America/Sao_Paulo, `DB_BACKUP_HOUR`, padrão 3, **independente** do `DAILY_JOBS_HOUR` das rotinas de alerta, que continua às 7h):
   `pg_dump --format=custom --no-owner --no-acl --schema=public --schema=auth` → cifra com o mesmo `BACKUP_ENCRYPTION_KEY` (AES-256-GCM, mesmo formato `.vtxbak`, extensão `.vtxdb` para diferenciar)
   → grava em `/backups` (no VPS: `/opt/financeiro-inteligente/backups`) → mantém 14 arquivos → envia ao Drive em pasta própria ("Backups do banco (cifrados)", 14 arquivos) → registra o resultado.
   Roda uma vez por dia; se o contêiner estiver parado às 03:00, executa na primeira verificação seguinte (a cada 15 min), como as outras rotinas.
3. **Medição de uso:** `psql` com a mesma conexão: `pg_database_size(current_database())` e a soma de `storage.objects.metadata->>'size'`. Limites 500 MB e 1 GB (configuráveis por `PLAN_DB_LIMIT_MB` e `PLAN_STORAGE_LIMIT_MB`). Sem tabela nova nem função SQL nova.
4. **Alertas** pelos canais já existentes: backup falhou e uso ≥ 70% (e ≥ 90%). Usam o `dispatchNotification` com dois tipos novos (`backup_failed`, `usage_high`), o que exige **uma migration pequena** (a coluna `kind` de `notification_logs` tem um CHECK com a lista fechada de tipos).
5. **Tela:** nova aba **"Banco e backups"** em Segurança & SQL (só `owner`/`admin`): barras de uso do banco e do Storage, aviso a partir de 70%, último backup (data, tamanho, SHA-256, se foi ao Drive), botão "Fazer backup do banco agora".
6. **Teste de restauração:** `deploy/restore-test.sh` (roda no VPS): decifra o arquivo mais recente com `scripts/decrypt-db-backup.ts` (dentro do contêiner), sobe um Postgres descartável (`docker run --rm postgres:17`), restaura e **compara as contagens das tabelas principais** com as do banco real.
7. **Documento** `docs/supabase-self-host.md` (só descreve; não executa nada).

Quem recebe os alertas e o arquivo no Drive: o titular indicado em `OWNER_TENANT_ID` (UUID do usuário dono; é ele quem conectou o Google e configurou e-mail/WhatsApp). Sem essa variável o backup local continua, e a tela avisa que o Drive e os alertas estão desligados.

## Arquivos afetados
- `Dockerfile` — instalar `postgresql-client` na imagem final (`apt-get install --no-install-recommends`, limpar listas do apt).
- `deploy/receive.sh` — no `main`, montar `-v /opt/financeiro-inteligente/backups:/backups` (o `dev` não monta nada: não roda o agendador).
- `deploy/restore-test.sh` — **novo**.
- `server/integrations/dbBackup/pgConnection.ts` — **novo**: lê `SUPABASE_DB_URL`, separa host/porta/usuário/banco e senha; a **senha vai só em `PGPASSWORD` do processo filho**, nunca em argumento, log ou mensagem de erro (`redactConnectionError`).
- `server/integrations/dbBackup/pgRunner.ts` — **novo**: `execFile` de `pg_dump`/`psql` com timeout, limite de saída e injeção de dependência (para teste sem Postgres).
- `server/integrations/dbBackup/dbBackupService.ts` — **novo**: `runDbBackup({ now, deps })`, retenção local e no Drive, `status.json` (último resultado) em `/backups`.
- `server/integrations/dbBackup/planUsage.ts` — **novo**: `readPlanUsage`, `evaluateUsage(usage, limits) → { level: 'ok'|'warn'|'critical', pct }`.
- `server/integrations/dbBackup/dbBackupAlerts.ts` — **novo**: monta as mensagens e despacha (dedupe por dia/semana).
- `server/integrations/dbBackup/dbBackupRoutes.ts` — **novo**: `GET /api/ops/db-status`, `POST /api/ops/db-backup/run` (só `owner`/`admin`).
- `server/integrations/dailyJobs.ts` — `startInternalScheduler` também chama `runDbBackupIfDue()` (separado da rotina diária).
- `server/crypto/backupCrypto.ts` — `encryptBackupPayload` passa a aceitar `string | Buffer` (hoje só `string`); o formato do arquivo **não muda**.
- `server/integrations/google/googleClient.ts` — **reaproveitar** `uploadDriveFile`, `listDriveFolder`, `deleteDriveFile`; **acrescentar** `findDriveFolderByName` (hoje `ensureDriveFolder` sem id conhecido cria outra pasta a cada chamada; o `status.json` não pode ser a única memória da pasta).
- `server/integrations/alerts/notificationService.ts` — `NotificationKind` ganha `backup_failed` e `usage_high`; **reaproveitar** `dispatchNotification`, `getChannelStatus`.
- `server/integrations/authz.ts` — **novo**: `requireAdminRole(userId)` lê `user_profiles.role` com a service role (`owner`/`admin`); será reaproveitado pela spec 005.
- `server.ts` — monta `dbBackupRoutes`.
- `scripts/decrypt-db-backup.ts` — **novo**: decifra um `.vtxdb` para um arquivo, com a mesma chave.
- `src/modules/settings/SecurityAuditView.tsx` — aba nova; `src/modules/settings/PlanUsagePanel.tsx` — **novo**; `src/modules/integrations/integrationsApi.ts` (ou `opsApi.ts` novo) — chamadas.
- `.env.example` — `SUPABASE_DB_URL`, `OWNER_TENANT_ID`, `DB_BACKUP_HOUR`, `PLAN_DB_LIMIT_MB`, `PLAN_STORAGE_LIMIT_MB` (só nomes, sem valores).
- `docs/supabase-self-host.md` — **novo**; `docs/architecture.md` — seção "Backup do banco e uso do plano".
- Testes novos: `server/__tests__/dbBackup.test.ts`; registrar em `scripts/run-tests.ts`.

## Banco de dados
**Migration `0009_alertas_backup_uso.sql`** (aplicada **manualmente pelo usuário**, antes do código que dispara os novos alertas; segura se aplicada antes: só amplia uma lista):
```sql
ALTER TABLE public.notification_logs DROP CONSTRAINT IF EXISTS notification_logs_kind_check;
ALTER TABLE public.notification_logs ADD CONSTRAINT notification_logs_kind_check
  CHECK (kind IN ('due_today','overdue','weekly_summary','cfo_critical','test','backup_failed','usage_high'));
```
Sem tabela nova, sem RLS nova. (O nome `notification_logs_kind_check` é o que o Postgres gera para o CHECK embutido da `0006`; na tarefa T01 conferimos o nome real antes de escrever o arquivo, e o rollback recria a lista antiga.)
Acesso ao banco pelo app: **só** por `SUPABASE_DB_URL` no env do VPS (usuário com direito de leitura nas tabelas; o do painel do Supabase serve).

## Contratos (API / tipos)
- `GET /api/ops/db-status` (JWT aal2, só `owner`/`admin`) → `{ usage: { dbBytes, dbLimitBytes, dbPct, storageBytes, storageLimitBytes, storagePct, level }, lastBackup: { at, status, fileName, sizeBytes, sha256, driveUploaded, error? } | null, retained: number, configured: { dbUrl, backupKey, drive, alerts } }`.
- `POST /api/ops/db-backup/run` (mesma regra) → mesmo formato de `lastBackup`; `409` se já houver um backup em andamento.
- Nenhuma resposta traz a connection string, a senha ou a chave.
- `status.json` em `/backups`: `{ lastRun: {...}, lastSuccessAt }` (sem segredos).
- Tipos de alerta: `backup_failed` (dedupe `backup_failed:YYYY-MM-DD`), `usage_high` (dedupe `usage_high:{db|storage}:{warn|critical}:YYYY-Www`, no máximo um lembrete por semana por nível).

## Riscos e mitigação
| Risco | Mitigação |
|---|---|
| A conexão direta do Supabase é só IPv6 e o VPS pode não ter IPv6 | Usar a *connection string* do **pooler em modo sessão** (IPv4). Verificado antes de tudo na T01 (consulta real com `psql` a partir do contêiner) |
| `pg_dump` mais novo que o servidor é aceito; mais antigo que o servidor **falha** | A imagem instala o cliente 17 (versão atual do Debian da imagem); T01 confere `SHOW server_version`. Se o servidor for mais novo, fixar o cliente pela fonte oficial do PostgreSQL |
| Restaurar em Postgres comum falha por papéis/extensões do Supabase (`anon`, `authenticated`, `auth.uid()`) | O dump inclui o schema `auth`; o `restore-test.sh` cria os papéis vazios e as extensões antes; erros esperados e inofensivos são listados e não contam como falha, **a contagem das tabelas é o critério** (CA2) |
| Dump e envio ao Drive em memória estouram o limite de 768 MB do contêiner | Hoje o banco tem poucos MB; guarda de 150 MB: acima disso, não envia ao Drive, mantém o arquivo local e **alerta** |
| A senha do banco vazar (CA7) | Senha só em `PGPASSWORD` do processo filho; erros do `pg_dump` passam por `redactConnectionError`; teste injeta uma senha fictícia e confere que ela não aparece em nenhuma saída, log ou `status.json`; a imagem não recebe a variável (entra só por `--env-file`) |
| Backup cifrado sem a chave não restaura | Já é regra do projeto: o usuário guarda a `BACKUP_ENCRYPTION_KEY` fora do servidor; a tela lembra disso |
| Duas execuções simultâneas (agendador e botão) | Trava em memória + arquivo `/backups/.lock`; o botão recebe `409` |
| Retenção apagar arquivos que não são nossos | Remove só arquivos `financeiro-db-*.vtxdb`, no diretório e na pasta do Drive criada por nós |
| O agendador de dev disparar o backup também | Só roda com `ENABLE_INTERNAL_SCHEDULER=true` (produção) **e** `SUPABASE_DB_URL` definido; o dev não monta `/backups` |
| Arquivos antigos no VPS sem permissão para o usuário `node` (uid 1000) | O usuário cria a pasta uma vez (`mkdir` e `chown 1000:1000`); o job checa a escrita no início e alerta se falhar |
| Como o `deploy/receive.sh` do VPS é carregado (cópia instalada versus a do repositório) | Verificado na T01 por SSH; se for uma cópia instalada, a mudança é aplicada lá por mim, com a sua confirmação |

## Rollback
- Código: reverter o PR; sem `SUPABASE_DB_URL`/`OWNER_TENANT_ID` o job fica inerte.
- Migration: `ALTER TABLE ... DROP CONSTRAINT notification_logs_kind_check;` e recriar a lista antiga (`due_today`, `overdue`, `weekly_summary`, `cfo_critical`, `test`) — só depois de reverter o código e **apagar** linhas com os tipos novos, se existirem.
- Contêiner: voltar a imagem anterior (o `receive.sh` já faz rollback automático se o healthcheck falhar); a pasta `/backups` e a pasta do Drive ficam, são só arquivos.

## Estratégia de teste
Automatizados (`npm test`, suíte `dbBackup`, tudo com `pg_dump`/`psql` simulados por injeção):
- **CA1:** `runDbBackup` cria um arquivo por dia; execuções repetidas no mesmo dia não duplicam; com 16 arquivos de datas diferentes sobram os **14 mais recentes** e arquivos de nome diferente não são tocados.
- **CA3:** o arquivo gerado não contém o conteúdo claro (procura de trecho conhecido) e só decifra com a chave certa (reaproveita `decryptBackupPayload`).
- **CA4:** `readPlanUsage` converte a saída do `psql` em bytes/porcentagens corretas; `evaluateUsage` classifica 69%/70%/90%/100%.
- **CA5:** com uso simulado acima de 70%, o alerta é despachado uma vez por semana por nível e a resposta de `db-status` traz `level: 'warn'`.
- **CA6:** `pg_dump` simulado que falha ⇒ `status: 'failed'` no `status.json`, alerta `backup_failed` despachado, nenhum arquivo parcial deixado.
- **CA7:** senha fictícia na URL não aparece em argumentos do processo filho, mensagens de erro, `status.json` nem na resposta da API.
- **CA8:** com Drive simulado, o upload usa a pasta do banco, e a retenção do Drive remove só o excedente com o prefixo certo.
- Autorização: `analyst` recebe 403 nas duas rotas; sem `OWNER_TENANT_ID`, o status diz "alertas e Drive desligados".

Verificação manual no cfo (`/sdd-verify 006`), depois que o usuário puser `SUPABASE_DB_URL` e `OWNER_TENANT_ID` no env do `main`:
- CA4: comparar os números da aba com o painel do Supabase.
- CA1/CA2/CA3/CA8: clicar "Fazer backup do banco agora", ver o arquivo no VPS e no Drive, rodar `deploy/restore-test.sh` e conferir as contagens.
- CA1 (24 h): conferir no dia seguinte se o de 03:00 apareceu.
- CA5 (opcional): baixar `PLAN_DB_LIMIT_MB` no env por alguns minutos para ver o aviso e o alerta.
- CA6: só por teste automático (forçar falha real no cfo exigiria quebrar a conexão de produção; não vamos fazer isso).
