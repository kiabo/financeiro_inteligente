import {
  WebhookSignatureError,
  type CustomFieldMapping,
  type NormalizedEventKind,
  type PaymentProviderAdapter,
  type ResolvedWebhookEvent,
  type WebhookProviderId,
} from '../types.ts';
import {
  getByPath,
  hmacSha256,
  roundMoney,
  safeEqualHex,
  toISODateBR,
  toNumberOrNull,
  toStringOrNull,
} from '../utils.ts';
import { timingSafeEqualStr } from '../../../crypto/secretBox.ts';

/**
 * Adaptador genérico por mapeamento JSON.
 * Assinatura: HMAC-SHA256 do corpo bruto no cabeçalho configurado (padrão `x-signature`),
 * aceitando prefixo opcional "sha256=". Os campos são lidos por caminhos (ex.: "data.amount").
 */

export const OPEN_FINANCE_DEFAULT_MAPPING: CustomFieldMapping = {
  event_id_path: 'id',
  event_type_path: 'type',
  payment_ref_path: 'data.transactionId',
  amount_path: 'data.amount',
  fee_path: 'data.fee',
  net_path: 'data.netAmount',
  date_path: 'data.bookingDate',
  settlement_date_path: 'data.valueDate',
  description_path: 'data.description',
  status_path: 'data.status',
  settled_values: ['BOOKED', 'COMPLETED', 'SETTLED', 'PAID'],
  pending_values: ['PENDING', 'SCHEDULED'],
  refund_values: ['REVERSED', 'REFUNDED', 'CHARGEBACK'],
  amount_in_cents: false,
  signature_header: 'x-signature',
  signature_encoding: 'hex',
};

export const CUSTOM_DEFAULT_MAPPING: CustomFieldMapping = {
  event_id_path: 'id',
  event_type_path: 'event',
  payment_ref_path: 'payment.id',
  amount_path: 'payment.amount',
  fee_path: 'payment.fee',
  net_path: 'payment.net_amount',
  date_path: 'payment.created_at',
  settlement_date_path: 'payment.paid_at',
  description_path: 'payment.description',
  status_path: 'payment.status',
  settled_values: ['paid', 'approved', 'succeeded', 'settled'],
  pending_values: ['pending', 'processing', 'authorized'],
  refund_values: ['refunded', 'chargeback', 'reversed'],
  amount_in_cents: false,
  signature_header: 'x-signature',
  signature_encoding: 'hex',
};

function classify(status: string | null, mapping: CustomFieldMapping): NormalizedEventKind {
  if (!status) return 'payment_settled';
  const s = status.toLowerCase();
  const inList = (list?: string[]) => (list ?? []).some((v) => v.toLowerCase() === s);
  if (inList(mapping.refund_values)) return 'refund';
  if (inList(mapping.pending_values)) return 'payment_pending';
  if (inList(mapping.settled_values)) return 'payment_settled';
  return 'ignored';
}

export function createMappingAdapter(
  provider: Extract<WebhookProviderId, 'custom_json_mapping' | 'openfinance_generic'>,
  displayName: string,
  defaults: CustomFieldMapping
): PaymentProviderAdapter {
  return {
    provider,
    displayName,

    verifySignature(ctx, secrets, config) {
      const mapping = { ...defaults, ...(config.mapping ?? {}) };
      const headerName = (mapping.signature_header ?? 'x-signature').toLowerCase();
      const received = ctx.headers[headerName];
      if (!received) throw new WebhookSignatureError(`Cabeçalho ${headerName} ausente.`);
      const signature = received.replace(/^sha256=/i, '').trim();
      const encoding = mapping.signature_encoding ?? 'hex';
      const expected = hmacSha256(secrets.signingSecret, ctx.rawBody, encoding);
      const ok = encoding === 'hex' ? safeEqualHex(signature, expected) : timingSafeEqualStr(signature, expected);
      if (!ok) throw new WebhookSignatureError('Assinatura HMAC inválida.');
    },

    async resolve(payload, ctx, _secrets, config): Promise<ResolvedWebhookEvent> {
      const mapping = { ...defaults, ...(config.mapping ?? {}) };
      const eventId = toStringOrNull(getByPath(payload, mapping.event_id_path));
      if (!eventId) throw new Error(`Campo de id do evento (${mapping.event_id_path}) ausente no payload.`);
      const eventType = toStringOrNull(getByPath(payload, mapping.event_type_path)) ?? 'event';

      const divisor = mapping.amount_in_cents ? 100 : 1;
      const readMoney = (path?: string): number | null => {
        const n = toNumberOrNull(getByPath(payload, path));
        return n === null ? null : roundMoney(Math.abs(n) / divisor);
      };

      const gross = readMoney(mapping.amount_path) ?? 0;
      const fee = readMoney(mapping.fee_path);
      const net = readMoney(mapping.net_path);
      const status = toStringOrNull(getByPath(payload, mapping.status_path));
      let kind = classify(status, mapping);
      if (gross <= 0) kind = 'ignored';

      const rawDate = getByPath(payload, mapping.date_path);
      const rawSettlement = getByPath(payload, mapping.settlement_date_path) ?? rawDate;

      return {
        externalEventId: eventId,
        eventType,
        storedPayload: payload,
        normalized: {
          kind,
          paymentRef: toStringOrNull(getByPath(payload, mapping.payment_ref_path)) ?? eventId,
          grossAmount: gross,
          feeAmount: kind === 'refund' ? 0 : fee ?? (net !== null ? roundMoney(Math.max(0, gross - net)) : null),
          netAmount: net,
          currency: 'BRL',
          competenceDate: toISODateBR(rawDate, ctx.now),
          settlementDate: toISODateBR(rawSettlement, ctx.now),
          description: (toStringOrNull(getByPath(payload, mapping.description_path)) ?? `${displayName} ${eventType}`).slice(0, 180),
          productHint: null,
          ignoredReason: kind === 'ignored' ? (gross <= 0 ? 'valor zero ou ausente' : `status ${status ?? 'n/d'} não mapeado`) : undefined,
        },
      };
    },
  };
}

export const customJsonMappingAdapter = createMappingAdapter('custom_json_mapping', 'Mapeamento JSON customizado', CUSTOM_DEFAULT_MAPPING);
export const openFinanceGenericAdapter = createMappingAdapter('openfinance_generic', 'Open Finance (genérico)', OPEN_FINANCE_DEFAULT_MAPPING);
