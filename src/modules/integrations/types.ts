export type IntegrationProvider =
  | 'stripe'
  | 'mercadopago'
  | 'asaas'
  | 'openfinance_generic'
  | 'custom_json_mapping';

export interface CustomFieldMappingConfig {
  event_id_path: string;
  event_type_path?: string;
  payment_ref_path?: string;
  amount_path: string;
  fee_path?: string;
  net_path?: string;
  date_path?: string;
  settlement_date_path?: string;
  description_path?: string;
  status_path?: string;
  settled_values?: string[];
  pending_values?: string[];
  refund_values?: string[];
  amount_in_cents?: boolean;
  signature_header?: string;
  signature_encoding?: 'hex' | 'base64';
}

export interface IntegrationConnectionConfig {
  fee_pct?: number;
  fee_fixed?: number;
  revenue_category_id?: string | null;
  fee_category_id?: string | null;
  refund_category_id?: string | null;
  default_product_service_id?: string | null;
  record_fee_as_expense?: boolean;
  signature_tolerance_seconds?: number;
  mapping?: CustomFieldMappingConfig;
}

export interface IntegrationConnection {
  id: string;
  tenant_id: string;
  provider: IntegrationProvider;
  label: string;
  company_id: string | null;
  account_id: string | null;
  webhook_secret_id: string | null;
  webhook_url: string | null;
  /** Há chave de API cifrada no servidor (a chave nunca volta ao navegador) */
  api_key_configured: boolean;
  config: IntegrationConnectionConfig;
  status: 'active' | 'paused' | 'error';
  last_event_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookEventRow {
  id: string;
  connection_id: string;
  provider: string;
  /** Origem do evento: webhook do provedor ou importação de histórico por API */
  source?: 'webhook' | 'api';
  external_event_id: string;
  event_type: string | null;
  status: 'received' | 'processed' | 'failed' | 'ignored';
  normalized: {
    kind: string;
    grossAmount: number;
    feeAmount: number | null;
    settlementDate: string;
    description: string;
    ignoredReason?: string;
  } | null;
  error_message: string | null;
  attempts: number;
  transaction_ids: string[];
  received_at: string;
  processed_at: string | null;
}

export interface BankStatementImport {
  id: string;
  tenant_id: string;
  company_id: string;
  account_id: string;
  file_name: string;
  file_format: 'ofx' | 'csv' | 'pdf';
  file_sha256: string;
  period_start: string | null;
  period_end: string | null;
  total_lines: number;
  exact_count: number;
  partial_count: number;
  unmatched_count: number;
  status: 'reconciling' | 'completed';
  created_at: string;
}

export type ReconciliationResolution = 'pending' | 'confirmed' | 'created' | 'ignored';

export interface ReconciliationItem {
  id: string;
  tenant_id: string;
  import_id: string;
  account_id: string;
  line_index: number;
  line_date: string;
  amount: number;
  description: string;
  fit_id: string | null;
  match_status: 'exact_match' | 'partial_match' | 'unmatched';
  matched_transaction_id: string | null;
  match_score: number;
  date_diff_days: number | null;
  amount_diff: number | null;
  match_reasons: string[];
  resolution: ReconciliationResolution;
  resolved_transaction_id: string | null;
  resolved_at: string | null;
}

export interface ReceiptDraft {
  id: string;
  tenant_id: string;
  company_id: string | null;
  storage_path: string | null;
  file_name: string;
  mime_type: string;
  ocr_text_sanitized: string;
  ocr_confidence: number;
  extracted: Record<string, unknown>;
  suggestion: Record<string, unknown>;
  status: 'pending_review' | 'confirmed' | 'discarded';
  transaction_id: string | null;
  created_at: string;
}

export interface NotificationPreferencesRow {
  tenant_id: string;
  email_enabled: boolean;
  email_to: string | null;
  whatsapp_enabled: boolean;
  whatsapp_number: string | null;
  notify_due_today: boolean;
  notify_overdue: boolean;
  notify_weekly_summary: boolean;
  weekly_summary_weekday: number;
  notify_cfo_critical: boolean;
  include_real_labels: boolean;
  calendar_sync_enabled: boolean;
  calendar_id: string;
  calendar_days_ahead: number;
  backup_enabled: boolean;
  backup_retention_count: number;
  drive_folder_id: string | null;
  last_daily_run_at: string | null;
  last_weekly_summary_at: string | null;
  last_calendar_sync_at: string | null;
}

export type EditablePreferences = Omit<
  NotificationPreferencesRow,
  'tenant_id' | 'drive_folder_id' | 'last_daily_run_at' | 'last_weekly_summary_at' | 'last_calendar_sync_at'
>;

export interface BackupLogRow {
  id: string;
  trigger_source: 'cron' | 'manual';
  destination: 'google_drive' | 'download';
  status: 'running' | 'success' | 'failed';
  file_name: string | null;
  size_bytes: number | null;
  sha256: string | null;
  rows_count: number | null;
  error_message: string | null;
  verified_at: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface NotificationLogRow {
  id: string;
  channel: 'email' | 'whatsapp';
  kind: string;
  status: 'sent' | 'failed' | 'skipped';
  error_message: string | null;
  items_count: number;
  created_at: string;
}

export interface AutomationStatus {
  supabase: boolean;
  credentialsKeyConfigured: boolean;
  backupKeyConfigured: boolean;
  googleOAuthConfigured: boolean;
  google: { connected: boolean; email: string | null; scopes: string[]; connectedAt: string | null; configured: boolean };
  channels: { email: boolean; whatsapp: boolean; whatsappProvider: string | null };
  cronSecretConfigured: boolean;
  internalScheduler: boolean;
  ai: { provider: string; model: string; configured: boolean };
  publicBaseUrl: string;
  googleRedirectUri: string;
}

export interface OcrClassification {
  source: 'ai' | 'heuristic';
  provider: string | null;
  transactionType: 'expense' | 'income';
  categoryId: string | null;
  categoryCode: string | null;
  productServiceId: string | null;
  offerToken: string | null;
  projectId: string | null;
  projectToken: string | null;
  confidence: number;
  rationale: string;
  aiPayload: Record<string, unknown> | null;
}

export const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  stripe: 'Stripe',
  mercadopago: 'Mercado Pago',
  asaas: 'Asaas',
  openfinance_generic: 'Open Finance (genérico)',
  custom_json_mapping: 'Mapeamento JSON customizado',
};

export const PROVIDER_SECRET_HELP: Record<IntegrationProvider, string> = {
  stripe: 'Signing secret do endpoint (começa com whsec_), em Developers → Webhooks.',
  mercadopago: 'Chave secreta da assinatura em Suas integrações → Webhooks.',
  asaas: 'Token de autenticação definido ao criar o webhook no Asaas (enviado no cabeçalho asaas-access-token).',
  openfinance_generic: 'Segredo HMAC-SHA256 combinado com o agregador (cabeçalho x-signature por padrão).',
  custom_json_mapping: 'Segredo HMAC-SHA256 usado para assinar o corpo bruto (cabeçalho x-signature por padrão).',
};

// ============================================================================
// Importação de histórico por API
// ============================================================================
export type HistoryImportStatus = 'running' | 'completed' | 'failed' | 'canceled';

export interface HistoryImportRun {
  id: string;
  connection_id: string;
  provider: 'asaas' | 'mercadopago';
  account_id: string;
  period_start: string;
  period_end: string;
  status: HistoryImportStatus;
  phase: 'customers' | 'payments';
  window_index: number;
  window_total: number;
  counts: { created: number; updated: number; ignored: number; marked_apart: number; failed: number };
  /** `ref` é o id do pagamento no provedor (nunca nome de cliente) */
  errors: Array<{ ref: string; message: string }>;
  last_error: string | null;
  started_at: string;
  finished_at: string | null;
}
