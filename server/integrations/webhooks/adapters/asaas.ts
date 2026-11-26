import {
  WebhookSignatureError,
  type NormalizedPaymentEvent,
  type PaymentProviderAdapter,
  type ResolvedWebhookEvent,
} from '../types.ts';
import { roundMoney, toISODateBR, toNumberOrNull } from '../utils.ts';
import { timingSafeEqualStr } from '../../../crypto/secretBox.ts';

/**
 * Asaas — autenticação por cabeçalho `asaas-access-token` igual ao token definido
 * na configuração do webhook no painel Asaas. Valores em BRL (não centavos).
 * Taxa = value - netValue.
 */

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});

const SETTLED = new Set(['PAYMENT_RECEIVED', 'PAYMENT_RECEIVED_IN_CASH']);
const PENDING = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_CREATED', 'PAYMENT_AWAITING_RISK_ANALYSIS', 'PAYMENT_APPROVED_BY_RISK_ANALYSIS']);
const REFUND = new Set(['PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_PARTIALLY_REFUNDED']);

export const asaasAdapter: PaymentProviderAdapter = {
  provider: 'asaas',
  displayName: 'Asaas',

  verifySignature(ctx, secrets) {
    const token = ctx.headers['asaas-access-token'];
    if (!token) throw new WebhookSignatureError('Cabeçalho asaas-access-token ausente.');
    if (!timingSafeEqualStr(token, secrets.signingSecret)) {
      throw new WebhookSignatureError('Token de autenticação Asaas inválido.');
    }
  },

  async resolve(payload, ctx): Promise<ResolvedWebhookEvent> {
    const event = typeof payload.event === 'string' ? payload.event : 'UNKNOWN';
    const payment = asObj(payload.payment);
    const paymentId = typeof payment.id === 'string' ? payment.id : '';
    const eventId =
      (typeof payload.id === 'string' && payload.id) || (paymentId ? `${paymentId}:${event}` : '');
    if (!eventId) throw new Error('Evento Asaas sem identificador.');

    const value = roundMoney(toNumberOrNull(payment.value) ?? 0);
    const netValue = toNumberOrNull(payment.netValue);
    const fee = netValue !== null ? roundMoney(Math.max(0, value - netValue)) : null;

    const base: Omit<NormalizedPaymentEvent, 'kind' | 'grossAmount'> = {
      paymentRef: paymentId || eventId,
      feeAmount: fee,
      netAmount: netValue !== null ? roundMoney(netValue) : null,
      currency: 'BRL',
      competenceDate: toISODateBR(payment.confirmedDate ?? payment.paymentDate ?? payment.dateCreated, ctx.now),
      settlementDate: toISODateBR(
        payment.creditDate ?? payment.estimatedCreditDate ?? payment.clientPaymentDate ?? payment.paymentDate,
        ctx.now
      ),
      description:
        (typeof payment.description === 'string' && payment.description) ||
        `Asaas ${typeof payment.billingType === 'string' ? payment.billingType : 'cobrança'}`,
      productHint: typeof payment.externalReference === 'string' ? payment.externalReference : null,
    };

    let normalized: NormalizedPaymentEvent;
    if (SETTLED.has(event) && value > 0) {
      normalized = { ...base, kind: 'payment_settled', grossAmount: value };
    } else if (PENDING.has(event) && value > 0) {
      normalized = { ...base, kind: event === 'PAYMENT_CREATED' ? 'ignored' : 'payment_pending', grossAmount: value, ignoredReason: event === 'PAYMENT_CREATED' ? 'cobrança criada (sem pagamento)' : undefined };
    } else if (REFUND.has(event) && value > 0) {
      const refunds = Array.isArray(payment.refunds) ? (payment.refunds as Obj[]) : [];
      const refundedSum = refunds.reduce((s, r) => s + (toNumberOrNull(r.value) ?? 0), 0);
      const refundedValue = roundMoney(refundedSum > 0 ? refundedSum : value);
      normalized = { ...base, kind: 'refund', grossAmount: refundedValue, feeAmount: 0, netAmount: refundedValue };
    } else {
      normalized = { ...base, kind: 'ignored', grossAmount: 0, ignoredReason: `evento ${event}` };
    }

    return { externalEventId: eventId, eventType: event, normalized, storedPayload: payload };
  },
};
