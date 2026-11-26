import crypto from 'crypto';
import {
  decryptBackupPayload,
  encryptBackupPayload,
  isBackupKeyConfigured,
  resolveBackupPassphrase,
} from '../crypto/backupCrypto.ts';
import { sha256Hex } from '../crypto/secretBox.ts';
import { getSupabaseAdmin } from '../supabaseAdmin.ts';
import { selectTenantRows } from '../tenantData.ts';
import {
  deleteDriveFile,
  downloadDriveFile,
  ensureDriveFolder,
  getGoogleConnectionInfo,
  listDriveFolder,
  uploadDriveFile,
} from './google/googleClient.ts';

/**
 * Backup Blindado:
 *   exporta TODAS as tabelas do tenant (inclusive o Cofre de Anonimização) → JSON
 *   → gzip → AES-256-GCM (chave derivada de BACKUP_ENCRYPTION_KEY por scrypt, salt aleatório)
 *   → Google Drive (pasta própria, escopo drive.file) com retenção dos N mais recentes
 *   → backup_logs com SHA-256 do arquivo cifrado.
 * A restauração verificada baixa o arquivo, confere o SHA-256, decifra e valida a contagem de linhas.
 */

/** Ordem pensada para restauração (dependências antes dos dependentes). */
export const BACKUP_TABLES = [
  'business_groups',
  'companies',
  'financial_accounts',
  'vault_token_counters',
  'anonymization_vault',
  'categories',
  'products_services',
  'projects',
  'transactions',
  'project_forecast_items',
  'debts',
  'debt_installments',
  'tax_obligations',
  'ai_insights',
  'mcp_access_tokens',
  'mcp_call_logs',
  'integration_connections',
  'webhook_events',
  'bank_statement_imports',
  'reconciliation_items',
  'receipt_drafts',
  'notification_preferences',
  'notification_logs',
  'calendar_sync_items',
  'backup_logs',
  'audit_logs',
] as const;

export const BACKUP_FOLDER_NAME = 'Vértice Backups (cifrados)';
export const BACKUP_FILE_PREFIX = 'vertice-backup-';

export interface BackupDump {
  format: 'vertice-backup';
  version: 1;
  createdAt: string;
  tenantId: string;
  migrations: string[];
  tables: Record<string, { count: number; rows: Record<string, unknown>[] }>;
  userProfile: Record<string, unknown> | null;
}

export interface BackupRunResult {
  logId: string;
  status: 'success' | 'failed';
  destination: 'google_drive' | 'download';
  fileName: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  rowsCount: number;
  driveFileId: string | null;
  deletedOldBackups: number;
  error?: string;
  /** Presente apenas quando destination = download (sem Google conectado) */
  fileContent?: Buffer;
}

export function tenantRefFor(tenantId: string): string {
  return sha256Hex(`vertice-tenant:${tenantId}`).slice(0, 16);
}

export function buildBackupFileName(tenantId: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  return `${BACKUP_FILE_PREFIX}${stamp}-${tenantRefFor(tenantId).slice(0, 8)}.vtxbak`;
}

export async function exportTenantDump(tenantId: string, now: Date = new Date()): Promise<BackupDump> {
  const tables: BackupDump['tables'] = {};
  for (const table of BACKUP_TABLES) {
    const rows = await selectTenantRows(table, tenantId);
    tables[table] = { count: rows.length, rows };
  }
  const { data: profile } = await getSupabaseAdmin().from('user_profiles').select('*').eq('id', tenantId).maybeSingle();
  return {
    format: 'vertice-backup',
    version: 1,
    createdAt: now.toISOString(),
    tenantId,
    migrations: ['0001', '0002', '0003', '0004', '0005', '0006'],
    tables,
    userProfile: (profile as Record<string, unknown> | null) ?? null,
  };
}

export function countDumpRows(dump: BackupDump): number {
  return Object.values(dump.tables).reduce((sum, t) => sum + t.count, 0);
}

async function readPreferences(tenantId: string): Promise<{ backup_retention_count: number; drive_folder_id: string | null }> {
  const { data } = await getSupabaseAdmin()
    .from('notification_preferences')
    .select('backup_retention_count, drive_folder_id')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  const row = data as { backup_retention_count?: number; drive_folder_id?: string | null } | null;
  return { backup_retention_count: Number(row?.backup_retention_count ?? 30), drive_folder_id: row?.drive_folder_id ?? null };
}

