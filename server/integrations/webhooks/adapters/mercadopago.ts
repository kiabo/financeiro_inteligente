import {
  WebhookSignatureError,
  type NormalizedPaymentEvent,
  type PaymentProviderAdapter,
  type ResolvedWebhookEvent,
} from '../types.ts';
import { hmacSha256, parseSignatureHeader, roundMoney, safeEqualHex, toISODateBR, toNumberOrNull } from '../utils.ts';

/**
 * Mercado Pago — cabeçalhos `x-signature: ts=<ms>,v1=<hmac>` e `x-request-id`.
 * Manifesto assinado: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 * (data.id vem da query string; se alfanumérico, em minúsculas).
 *
 * IMPORTANTE: a assinatura do MP NÃO cobre o corpo. Por isso o corpo nunca é confiável:
 * o adaptador consulta GET /v1/payments/{id} com o access token da conexão para obter
 * valor, taxa, status e datas reais.
 */

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});

export type MercadoPagoFetcher = (paymentId: string, accessToken: string) => Promise<Obj>;

export const defaultMercadoPagoFetcher: MercadoPagoFetcher = async (paymentId, accessToken) => {
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Mercado Pago respondeu ${res.status} ao consultar o pagamento.`);
  }
  return (await res.json()) as Obj;
};

function resolveDataId(ctx: { query: Record<string, string | undefined> }, payload: Obj): string {
  const fromQuery = ctx.query['data.id'] ?? ctx.query.id;
  const fromBody = asObj(payload.data).id;
  const raw = fromQuery ?? (typeof fromBody === 'string' || typeof fromBody === 'number' ? String(fromBody) : '');
  return /^[a-z0-9]+$/i.test(raw) ? raw.toLowerCase() : raw;
}

export interface NormalizedMercadoPagoPayment {
  normalized: NormalizedPaymentEvent;
  /** Status do pagamento no Mercado Pago (ex.: approved, pending, refunded) */
  status: string;
  paymentRef: string;
  feeSum: number;
  net: number | null;
}

/** Nome do pagador (first_name + last_name), sem e-mail nem documento. Ausente → null. */
export function mercadoPagoPayerName(payment: Obj): string | null {
  const payer = asObj(payment.payer);
  const name = [payer.first_name, payer.last_name]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim())
    .join(' ');
  return name ? name.slice(0, 160) : null;
}

/**
 * Normaliza um pagamento do Mercado Pago (resposta de `GET /v1/payments/{id}` ou item de `/v1/payments/search`).
 * Usada pelo webhook e pela importação de histórico: as duas têm que produzir o mesmo resultado.
 */
export function normalizeMercadoPagoPayment(payment: Obj, fallbackId: string, now: Date): NormalizedMercadoPagoPayment {
  const status = typeof payment.status === 'string' ? payment.status : 'unknown';
  const gross = roundMoney(toNumberOrNull(payment.transaction_amount) ?? 0);
  const feeDetails = Array.isArray(payment.fee_details) ? (payment.fee_details as Obj[]) : [];
  const feeSum = feeDetails.reduce((s, f) => s + (toNumberOrNull(f.amount) ?? 0), 0);
  const net = toNumberOrNull(asObj(payment.transaction_details).net_received_amount);
  const refunded = roundMoney(toNumberOrNull(payment.transaction_amount_refunded) ?? 0);

  const base: Omit<NormalizedPaymentEvent, 'kind' | 'grossAmount'> = {
    paymentRef: String(payment.id ?? fallbackId),
    feeAmount: feeDetails.length > 0 ? roundMoney(feeSum) : null,
    netAmount: net !== null ? roundMoney(net) : null,
    currency: (typeof payment.currency_id === 'string' ? payment.currency_id : 'BRL').toUpperCase(),
    competenceDate: toISODateBR(payment.date_approved ?? payment.date_created, now),
    settlementDate: toISODateBR(payment.money_release_date ?? payment.date_approved ?? payment.date_created, now),
    description: (typeof payment.description === 'string' && payment.description) || 'Pagamento Mercado Pago',
    productHint: typeof payment.external_reference === 'string' ? payment.external_reference : null,
    counterpartyName: mercadoPagoPayerName(payment),
  };

  let normalized: NormalizedPaymentEvent;
  if (status === 'approved') {
    normalized = { ...base, kind: 'payment_settled', grossAmount: gross };
  } else if (status === 'pending' || status === 'in_process' || status === 'authorized') {
    // Pendente com data de expiração (ex.: Pix/boleto): o vencimento é a expiração
    const expiration = payment.date_of_expiration;
    normalized = {
      ...base,
      settlementDate: expiration ? toISODateBR(expiration, now) : base.settlementDate,
      kind: 'payment_pending',
      grossAmount: gross,
    };
  } else if ((status === 'refunded' || status === 'charged_back') && (refunded || gross) > 0) {
    normalized = {
      ...base,
      kind: 'refund',
      grossAmount: refunded || gross,
      feeAmount: 0,
      netAmount: refunded || gross,
      settlementDate: toISODateBR(payment.date_last_updated, now),
    };
  } else {
    normalized = { ...base, kind: 'ignored', grossAmount: 0, ignoredReason: `status ${status}` };
  }

  return { normalized, status, paymentRef: base.paymentRef, feeSum, net };
}

export function createMercadoPagoAdapter(fetcher: MercadoPagoFetcher = defaultMercadoPagoFetcher): PaymentProviderAdapter {
  return {
    provider: 'mercadopago',
    displayName: 'Mercado Pago',

    verifySignature(ctx, secrets, config) {
      const header = ctx.headers['x-signature'];
      const requestId = ctx.headers['x-request-id'] ?? '';
      if (!header) throw new WebhookSignatureError('Cabeçalho x-signature ausente.');
      const parts = parseSignatureHeader(header);
      const ts = parts.get('ts')?.[0];
      const v1 = parts.get('v1')?.[0];
      if (!ts || !v1) throw new WebhookSignatureError('Cabeçalho x-signature malformado.');

      let payload: Obj = {};
      try {
        payload = JSON.parse(ctx.rawBody.toString('utf8') || '{}') as Obj;
      } catch {
        payload = {};
      }
      const dataId = resolveDataId(ctx, payload);

      // Monta o manifesto omitindo partes ausentes, conforme documentação do MP
      let manifest = '';
      if (dataId) manifest += `id:${dataId};`;
      if (requestId) manifest += `request-id:${requestId};`;
      manifest += `ts:${ts};`;

      const expected = hmacSha256(secrets.signingSecret, manifest);
      if (!safeEqualHex(v1, expected)) {
        throw new WebhookSignatureError('Assinatura Mercado Pago inválida.');
      }

      const toleranceMs = (config.signature_tolerance_seconds ?? 600) * 1000;
      const tsNum = Number(ts);
      const tsMs = tsNum < 1e12 ? tsNum * 1000 : tsNum;
      if (Number.isFinite(tsMs) && Math.abs(ctx.now.getTime() - tsMs) > toleranceMs) {
        throw new WebhookSignatureError('Assinatura Mercado Pago fora da janela de tolerância.');
      }
    },

    async resolve(payload, ctx, secrets): Promise<ResolvedWebhookEvent> {
      const type = typeof payload.type === 'string' ? payload.type : typeof payload.topic === 'string' ? payload.topic : '';
      const action = typeof payload.action === 'string' ? payload.action : type;
      const dataId = resolveDataId(ctx, payload);

      if (type !== 'payment' || !dataId) {
        return {
          externalEventId: `mp:${type || 'unknown'}:${dataId || String(payload.id ?? 'sem-id')}`,
          eventType: action || 'unknown',
          storedPayload: payload,
          normalized: {
            kind: 'ignored',
            paymentRef: dataId || 'n/a',
            grossAmount: 0,
            feeAmount: null,
            netAmount: null,
            currency: 'BRL',
            competenceDate: toISODateBR(undefined, ctx.now),
            settlementDate: toISODateBR(undefined, ctx.now),
            description: 'Notificação Mercado Pago não relacionada a pagamento',
            productHint: null,
            ignoredReason: `tópico ${type || 'desconhecido'}`,
          },
        };
      }

      if (!secrets.apiAccessToken) {
        throw new Error('Conexão Mercado Pago sem access token: não é possível consultar o pagamento.');
      }
      const payment = await fetcher(dataId, secrets.apiAccessToken);
      const { normalized, status, paymentRef, feeSum, net } = normalizeMercadoPagoPayment(payment, dataId, ctx.now);

      // Idempotência por (pagamento, status): "created" e "updated" do mesmo status não duplicam
      return {
        externalEventId: `mp:payment:${paymentRef}:${status}`,
        eventType: `payment.${status}`,
        normalized,
        storedPayload: {
          notification: payload,
          payment: {
            id: payment.id,
            status,
            status_detail: payment.status_detail,
            transaction_amount: payment.transaction_amount,
            fee_total: feeSum,
            net_received_amount: net,
            date_approved: payment.date_approved,
            money_release_date: payment.money_release_date,
            payment_method_id: payment.payment_method_id,
            external_reference: payment.external_reference,
          },
        },
      };
    },
  };
}

export const mercadoPagoAdapter = createMercadoPagoAdapter();
