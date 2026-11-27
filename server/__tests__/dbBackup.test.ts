import crypto from 'crypto';
import { assert, assertEqual, assertRejects, runCases, type TestCase, type TestCaseResult } from '../../scripts/testHarness.ts';
import { parsePgUrl, pgArgsFor, pgEnvFor, redactConnectionError } from '../integrations/dbBackup/pgConnection.ts';
import { createPgRunner } from '../integrations/dbBackup/pgRunner.ts';
import { evaluateUsage, parseUsageOutput, planLimits, readPlanUsage } from '../integrations/dbBackup/planUsage.ts';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  DB_BACKUP_RETENTION,
  DbBackupBusyError,
  backupFileName,
  dbBackupHour,
  emptyStatus,
  isDbBackupDue,
  listLocalBackups,
  readStatus,
  runDbBackup,
  type DbBackupDeps,
} from '../integrations/dbBackup/dbBackupService.ts';
import { DB_BACKUP_DRIVE_FOLDER, createDbBackupDrive, type DriveApi } from '../integrations/dbBackup/dbBackupDrive.ts';
import { isAdminRole, requireAdminRole } from '../integrations/authz.ts';
import { HttpError } from '../authMiddleware.ts';
import {
  composeBackupFailedMessage,
  composeUsageMessage,
  createOwnerAlertSink,
  isoWeekKey,
  sendBackupFailedAlert,
  sendUsageAlert,
  type AlertSink,
} from '../integrations/dbBackup/dbBackupAlerts.ts';
import { decryptBackupBytes, decryptBackupPayload, encryptBackupPayload, readBackupHeader } from '../crypto/backupCrypto.ts';

const NOW = new Date('2026-11-27T06:00:00Z');
const PASS = 'senha-muito-longa-para-backup-1234';

const FAKE_PASSWORD = 'S3nh@-Fict1cia/9z';
const FAKE_URL = `postgresql://postgres.abcdefgh:${encodeURIComponent(FAKE_PASSWORD)}@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`;

const DUMP_MARKER = Buffer.from('LINHA-SECRETA-DO-DUMP-123');
const BACKUP_PASS = 'chave-de-backup-com-mais-de-24-chars';

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dbbackup-test-'));
}

function makeDeps(dir: string, over: Partial<DbBackupDeps> = {}, at = '2026-11-27T06:00:00Z'): DbBackupDeps & { dumped: number } {
  const state = { dumped: 0 };
  const deps: DbBackupDeps = {
    runner: {
      dump: async (_c, out) => {
        state.dumped += 1;
        await fs.writeFile(out, Buffer.concat([DUMP_MARKER, crypto.randomBytes(512)]));
      },
      query: async () => '',
    },
    backupsDir: dir,
    env: { SUPABASE_DB_URL: FAKE_URL } as NodeJS.ProcessEnv,
    now: () => new Date(at),
    passphrase: () => BACKUP_PASS,
    ...over,
  };
  return Object.assign(deps, { get dumped() { return state.dumped; } });
}

