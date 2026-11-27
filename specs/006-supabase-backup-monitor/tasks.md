# Tasks 006 — Supabase Free com backup e monitor de uso

- **Status:** em-andamento
- **Plan:** `specs/006-supabase-backup-monitor/plan.md` (aprovado em 2026-11-27)
- **Branch:** `feat/006-supabase-backup-monitor` (saindo da `dev`)
- **Aprovado em:** 2026-11-27

Uma tarefa por vez, em ordem. Marque `[x]` ao concluir. Commit: `feat(006): descrição (T01)`.
Antes de cada commit: `npx tsc --noEmit && npm test` (e `npm run build` nas tarefas de tela).
Tarefas marcadas **(usuário)** dependem de uma ação sua; eu não as simulo.
Regras duras: a connection string e a senha do banco nunca são lidas, impressas nem commitadas; os testes usam valores fictícios e `pg_dump`/`psql` simulados.

## Preparação

- [x] T01 — **(usuário)** Verificar a conexão e o ambiente. Eu passo os comandos; você roda e me diz **só o resultado**:
  (a) `SHOW server_version` com a connection string do **pooler em modo sessão** (num contêiner `postgres:17` descartável, lendo a variável do seu env, sem me mostrar a senha);
  (b) `select conname from pg_constraint where conrelid = 'public.notification_logs'::regclass and contype = 'c'` (nome real do CHECK da coluna `kind`);
  (c) se a conta do `deploy` consegue usar `/opt/financeiro-inteligente/backups`.
  Eu confiro por SSH, só leitura, se o `receive.sh` do VPS é cópia instalada ou o do repositório.
  **Pronto quando:** tenho a versão do servidor, o nome do CHECK e a resposta sobre o `receive.sh`; se a versão for mais nova que o cliente 17 ou o pooler não responder, **paro** e atualizo o plan antes da T02. (CA2, CA7)

## Banco e alicerces

- [x] T02 — Escrever `supabase/migrations/0009_alertas_backup_uso.sql` (troca o CHECK de `notification_logs.kind` incluindo `backup_failed` e `usage_high`), idempotente, com rollback comentado e o aviso "aplicar antes do deploy".
  **Pronto quando:** o arquivo usa o nome real do CHECK (T01), pode rodar duas vezes sem erro e passa em leitura linha a linha contra a `0006`. (CA5, CA6)

- [x] T03 — `server/crypto/backupCrypto.ts`: `encryptBackupPayload` aceita `string | Buffer`; teste escrito **antes** (um Buffer binário volta idêntico ao decifrar; o formato do cabeçalho não muda; os testes de backup antigos continuam verdes).
  **Pronto quando:** `npm test` passa com o teste novo e sem alterar os antigos. (CA3)

- [x] T04 — `server/integrations/dbBackup/pgConnection.ts`: separar a URL em host, porta, usuário, banco e senha (senha só em `PGPASSWORD` do processo filho) e `redactConnectionError`; testes **antes**.
  **Pronto quando:** com uma senha fictícia, nenhum argumento, mensagem de erro, saída de log nem objeto serializado contém a senha; URL inválida ou ausente dá mensagem clara em pt-BR. (CA7)

- [x] T05 — `server/integrations/dbBackup/pgRunner.ts` (`execFile` de `pg_dump` e `psql` com timeout, limite de saída e dependência injetável) e `planUsage.ts` (`readPlanUsage`, `evaluateUsage`, limites por `PLAN_DB_LIMIT_MB`/`PLAN_STORAGE_LIMIT_MB`, padrão 500 MB e 1 GB); testes **antes**.
  **Pronto quando:** a saída simulada do `psql` vira bytes e porcentagens corretos, e 69%, 70%, 90% e 100% caem em `ok`, `warn`, `critical`, `critical`. (CA4, CA5)

## Backup

- [x] T06 — `server/integrations/dbBackup/dbBackupService.ts`: `pg_dump` → cifrar → gravar em `/backups` como `financeiro-db-AAAAMMDD-HHMMSS.vtxdb` → retenção de 14 → `status.json` → trava (memória e `.lock`) → guarda de 150 MB para o Drive.
  Testes **antes**, com `pg_dump` simulado: um arquivo por dia sem duplicar, 16 datas sobram 14, arquivos de outro nome não são tocados, conteúdo claro não aparece no arquivo e só decifra com a chave certa, falha deixa `status: failed` e nenhum arquivo parcial.
  **Pronto quando:** todos esses testes passam. (CA1, CA3, CA6)

