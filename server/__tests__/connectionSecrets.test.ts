import crypto from 'crypto';
import { assert, assertEqual, assertRejects, runCases, type TestCase, type TestCaseResult } from '../../scripts/testHarness.ts';
import { decryptSecret, encryptSecret } from '../crypto/secretBox.ts';
import { auditFieldsFor, prepareSigningSecretChange } from '../integrations/connectionSecrets.ts';
import { buildTestRequest, presentConnection } from '../integrations/webhookRoutes.ts';
import { asaasAdapter } from '../integrations/webhooks/adapters/asaas.ts';
import { customJsonMappingAdapter, CUSTOM_DEFAULT_MAPPING } from '../integrations/webhooks/adapters/customJsonMapping.ts';
import { createMercadoPagoAdapter } from '../integrations/webhooks/adapters/mercadopago.ts';
import { stripeAdapter } from '../integrations/webhooks/adapters/stripe.ts';
import type { PaymentProviderAdapter, WebhookRequestContext } from '../integrations/webhooks/types.ts';

const KEY = crypto.randomBytes(32);
const TENANT = 'tenant-A';
const NOW = new Date('2026-11-27T15:00:00Z');
const OLD = 'segredo-antigo-123';
const NEW = 'segredo-novo-4567';
const hmac = (secret: string, data: string) => crypto.createHmac('sha256', secret).update(data).digest('hex');

/** Segredo "guardado" depois da troca: o que o servidor decifraria ao validar um webhook. */
const storedAfterChange = (raw: string) => decryptSecret(prepareSigningSecretChange(raw, TENANT, KEY).encrypted, TENANT, KEY);

function ctxFrom(req: { rawBody: Buffer; headers: Record<string, string> }): WebhookRequestContext {
  return { rawBody: req.rawBody, headers: req.headers, query: {}, now: NOW };
}

async function accepts(adapter: PaymentProviderAdapter, ctx: WebhookRequestContext, secret: string, config = {}): Promise<boolean> {
  try {
    await adapter.verifySignature(ctx, { signingSecret: secret }, config);
    return true;
  } catch {
    return false;
  }
}

