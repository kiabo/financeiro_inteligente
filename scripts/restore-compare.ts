/**
 * Apoio do teste de restauração (spec 006), roda dentro do contêiner:
 *   npx tsx scripts/restore-compare.ts sql                 → imprime o SQL de contagem (para rodar no Postgres temporário)
 *   <contagens restauradas> | npx tsx scripts/restore-compare.ts compare
 *                                                          → lê `tabela|n` do stdin, conta o banco real e compara
 * Código de saída 1 se alguma tabela divergir. A senha do banco nunca aparece na saída.
 */
import fs from 'fs';
import { parsePgUrl, redactConnectionError } from '../server/integrations/dbBackup/pgConnection.ts';
import { createPgRunner } from '../server/integrations/dbBackup/pgRunner.ts';
import { RESTORE_CHECK_TABLES, compareCounts, countsSql, parseCounts, restoreOk } from '../server/integrations/dbBackup/restoreCheck.ts';

const mode = process.argv[2];

if (mode === 'sql') {
  console.log(countsSql(RESTORE_CHECK_TABLES));
} else if (mode === 'compare') {
  try {
    const restored = parseCounts(fs.readFileSync(0, 'utf8'));
    const conn = parsePgUrl(process.env.SUPABASE_DB_URL);
    const live = parseCounts(await createPgRunner().query(conn, countsSql(RESTORE_CHECK_TABLES)));
    const rows = compareCounts(restored, live);
    const sign = { igual: '✔ igual', 'live-maior': '≈ banco real tem mais (dados novos desde o backup)', divergente: '✘ DIVERGENTE' } as const;
    console.log('tabela'.padEnd(26), 'restaurado'.padStart(11), 'banco real'.padStart(11), ' resultado');
    for (const r of rows) {
      console.log(r.table.padEnd(26), String(r.restored ?? '—').padStart(11), String(r.live ?? '—').padStart(11), ' ', sign[r.verdict]);
    }
    console.log(restoreOk(rows) ? '\nRESTAURAÇÃO OK: nenhuma tabela divergente.' : '\nFALHA: há tabela divergente.');
    process.exit(restoreOk(rows) ? 0 : 1);
  } catch (err) {
    console.error(redactConnectionError(err instanceof Error ? err.message : 'erro desconhecido'));
    process.exit(2);
  }
} else {
  console.error('Uso: restore-compare.ts sql | compare');
  process.exit(2);
}