async function saveDriveFolderId(tenantId: string, folderId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data } = await admin.from('notification_preferences').select('tenant_id').eq('tenant_id', tenantId).maybeSingle();
  if (data) {
    await admin.from('notification_preferences').update({ drive_folder_id: folderId }).eq('tenant_id', tenantId);
  } else {
    await admin.from('notification_preferences').insert({ tenant_id: tenantId, drive_folder_id: folderId });
  }
}

export async function runEncryptedBackup(params: {
  tenantId: string;
  trigger: 'cron' | 'manual';
  now?: Date;
}): Promise<BackupRunResult> {
  const now = params.now ?? new Date();
  const admin = getSupabaseAdmin();

  if (!isBackupKeyConfigured()) {
    throw new Error('BACKUP_ENCRYPTION_KEY não configurada no servidor. Nenhum backup é gerado sem criptografia.');
  }
  const google = await getGoogleConnectionInfo(params.tenantId);
  const destination: 'google_drive' | 'download' = google.connected ? 'google_drive' : 'download';
  if (destination === 'download' && params.trigger === 'cron') {
    throw new Error('Backup agendado exige Google Drive conectado.');
  }

  const { data: logRow, error: logErr } = await admin
    .from('backup_logs')
    .insert({ tenant_id: params.tenantId, trigger_source: params.trigger, destination, status: 'running', started_at: now.toISOString() })
    .select('id')
    .single();
  if (logErr || !logRow) throw new Error(`Falha ao abrir registro de backup: ${logErr?.message ?? ''}`);
  const logId = (logRow as { id: string }).id;

  try {
    const dump = await exportTenantDump(params.tenantId, now);
    const rowsCount = countDumpRows(dump);
    const pkg = encryptBackupPayload(JSON.stringify(dump), resolveBackupPassphrase(), tenantRefFor(params.tenantId), now);
    const fileHash = sha256Hex(pkg);
    const fileName = buildBackupFileName(params.tenantId, now);

    let driveFileId: string | null = null;
    let deletedOldBackups = 0;
    if (destination === 'google_drive') {
      const prefs = await readPreferences(params.tenantId);
      const folderId = await ensureDriveFolder(params.tenantId, prefs.drive_folder_id, BACKUP_FOLDER_NAME);
      if (folderId !== prefs.drive_folder_id) await saveDriveFolderId(params.tenantId, folderId);
      const uploaded = await uploadDriveFile(
        params.tenantId,
        folderId,
        fileName,
        pkg,
        `Backup Vértice AES-256-GCM · SHA-256 ${fileHash}`
      );
      driveFileId = uploaded.id;

      // Retenção: mantém os N backups mais recentes da pasta
      const files = (await listDriveFolder(params.tenantId, folderId))
        .filter((f) => f.name.startsWith(BACKUP_FILE_PREFIX))
        .sort((a, b) => (b.createdTime ?? '').localeCompare(a.createdTime ?? ''));
      const excess = files.slice(Math.max(1, prefs.backup_retention_count));
      for (const f of excess) {
        await deleteDriveFile(params.tenantId, f.id).catch(() => undefined);
        deletedOldBackups += 1;
      }
    }

    await admin
      .from('backup_logs')
      .update({
        status: 'success',
        file_name: fileName,
        drive_file_id: driveFileId,
        size_bytes: pkg.length,
        sha256: fileHash,
        tables_count: BACKUP_TABLES.length,
        rows_count: rowsCount,
        finished_at: new Date().toISOString(),
      })
      .eq('id', logId);
    await admin.from('audit_logs').insert({
      tenant_id: params.tenantId,
      actor_id: params.trigger === 'manual' ? params.tenantId : null,
      action: 'backup.completed',
      entity_type: 'backup',
      entity_id: logId,
      metadata: { destination, size_bytes: pkg.length, rows: rowsCount, sha256: fileHash },
    });

    return {
      logId,
      status: 'success',
      destination,
      fileName,
      sizeBytes: pkg.length,
      sha256: fileHash,
      rowsCount,
      driveFileId,
      deletedOldBackups,
      fileContent: destination === 'download' ? pkg : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha desconhecida no backup.';
    await admin
      .from('backup_logs')
      .update({ status: 'failed', error_message: message.slice(0, 500), finished_at: new Date().toISOString() })
      .eq('id', logId);
    await admin.from('audit_logs').insert({
      tenant_id: params.tenantId,
      actor_id: params.trigger === 'manual' ? params.tenantId : null,
      action: 'backup.failed',
      entity_type: 'backup',
      entity_id: logId,
      metadata: { destination, error: message.slice(0, 200) },
    });
    return {
      logId,
      status: 'failed',
      destination,
      fileName: null,
      sizeBytes: null,
      sha256: null,
      rowsCount: 0,
      driveFileId: null,
      deletedOldBackups: 0,
      error: message,
    };
  }
}

export interface BackupVerification {
  logId: string;
  fileName: string | null;
  sha256Matches: boolean;
  decrypted: boolean;
  rowsInFile: number;
  rowsExpected: number | null;
  tables: Array<{ table: string; count: number }>;
  createdAt: string | null;
}

/** Verifica um pacote já em memória (usado pelo endpoint e pelo script de restauração). */
export function verifyBackupPackage(pkg: Buffer, passphrase: string, expectedSha256?: string | null): {
  sha256: string;
  sha256Matches: boolean;
  dump: BackupDump;
} {
  const sha256 = sha256Hex(pkg);
  const { json } = decryptBackupPayload(pkg, passphrase);
  const dump = JSON.parse(json) as BackupDump;
  if (dump.format !== 'vertice-backup' || dump.version !== 1 || typeof dump.tables !== 'object') {
    throw new Error('Conteúdo decifrado não é um dump Vértice válido.');
  }
  for (const [name, t] of Object.entries(dump.tables)) {
    if (!Array.isArray(t.rows) || t.rows.length !== t.count) {
      throw new Error(`Tabela ${name} com contagem inconsistente no backup.`);
    }
  }
  return { sha256, sha256Matches: expectedSha256 ? expectedSha256 === sha256 : true, dump };
}

export async function verifyLatestDriveBackup(tenantId: string): Promise<BackupVerification> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('backup_logs')
    .select('id, file_name, drive_file_id, sha256, rows_count, started_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'success')
    .eq('destination', 'google_drive')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const log = data as { id: string; file_name: string | null; drive_file_id: string | null; sha256: string | null; rows_count: number | null } | null;
  if (!log?.drive_file_id) throw new Error('Nenhum backup no Google Drive para verificar.');

  const pkg = await downloadDriveFile(tenantId, log.drive_file_id);
  const result = verifyBackupPackage(pkg, resolveBackupPassphrase(), log.sha256);
  if (result.dump.tenantId !== tenantId) throw new Error('Backup pertence a outro tenant.');

  if (result.sha256Matches) {
    await admin.from('backup_logs').update({ verified_at: new Date().toISOString() }).eq('id', log.id);
  }
  const rowsInFile = countDumpRows(result.dump);
  return {
    logId: log.id,
    fileName: log.file_name,
    sha256Matches: result.sha256Matches,
    decrypted: true,
    rowsInFile,
    rowsExpected: log.rows_count,
    tables: Object.entries(result.dump.tables).map(([table, t]) => ({ table, count: t.count })),
    createdAt: result.dump.createdAt,
  };
}

/**
 * Gera um script SQL de restauração (para colar no SQL Editor do Supabase).
 * Usa jsonb_populate_recordset para converter tipos automaticamente e
 * session_replication_role = replica para não regenerar tokens analíticos nem disparar auditoria.
 * ON CONFLICT DO NOTHING: nunca sobrescreve dados existentes.
 */
export function buildRestoreSql(dump: BackupDump): string {
  const tag = `vtx_${crypto.randomBytes(6).toString('hex')}`;
  const lines: string[] = [
    '-- Restauração Vértice gerada por scripts/restore-backup.ts',
    `-- Backup de ${dump.createdAt} · tenant ${dump.tenantId}`,
    '-- Pré-requisito: o usuário (auth.users) com esse ID já existe no projeto e as migrações 0001..0006 foram aplicadas.',
    'BEGIN;',
    "SET LOCAL session_replication_role = 'replica';",
  ];
  if (dump.userProfile) {
    lines.push(
      `INSERT INTO public.user_profiles SELECT * FROM jsonb_populate_recordset(NULL::public.user_profiles, $${tag}$${JSON.stringify([dump.userProfile])}$${tag}$::jsonb) ON CONFLICT DO NOTHING;`
    );
  }
  for (const table of BACKUP_TABLES) {
    const t = dump.tables[table];
    if (!t || t.count === 0) continue;
    // Lotes de 500 linhas para não gerar statements gigantes
    for (let i = 0; i < t.rows.length; i += 500) {
      const chunk = JSON.stringify(t.rows.slice(i, i + 500));
      if (chunk.includes(`$${tag}$`)) throw new Error('Conflito improvável de delimitador SQL; gere novamente.');
      lines.push(
        `INSERT INTO public.${table} SELECT * FROM jsonb_populate_recordset(NULL::public.${table}, $${tag}$${chunk}$${tag}$::jsonb) ON CONFLICT DO NOTHING;`
      );
    }
  }
  lines.push('COMMIT;');
  return lines.join('\n') + '\n';
}
