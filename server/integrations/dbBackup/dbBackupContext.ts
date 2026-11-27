import { HttpError } from '../../authMiddleware.ts';
import { isBackupKeyConfigured, resolveBackupPassphrase } from '../../crypto/backupCrypto.ts';
import { isServerSupabaseConfigured } from '../../supabaseAdmin.ts';
import { getGoogleConnectionInfo } from '../google/googleClient.ts';
import { requireAdminRole, type RoleLoader } from '../authz.ts';
import { createOwnerAlertSink, sendBackupFailedAlert, sendUsageAlert, type AlertSink } from './dbBackupAlerts.ts';
import { createDbBackupDrive, googleDriveApi } from './dbBackupDrive.ts';
import {
  DbBackupBusyError,
  dbBackupHour,
  isDbBackupDue,
  listLocalBackups,
  readStatus,
  runDbBackup,
  type DbBackupDeps,
  type LastRun,
} from './dbBackupService.ts';
import { parsePgUrl, redactConnectionError } from './pgConnection.ts';
import { createPgRunner, type PgRunner } from './pgRunner.ts';
import { readPlanUsage, type PlanUsage } from './planUsage.ts';

/** Pasta dos backups dentro do contêiner (no VPS: /opt/financeiro-inteligente/backups, montada em /backups). */
export const DEFAULT_BACKUPS_DIR = '/backups';

export const dbBackupDir = (env: NodeJS.ProcessEnv = process.env) => env.DB_BACKUP_DIR?.trim() || DEFAULT_BACKUPS_DIR;

export interface DbBackupWiring {
  env: NodeJS.ProcessEnv;
  now: () => Date;
  runner: PgRunner;
  /** Destino de alertas; `null` = alertas desligados. */
  sink: AlertSink | null;
  /** Há Google Drive conectado para a cópia? */
  driveAvailable: () => Promise<boolean>;
  backupsDir: string;
}

export async function defaultWiring(env: NodeJS.ProcessEnv = process.env): Promise<DbBackupWiring> {
  const owner = env.OWNER_TENANT_ID?.trim() || undefined;
  return {
    env,
    now: () => new Date(),
    runner: createPgRunner(),
    sink: isServerSupabaseConfigured() ? await createOwnerAlertSink(owner) : null,
    driveAvailable: async () => {
      if (!owner || !isServerSupabaseConfigured()) return false;
      try {
        return (await getGoogleConnectionInfo(owner)).connected;
      } catch {
        return false;
      }
    },
    backupsDir: dbBackupDir(env),
  };
}

/** Dependências do serviço de backup a partir da fiação (Drive só se estiver conectado). */
export async function buildServiceDeps(w: DbBackupWiring): Promise<DbBackupDeps> {
  const owner = w.env.OWNER_TENANT_ID?.trim();
  const drive = owner && (await w.driveAvailable()) ? createDbBackupDrive(googleDriveApi(owner)) : null;
  return {
    runner: w.runner,
    backupsDir: w.backupsDir,
    env: w.env,
    now: w.now,
    passphrase: () => resolveBackupPassphrase(),
    drive,
    onFailure: async (message, at) => {
      await sendBackupFailedAlert(w.sink, message, at);
    },
  };
}

export interface DbStatusView {
  usage: PlanUsage | null;
  usageError: string | null;
  lastBackup: LastRun | null;
  lastSuccessAt: string | null;
  retained: number;
  newestFiles: Array<{ name: string; sizeBytes: number }>;
  nextRunHour: number;
  configured: { dbUrl: boolean; backupKey: boolean; drive: boolean; alerts: boolean };
}

