/**
 * Decifra um backup do banco (.vtxdb) — spec 006.
 *
 * Uso (dentro do contêiner, que já tem BACKUP_ENCRYPTION_KEY):
 *   npx tsx scripts/decrypt-db-backup.ts < arquivo.vtxdb > banco.dump
 * Ou com caminhos: npx tsx scripts/decrypt-db-backup.ts arquivo.vtxdb banco.dump
 *
 * O resultado é um dump do `pg_dump --format=custom`, que se restaura com `pg_restore`.
 * Os avisos vão para o stderr; o stdout só recebe os bytes quando nenhum arquivo de saída é informado.
 */
import fs from 'fs';
import { decryptBackupBytes, resolveBackupPassphrase } from '../server/crypto/backupCrypto.ts';

const [input, output] = process.argv.slice(2);
const pkg = fs.readFileSync(input && input !== '-' ? input : 0);
const { header, data } = decryptBackupBytes(pkg, resolveBackupPassphrase());
console.error(`Backup de ${header.createdAt} decifrado (${(data.length / 1024).toFixed(1)} KiB de dump).`);
if (output && output !== '-') fs.writeFileSync(output, data, { mode: 0o600 });
else fs.writeFileSync(1, data);
