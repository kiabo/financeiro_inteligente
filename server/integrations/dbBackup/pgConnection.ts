/**
 * Conexão com o banco do Supabase para `pg_dump` e `psql` (spec 006).
 * A connection string vem só de `SUPABASE_DB_URL` (env do servidor). A senha é separada da URL e
 * entregue ao processo filho exclusivamente por `PGPASSWORD`: nunca em argumento, log ou mensagem de erro.
 */

export interface PgConnection {
  host: string;
  port: string;
  user: string;
  database: string;
  password: string;
}

const REDACTED = '[oculto]';

/** Lê `postgresql://usuario:senha@host:porta/banco`. A mensagem de erro nunca inclui a URL recebida. */
export function parsePgUrl(raw: string | undefined | null): PgConnection {
  const fail = (): never => {
    throw new Error('SUPABASE_DB_URL ausente ou inválida. Use a connection string do banco (formato postgresql://usuário:senha@host:porta/banco).');
  };
  const value = (raw ?? '').trim();
  if (!value) return fail();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail();
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') return fail();
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres';
  if (!url.hostname || !user || !password) return fail();
  return { host: url.hostname, port: url.port || '5432', user, database, password };
}

/** Argumentos de conexão sem a senha (seguros para aparecer em lista de processos e em erros). */
export function pgArgsFor(conn: PgConnection): string[] {
  return ['--host', conn.host, '--port', conn.port, '--username', conn.user, '--dbname', conn.database, '--no-password'];
}

/** Ambiente do processo filho: a senha só existe aqui. */
export function pgEnvFor(conn: PgConnection, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: base.PATH,
    HOME: base.HOME,
    LANG: base.LANG,
    PGPASSWORD: conn.password,
    PGSSLMODE: 'require',
    PGCONNECT_TIMEOUT: '20',
  };
  return env;
}

/** Remove a senha e qualquer connection string de um texto (saída de erro do pg_dump/psql, por exemplo). */
export function redactConnectionError(text: string, conn?: PgConnection | null, extraSecrets: string[] = []): string {
  let out = text.replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, REDACTED);
  const secrets = [conn?.password, ...extraSecrets].filter((s): s is string => typeof s === 'string' && s.length >= 4);
  for (const secret of secrets) {
    out = out.split(secret).join(REDACTED);
    out = out.split(encodeURIComponent(secret)).join(REDACTED);
  }
  return out;
}
