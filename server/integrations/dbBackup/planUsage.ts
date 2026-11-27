import type { PgConnection } from './pgConnection.ts';
import type { PgRunner } from './pgRunner.ts';

/** Limites do plano Free do Supabase (padrão) e do aviso. */
export const DEFAULT_DB_LIMIT_MB = 500;
export const DEFAULT_STORAGE_LIMIT_MB = 1024;
export const WARN_PCT = 70;
export const CRITICAL_PCT = 90;

export type UsageLevel = 'ok' | 'warn' | 'critical';

export interface UsageReading {
  bytes: number;
  limitBytes: number;
  pct: number;
  level: UsageLevel;
}

export interface PlanUsage {
  db: UsageReading;
  storage: UsageReading;
  /** O pior dos dois níveis */
  level: UsageLevel;
}

/** Tamanho do banco e soma dos arquivos do Storage, numa só consulta de leitura. */
export const USAGE_SQL =
  "select pg_database_size(current_database()), coalesce((select sum((metadata->>'size')::bigint) from storage.objects), 0)";

/** Saída do `psql -A -t`: `14784179|0`. */
export function parseUsageOutput(out: string): { dbBytes: number; storageBytes: number } {
  const line = out.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  const [db, storage] = line.split('|');
  const dbBytes = Number(db);
  const storageBytes = Number(storage);
  if (!Number.isFinite(dbBytes) || !Number.isFinite(storageBytes) || dbBytes < 0 || storageBytes < 0) {
    throw new Error('Resposta inesperada ao medir o uso do plano.');
  }
  return { dbBytes, storageBytes };
}

export function planLimits(env: NodeJS.ProcessEnv = process.env): { dbBytes: number; storageBytes: number } {
  const mb = (raw: string | undefined, fallback: number) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    dbBytes: mb(env.PLAN_DB_LIMIT_MB, DEFAULT_DB_LIMIT_MB) * 1024 * 1024,
    storageBytes: mb(env.PLAN_STORAGE_LIMIT_MB, DEFAULT_STORAGE_LIMIT_MB) * 1024 * 1024,
  };
}

/** 70% ou mais = aviso; 90% ou mais = crítico. */
export function evaluateUsage(bytes: number, limitBytes: number): UsageReading {
  const pct = limitBytes > 0 ? Math.round((bytes / limitBytes) * 1000) / 10 : 0;
  const level: UsageLevel = pct >= CRITICAL_PCT ? 'critical' : pct >= WARN_PCT ? 'warn' : 'ok';
  return { bytes, limitBytes, pct, level };
}

const RANK: Record<UsageLevel, number> = { ok: 0, warn: 1, critical: 2 };

export async function readPlanUsage(runner: PgRunner, conn: PgConnection, env: NodeJS.ProcessEnv = process.env): Promise<PlanUsage> {
  const { dbBytes, storageBytes } = parseUsageOutput(await runner.query(conn, USAGE_SQL));
  const limits = planLimits(env);
  const db = evaluateUsage(dbBytes, limits.dbBytes);
  const storage = evaluateUsage(storageBytes, limits.storageBytes);
  return { db, storage, level: RANK[db.level] >= RANK[storage.level] ? db.level : storage.level };
}
