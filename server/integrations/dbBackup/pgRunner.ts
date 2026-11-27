import { execFile, type ExecFileException } from 'child_process';
import { parsePgUrl, pgArgsFor, pgEnvFor, redactConnectionError, type PgConnection } from './pgConnection.ts';

/**
 * Executa `pg_dump` e `psql` (spec 006). É uma interface para os testes trocarem por uma versão simulada,
 * sem Postgres. Toda mensagem de erro passa por `redactConnectionError`.
 */
export interface PgRunner {
  /** Grava o dump (formato custom, schemas public e auth) em `outFile`. */
  dump(conn: PgConnection, outFile: string): Promise<void>;
  /** Roda uma consulta somente de leitura e devolve a saída (`-At`, colunas separadas por `|`). */
  query(conn: PgConnection, sql: string): Promise<string>;
}

type ExecFn = (
  file: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number },
  callback: (error: ExecFileException | null, stdout: string, stderr: string) => void
) => unknown;

const DUMP_TIMEOUT_MS = 10 * 60 * 1000;
const QUERY_TIMEOUT_MS = 60 * 1000;
const MAX_BUFFER = 1024 * 1024;

function run(exec: ExecFn, file: string, args: string[], conn: PgConnection, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(file, args, { env: pgEnvFor(conn), timeout, maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
      if (error) {
        const notFound = (error as NodeJS.ErrnoException).code === 'ENOENT';
        const detail = notFound
          ? `${file} não encontrado no servidor (o cliente do PostgreSQL precisa estar na imagem).`
          : redactConnectionError(`${stderr || error.message}`.trim(), conn).slice(0, 400);
        reject(new Error(detail));
        return;
      }
      resolve(String(stdout));
    });
  });
}

export function createPgRunner(exec: ExecFn = execFile as unknown as ExecFn): PgRunner {
  return {
    dump(conn, outFile) {
      const args = [...pgArgsFor(conn), '--format=custom', '--no-owner', '--no-acl', '--schema=public', '--schema=auth', '--file', outFile];
      return run(exec, 'pg_dump', args, conn, DUMP_TIMEOUT_MS).then(() => undefined);
    },
    query(conn, sql) {
      return run(exec, 'psql', [...pgArgsFor(conn), '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], conn, QUERY_TIMEOUT_MS);
    },
  };
}

export { parsePgUrl };
