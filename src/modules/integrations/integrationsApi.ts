import { apiFetch, apiJson } from '../core/apiClient';
import { createTransactionsBatch, markTransactionPaid } from '../core/repository';
import { getSupabaseClient, isSupabaseConfigured } from '../core/supabase';
import type { Transaction } from '../core/types';
import type { LineMatchResult, ParsedStatement } from './reconciliationEngine';
import type {
  AutomationStatus,
  BackupLogRow,
  BankStatementImport,
  HistoryImportRun,
  EditablePreferences,
  IntegrationConnection,
  IntegrationConnectionConfig,
  IntegrationProvider,
  NotificationLogRow,
  NotificationPreferencesRow,
  OcrClassification,
  ReceiptDraft,
  ReconciliationItem,
  WebhookEventRow,
} from './types';

function requireSupabase() {
  if (!isSupabaseConfigured) {
    throw new Error('Este recurso exige o Supabase configurado (o modo sandbox não o suporta).');
  }
  const client = getSupabaseClient();
  if (!client) throw new Error('Cliente Supabase indisponível.');
  return client;
}

const num = (v: unknown) => Number(v ?? 0);

// ============================================================================
// Integrações & Webhooks (servidor — segredos nunca passam pelo navegador depois de salvos)
// ============================================================================
export async function fetchConnections(): Promise<{ connections: IntegrationConnection[]; baseUrl: string }> {
  return apiJson('/api/integrations/connections');
}