/** Estado para a tela. Nada aqui carrega a connection string, a senha ou a chave. */
export async function getDbStatusView(w: DbBackupWiring): Promise<DbStatusView> {
  let conn: ReturnType<typeof parsePgUrl> | null = null;
  try {
    conn = parsePgUrl(w.env.SUPABASE_DB_URL);
  } catch {
    conn = null;
  }
  let usage: PlanUsage | null = null;
  let usageError: string | null = null;
  if (conn) {
    try {
      usage = await readPlanUsage(w.runner, conn, w.env);
    } catch (err) {
      usageError = redactConnectionError(err instanceof Error ? err.message : 'Não foi possível medir o uso.', conn).slice(0, 300);
    }
  }
  const status = await readStatus(w.backupsDir);
  const files = await listLocalBackups(w.backupsDir);
  return {
    usage,
    usageError,
    lastBackup: status.lastRun,
    lastSuccessAt: status.lastSuccessAt,
    retained: files.length,
    newestFiles: files.slice(0, 5),
    nextRunHour: dbBackupHour(w.env),
    configured: { dbUrl: conn !== null, backupKey: isBackupKeyConfigured(), drive: await w.driveAvailable(), alerts: w.sink !== null },
  };
}

/** Só `owner`/`admin`; usuários do modo de demonstração (servidor sem Supabase) passam, mas não há banco para medir. */
export async function assertCanManageDb(user: { id: string; sandbox: boolean }, loader?: RoleLoader): Promise<void> {
  if (user.sandbox) return;
  await requireAdminRole(user.id, loader);
}

export async function handleDbStatus(user: { id: string; sandbox: boolean }, w: DbBackupWiring, loader?: RoleLoader): Promise<DbStatusView> {
  await assertCanManageDb(user, loader);
  return getDbStatusView(w);
}

export async function handleDbBackupRun(user: { id: string; sandbox: boolean }, w: DbBackupWiring, loader?: RoleLoader): Promise<LastRun> {
  await assertCanManageDb(user, loader);
  try {
    parsePgUrl(w.env.SUPABASE_DB_URL);
  } catch (err) {
    throw new HttpError(503, err instanceof Error ? err.message : 'SUPABASE_DB_URL não configurada.');
  }
  try {
    return await runDbBackup(await buildServiceDeps(w), 'manual');
  } catch (err) {
    if (err instanceof DbBackupBusyError) throw new HttpError(409, err.message);
    throw err;
  }
}

/** Uma vez por dia, a partir da hora configurada: faz o backup e confere o uso do plano. */
export async function runDbBackupIfDue(w: DbBackupWiring): Promise<LastRun | null> {
  if ((w.env.SUPABASE_DB_URL ?? '').trim() === '') return null;
  const status = await readStatus(w.backupsDir);
  const now = w.now();
  if (!isDbBackupDue(status, now, dbBackupHour(w.env))) return null;
  let run: LastRun | null = null;
  try {
    run = await runDbBackup(await buildServiceDeps(w), 'cron');
  } catch (err) {
    if (!(err instanceof DbBackupBusyError)) throw err;
    return null;
  }
  try {
    const conn = parsePgUrl(w.env.SUPABASE_DB_URL);
    await sendUsageAlert(w.sink, await readPlanUsage(w.runner, conn, w.env), now);
  } catch {
    /* a medição aparece na tela; falha aqui não pode afetar o resultado do backup */
  }
  return run;
}

/** Agendador do backup do banco: só em produção (ENABLE_INTERNAL_SCHEDULER=true) e com SUPABASE_DB_URL definida. */
export function startDbBackupScheduler(env: NodeJS.ProcessEnv = process.env): void {
  if ((env.ENABLE_INTERNAL_SCHEDULER ?? '').toLowerCase() !== 'true') return;
  if ((env.SUPABASE_DB_URL ?? '').trim() === '') {
    console.log('[Backup do banco] SUPABASE_DB_URL não definida: backup diário do banco desligado.');
    return;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const run = await runDbBackupIfDue(await defaultWiring(env));
      if (run) console.log(`[Backup do banco] ${run.status === 'success' ? `ok (${run.fileName}${run.driveUploaded ? ', copiado ao Drive' : ''})` : `falhou: ${run.error ?? 'motivo desconhecido'}`}`);
    } catch (err) {
      console.error('[Backup do banco] Falha:', err instanceof Error ? redactConnectionError(err.message) : 'erro');
    } finally {
      running = false;
    }
  };
  setInterval(() => void tick(), 15 * 60 * 1000).unref();
  setTimeout(() => void tick(), 45_000).unref();
  console.log(`[Backup do banco] Agendador ativo: backup diário a partir das ${dbBackupHour(env)}h (America/Sao_Paulo).`);
}
