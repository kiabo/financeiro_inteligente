export type WebhookProviderId =
  | 'stripe'
  | 'mercadopago'
  | 'asaas'
  | 'openfinance_generic'
  | 'custom_json_mapping';

export const WEBHOOK_PROVIDERS: readonly WebhookProviderId[] = [
  'stripe',
  'mercadopago',
  'asaas',
  'openfinance_generic',
  'custom_json_mapping',
];

export interface WebhookRequestContext {
  rawBody: Buffer;
  /** Cabeçalhos em minúsculas */
  headers: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  /** Momento de recebimento (injetável nos testes) */
  now: Date;
}

/** Mapeamento customizável de campos (custom_json_mapping / openfinance_generic) */
export interface CustomFieldMapping {
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
  /** Cabeçalho que carrega a assinatura HMAC-SHA256 do corpo bruto */
  signature_header?: string;
  /** Codificação da assinatura recebida */
  signature_encoding?: 'hex' | 'base64';
}

export interface ConnectionConfig {
  /** Taxa percentual do gateway aplicada quando o provedor não informa a taxa no evento */
  fee_pct?: number;
  /** Taxa fixa por transação (BRL) quando o provedor não informa */
  fee_fixed?: number;
  revenue_category_id?: string | null;
  fee_category_id?: string | null;
  refund_category_id?: string | null;
  default_product_service_id?: string | null;
  /** Lança a taxa do gateway como despesa separada (padrão: true) */
  record_fee_as_expense?: boolean;
  /** Tolerância de relógio para assinaturas com timestamp (segundos) */
  signature_tolerance_seconds?: number;
  mapping?: CustomFieldMapping;
}

export interface ConnectionSecrets {
  /** Segredo de assinatura do webhook (whsec_ do Stripe, chave secreta do MP, token Asaas, HMAC custom) */
  signingSecret: string;
  /** Credencial de API opcional (ex.: access token do Mercado Pago para consultar o pagamento) */
  apiAccessToken?: string;
}

export type NormalizedEventKind = 'payment_pending' | 'payment_settled' | 'refund' | 'ignored';

export interface NormalizedPaymentEvent {
  kind: NormalizedEventKind;
  /** Identificador estável do pagamento no provedor (liga pendente → liquidado → estorno) */
  paymentRef: string;
  grossAmount: number;
  /** null = provedor não informou; o núcleo aplica fee_pct/fee_fixed da conexão */
  feeAmount: number | null;
  netAmount: number | null;
  currency: string;
  /** Data do fato gerador (competência) — YYYY-MM-DD */
  competenceDate: string;
  /** Data de liquidação/crédito na conta (caixa) — YYYY-MM-DD */
  settlementDate: string;
  description: string;
  /** Dica de produto: SKU, token PRD_XX/SRV_XX ou referência externa */
  productHint: string | null;
  /** Nome do cliente/pagador, quando o provedor informa (vira a contraparte do lançamento; nunca vai à IA em claro) */
  counterpartyName?: string | null;
  ignoredReason?: string;
}

export interface ResolvedWebhookEvent {
  externalEventId: string;
  eventType: string;
  normalized: NormalizedPaymentEvent;
  /** Payload a persistir em webhook_events (pode ser enriquecido com a consulta à API) */
  storedPayload: Record<string, unknown>;
}

export interface PaymentProviderAdapter {
  readonly provider: WebhookProviderId;
  readonly displayName: string;
  /** Lança erro (mensagem segura) quando a assinatura é inválida */
  verifySignature(ctx: WebhookRequestContext, secrets: ConnectionSecrets, config: ConnectionConfig): void;
  /** Converte o payload do provedor no evento normalizado (pode consultar a API do provedor) */
  resolve(
    payload: Record<string, unknown>,
    ctx: WebhookRequestContext,
    secrets: ConnectionSecrets,
    config: ConnectionConfig
  ): Promise<ResolvedWebhookEvent>;
}

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}
