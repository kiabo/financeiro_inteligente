import { asaasBaseFields } from '../webhooks/adapters/asaas.ts';
import { normalizeMercadoPagoPayment } from '../webhooks/adapters/mercadopago.ts';
import type { NormalizedPaymentEvent } from '../webhooks/types.ts';
import { roundMoney, toISODateBR, toNumberOrNull } from '../webhooks/utils.ts';

/**
 * Mapeamento de pagamentos do histórico (API de listagem) para o evento normalizado do webhook (spec 004).
 *
 * Ciclos (`lifecycle`):
 *  - `settled`  pago (vira liquidado; pago de fato quando a data de crédito chega);
 *  - `open`     pendente, confirmado ou vencido (o banco marca "vencido" pela data de vencimento);
 *  - `canceled` cancelado, rejeitado ou removido: entra marcado à parte, não soma no saldo;
 *  - `refunded` estornado ou em chargeback: entra marcado à parte, não soma no saldo;
 *  - `unknown`  não importado (conta como "ignorado" com o motivo).
 *
 * Para `canceled` e `refunded`, `normalized.kind` é `payment_pending` apenas como transporte do valor cheio:
 * quem decide o que gravar é o `lifecycle`.
 */

export type HistoryProviderId = 'asaas' | 'mercadopago';
export type HistoryLifecycle = 'settled' | 'open' | 'canceled' | 'refunded' | 'unknown';

export interface HistoryPayment {
  provider: HistoryProviderId;
  /** Status original do provedor (para o log) */
  providerStatus: string;
  lifecycle: HistoryLifecycle;
  normalized: NormalizedPaymentEvent;
}

type Obj = Record<string, unknown>;

/** Os 14 status de cobrança documentados pelo Asaas (conferidos na T01). */
export const ASAAS_KNOWN_STATUSES = [
  'PENDING',
  'RECEIVED',
  'CONFIRMED',
  'OVERDUE',
  'REFUNDED',
  'RECEIVED_IN_CASH',
  'REFUND_REQUESTED',
  'REFUND_IN_PROGRESS',
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
  'DUNNING_REQUESTED',
  'DUNNING_RECEIVED',
  'AWAITING_RISK_ANALYSIS',
] as const;

const ASAAS_SETTLED = new Set(['RECEIVED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED']);
const ASAAS_OPEN = new Set(['PENDING', 'CONFIRMED', 'OVERDUE', 'DUNNING_REQUESTED', 'AWAITING_RISK_ANALYSIS']);
const ASAAS_REFUNDED = new Set([
  'REFUNDED',
  'REFUND_REQUESTED',
  'REFUND_IN_PROGRESS',
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
]);

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

function ignored(
  provider: HistoryProviderId,
  providerStatus: string,
  paymentRef: string,
  reason: string,
  now: Date
): HistoryPayment {
  const today = toISODateBR(undefined, now);
  return {
    provider,
    providerStatus,
    lifecycle: 'unknown',
    normalized: {
      kind: 'ignored',
      paymentRef: paymentRef || 'n/a',
      grossAmount: 0,
      feeAmount: null,
      netAmount: null,
      currency: 'BRL',
      competenceDate: today,
      settlementDate: today,
      description: 'Pagamento não importado',
      productHint: null,
      ignoredReason: reason,
    },
  };
}

/**
 * Cobrança do Asaas (item de `GET /v3/payments`). `customerName` vem da lista de clientes
 * (a cobrança só traz o id do cliente); ausente → contraparte nula.
 */