const cases: TestCase[] = [
  ['segredo: é cifrado, decifra com o tenant certo e não aparece em claro (CA1)', () => {
    const { encrypted } = prepareSigningSecretChange(NEW, TENANT, KEY);
    assert(encrypted.startsWith('v1:') && !encrypted.includes(NEW), 'o valor não pode aparecer em claro');
    assertEqual(decryptSecret(encrypted, TENANT, KEY), NEW, 'roundtrip');
  }],
  ['segredo: copiado para outro tenant não decifra (CA1/CA5)', async () => {
    const { encrypted } = prepareSigningSecretChange(NEW, TENANT, KEY);
    await assertRejects(() => decryptSecret(encrypted, 'tenant-B', KEY), /.+/, 'AAD diferente deve falhar');
  }],
  ['segredo: menos de 8 caracteres, vazio, só espaços e valor não textual são recusados (CA3)', async () => {
    for (const bad of ['1234567', '', '        ', '   abc   ', null, undefined, 12345678, { a: 1 }]) {
      await assertRejects(() => prepareSigningSecretChange(bad, TENANT, KEY), /8 caracteres/, `recusar ${JSON.stringify(bad)}`);
    }
  }],
  ['segredo: espaços nas pontas são removidos antes de cifrar (CA3)', () => {
    assertEqual(storedAfterChange('  segredo-com-espacos  '), 'segredo-com-espacos', 'trim');
  }],
  ['troca no Asaas: o token antigo é recusado e o novo é aceito (CA2)', async () => {
    const mk = (secret: string) => ctxFrom(buildTestRequest('asaas', secret, {}, NOW));
    assert(await accepts(asaasAdapter, mk(OLD), OLD), 'antes da troca o antigo passa');
    const stored = storedAfterChange(NEW);
    assert(!(await accepts(asaasAdapter, mk(OLD), stored)), 'depois da troca o antigo é recusado');
    assert(await accepts(asaasAdapter, mk(NEW), stored), 'depois da troca o novo é aceito');
  }],
  ['troca no Stripe: a assinatura com o segredo antigo é recusada e a do novo é aceita (CA2)', async () => {
    const mk = (secret: string) => ctxFrom(buildTestRequest('stripe', secret, {}, NOW));
    assert(await accepts(stripeAdapter, mk(OLD), OLD), 'antes da troca o antigo passa');
    const stored = storedAfterChange(NEW);
    assert(!(await accepts(stripeAdapter, mk(OLD), stored)), 'antigo recusado');
    assert(await accepts(stripeAdapter, mk(NEW), stored), 'novo aceito');
  }],
  ['troca no JSON customizado: HMAC antigo é recusado e o novo é aceito (CA2)', async () => {
    const mk = (secret: string) => ctxFrom(buildTestRequest('custom_json_mapping', secret, {}, NOW));
    const config = { mapping: CUSTOM_DEFAULT_MAPPING };
    assert(await accepts(customJsonMappingAdapter, mk(OLD), OLD, config), 'antes da troca o antigo passa');
    const stored = storedAfterChange(NEW);
    assert(!(await accepts(customJsonMappingAdapter, mk(OLD), stored, config)), 'antigo recusado');
    assert(await accepts(customJsonMappingAdapter, mk(NEW), stored, config), 'novo aceito');
  }],
  ['troca no Mercado Pago: assinatura com o segredo antigo é recusada e a do novo é aceita (CA2)', async () => {
    const adapter = createMercadoPagoAdapter(async () => ({}));
    const ts = String(NOW.getTime());
    const manifest = `id:123456;request-id:req-1;ts:${ts};`;
    const body = JSON.stringify({ type: 'payment', data: { id: '123456' } });
    const mk = (secret: string): WebhookRequestContext => ({
      rawBody: Buffer.from(body),
      headers: { 'x-signature': `ts=${ts},v1=${hmac(secret, manifest)}`, 'x-request-id': 'req-1' },
      query: { 'data.id': '123456' },
      now: NOW,
    });
    assert(await accepts(adapter, mk(OLD), OLD), 'antes da troca o antigo passa');
    const stored = storedAfterChange(NEW);
    assert(!(await accepts(adapter, mk(OLD), stored)), 'antigo recusado');
    assert(await accepts(adapter, mk(NEW), stored), 'novo aceito');
  }],
  ['resposta da conexão: não contém o segredo nem o texto cifrado (CA1)', () => {
    const sealed = encryptSecret(NEW, TENANT, KEY);
    const view = presentConnection(
      { id: 'c1', provider: 'asaas', webhook_secret_id: 'a'.repeat(32), signing_secret_encrypted: sealed, credentials_encrypted: 'v1:cifrado' },
      'https://exemplo.test'
    );
    const text = JSON.stringify(view);
    for (const forbidden of [NEW, sealed, 'v1:cifrado', 'signing_secret', 'credentials_encrypted']) {
      assert(!text.includes(forbidden), `não pode conter ${forbidden}`);
    }
  }],
  ['auditoria: lista o campo trocado e nunca o valor (CA4)', () => {
    const { encrypted } = prepareSigningSecretChange(NEW, TENANT, KEY);
    const fields = auditFieldsFor({ signing_secret_encrypted: encrypted, label: 'Nova' });
    assertEqual(JSON.stringify(fields), JSON.stringify(['signing_secret', 'label']), 'campos');
    assert(!JSON.stringify(fields).includes(NEW) && !JSON.stringify(fields).includes(encrypted), 'sem valor');
  }],
];

export async function runConnectionSecretsTests(): Promise<TestCaseResult[]> {
  return runCases(cases);
}
