import crypto from 'crypto';
import { assert, assertEqual, assertRejects, runCases, type TestCase, type TestCaseResult } from '../../scripts/testHarness.ts';
import { parsePgUrl, pgArgsFor, pgEnvFor, redactConnectionError } from '../integrations/dbBackup/pgConnection.ts';
import { createPgRunner } from '../integrations/dbBackup/pgRunner.ts';
import { evaluateUsage, parseUsageOutput, planLimits, readPlanUsage } from '../integrations/dbBackup/planUsage.ts';
import { decryptBackupBytes, decryptBackupPayload, encryptBackupPayload, readBackupHeader } from '../crypto/backupCrypto.ts';

const NOW = new Date('2026-11-27T06:00:00Z');
const PASS = 'senha-muito-longa-para-backup-1234';

const FAKE_PASSWORD = 'S3nh@-Fict1cia/9z';
const FAKE_URL = `postgresql://postgres.abcdefgh:${encodeURIComponent(FAKE_PASSWORD)}@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`;

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
];

export async function runDbBackupTests(): Promise<TestCaseResult[]> {
  return runCases(cases);
}
