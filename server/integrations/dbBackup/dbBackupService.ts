import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { encryptBackupPayload } from '../../crypto/backupCrypto.ts';
import { saoPauloClock, todayInSaoPaulo } from '../alerts/dateUtils.ts';
import { parsePgUrl, redactConnectionError, type PgConnection } from './pgConnection.ts';
import type { PgRunner } from './pgRunner.ts';

/**
 * Backup diário do banco do Supabase (spec 006): `pg_dump` → cifra AES-256-GCM (mesmo formato do backup lógico)
 * → arquivo local com retenção → cópia opcional no Google Drive. O resultado de cada tentativa fica em `status.json`.
 */

export const DB_BACKUP_PREFIX = 'financeiro-db-';
export const DB_BACKUP_EXT = '.vtxdb';
export const DB_BACKUP_RETENTION = 14;
/** Acima disso o arquivo não vai ao Drive (memória do contêiner), mas o local é mantido e há alerta. */
export const DRIVE_MAX_BYTES = 150 * 1024 * 1024;
export const DB_BACKUP_DEFAULT_HOUR = 3;
const FILE_RE = /^financeiro-db-\d{8}-\d{6}\.vtxdb$/;
const STATUS_FILE = 'status.json';
const LOCK_FILE = '.lock';
const STALE_LOCK_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS_PER_DAY = 3;
const MIN_RETRY_GAP_MS = 30 * 60 * 1000;

/** Destino opcional no Google Drive (pasta própria, retenção própria). */
export interface DbBackupDrive {
  upload(fileName: string, content: Buffer, description: string): Promise<{ id: string }>;
  /** Remove os mais antigos além de `keep`, só arquivos com o nosso prefixo; devolve quantos removeu. */
  prune(keep: number): Promise<number>;
}

export interface DbBackupDeps {
  runner: PgRunner;
  backupsDir: string;
  env: NodeJS.ProcessEnv;
  now: () => Date;
  /** Chave do backup (BACKUP_ENCRYPTION_KEY); lança se ausente ou curta. */
  passphrase: () => string;
  drive?: DbBackupDrive | null;
  /** Chamado em falha do backup ou da cópia ao Drive; erros aqui nunca derrubam o backup. */
  onFailure?: (message: string, at: Date) => Promise<void>;
}

export interface LastRun {
  at: string;
  trigger: 'cron' | 'manual';
  status: 'success' | 'failed';
  fileName: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  driveUploaded: boolean;
  driveError?: string;
  error?: string;
}

export interface DbBackupStatus {
  lastRun: LastRun | null;
  lastSuccessAt: string | null;
  attempts: { date: string; count: number; lastAt: string } | null;
}

export class DbBackupBusyError extends Error {
  constructor() {
    super('Já existe um backup do banco em andamento.');
  }
}

let runningInMemory = false;

export const emptyStatus = (): DbBackupStatus => ({ lastRun: null, lastSuccessAt: null, attempts: null });

export async function readStatus(dir: string): Promise<DbBackupStatus> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(dir, STATUS_FILE), 'utf8')) as Partial<DbBackupStatus>;
    return { ...emptyStatus(), ...raw };
  } catch {
    return emptyStatus();
  }
}

