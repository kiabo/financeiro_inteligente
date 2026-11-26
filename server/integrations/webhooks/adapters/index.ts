import type { PaymentProviderAdapter, WebhookProviderId } from '../types.ts';
import { asaasAdapter } from './asaas.ts';
import { customJsonMappingAdapter, openFinanceGenericAdapter } from './customJsonMapping.ts';
import { mercadoPagoAdapter } from './mercadopago.ts';
import { stripeAdapter } from './stripe.ts';

const REGISTRY: Record<WebhookProviderId, PaymentProviderAdapter> = {
  stripe: stripeAdapter,
  mercadopago: mercadoPagoAdapter,
  asaas: asaasAdapter,
  openfinance_generic: openFinanceGenericAdapter,
  custom_json_mapping: customJsonMappingAdapter,
};

export function getPaymentAdapter(provider: string): PaymentProviderAdapter | null {
  return (REGISTRY as Record<string, PaymentProviderAdapter | undefined>)[provider] ?? null;
}

export function listPaymentAdapters(): PaymentProviderAdapter[] {
  return Object.values(REGISTRY);
}
