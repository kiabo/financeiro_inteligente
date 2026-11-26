import {
  WebhookSignatureError,
  type NormalizedPaymentEvent,
  type PaymentProviderAdapter,
  type ResolvedWebhookEvent,
} from '../types.ts';
import { hmacSha256, parseSignatureHeader, roundMoney, safeEqualHex, toISODateBR } from '../utils.ts';

/**
 * Stripe — assinatura `Stripe-Signature: t=<epoch>,v1=<hmac>`
 * signed_payload = `${t}.${corpo_bruto}`, HMAC-SHA256 com o "whsec_..." do endpoint.
 * Valores em centavos. Taxa só vem no evento quando `balance_transaction` está expandido;
 * caso contrário o núcleo aplica fee_pct/fee_fixed configurados na conexão.
 */

const SETTLED_EVENTS = new Set(['payment_intent.succeeded', 'charge.succeeded', 'checkout.session.completed', 'invoice.paid']);
const PENDING_EVENTS = new Set(['checkout.session.async_payment_pending', 'payment_intent.processing']);
const REFUND_EVENTS = new Set(['charge.refunded']);

type Obj = Record<string, unknown>;

const asObj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const cents = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? roundMoney(v / 100) : 0);

export const stripeAdapter: PaymentProviderAdapter = {
  provider: 'stripe',
  displayName: 'Stripe',

  verifySignature(ctx, secrets, config) {
    const header = ctx.headers['stripe-signature'];
    if (!header) throw new WebhookSignatureError('Cabeçalho Stripe-Signature ausente.');
    const parts = parseSignatureHeader(header);
    const t = parts.get('t')?.[0];
    const v1List = parts.get('v1') ?? [];
    if (!t || !/^\d+$/.test(t) || v1List.length === 0) {
      throw new WebhookSignatureError('Cabeçalho Stripe-Signature malformado.');
    }
    const tolerance = config.signature_tolerance_seconds ?? 300;
    const ageSeconds = Math.abs(Math.floor(ctx.now.getTime() / 1000) - Number(t));
    if (ageSeconds > tolerance) {
      throw new WebhookSignatureError('Assinatura Stripe fora da janela de tolerância (possível replay).');
    }
    const expected = hmacSha256(secrets.signingSecret, `${t}.${ctx.rawBody.toString('utf8')}`);
    if (!v1List.some((sig) => safeEqualHex(sig, expected))) {
      throw new WebhookSignatureError('Assinatura Stripe inválida.');
    }
  },

  async resolve(payload, ctx): Promise<ResolvedWebhookEvent> {
    const eventId = typeof payload.id === 'string' ? payload.id : '';
    const eventType = typeof payload.type === 'string' ? payload.type : 'unknown';
    if (!eventId) throw new Error('Evento Stripe sem id.');

    const obj = asObj(asObj(payload.data).object);
    const created = typeof payload.created === 'number' ? payload.created : undefined;
    const currency = (typeof obj.currency === 'string' ? obj.currency : 'brl').toUpperCase();
    const metadata = asObj(obj.metadata);
    const productHint =
      (typeof metadata.vertice_product === 'string' && metadata.vertice_product) ||
      (typeof metadata.sku === 'string' && metadata.sku) ||
      null;

    const paymentRef =
      (typeof obj.payment_intent === 'string' && obj.payment_intent) ||
      (typeof obj.id === 'string' && obj.id) ||
      eventId;

    const balanceTx = asObj(obj.balance_transaction);
    const feeFromBalance = typeof balanceTx.fee === 'number' ? cents(balanceTx.fee) : null;

    const description =
      (typeof obj.description === 'string' && obj.description) ||
      (typeof metadata.description === 'string' && metadata.description) ||
      `Stripe ${eventType}`;

    const base: Omit<NormalizedPaymentEvent, 'kind' | 'grossAmount'> = {
      paymentRef,
      feeAmount: feeFromBalance,
      netAmount: typeof balanceTx.net === 'number' ? cents(balanceTx.net) : null,
      currency,
      competenceDate: toISODateBR(created, ctx.now),
      settlementDate: toISODateBR(
        typeof balanceTx.available_on === 'number' ? balanceTx.available_on : created,
        ctx.now
      ),
      description: description.slice(0, 180),
      productHint,
    };

    let normalized: NormalizedPaymentEvent;
    if (SETTLED_EVENTS.has(eventType)) {
      const gross =
        cents(obj.amount_received) || cents(obj.amount_total) || cents(obj.amount_paid) || cents(obj.amount);
      normalized = { ...base, kind: gross > 0 ? 'payment_settled' : 'ignored', grossAmount: gross, ignoredReason: gross > 0 ? undefined : 'valor zero' };
    } else if (PENDING_EVENTS.has(eventType)) {
      const gross = cents(obj.amount_total) || cents(obj.amount);
      normalized = { ...base, kind: gross > 0 ? 'payment_pending' : 'ignored', grossAmount: gross };
    } else if (REFUND_EVENTS.has(eventType)) {
      const refunded = cents(obj.amount_refunded);
      normalized = { ...base, kind: refunded > 0 ? 'refund' : 'ignored', grossAmount: refunded, feeAmount: 0, netAmount: refunded };
    } else {
      normalized = { ...base, kind: 'ignored', grossAmount: 0, ignoredReason: `tipo ${eventType} não mapeado` };
    }

    return { externalEventId: eventId, eventType, normalized, storedPayload: payload };
  },
};