- [x] T07 — Drive: `findDriveFolderByName` em `google/googleClient.ts` e, no serviço, envio à pasta "Backups do banco (cifrados)" com retenção de 14 só dos arquivos `financeiro-db-*.vtxdb`; testes com Drive simulado (usa a pasta certa, remove só o excedente, falha do Drive não apaga o backup local e gera alerta).
  **Pronto quando:** os testes passam. (CA8)

- [x] T08 — Autorização e alertas: `server/integrations/authz.ts` (`requireAdminRole`: `owner` e `admin`), `NotificationKind` com `backup_failed` e `usage_high`, mensagens e dedupe (`backup_failed:AAAA-MM-DD`, `usage_high:{db|storage}:{warn|critical}:AAAA-Www`) em `dbBackupAlerts.ts`; testes **antes**.
  **Pronto quando:** falha de backup despacha um alerta por dia, uso acima de 70% um por semana e por nível, `analyst` é recusado em `requireAdminRole`, e sem `OWNER_TENANT_ID` o resultado diz "alertas e Drive desligados". (CA5, CA6)

- [x] T09 — Rotas e agendador: `dbBackupRoutes.ts` (`GET /api/ops/db-status`, `POST /api/ops/db-backup/run`, só `owner`/`admin`, `409` se já houver backup rodando) montadas em `server.ts`; `startInternalScheduler` também chama `runDbBackupIfDue()` (hora `DB_BACKUP_HOUR`, padrão 3; só com `ENABLE_INTERNAL_SCHEDULER=true` **e** `SUPABASE_DB_URL`; executa uma vez por dia e recupera se o contêiner estava parado às 03:00).
  **Pronto quando:** testes cobrem 403 para `analyst`, 409 em execução dupla, "já rodou hoje" não repete e nenhuma resposta traz a URL, a senha ou a chave. (CA1, CA4, CA7)

## Infraestrutura e documentos

- [x] T10 — `Dockerfile` (`postgresql-client`, listas do apt limpas), `deploy/receive.sh` (montagem `/backups` só no `main`), `.env.example` (nomes `SUPABASE_DB_URL`, `OWNER_TENANT_ID`, `DB_BACKUP_HOUR`, `PLAN_DB_LIMIT_MB`, `PLAN_STORAGE_LIMIT_MB`, sem valores), `scripts/decrypt-db-backup.ts` e `deploy/restore-test.sh` (decifra, sobe Postgres descartável, cria papéis e extensões, restaura, compara contagens das tabelas principais com o banco real).
  **Pronto quando:** `docker build` da imagem termina no VPS e `pg_dump --version` e `psql --version` respondem dentro dela (sem expor variáveis); `bash -n` passa nos scripts. (CA2, CA7)

- [ ] T11 — Tela: `PlanUsagePanel.tsx` e aba **"Banco e backups"** em `SecurityAuditView.tsx` (só `owner`/`admin`): barras do banco e do Storage com aviso a partir de 70%, último backup (data, tamanho, SHA-256, enviado ao Drive), botão "Fazer backup do banco agora" com confirmação de resultado, aviso de que a `BACKUP_ENCRYPTION_KEY` precisa ficar guardada fora do servidor, e estado "não configurado" claro quando faltam variáveis.
  **Pronto quando:** `npm run build` passa e, em modo sandbox, a aba mostra o estado "não configurado" sem erro. (CA4, CA5)

- [ ] T12 — `docs/supabase-self-host.md` (recursos, passos, riscos; sem executar nada) e seção "Backup do banco e uso do plano" em `docs/architecture.md`; spec 006 `em-andamento` em `specs/README.md`.
  **Pronto quando:** os documentos existem e a lista de variáveis bate com o `.env.example`. (—)

## Publicação e verificação