export async function createConnection(input: {
  provider: IntegrationProvider;
  label: string;
  company_id: string;
  account_id: string;
  signing_secret: string;
  api_access_token?: string;
  config: IntegrationConnectionConfig;
}): Promise<IntegrationConnection> {
  const res = await apiJson<{ connection: IntegrationConnection }>('/api/integrations/connections', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.connection;
}

export async function updateConnection(
  id: string,
  patch: Partial<{
    label: string;
    status: 'active' | 'paused';
    account_id: string;
    config: IntegrationConnectionConfig;
    signing_secret: string;
    api_access_token: string;
    rotate_url: boolean;
  }>
): Promise<IntegrationConnection> {
  const res = await apiJson<{ connection: IntegrationConnection }>(`/api/integrations/connections/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return res.connection;
}

export async function deleteConnection(id: string): Promise<void> {
  await apiJson(`/api/integrations/connections/${id}`, { method: 'DELETE' });
}

export async function fetchWebhookEvents(connectionId?: string, source?: 'api' | 'webhook'): Promise<WebhookEventRow[]> {
  const params = new URLSearchParams({ limit: '100' });
  if (connectionId) params.set('connection_id', connectionId);
  if (source) params.set('source', source);
  const qs = `?${params.toString()}`;
  const res = await apiJson<{ events: WebhookEventRow[] }>(`/api/integrations/events${qs}`);
  return res.events;
}

export async function reprocessEvent(eventId: string): Promise<{ ok: boolean; transactions: number; error?: string }> {
  return apiJson(`/api/integrations/events/${eventId}/reprocess`, { method: 'POST', body: '{}' });
}

// ----------------------------------------------------------------------------
// Importação de histórico por API (a chave fica cifrada no servidor e nunca volta)
// ----------------------------------------------------------------------------
export async function startHistoryImport(
  connectionId: string,
  input: { period_start: string; period_end: string; account_id: string }
): Promise<HistoryImportRun> {
  const res = await apiJson<{ run: HistoryImportRun }>(`/api/integrations/connections/${connectionId}/history/start`, {
    method: 'POST',
    body: JSON.stringify({ period_start: input.period_start, period_end: input.period_end, account_id: input.account_id }),
  });
  return res.run;
}

/** Processa um lote (uma página) e devolve o progresso; numa execução "failed" funciona como "Retomar". */
export async function stepHistoryImport(runId: string): Promise<HistoryImportRun> {
  const res = await apiJson<{ run: HistoryImportRun; done: boolean }>(`/api/integrations/history/${runId}/step`, {
    method: 'POST',
    body: '{}',
  });
  return res.run;
}

export async function cancelHistoryImport(runId: string): Promise<HistoryImportRun> {
  const res = await apiJson<{ run: HistoryImportRun }>(`/api/integrations/history/${runId}/cancel`, { method: 'POST', body: '{}' });
  return res.run;
}

/** Execução mais recente da conexão (ou null), para oferecer "Retomar". */
export async function fetchLatestHistoryImport(connectionId: string): Promise<HistoryImportRun | null> {
  const res = await apiJson<{ run: HistoryImportRun | null }>(`/api/integrations/connections/${connectionId}/history/latest`);
  return res.run;
}

export async function sendTestEvent(connectionId: string): Promise<Record<string, unknown>> {
  return apiJson(`/api/integrations/connections/${connectionId}/test`, { method: 'POST', body: '{}' });
}

// ============================================================================
// Conciliação bancária (RLS direto — o extrato é processado no navegador)
// ============================================================================
export async function sha256OfBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function fetchStatementImports(): Promise<BankStatementImport[]> {
  const sb = requireSupabase();
  const { data, error } = await sb.from('bank_statement_imports').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as BankStatementImport[];
}

export async function fetchReconciliationItems(importId: string): Promise<ReconciliationItem[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('reconciliation_items')
    .select('*')
    .eq('import_id', importId)
    .order('line_index', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    ...(r as unknown as ReconciliationItem),
    amount: num(r.amount),
    match_score: num(r.match_score),
    amount_diff: r.amount_diff === null || r.amount_diff === undefined ? null : num(r.amount_diff),
    match_reasons: Array.isArray(r.match_reasons) ? (r.match_reasons as string[]) : [],
  }));
}

/** IDs de lançamentos já conciliados em importações anteriores desta conta (evita casar duas vezes). */
export async function fetchReconciledTransactionIds(accountId: string): Promise<Set<string>> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('reconciliation_items')
    .select('resolved_transaction_id')
    .eq('account_id', accountId)
    .in('resolution', ['confirmed', 'created'])
    .not('resolved_transaction_id', 'is', null);
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as Array<{ resolved_transaction_id: string }>).map((r) => r.resolved_transaction_id));
}

export async function fetchKnownFitIds(accountId: string): Promise<Set<string>> {
  const sb = requireSupabase();
  const { data, error } = await sb.from('reconciliation_items').select('fit_id').eq('account_id', accountId).not('fit_id', 'is', null);
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as Array<{ fit_id: string }>).map((r) => r.fit_id));
}

export async function saveStatementImport(params: {
  tenantId: string;
  companyId: string;
  accountId: string;
  fileName: string;
  fileSha256: string;
  statement: ParsedStatement;
  matches: LineMatchResult[];
  knownFitIds: ReadonlySet<string>;
}): Promise<{ importRow: BankStatementImport; skippedDuplicates: number }> {
  const sb = requireSupabase();
  const fresh = params.statement.lines.filter((l) => !l.fitId || !params.knownFitIds.has(l.fitId));
  const skippedDuplicates = params.statement.lines.length - fresh.length;
  const matchByLine = new Map(params.matches.map((m) => [m.lineIndex, m]));
  const counts = { exact: 0, partial: 0, unmatched: 0 };
  for (const l of fresh) {
    const s = matchByLine.get(l.index)?.status ?? 'unmatched';
    if (s === 'exact_match') counts.exact++;
    else if (s === 'partial_match') counts.partial++;
    else counts.unmatched++;
  }

  const { data: imp, error: impErr } = await sb
    .from('bank_statement_imports')
    .insert({
      tenant_id: params.tenantId,
      company_id: params.companyId,
      account_id: params.accountId,
      file_name: params.fileName.slice(0, 255),
      file_format: params.statement.format,
      file_sha256: params.fileSha256,
      period_start: params.statement.periodStart,
      period_end: params.statement.periodEnd,
      total_lines: fresh.length,
      exact_count: counts.exact,
      partial_count: counts.partial,
      unmatched_count: counts.unmatched,
      status: fresh.length === 0 ? 'completed' : 'reconciling',
    })
    .select()
    .single();
  if (impErr) {
    if (impErr.code === '23505') throw new Error('Este arquivo de extrato já foi importado para esta conta.');
    throw new Error(impErr.message);
  }
  const importRow = imp as BankStatementImport;

  if (fresh.length > 0) {
    const rows = fresh.map((l, i) => {
      const m = matchByLine.get(l.index);
      return {
        tenant_id: params.tenantId,
        import_id: importRow.id,
        account_id: params.accountId,
        line_index: i,
        line_date: l.date,
        amount: l.amount,
        description: l.description,
        fit_id: l.fitId,
        match_status: m?.status ?? 'unmatched',
        matched_transaction_id: m?.transactionId ?? null,
        match_score: m?.score ?? 0,
        date_diff_days: m?.dateDiffDays ?? null,
        amount_diff: m?.amountDiff ?? null,
        match_reasons: m?.reasons ?? [],
      };
    });
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from('reconciliation_items').insert(rows.slice(i, i + 500));
      if (error) {
        await sb.from('bank_statement_imports').delete().eq('id', importRow.id);
        throw new Error(error.message);
      }
    }
  }
  return { importRow, skippedDuplicates };
}

async function markItemResolved(itemId: string, resolution: 'confirmed' | 'created' | 'ignored', transactionId: string | null): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('reconciliation_items')
    .update({ resolution, resolved_transaction_id: transactionId, resolved_at: new Date().toISOString() })
    .eq('id', itemId);
  if (error) throw new Error(error.message);
}

export type ConfirmMode = 'confirm' | 'adjust_amount' | 'record_fee';

/**
 * Confirma o casamento linha ↔ lançamento.
 *  - confirm:       dá baixa no lançamento com a data do extrato
 *  - adjust_amount: ajusta o valor do lançamento para o valor do extrato e dá baixa
 *  - record_fee:    dá baixa e lança a diferença como despesa de taxa (2.2)
 */
export async function confirmReconciliationItem(params: {
  tenantId: string;
  userEmail: string;
  item: ReconciliationItem;
  transaction: Transaction;
  mode: ConfirmMode;
  feeCategoryId: string | null;
}): Promise<void> {
  const sb = requireSupabase();
  const { item, transaction } = params;
  const lineAbs = Math.abs(item.amount);

  if (params.mode === 'adjust_amount' && Math.abs(lineAbs - transaction.amount) >= 0.01) {
    const { error } = await sb.from('transactions').update({ amount: lineAbs }).eq('id', transaction.id);
    if (error) throw new Error(error.message);
  }
  if (transaction.status !== 'paid' || transaction.payment_date !== item.line_date) {
    await markTransactionPaid(params.tenantId, params.userEmail, transaction.id, item.line_date);
  }
  if (params.mode === 'record_fee') {
    const diff = Math.round(Math.abs(transaction.amount - lineAbs) * 100) / 100;
    if (diff >= 0.01) {
      await createTransactionsBatch(params.tenantId, params.userEmail, {
        company_id: transaction.company_id,
        account_id: transaction.account_id,
        destination_account_id: null,
        category_id: params.feeCategoryId,
        product_service_id: transaction.product_service_id,
        project_id: transaction.project_id,
        transaction_type: 'expense',
        status: 'paid',
        description: `Taxa/diferença conciliação: ${transaction.description}`.slice(0, 240),
        amount: diff,
        competence_date: transaction.competence_date,
        due_date: item.line_date,
        payment_date: item.line_date,
        schedule_mode: 'single',
        notes: `conciliacao:${item.import_id}:${item.line_index}`,
      });
    }
  }
  await markItemResolved(item.id, 'confirmed', transaction.id);
}

export async function createTransactionFromItem(params: {
  tenantId: string;
  userEmail: string;
  item: ReconciliationItem;
  companyId: string;
  description: string;
  categoryId: string | null;
  productServiceId: string | null;
  projectId: string | null;
}): Promise<void> {
  const created = await createTransactionsBatch(params.tenantId, params.userEmail, {
    company_id: params.companyId,
    account_id: params.item.account_id,
    destination_account_id: null,
    category_id: params.categoryId,
    product_service_id: params.productServiceId,
    project_id: params.projectId,
    transaction_type: params.item.amount > 0 ? 'income' : 'expense',
    status: 'paid',
    description: params.description.trim().slice(0, 240) || 'Lançamento do extrato',
    amount: Math.abs(params.item.amount),
    competence_date: params.item.line_date,
    due_date: params.item.line_date,
    payment_date: params.item.line_date,
    schedule_mode: 'single',
    notes: `conciliacao:${params.item.import_id}:${params.item.line_index}`,
  });
  await markItemResolved(params.item.id, 'created', created[0]?.id ?? null);
}

export async function ignoreReconciliationItem(itemId: string): Promise<void> {
  await markItemResolved(itemId, 'ignored', null);
}

export async function refreshImportStatus(importId: string): Promise<void> {
  const sb = requireSupabase();
  const { count } = await sb
    .from('reconciliation_items')
    .select('id', { count: 'exact', head: true })
    .eq('import_id', importId)
    .eq('resolution', 'pending');
  await sb.from('bank_statement_imports').update({ status: (count ?? 0) === 0 ? 'completed' : 'reconciling' }).eq('id', importId);
}

// ============================================================================
// Comprovantes por foto (OCR)
// ============================================================================
export async function uploadReceiptFile(tenantId: string, file: Blob, fileName: string): Promise<string> {
  const sb = requireSupabase();
  const ext = (fileName.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
  const path = `${tenantId}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from('receipts').upload(path, file, {
    contentType: file.type || 'image/jpeg',
    upsert: false,
  });
  if (error) throw new Error(`Falha ao guardar o comprovante: ${error.message}`);
  return path;
}

export async function getReceiptSignedUrl(path: string): Promise<string | null> {
  const sb = requireSupabase();
  const { data } = await sb.storage.from('receipts').createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

export async function classifyReceiptText(input: {
  company_id: string;
  sanitized_text: string;
  amount: number | null;
  date: string | null;
}): Promise<OcrClassification> {
  return apiJson('/api/ocr/classify', { method: 'POST', body: JSON.stringify(input) });
}

export async function createReceiptDraft(row: Omit<ReceiptDraft, 'id' | 'created_at' | 'status' | 'transaction_id'>): Promise<ReceiptDraft> {
  const sb = requireSupabase();
  const { data, error } = await sb.from('receipt_drafts').insert({ ...row, status: 'pending_review' }).select().single();
  if (error) throw new Error(error.message);
  return data as ReceiptDraft;
}

export async function fetchPendingReceiptDrafts(): Promise<ReceiptDraft[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('receipt_drafts')
    .select('*')
    .eq('status', 'pending_review')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return (data ?? []) as ReceiptDraft[];
}

export async function confirmReceiptDraft(params: {
  tenantId: string;
  userEmail: string;
  draftId: string;
  companyId: string;
  accountId: string;
  transactionType: 'income' | 'expense';
  description: string;
  amount: number;
  date: string;
  paid: boolean;
  categoryId: string | null;
  productServiceId: string | null;
  projectId: string | null;
  installments: number;
}): Promise<Transaction[]> {
  const sb = requireSupabase();
  const created = await createTransactionsBatch(params.tenantId, params.userEmail, {
    company_id: params.companyId,
    account_id: params.accountId,
    destination_account_id: null,
    category_id: params.categoryId,
    product_service_id: params.productServiceId,
    project_id: params.projectId,
    transaction_type: params.transactionType,
    status: params.paid ? 'paid' : 'pending',
    description: params.description,
    amount: params.amount,
    competence_date: params.date,
    due_date: params.date,
    payment_date: params.paid ? params.date : null,
    schedule_mode: params.installments > 1 ? 'installments' : 'single',
    total_occurrences: params.installments > 1 ? params.installments : undefined,
    notes: `comprovante:${params.draftId}`,
  });
  const { error } = await sb
    .from('receipt_drafts')
    .update({ status: 'confirmed', transaction_id: created[0]?.id ?? null, company_id: params.companyId })
    .eq('id', params.draftId);
  if (error) throw new Error(error.message);
  return created;
}

export async function discardReceiptDraft(draftId: string, storagePath: string | null): Promise<void> {
  const sb = requireSupabase();
  if (storagePath) await sb.storage.from('receipts').remove([storagePath]);
  const { error } = await sb.from('receipt_drafts').update({ status: 'discarded', storage_path: null }).eq('id', draftId);
  if (error) throw new Error(error.message);
}

// ============================================================================
// Alertas, agenda e backup
// ============================================================================
export const DEFAULT_EDITABLE_PREFERENCES: EditablePreferences = {
  email_enabled: false,
  email_to: null,
  whatsapp_enabled: false,
  whatsapp_number: null,
  notify_due_today: true,
  notify_overdue: true,
  notify_weekly_summary: true,
  weekly_summary_weekday: 1,
  notify_cfo_critical: true,
  include_real_labels: false,
  calendar_sync_enabled: false,
  calendar_id: 'primary',
  calendar_days_ahead: 60,
  backup_enabled: false,
  backup_retention_count: 30,
};

export async function fetchPreferences(): Promise<NotificationPreferencesRow | null> {
  const sb = requireSupabase();
  const { data, error } = await sb.from('notification_preferences').select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return (data as NotificationPreferencesRow | null) ?? null;
}

export async function savePreferences(tenantId: string, prefs: EditablePreferences, exists: boolean): Promise<void> {
  const sb = requireSupabase();
  // Lista fechada: o banco só concede escrita a estas colunas (GRANT por coluna na migration 0006).
  // `select('*')` também traz created_at/updated_at/etc.; enviá-los causaria "permission denied".
  const clean: EditablePreferences = {
    email_enabled: prefs.email_enabled,
    email_to: prefs.email_to?.trim() || null,
    whatsapp_enabled: prefs.whatsapp_enabled,
    whatsapp_number: prefs.whatsapp_number?.replace(/\D/g, '') || null,
    notify_due_today: prefs.notify_due_today,
    notify_overdue: prefs.notify_overdue,
    notify_weekly_summary: prefs.notify_weekly_summary,
    weekly_summary_weekday: prefs.weekly_summary_weekday,
    notify_cfo_critical: prefs.notify_cfo_critical,
    include_real_labels: prefs.include_real_labels,
    calendar_sync_enabled: prefs.calendar_sync_enabled,
    calendar_id: prefs.calendar_id?.trim() || 'primary',
    calendar_days_ahead: prefs.calendar_days_ahead,
    backup_enabled: prefs.backup_enabled,
    backup_retention_count: prefs.backup_retention_count,
  };
  if (clean.email_enabled && !clean.email_to) throw new Error('Informe o e-mail que receberá os alertas.');
  if (clean.whatsapp_enabled && !clean.whatsapp_number) throw new Error('Informe o número de WhatsApp com DDI e DDD (ex.: 5511999998888).');
  if (exists) {
    const { error } = await sb.from('notification_preferences').update(clean).eq('tenant_id', tenantId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await sb.from('notification_preferences').insert({ tenant_id: tenantId, ...clean });
    if (error) throw new Error(error.message);
  }
}

export async function fetchBackupLogs(): Promise<BackupLogRow[]> {
  const sb = requireSupabase();
  const { data, error } = await sb.from('backup_logs').select('*').order('started_at', { ascending: false }).limit(30);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    ...(r as unknown as BackupLogRow),
    size_bytes: r.size_bytes === null ? null : num(r.size_bytes),
  }));
}

export async function fetchNotificationLogs(): Promise<NotificationLogRow[]> {
  const sb = requireSupabase();
  const { data, error } = await sb.from('notification_logs').select('*').order('created_at', { ascending: false }).limit(30);
  if (error) throw new Error(error.message);
  return (data ?? []) as NotificationLogRow[];
}

export async function fetchAutomationStatus(): Promise<AutomationStatus> {
  return apiJson('/api/automation/status');
}

export async function startGoogleConnect(): Promise<void> {
  const { url } = await apiJson<{ url: string }>('/api/google/oauth/start');
  window.location.assign(url);
}

export async function disconnectGoogleAccount(): Promise<void> {
  await apiJson('/api/google/disconnect', { method: 'POST', body: '{}' });
}

export async function runCalendarSyncNow(): Promise<{ created: number; updated: number; deleted: number; unchanged: number; errors: string[] }> {
  return apiJson('/api/calendar/sync', { method: 'POST', body: '{}' });
}

export async function sendTestAlert(): Promise<{ results: Array<{ channel: string; status: string; error?: string }> }> {
  return apiJson('/api/alerts/test', { method: 'POST', body: '{}' });
}

export async function runDailyJobsNow(): Promise<Record<string, unknown>> {
  return apiJson('/api/automation/run-daily', { method: 'POST', body: '{}' });
}

/** Executa o backup. Sem Google conectado, o servidor devolve o arquivo cifrado para download. */
export async function runBackupNow(): Promise<{ mode: 'drive'; summary: Record<string, unknown> } | { mode: 'download'; fileName: string; sha256: string }> {
  const res = await apiFetch('/api/backup/run', { method: 'POST', body: '{}' });
  const type = res.headers.get('Content-Type') ?? '';
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Falha no backup (${res.status}).`);
  }
  if (type.includes('application/octet-stream')) {
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'vertice-backup.vtxbak';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return { mode: 'download', fileName, sha256: res.headers.get('X-Backup-Sha256') ?? '' };
  }
  return { mode: 'drive', summary: (await res.json()) as Record<string, unknown> };
}

export async function verifyLatestBackup(): Promise<{
  fileName: string | null;
  sha256Matches: boolean;
  decrypted: boolean;
  rowsInFile: number;
  rowsExpected: number | null;
  tables: Array<{ table: string; count: number }>;
  createdAt: string | null;
}> {
  return apiJson('/api/backup/verify', { method: 'POST', body: '{}' });
}