export function mapAsaasPayment(payment: Obj, customerName: string | null, now: Date): HistoryPayment {
  const providerStatus = text(payment.status);
  const paymentRef = text(payment.id);
  if (!paymentRef) return ignored('asaas', providerStatus, '', 'cobrança sem identificador', now);

  const gross = roundMoney(toNumberOrNull(payment.value) ?? 0);
  if (gross <= 0) return ignored('asaas', providerStatus, paymentRef, 'cobrança sem valor', now);

  const base = {
    ...asaasBaseFields(payment, paymentRef, now),
    competenceDate: toISODateBR(payment.paymentDate ?? payment.clientPaymentDate ?? payment.dateCreated, now),
    counterpartyName: customerName?.trim() ? customerName.trim().slice(0, 160) : null,
  };
  const withKind = (kind: NormalizedPaymentEvent['kind'], extra: Partial<NormalizedPaymentEvent> = {}) =>
    ({ ...base, kind, grossAmount: gross, ...extra }) as NormalizedPaymentEvent;

  // Cobrança removida entra marcada como cancelada, qualquer que seja o status
  if (payment.deleted === true) {
    return { provider: 'asaas', providerStatus, lifecycle: 'canceled', normalized: withKind('payment_pending') };
  }
  if (ASAAS_SETTLED.has(providerStatus)) {
    return { provider: 'asaas', providerStatus, lifecycle: 'settled', normalized: withKind('payment_settled') };
  }
  if (ASAAS_OPEN.has(providerStatus)) {
    // Confirmado (cartão): vence no crédito estimado. Os demais: na data de vencimento.
    const dueDate = toISODateBR(payment.dueDate, now);
    const settlementDate =
      providerStatus === 'CONFIRMED'
        ? toISODateBR(payment.estimatedCreditDate ?? payment.creditDate ?? payment.dueDate, now)
        : dueDate;
    return { provider: 'asaas', providerStatus, lifecycle: 'open', normalized: withKind('payment_pending', { settlementDate }) };
  }
  if (ASAAS_REFUNDED.has(providerStatus)) {
    return { provider: 'asaas', providerStatus, lifecycle: 'refunded', normalized: withKind('payment_pending') };
  }
  return ignored('asaas', providerStatus, paymentRef, `status ${providerStatus || 'ausente'}`, now);
}

/** Pagamento do Mercado Pago (item de `GET /v1/payments/search`; mesma estrutura de `GET /v1/payments/{id}`). */
export function mapMercadoPagoPayment(payment: Obj, now: Date): HistoryPayment {
  const { normalized, status, paymentRef } = normalizeMercadoPagoPayment(payment, '', now);
  if (!paymentRef) return ignored('mercadopago', status, '', 'pagamento sem identificador', now);

  const gross = roundMoney(toNumberOrNull(payment.transaction_amount) ?? 0);
  if (gross <= 0) return ignored('mercadopago', status, paymentRef, 'pagamento sem valor', now);

  const asPending = (): NormalizedPaymentEvent => ({ ...normalized, kind: 'payment_pending', grossAmount: gross, ignoredReason: undefined });

  if (status === 'approved') {
    return { provider: 'mercadopago', providerStatus: status, lifecycle: 'settled', normalized: { ...normalized, kind: 'payment_settled', grossAmount: gross } };
  }
  if (status === 'pending' || status === 'in_process' || status === 'authorized' || status === 'in_mediation') {
    return { provider: 'mercadopago', providerStatus: status, lifecycle: 'open', normalized: asPending() };
  }
  if (status === 'cancelled' || status === 'rejected') {
    return { provider: 'mercadopago', providerStatus: status, lifecycle: 'canceled', normalized: asPending() };
  }
  if (status === 'refunded' || status === 'charged_back') {
    return { provider: 'mercadopago', providerStatus: status, lifecycle: 'refunded', normalized: asPending() };
  }
  return ignored('mercadopago', status, paymentRef, `status ${status}`, now);
}

/**
 * Payload reduzido que vai para `webhook_events.payload` na importação:
 * só identificadores, status, valores e datas. Sem nome, e-mail, documento, id do cliente nem descrição livre.
 */
export function toHistoryLogPayload(provider: HistoryProviderId, payment: Obj): Record<string, unknown> {
  const pick = (keys: readonly string[]): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const key of keys) if (payment[key] !== undefined) out[key] = payment[key];
    return out;
  };
  if (provider === 'asaas') {
    return {
      source: 'api',
      payment: pick([
        'id', 'status', 'value', 'netValue', 'billingType', 'dueDate', 'dateCreated', 'paymentDate',
        'creditDate', 'estimatedCreditDate', 'deleted', 'externalReference',
      ]),
    };
  }
  return {
    source: 'api',
    payment: pick([
      'id', 'status', 'status_detail', 'transaction_amount', 'transaction_amount_refunded', 'date_created',
      'date_approved', 'date_of_expiration', 'money_release_date', 'payment_method_id', 'external_reference',
    ]),
  };
}