const cases: TestCase[] = [
  // ---------------------------------------------------------------- T03 · cifra de dump binário
  ['cifra do banco: bytes binários voltam idênticos e o conteúdo não fica em claro (CA3)', () => {
    const secretMarker = Buffer.from('CONTEUDO-CONHECIDO-DO-DUMP');
    const binary = Buffer.concat([Buffer.from([0, 1, 2, 255, 254, 128]), secretMarker, crypto.randomBytes(2048)]);
    const pkg = encryptBackupPayload(binary, PASS, 'instance', NOW);
    assert(pkg.indexOf(secretMarker) === -1, 'o conteúdo conhecido não pode aparecer no arquivo cifrado');
    const { data, header } = decryptBackupBytes(pkg, PASS);
    assert(data.equals(binary), 'os bytes têm que voltar idênticos');
    assertEqual(header.tenantRef, 'instance', 'referência no cabeçalho');
  }],
  ['cifra do banco: chave errada e adulteração são recusadas (CA3)', async () => {
    const pkg = encryptBackupPayload(Buffer.from('dump'), PASS, 'instance', NOW);
    await assertRejects(() => decryptBackupBytes(pkg, 'outra-senha-totalmente-diferente-99'), /chave incorreta|adulterado/, 'senha errada');
    const tampered = Buffer.from(pkg);
    tampered[tampered.length - 20] = (tampered[tampered.length - 20] ?? 0) ^ 0xff;
    await assertRejects(() => decryptBackupBytes(tampered, PASS), /chave incorreta|adulterado/, 'conteúdo adulterado');
  }],
  ['cifra do backup lógico continua igual: texto cifra, decifra e mantém o cabeçalho', () => {
    const json = JSON.stringify({ a: 'mundo', n: [1, 2, 3] });
    const pkg = encryptBackupPayload(json, PASS, 'ref', NOW);
    assertEqual(readBackupHeader(pkg).header.v, 1, 'versão do formato');
    assertEqual(decryptBackupPayload(pkg, PASS).json, json, 'roundtrip como texto');
  }],

  // ---------------------------------------------------------------- T04 · conexão e senha
  ['conexão: separa host, porta, usuário, banco e senha (inclusive com caracteres especiais)', () => {
    const c = parsePgUrl(FAKE_URL);
    assertEqual(c.host, 'aws-0-sa-east-1.pooler.supabase.com', 'host');
    assertEqual(c.port, '5432', 'porta');
    assertEqual(c.user, 'postgres.abcdefgh', 'usuário');
    assertEqual(c.database, 'postgres', 'banco');
    assertEqual(c.password, FAKE_PASSWORD, 'senha decodificada');
  }],
  ['conexão: a senha só vai no ambiente do processo filho, nunca nos argumentos (CA7)', () => {
    const c = parsePgUrl(FAKE_URL);
    const args = pgArgsFor(c).join(' ');
    assert(!args.includes(FAKE_PASSWORD) && !args.includes(encodeURIComponent(FAKE_PASSWORD)), 'senha nos argumentos');
    assert(!args.includes('postgresql://'), 'URL nos argumentos');
    const env = pgEnvFor(c, { PATH: '/usr/bin', HOME: '/home/node', SUPABASE_DB_URL: FAKE_URL, CREDENTIALS_ENCRYPTION_KEY: 'x' } as NodeJS.ProcessEnv);
    assertEqual(env.PGPASSWORD, FAKE_PASSWORD, 'PGPASSWORD');
    assert(!JSON.stringify(Object.keys(env)).includes('SUPABASE_DB_URL') && !('CREDENTIALS_ENCRYPTION_KEY' in env), 'o filho não herda os segredos do app');
  }],
  ['conexão: URL ausente, vazia ou inválida dá mensagem clara que não repete o valor recebido (CA7)', () => {
    for (const bad of [undefined, '', '   ', 'isto-nao-e-url', 'mysql://u:p@h/db', 'postgresql://sem-senha@host/db']) {
      try {
        parsePgUrl(bad);
        throw new Error(`deveria recusar ${String(bad)}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        assert(/SUPABASE_DB_URL/.test(msg), `mensagem clara para ${String(bad)}: ${msg}`);
        if (typeof bad === 'string' && bad.length > 6) assert(!msg.includes(bad), 'não pode repetir o valor recebido');
      }
    }
  }],
  ['conexão: mensagens de erro têm a senha e as URLs removidas (CA7)', () => {
    const c = parsePgUrl(FAKE_URL);
    const raw = `pg_dump: error: connection to server at "host" failed: password authentication failed for user "x" (${FAKE_PASSWORD}) ${FAKE_URL} e ${encodeURIComponent(FAKE_PASSWORD)}`;
    const clean = redactConnectionError(raw, c);
    assert(!clean.includes(FAKE_PASSWORD) && !clean.includes(encodeURIComponent(FAKE_PASSWORD)), 'senha presente');
    assert(!clean.includes('postgresql://'), 'URL presente');
    assert(/password authentication failed/.test(clean), 'o diagnóstico útil permanece');
  }],

  // ---------------------------------------------------------------- T05 · executor e medição de uso
  ['executor: pg_dump recebe os argumentos esperados e a senha só no ambiente (CA7)', async () => {
    const calls: Array<{ file: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
    const runner = createPgRunner(((file: string, args: string[], options: { env: NodeJS.ProcessEnv }, cb: (e: null, o: string, s: string) => void) => {
      calls.push({ file, args, env: options.env });
      cb(null, '', '');
    }) as never);
    await runner.dump(parsePgUrl(FAKE_URL), '/backups/x.partial');
    const call = calls[0]!;
    assertEqual(call.file, 'pg_dump', 'binário');
    for (const flag of ['--format=custom', '--no-owner', '--no-acl', '--schema=public', '--schema=auth', '--no-password']) {
      assert(call.args.includes(flag), `falta ${flag}`);
    }
    assert(call.args.includes('/backups/x.partial'), 'arquivo de saída');
    assert(!call.args.join(' ').includes(FAKE_PASSWORD), 'senha nos argumentos');
    assertEqual(call.env.PGPASSWORD, FAKE_PASSWORD, 'senha no ambiente');
  }],
  ['executor: erro do processo sai sem a senha nem a URL; binário ausente tem mensagem própria (CA7)', async () => {
    const failing = (stderr: string, code?: string) =>
      createPgRunner(((_f: string, _a: string[], _o: unknown, cb: (e: Error, o: string, s: string) => void) => {
        const err = Object.assign(new Error('falhou'), code ? { code } : {});
        cb(err, '', stderr);
      }) as never);
    const conn = parsePgUrl(FAKE_URL);
    const msg1 = await failing(`FATAL: password authentication failed (${FAKE_PASSWORD}) ${FAKE_URL}`).dump(conn, '/x').then(() => '', (e: Error) => e.message);
    assert(msg1.includes('password authentication failed'), 'diagnóstico preservado');
    assert(!msg1.includes(FAKE_PASSWORD) && !msg1.includes('postgresql://'), `vazou: ${msg1}`);
    const msg2 = await failing('', 'ENOENT').query(conn, 'select 1').then(() => '', (e: Error) => e.message);
    assert(/não encontrado/.test(msg2), `mensagem do binário ausente: ${msg2}`);
  }],
  ['uso: a saída do psql vira bytes e porcentagens do banco e do Storage (CA4)', async () => {
    assertEqual(JSON.stringify(parseUsageOutput('14784179|0\n')), JSON.stringify({ dbBytes: 14784179, storageBytes: 0 }), 'parse');
    const runner = { dump: async () => undefined, query: async () => `${250 * 1024 * 1024}|${512 * 1024 * 1024}\n` };
    const usage = await readPlanUsage(runner, parsePgUrl(FAKE_URL), {} as NodeJS.ProcessEnv);
    assertEqual(usage.db.pct, 50, 'banco 250 MB de 500 MB');
    assertEqual(usage.storage.pct, 50, 'Storage 512 MB de 1 GB');
    assertEqual(usage.level, 'ok', 'nível geral');
    for (const bad of ['', 'abc|def', '-1|0', '10']) {
      let failed = false;
      try { parseUsageOutput(bad); } catch { failed = true; }
      assert(failed, `deveria recusar "${bad}"`);
    }
  }],
  ['uso: 69% é normal, 70% avisa, 90% e 100% são críticos (CA4, CA5)', () => {
    const lim = 1000;
    assertEqual(evaluateUsage(690, lim).level, 'ok', '69%');
    assertEqual(evaluateUsage(700, lim).level, 'warn', '70%');
    assertEqual(evaluateUsage(899, lim).level, 'warn', '89,9%');
    assertEqual(evaluateUsage(900, lim).level, 'critical', '90%');
    assertEqual(evaluateUsage(1000, lim).level, 'critical', '100%');
    assertEqual(evaluateUsage(1500, lim).level, 'critical', 'acima do limite');
  }],
  ['uso: o nível geral é o pior dos dois e os limites vêm do ambiente (CA5)', async () => {
    const mb = 1024 * 1024;
    const runner = { dump: async () => undefined, query: async () => `${10 * mb}|${800 * mb}\n` };
    const usage = await readPlanUsage(runner, parsePgUrl(FAKE_URL), { PLAN_STORAGE_LIMIT_MB: '1000', PLAN_DB_LIMIT_MB: '500' } as NodeJS.ProcessEnv);
    assertEqual(usage.storage.level, 'warn', 'Storage a 80%');
    assertEqual(usage.db.level, 'ok', 'banco a 2%');
    assertEqual(usage.level, 'warn', 'geral');
    const lim = planLimits({ PLAN_DB_LIMIT_MB: 'lixo' } as NodeJS.ProcessEnv);
    assertEqual(lim.dbBytes, 500 * mb, 'valor inválido volta ao padrão');
    assertEqual(lim.storageBytes, 1024 * mb, 'padrão do Storage');
  }],

  // ---------------------------------------------------------------- T06 · backup local
  ['backup do banco: gera um arquivo cifrado que só decifra com a chave e não guarda o conteúdo em claro (CA3)', async () => {
    const dir = await tempDir();
    const run = await runDbBackup(makeDeps(dir), 'manual');
    assertEqual(run.status, 'success', `resultado: ${run.error ?? ''}`);
    const file = await fs.readFile(path.join(dir, run.fileName!));
    assert(file.indexOf(DUMP_MARKER) === -1, 'conteúdo em claro no arquivo');
    assert(decryptBackupBytes(file, BACKUP_PASS).data.indexOf(DUMP_MARKER) === 0, 'volta com a chave certa');
    await assertRejects(() => decryptBackupBytes(file, 'chave-errada-com-mais-de-24-caracteres'), /chave incorreta|adulterado/, 'chave errada');
    assertEqual((await fs.readdir(dir)).filter((n) => n.endsWith('.partial')).length, 0, 'sem arquivo parcial');
    assert(/^financeiro-db-20261127-060000\.vtxdb$/.test(run.fileName!), `nome do arquivo: ${run.fileName}`);
  }],
  ['backup do banco: um por dia; antes das 03:00 não roda; no dia seguinte roda de novo (CA1)', async () => {
    const dir = await tempDir();
    const hour = dbBackupHour({} as NodeJS.ProcessEnv);
    assertEqual(hour, 3, 'padrão 03:00');
    // 02:30 em São Paulo = 05:30Z; 03:05 = 06:05Z
    assert(!isDbBackupDue(emptyStatus(), new Date('2026-11-27T05:30:00Z'), hour), 'antes das 03:00 não roda');
    assert(isDbBackupDue(emptyStatus(), new Date('2026-11-27T06:05:00Z'), hour), 'às 03:05 roda');
    await runDbBackup(makeDeps(dir, {}, '2026-11-27T06:05:00Z'), 'cron');
    const status = await readStatus(dir);
    assert(!isDbBackupDue(status, new Date('2026-11-27T20:00:00Z'), hour), 'já teve sucesso hoje');
    assert(isDbBackupDue(status, new Date('2026-11-28T06:05:00Z'), hour), 'no dia seguinte roda');
    assertEqual(dbBackupHour({ DB_BACKUP_HOUR: '5' } as NodeJS.ProcessEnv), 5, 'hora configurável');
    assertEqual(dbBackupHour({ DB_BACKUP_HOUR: '99' } as NodeJS.ProcessEnv), 3, 'hora inválida volta ao padrão');
  }],
  ['backup do banco: contêiner parado às 03:00 recupera na primeira verificação do dia (CA1)', () => {
    assert(isDbBackupDue(emptyStatus(), new Date('2026-11-27T13:00:00Z'), 3), 'às 10:00 sem backup do dia roda');
  }],
  ['backup do banco: retenção mantém os 14 mais recentes e não toca em outros arquivos (CA1)', async () => {
    const dir = await tempDir();
    for (let d = 1; d <= 16; d++) {
      const day = String(d).padStart(2, '0');
      await fs.writeFile(path.join(dir, `financeiro-db-202611${day}-030000.vtxdb`), 'x');
    }
    await fs.writeFile(path.join(dir, 'notas-do-usuario.txt'), 'meu texto');
    await fs.writeFile(path.join(dir, 'financeiro-db-manual.vtxdb.bak'), 'nao mexer');
    const run = await runDbBackup(makeDeps(dir, {}, '2026-11-27T06:00:00Z'), 'cron');
    assertEqual(run.status, 'success', 'sucesso');
    const files = await listLocalBackups(dir);
    assertEqual(files.length, DB_BACKUP_RETENTION, 'sobram 14');
    assertEqual(files[0]!.name, backupFileName(new Date('2026-11-27T06:00:00Z')), 'o mais novo é o de hoje');
    assert(!files.some((f) => f.name.includes('20261101') || f.name.includes('20261103')), 'os mais antigos saíram');
    const all = await fs.readdir(dir);
    assert(all.includes('notas-do-usuario.txt') && all.includes('financeiro-db-manual.vtxdb.bak'), 'outros arquivos intactos');
  }],
  ['backup do banco: falha do pg_dump vira "failed", não deixa parcial, preserva o último sucesso e alerta sem a senha (CA6, CA7)', async () => {
    const dir = await tempDir();
    await runDbBackup(makeDeps(dir, {}, '2026-11-26T06:00:00Z'), 'cron');
    const before = (await readStatus(dir)).lastSuccessAt;
    const alerts: string[] = [];
    const deps = makeDeps(dir, {
      runner: {
        dump: async (_c, out) => {
          await fs.writeFile(out, 'meio');
          throw new Error(`pg_dump: FATAL password authentication failed ${FAKE_PASSWORD} ${FAKE_URL}`);
        },
        query: async () => '',
      },
      onFailure: async (m) => { alerts.push(m); },
    }, '2026-11-27T06:00:00Z');
    const run = await runDbBackup(deps, 'cron');
    assertEqual(run.status, 'failed', 'falhou');
    assertEqual(alerts.length, 1, 'um alerta');
    for (const text of [run.error ?? '', alerts[0] ?? '', JSON.stringify(await readStatus(dir))]) {
      assert(!text.includes(FAKE_PASSWORD) && !text.includes('postgresql://'), `segredo vazou: ${text.slice(0, 120)}`);
    }
    assertEqual((await fs.readdir(dir)).filter((n) => n.endsWith('.partial')).length, 0, 'sem parcial');
    assertEqual((await readStatus(dir)).lastSuccessAt, before, 'último sucesso preservado');
    assert(!(await listLocalBackups(dir)).some((f) => f.name.includes('20261127')), 'não criou arquivo do dia');
  }],
  ['backup do banco: dump vazio, URL ausente e chave ausente são falhas claras (CA6)', async () => {
    const dir = await tempDir();
    const empty = await runDbBackup(makeDeps(dir, { runner: { dump: async (_c, out) => fs.writeFile(out, ''), query: async () => '' } }), 'manual');
    assert(empty.status === 'failed' && /sem gerar conteúdo/.test(empty.error ?? ''), `dump vazio: ${empty.error}`);
    const noUrl = await runDbBackup(makeDeps(dir, { env: {} as NodeJS.ProcessEnv }), 'manual');
    assert(noUrl.status === 'failed' && /SUPABASE_DB_URL/.test(noUrl.error ?? ''), `sem URL: ${noUrl.error}`);
    const noKey = await runDbBackup(makeDeps(dir, { passphrase: () => { throw new Error('BACKUP_ENCRYPTION_KEY ausente ou curta demais'); } }), 'manual');
    assert(noKey.status === 'failed' && /BACKUP_ENCRYPTION_KEY/.test(noKey.error ?? ''), `sem chave: ${noKey.error}`);
  }],
  ['backup do banco: pasta inacessível gera alerta e resultado "failed" sem lançar (CA6)', async () => {
    const dir = await tempDir();
    const blocker = path.join(dir, 'arquivo-no-caminho');
    await fs.writeFile(blocker, 'x');
    const alerts: string[] = [];
    const run = await runDbBackup(makeDeps(path.join(blocker, 'backups'), { onFailure: async (m) => { alerts.push(m); } }), 'cron');
    assertEqual(run.status, 'failed', 'falhou');
    assert(/pasta de backups/.test(run.error ?? '') && alerts.length === 1, `erro: ${run.error}; alertas: ${alerts.length}`);
  }],
  ['backup do banco: duas execuções simultâneas — a segunda recebe "em andamento"; trava velha é descartada', async () => {
    const dir = await tempDir();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow = makeDeps(dir, { runner: { dump: async (_c, out) => { await gate; await fs.writeFile(out, 'dados'); }, query: async () => '' } });
    const first = runDbBackup(slow, 'cron');
    await new Promise((r) => setTimeout(r, 30));
    await assertRejects(() => runDbBackup(makeDeps(dir), 'manual'), /em andamento/, 'segunda execução');
    release();
    assertEqual((await first).status, 'success', 'a primeira termina bem');
    // trava deixada por um processo morto (mais de 30 min) não bloqueia para sempre
    await fs.writeFile(path.join(dir, '.lock'), '');
    const clock = new Date('2026-11-27T06:00:00Z');
    const old = new Date(clock.getTime() - 2 * 60 * 60 * 1000);
    await fs.utimes(path.join(dir, '.lock'), old, old);
    assertEqual((await runDbBackup(makeDeps(dir), 'manual')).status, 'success', 'trava velha descartada');
    // trava recente bloqueia
    await fs.writeFile(path.join(dir, '.lock'), '');
    await fs.utimes(path.join(dir, '.lock'), new Date(clock.getTime() - 60 * 1000), new Date(clock.getTime() - 60 * 1000));
    let busy = false;
    try { await runDbBackup(makeDeps(dir), 'manual'); } catch (e) { busy = e instanceof DbBackupBusyError; }
    assert(busy, 'trava recente bloqueia');
  }],
  ['backup do banco: depois de 3 falhas no dia para de tentar; entre tentativas espera 30 min (CA6)', async () => {
    const dir = await tempDir();
    const failing = (at: string) => makeDeps(dir, { runner: { dump: async () => { throw new Error('rede caiu'); }, query: async () => '' } }, at);
    await runDbBackup(failing('2026-11-27T06:00:00Z'), 'cron');
    assert(!isDbBackupDue(await readStatus(dir), new Date('2026-11-27T06:10:00Z'), 3), 'menos de 30 min depois');
    assert(isDbBackupDue(await readStatus(dir), new Date('2026-11-27T06:40:00Z'), 3), '30 min depois tenta de novo');
    await runDbBackup(failing('2026-11-27T06:40:00Z'), 'cron');
    await runDbBackup(failing('2026-11-27T07:20:00Z'), 'cron');
    assert(!isDbBackupDue(await readStatus(dir), new Date('2026-11-27T12:00:00Z'), 3), 'após 3 falhas não insiste no mesmo dia');
    assert(isDbBackupDue(await readStatus(dir), new Date('2026-11-28T06:00:00Z'), 3), 'no outro dia tenta');
  }],

  // ---------------------------------------------------------------- T07 · Drive
  ['Drive: envia à pasta própria e a retenção remove só o excedente com o nosso prefixo (CA8)', async () => {
    const calls = { folders: [] as string[], uploads: [] as string[], removed: [] as string[] };
    const existing = Array.from({ length: 16 }, (_, i) => ({
      id: `id${i}`, name: `financeiro-db-202611${String(i + 1).padStart(2, '0')}-030000.vtxdb`, createdTime: `2026-11-${String(i + 1).padStart(2, '0')}T06:00:00Z`,
    }));
    existing.push({ id: 'outro1', name: 'foto-de-ferias.jpg', createdTime: '2020-01-01T00:00:00Z' });
    existing.push({ id: 'outro2', name: 'financeiro-db-20261101-030000.vtxdb.bak', createdTime: '2020-01-02T00:00:00Z' });
    const api: DriveApi = {
      findOrCreateFolder: async (name) => { calls.folders.push(name); return 'pasta-db'; },
      upload: async (folderId, name) => { calls.uploads.push(`${folderId}:${name}`); return { id: 'novo' }; },
      list: async () => existing,
      remove: async (id) => { calls.removed.push(id); },
    };
    const dir = await tempDir();
    const run = await runDbBackup(makeDeps(dir, { drive: createDbBackupDrive(api) }), 'cron');
    assertEqual(run.status, 'success', 'sucesso');
    assertEqual(run.driveUploaded, true, 'enviado ao Drive');
    assertEqual(JSON.stringify(calls.folders), JSON.stringify([DB_BACKUP_DRIVE_FOLDER]), 'pasta própria, procurada uma vez');
    assertEqual(calls.uploads.length, 1, 'um envio');
    assert(calls.uploads[0]!.startsWith('pasta-db:financeiro-db-20261127-060000'), `envio: ${calls.uploads[0]}`);
    assertEqual(JSON.stringify(calls.removed.sort()), JSON.stringify(['id0', 'id1']), 'remove só os 2 mais antigos além dos 14');
  }],
  ['Drive: falha no envio mantém o backup local e gera alerta; não apaga nada no Drive (CA8)', async () => {
    const removed: string[] = [];
    const api: DriveApi = {
      findOrCreateFolder: async () => 'pasta',
      upload: async () => { throw new Error(`Google respondeu 500 ${FAKE_URL}`); },
      list: async () => [{ id: 'a', name: 'financeiro-db-20260101-030000.vtxdb', createdTime: '2026-01-01T00:00:00Z' }],
      remove: async (id) => { removed.push(id); },
    };
    const alerts: string[] = [];
    const dir = await tempDir();
    const run = await runDbBackup(makeDeps(dir, { drive: createDbBackupDrive(api), onFailure: async (m) => { alerts.push(m); } }), 'cron');
    assertEqual(run.status, 'success', 'o backup local é um sucesso');
    assertEqual(run.driveUploaded, false, 'não foi ao Drive');
    assert(/Drive/.test(run.driveError ?? '') || /Google/.test(run.driveError ?? ''), `erro do Drive: ${run.driveError}`);
    assert(!(run.driveError ?? '').includes('postgresql://'), 'URL removida');
    assertEqual(alerts.length, 1, 'um alerta');
    assertEqual(removed.length, 0, 'nada removido do Drive');
    assertEqual((await listLocalBackups(dir)).length, 1, 'cópia local mantida');
  }],
  ['Drive: sem Drive configurado o backup local segue sem erro (CA8)', async () => {
    const dir = await tempDir();
    const run = await runDbBackup(makeDeps(dir, { drive: null }), 'cron');
    assert(run.status === 'success' && !run.driveUploaded && !run.driveError, 'só local');
  }],

  // ---------------------------------------------------------------- T08 · autorização e alertas
  ['autorização: owner e admin passam; analyst, vazio e desconhecido recebem 403', async () => {
    assert(isAdminRole('owner') && isAdminRole('admin'), 'owner/admin');
    for (const role of ['analyst', '', null, undefined, 'OWNER', 'root']) assert(!isAdminRole(role), `não pode: ${String(role)}`);
    await requireAdminRole('u1', async () => 'owner');
    await requireAdminRole('u1', async () => 'admin');
    for (const role of ['analyst', null]) {
      let status = 0;
      try { await requireAdminRole('u1', async () => role); } catch (e) { status = e instanceof HttpError ? e.status : -1; }
      assertEqual(status, 403, `papel ${String(role)} recusado com 403`);
    }
  }],
  ['semana ISO: chave AAAA-Www correta nas viradas de semana e de ano', () => {
    assertEqual(isoWeekKey('2026-11-27'), '2026-W48', 'sexta 27/11/2026');
    assertEqual(isoWeekKey('2026-11-23'), '2026-W48', 'segunda da mesma semana');
    assertEqual(isoWeekKey('2026-11-29'), '2026-W48', 'domingo da mesma semana');
    assertEqual(isoWeekKey('2026-11-30'), '2026-W49', 'segunda seguinte');
    assertEqual(isoWeekKey('2026-01-01'), '2026-W01', '1º/1/2026');
    assertEqual(isoWeekKey('2027-01-01'), '2026-W53', '1º/1/2027 ainda é semana 53 de 2026');
    assertEqual(isoWeekKey('2024-12-30'), '2025-W01', '30/12/2024 já é semana 1 de 2025');
  }],
  ['alertas: falha de backup — uma chave por dia, mensagem sem segredo (CA6)', async () => {
    const sent: Array<{ kind: string; key: string; subject: string; text: string }> = [];
    const sink: AlertSink = async (kind, key, m) => { sent.push({ kind, key, subject: m.subject, text: m.text }); return [{ channel: 'email', status: 'sent' }]; };
    await sendBackupFailedAlert(sink, 'rede caiu', new Date('2026-11-27T06:00:00Z'));
    await sendBackupFailedAlert(sink, 'rede caiu', new Date('2026-11-27T20:00:00Z'));
    assertEqual(sent.length, 2, 'o sink recebe os dois pedidos (a deduplicação é do banco)');
    assertEqual(sent[0]!.key, sent[1]!.key, 'mesma chave no mesmo dia');
    assertEqual(sent[0]!.key, 'backup_failed:2026-11-27', 'chave do dia');
    assertEqual(sent[0]!.kind, 'backup_failed', 'tipo');
    await sendBackupFailedAlert(sink, 'rede caiu', new Date('2026-11-28T06:00:00Z'));
    assert(sent[2]!.key !== sent[0]!.key, 'outro dia, outra chave');
    assert(/backup do banco falhou/.test(sent[0]!.subject) && /rede caiu/.test(sent[0]!.text), 'assunto e motivo');
    assert(!sent[0]!.text.includes('postgresql://'), 'sem connection string');
    assertEqual(await sendBackupFailedAlert(null, 'x', new Date()), null, 'sem destinatário → null (alertas desligados)');
  }],
  ['alertas: uso — abaixo de 70% não envia; 70% avisa; chave semanal por nível; crítico avisa na hora (CA5)', async () => {
    const mk = (dbPct: number, stPct: number) => {
      const r = (pct: number, limit: number) => evaluateUsage(Math.round((pct / 100) * limit), limit);
      const db = r(dbPct, 500 * 1024 * 1024); const storage = r(stPct, 1024 * 1024 * 1024);
      const rank = { ok: 0, warn: 1, critical: 2 } as const;
      return { db, storage, level: rank[db.level] >= rank[storage.level] ? db.level : storage.level };
    };
    const keys: string[] = [];
    const sink: AlertSink = async (_k, key) => { keys.push(key); return [{ channel: 'email', status: 'sent' }]; };
    assertEqual(composeUsageMessage(mk(69, 10)), null, '69% não gera mensagem');
    assertEqual(JSON.stringify(await sendUsageAlert(sink, mk(69, 10), new Date('2026-11-27T10:00:00Z'))), '[]', 'nada enviado');
    assertEqual(keys.length, 0, 'sink não chamado');
    await sendUsageAlert(sink, mk(70, 10), new Date('2026-11-27T10:00:00Z'));
    await sendUsageAlert(sink, mk(72, 10), new Date('2026-11-28T10:00:00Z'));
    assertEqual(keys[0], keys[1], 'mesma semana e mesmo nível → mesma chave (não repete)');
    await sendUsageAlert(sink, mk(75, 10), new Date('2026-12-04T10:00:00Z'));
    assert(keys[2] !== keys[0], 'semana seguinte → lembrete novo');
    await sendUsageAlert(sink, mk(91, 10), new Date('2026-12-04T11:00:00Z'));
    assert(keys[3] !== keys[2] && /critical/.test(keys[3]!), 'subiu para crítico → aviso imediato');
    const msg = composeUsageMessage(mk(95, 40))!;
    assert(/Banco de dados: 475,0 MB de 500,0 MB \(95%\)/.test(msg.text) && /Armazenamento/.test(msg.text), `texto: ${msg.text}`);
  }],
  ['alertas: sem OWNER_TENANT_ID não há destinatário (alertas e Drive desligados)', async () => {
    assertEqual(await createOwnerAlertSink(undefined), null, 'sem tenant → null');
    assert(composeBackupFailedMessage('x', NOW, 'Meu App').subject.startsWith('Meu App ·'), 'nome da marca parametrizável');
  }],
];

export async function runDbBackupTests(): Promise<TestCaseResult[]> {
  return runCases(cases);
}