- [ ] T13 — **(usuário)** Aplicar `0009_alertas_backup_uso.sql` no SQL Editor do Supabase; criar `/opt/financeiro-inteligente/backups` com dono `1000:1000`; colocar `SUPABASE_DB_URL` e `OWNER_TENANT_ID` no `/opt/financeiro-inteligente/env/main.env` (e `DB_BACKUP_HOUR=3` se quiser explícito).
  **Pronto quando:** você confirma os três passos. (CA1, CA5, CA6, CA7, CA8)

- [ ] T14 — Publicar: `npx tsc --noEmit && npm test && npm run build` verdes, PR para `dev`, merge, promoção `dev` → `main` e deploy acompanhado (o primeiro build baixa o cliente do PostgreSQL; pode demorar mais).
  **Pronto quando:** o deploy da `main` termina com sucesso e o cfo responde 200 com a aba nova visível. (todos)

- [ ] T15 — Verificação final no **cfo** contra todos os critérios (`/sdd-verify 006`): números da aba × painel do Supabase (CA4); "Fazer backup do banco agora" cria arquivo no VPS e no Drive (CA1, CA8); arquivo cifrado ilegível (CA3); `deploy/restore-test.sh` com contagens iguais (CA2); senha ausente de logs e da imagem (CA7);
  no dia seguinte, o arquivo das 03:00 existe (CA1); aviso e alerta de uso com `PLAN_DB_LIMIT_MB` baixo por alguns minutos, se você topar (CA5). CA6 (falha forçada) fica só por teste automático, dito no registro.
  **Pronto quando:** o "Registro de verificação" tem cada CA com resultado, evidência e data; spec, plan e tasks `concluído`. (CA1–CA8)

## Notas de execução
- **T09 (desvio do plano):** o agendador do backup do banco ficou num arquivo próprio (`startDbBackupScheduler` em `dbBackupContext.ts`, chamado em `server.ts` ao lado do `startInternalScheduler`) em vez de dentro do `dailyJobs.ts`. Evita dependência circular (`dailyJobs` ↔ alertas) e mantém o horário das 03:00 separado das rotinas das 07:00. O comportamento planejado é o mesmo.
- **T10 (descoberta, plano ajustado):** o `node:24-slim` é Debian 12, cujo `postgresql-client` é o 15, que **não** copia um servidor 17. O Dockerfile instala o `postgresql-client-17` pelo repositório oficial do PostgreSQL (PGDG), com `curl`/`gnupg` só durante a instalação. Validado construindo a imagem completa no VPS (cliente 17.12, sem `curl`/`gpg` no fim, `/backups` inexistente de propósito: sem a pasta montada o backup falha alto em vez de gravar numa camada que some no próximo deploy). A pasta só é montada se existir no VPS.
- **T10:** o teste de restauração ficou em `deploy/restore-test.sh` + `scripts/decrypt-db-backup.ts` + `scripts/restore-compare.ts`; a lógica de comparação é testada em `npm test`, e a execução real fica para a T15 (precisa de um backup de verdade).
- **T09:** a conferência do uso do plano (e o alerta de 70%/90%) roda uma vez por dia junto com o backup agendado.
- **T01 (feita por mim, em modo leitura, a seu pedido, com o Supabase e o VPS já acessíveis):** Postgres do Supabase **17.12** (cliente 17 compatível); nome do CHECK = `notification_logs_kind_check`; banco com 14,8 MB e Storage com 0 byte; o VPS **tem IPv6** (então a conexão direta funciona, e o pooler também serve); a pasta `/opt/financeiro-inteligente/backups` **não existe** (o usuário do contêiner é o `node`, uid 1000, que no VPS é o `ubuntu`); o `receive.sh` **instalado** (`/opt/financeiro-inteligente/bin/receive.sh`, dono root, comando forçado da chave de deploy) é **igual ao do repositório, mas não é atualizado pelo deploy**.
  A senha do banco não foi lida; o teste real de conexão com o `psql` fica para a T14/T15, depois que `SUPABASE_DB_URL` estiver no env.
- **Mudança na T10:** atualizar o `receive.sh` do repositório **e** a cópia instalada no VPS (como root, com a sua confirmação antes), e criar `/opt/financeiro-inteligente/backups` com dono `1000:1000`. Isso vira passo explícito na T13.
