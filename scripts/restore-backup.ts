/**
 * Restauração Verificada de backups Vértice (.vtxbak)
 *
 * Uso:
 *   npm run restore-backup -- <arquivo.vtxbak>                     # só verifica (decifra + valida)
 *   npm run restore-backup -- <arquivo.vtxbak> --json dump.json    # exporta o JSON decifrado
 *   npm run restore-backup -- <arquivo.vtxbak> --sql restore.sql   # gera SQL para o SQL Editor
 *   npm run restore-backup -- <arquivo.vtxbak> --sha256 <hash>     # confere o hash do backup_logs
 *
 * A chave é lida de BACKUP_ENCRYPTION_KEY (.env) ou digitada quando não houver.
 * Nada é gravado no banco por este script: o SQL gerado usa ON CONFLICT DO NOTHING
 * e deve ser revisado e executado manualmente no SQL Editor do Supabase.
 */
import 'dotenv/config';
import fs from 'fs';
import readline from 'readline';
import { readBackupHeader } from '../server/crypto/backupCrypto.ts';
import { buildRestoreSql, countDumpRows, verifyBackupPackage } from '../server/integrations/backupService.ts';

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function askPassphrase(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('BACKUP_ENCRYPTION_KEY: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main(): Promise<void> {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--') && !process.argv[process.argv.indexOf(a) - 1]?.startsWith('--'));
  if (!file || !fs.existsSync(file)) {
    console.error('Informe o caminho do arquivo .vtxbak. Ex.: npm run restore-backup -- ./vertice-backup-20261126-070000-ab12cd34.vtxbak');
    process.exit(2);
  }

  const pkg = fs.readFileSync(file);
  const { header } = readBackupHeader(pkg);
  console.log(`Arquivo: ${file} (${(pkg.length / 1024).toFixed(1)} KiB)`);
  console.log(`Criado em: ${header.createdAt} · KDF scrypt N=${header.N} · tenantRef ${header.tenantRef}`);

  const passphrase = process.env.BACKUP_ENCRYPTION_KEY?.trim() || (await askPassphrase());
  const expected = arg('--sha256');
  const started = Date.now();
  const { sha256, sha256Matches, dump } = verifyBackupPackage(pkg, passphrase, expected ?? null);

  console.log(`SHA-256: ${sha256}${expected ? (sha256Matches ? '  ✔ confere com o registro' : '  ✘ DIFERENTE do registro informado') : ''}`);
  console.log(`✔ Autenticação AES-256-GCM válida e dump íntegro (${Date.now() - started} ms)`);
  console.log(`Tenant: ${dump.tenantId} · ${countDumpRows(dump)} linhas em ${Object.keys(dump.tables).length} tabelas`);
  for (const [table, t] of Object.entries(dump.tables)) {
    if (t.count > 0) console.log(`  · ${table.padEnd(26)} ${String(t.count).padStart(6)}`);
  }

  const jsonOut = arg('--json');
  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify(dump, null, 2), { mode: 0o600 });
    console.log(`\nJSON decifrado gravado em ${jsonOut} (permissão 600). Apague-o após o uso: contém dados reais.`);
  }
  const sqlOut = arg('--sql');
  if (sqlOut) {
    fs.writeFileSync(sqlOut, buildRestoreSql(dump), { mode: 0o600 });
    console.log(`\nSQL de restauração gravado em ${sqlOut} (permissão 600).`);
    console.log('Revise e execute no SQL Editor do Supabase. Pré-requisitos: migrações 0001..0006 aplicadas e o usuário com o mesmo ID existente em auth.users.');
  }
  if (expected && !sha256Matches) process.exit(1);
}

main().catch((err) => {
  console.error(`✘ Falha na restauração: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
