import { apiJson } from '../core/apiClient';

export type UsageLevel = 'ok' | 'warn' | 'critical';

export interface UsageReading {
  bytes: number;
  limitBytes: number;
  pct: number;
  level: UsageLevel;
}

export interface LastBackupRun {
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

export interface DbStatus {
  usage: { db: UsageReading; storage: UsageReading; level: UsageLevel } | null;
  usageError: string | null;
  lastBackup: LastBackupRun | null;
  lastSuccessAt: string | null;
  retained: number;
  newestFiles: Array<{ name: string; sizeBytes: number }>;
  nextRunHour: number;
  configured: { dbUrl: boolean; backupKey: boolean; drive: boolean; alerts: boolean };
}

export const fetchDbStatus = () => apiJson<DbStatus>('/api/ops/db-status');

export const runDbBackupNow = () => apiJson<{ lastBackup: LastBackupRun }>('/api/ops/db-backup/run', { method: 'POST' });