async function writeStatus(dir: string, status: DbBackupStatus): Promise<void> {
  const tmp = path.join(dir, `${STATUS_FILE}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(status, null, 2), { mode: 0o600 });
  await fs.rename(tmp, path.join(dir, STATUS_FILE));
}

export function backupFileName(now: Date): string {
  const iso = now.toISOString(); // 2026-11-27T06:00:00.000Z
  const stamp = `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
  return `${DB_BACKUP_PREFIX}${stamp}${DB_BACKUP_EXT}`;
}

/** Arquivos de backup (só os nossos), do mais novo para o mais antigo. */
export async function listLocalBackups(dir: string): Promise<Array<{ name: string; sizeBytes: number }>> {
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const files = names.filter((n) => FILE_RE.test(n)).sort().reverse();
  const out: Array<{ name: string; sizeBytes: number }> = [];
  for (const name of files) {
    try {
      out.push({ name, sizeBytes: (await fs.stat(path.join(dir, name))).size });
    } catch {
      /* removido entre a listagem e o stat */
    }
  }
  return out;
}

/** Mantém os `keep` mais recentes; nunca toca em arquivos com outro nome. */
export async function applyLocalRetention(dir: string, keep: number = DB_BACKUP_RETENTION): Promise<number> {
  const files = await listLocalBackups(dir);
  let removed = 0;
  for (const f of files.slice(Math.max(1, keep))) {
    await fs.rm(path.join(dir, f.name), { force: true });
    removed += 1;
  }
  return removed;
}

/** Hora (0-23) configurada para o backup do banco. */
export function dbBackupHour(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DB_BACKUP_HOUR;
  if (raw === undefined || raw.trim() === '') return DB_BACKUP_DEFAULT_HOUR;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : DB_BACKUP_DEFAULT_HOUR;
}

/**
 * Já é hora de rodar hoje? Uma vez por dia, a partir da hora configurada (America/Sao_Paulo).
 * Sem sucesso no dia, tenta de novo (no máximo 3 vezes, com 30 min de intervalo), o que também cobre contêiner parado às 03:00.
 */
export function isDbBackupDue(status: DbBackupStatus, now: Date, hour: number): boolean {
  if (saoPauloClock(now).hour < hour) return false;
  const today = todayInSaoPaulo(now);
  if (status.lastSuccessAt && todayInSaoPaulo(new Date(status.lastSuccessAt)) === today) return false;
  const attempts = status.attempts;
  if (attempts && attempts.date === today) {
    if (attempts.count >= MAX_ATTEMPTS_PER_DAY) return false;
    if (now.getTime() - new Date(attempts.lastAt).getTime() < MIN_RETRY_GAP_MS) return false;
  }
  return true;
}

async function acquireLock(dir: string, now: Date): Promise<() => Promise<void>> {
  const lockPath = path.join(dir, LOCK_FILE);
  try {
    const handle = await fs.open(lockPath, 'wx');
    await handle.close();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    const stat = await fs.stat(lockPath).catch(() => null);
    if (stat && now.getTime() - stat.mtimeMs < STALE_LOCK_MS) throw new DbBackupBusyError();
    await fs.rm(lockPath, { force: true });
    const handle = await fs.open(lockPath, 'wx');
    await handle.close();
  }
  return async () => {
    await fs.rm(lockPath, { force: true });
  };
}

async function notifyFailure(deps: DbBackupDeps, message: string, at: Date): Promise<void> {
  try {
    await deps.onFailure?.(message, at);
  } catch {
    /* o alerta não pode derrubar o backup nem esconder o resultado */
  }
}

/** Executa um backup agora (agendado ou manual). Falhas viram `status: 'failed'` no `status.json`, nunca exceção; só a trava lança. */
export async function runDbBackup(deps: DbBackupDeps, trigger: 'cron' | 'manual'): Promise<LastRun> {
  if (runningInMemory) throw new DbBackupBusyError();
  runningInMemory = true;
  const startedAt = deps.now();
  let release: (() => Promise<void>) | null = null;
  let conn: PgConnection | null = null;
  let partial: string | null = null;
  try {
    try {
      await fs.mkdir(deps.backupsDir, { recursive: true });
      release = await acquireLock(deps.backupsDir, startedAt);
    } catch (err) {
      if (err instanceof DbBackupBusyError) throw err;
      // Pasta de backups inacessível (ex.: sem permissão): não há onde gravar nem o status; só alerta
      const message = `Não foi possível usar a pasta de backups: ${err instanceof Error ? err.message : 'erro desconhecido'}`.slice(0, 300);
      await notifyFailure(deps, `O backup do banco falhou: ${message}`, startedAt);
      return { at: startedAt.toISOString(), trigger, status: 'failed', fileName: null, sizeBytes: null, sha256: null, driveUploaded: false, error: message };
    }

    const status = await readStatus(deps.backupsDir);
    const today = todayInSaoPaulo(startedAt);
    status.attempts = {
      date: today,
      count: (status.attempts?.date === today ? status.attempts.count : 0) + 1,
      lastAt: startedAt.toISOString(),
    };

    const run: LastRun = { at: startedAt.toISOString(), trigger, status: 'failed', fileName: null, sizeBytes: null, sha256: null, driveUploaded: false };
    try {
      conn = parsePgUrl(deps.env.SUPABASE_DB_URL);
      const passphrase = deps.passphrase();
      await fs.access(deps.backupsDir, (await import('fs')).constants.W_OK);

      const fileName = backupFileName(startedAt);
      partial = path.join(deps.backupsDir, `.dump-${fileName}.partial`);
      await deps.runner.dump(conn, partial);
      const dump = await fs.readFile(partial);
      if (dump.length === 0) throw new Error('O pg_dump terminou sem gerar conteúdo.');

      const pkg = encryptBackupPayload(dump, passphrase, 'instance', startedAt);
      const sha256 = crypto.createHash('sha256').update(pkg).digest('hex');
      const finalPath = path.join(deps.backupsDir, fileName);
      await fs.writeFile(`${finalPath}.tmp`, pkg, { mode: 0o600 });
      await fs.rename(`${finalPath}.tmp`, finalPath);
      await fs.rm(partial, { force: true });
      partial = null;
      await applyLocalRetention(deps.backupsDir);

      run.status = 'success';
      run.fileName = fileName;
      run.sizeBytes = pkg.length;
      run.sha256 = sha256;
      status.lastSuccessAt = startedAt.toISOString();

      if (deps.drive) {
        if (pkg.length > DRIVE_MAX_BYTES) {
          run.driveError = 'Arquivo grande demais para o envio ao Drive (acima de 150 MB); a cópia local foi mantida.';
        } else {
          try {
            await deps.drive.upload(fileName, pkg, `Backup do banco AES-256-GCM · SHA-256 ${sha256}`);
            run.driveUploaded = true;
            await deps.drive.prune(DB_BACKUP_RETENTION).catch(() => 0);
          } catch (err) {
            run.driveError = redactConnectionError(err instanceof Error ? err.message : 'Falha ao enviar ao Drive.', conn).slice(0, 300);
          }
        }
      }
    } catch (err) {
      run.error = redactConnectionError(err instanceof Error ? err.message : 'Falha desconhecida no backup.', conn).slice(0, 400);
      if (partial) await fs.rm(partial, { force: true }).catch(() => undefined);
    }

    status.lastRun = run;
    await writeStatus(deps.backupsDir, status);
    if (run.status === 'failed') await notifyFailure(deps, `O backup do banco falhou: ${run.error ?? 'motivo desconhecido'}`, startedAt);
    else if (run.driveError) await notifyFailure(deps, `O backup do banco foi gerado, mas a cópia no Google Drive falhou: ${run.driveError}`, startedAt);
    return run;
  } finally {
    if (release) await release().catch(() => undefined);
    runningInMemory = false;
  }
}
