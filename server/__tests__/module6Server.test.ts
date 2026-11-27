import crypto from 'crypto';
import {
  assert,
  assertClose,
  assertEqual,
  assertRejects,
  runCases,
  type TestCase,
  type TestCaseResult,
} from '../../scripts/testHarness.ts';
import { decryptBackupPayload, encryptBackupPayload, readBackupHeader } from '../crypto/backupCrypto.ts';
import { decryptSecret, encryptSecret } from '../crypto/secretBox.ts';
import { buildGoogleReturnUrl } from '../integrations/automationRoutes.ts';
import { buildAgendaItems } from '../integrations/alerts/agendaBuilder.ts';
import { composeDueTodayMessage, composeOverdueMessage } from '../integrations/alerts/notificationService.ts';
import { asaasAdapter } from '../integrations/webhooks/adapters/asaas.ts';
import { customJsonMappingAdapter, CUSTOM_DEFAULT_MAPPING } from '../integrations/webhooks/adapters/customJsonMapping.ts';
import { createMercadoPagoAdapter } from '../integrations/webhooks/adapters/mercadopago.ts';
import { stripeAdapter } from '../integrations/webhooks/adapters/stripe.ts';
import type { NormalizedPaymentEvent, WebhookRequestContext } from '../integrations/webhooks/types.ts';
import { planTransactionsForEvent, resolveFeeAmount } from '../integrations/webhooks/webhookCore.ts';
import { buildRestoreSql, type BackupDump } from '../integrations/backupService.ts';
import type { WorkspaceCfoSource } from '../../src/modules/ai-cfo/cfoAgent.ts';
import type { Category } from '../../src/modules/core/types.ts';

const KEY = crypto.randomBytes(32);
const NOW = new Date('2026-11-26T15:00:00Z');
const hmac = (secret: string, data: string | Buffer) => crypto.createHmac('sha256', secret).update(data).digest('hex');
const ctxOf = (body: string, headers: Record<string, string>, query: Record<string, string> = {}): WebhookRequestContext => ({
  rawBody: Buffer.from(body),
  headers,
  query,
  now: NOW,
});

const cases: TestCase[] = [
  // ---------------------------------------------------------------- Criptografia
  ['secretBox: cifra e decifra com AAD do tenant', () => {
    const sealed = encryptSecret('whsec_abc123', 'tenant-A', KEY);
    assert(sealed.startsWith('v1:') && !sealed.includes('whsec_abc123'), 'segredo não pode aparecer em claro');
    assertEqual(decryptSecret(sealed, 'tenant-A', KEY), 'whsec_abc123', 'roundtrip');
  }],
  ['secretBox: segredo copiado para outro tenant não decifra (AAD)', async () => {
    const sealed = encryptSecret('token-x', 'tenant-A', KEY);
    await assertRejects(() => decryptSecret(sealed, 'tenant-B', KEY), /.+/, 'AAD diferente deve falhar');
  }],
  ['secretBox: adulteração do ciphertext é detectada', async () => {
    const sealed = encryptSecret('token-y', 't', KEY);
    const raw = Buffer.from(sealed.slice(3), 'base64');
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 0xff;
    await assertRejects(() => decryptSecret(`v1:${raw.toString('base64')}`, 't', KEY), /.+/, 'GCM deve rejeitar');
  }],
  ['backup: AES-256-GCM roundtrip com gzip e cabeçalho autenticado', () => {
    const json = JSON.stringify({ hello: 'mundo', rows: Array.from({ length: 200 }, (_, i) => ({ i })) });
    const pkg = encryptBackupPayload(json, 'senha-muito-longa-para-backup-1234', 'ref123', NOW);
    assert(!pkg.toString('latin1').includes('mundo'), 'conteúdo não pode estar em claro');
    const { header } = readBackupHeader(pkg);
    assertEqual(header.tenantRef, 'ref123', 'tenantRef no cabeçalho');
    assertEqual(decryptBackupPayload(pkg, 'senha-muito-longa-para-backup-1234').json, json, 'roundtrip');
  }],
  ['backup: chave errada e cabeçalho adulterado são rejeitados', async () => {
    const pkg = encryptBackupPayload('{"a":1}', 'senha-muito-longa-para-backup-1234', 'ref', NOW);
    await assertRejects(() => decryptBackupPayload(pkg, 'outra-senha-totalmente-diferente-99'), /chave incorreta|adulterado/, 'senha errada');
    const tampered = Buffer.from(pkg);
    const idx = tampered.indexOf(Buffer.from('"ref"'));
    tampered[idx + 1] = 'x'.charCodeAt(0);
    await assertRejects(() => decryptBackupPayload(tampered, 'senha-muito-longa-para-backup-1234'), /adulterado|chave/, 'header adulterado');
  }],
  ['backup: SQL de restauração usa replica + ON CONFLICT DO NOTHING', () => {
    const dump: BackupDump = {
      format: 'vertice-backup', version: 1, createdAt: NOW.toISOString(), tenantId: 't1', migrations: [],
      tables: { companies: { count: 1, rows: [{ id: 'c1', legal_name: "O'Brien $$ Ltda" }] } }, userProfile: null,
    };
    const sql = buildRestoreSql(dump);
    assert(sql.includes("session_replication_role = 'replica'"), 'replica');
    assert(sql.includes('ON CONFLICT DO NOTHING'), 'sem sobrescrita');
    assert(sql.includes("O'Brien $$ Ltda"), 'aspas e $$ preservados via dollar-quote com tag');
  }],

  // ---------------------------------------------------------------- Stripe
  ['Stripe: assinatura válida aceita e evento normalizado em reais', async () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded', created: Math.floor(NOW.getTime() / 1000), data: { object: { id: 'pi_1', amount_received: 12345, currency: 'brl', description: 'Plano Pro' } } });
    const t = Math.floor(NOW.getTime() / 1000);
    const ctx = ctxOf(body, { 'stripe-signature': `t=${t},v1=${hmac('whsec_test', `${t}.${body}`)}` });
    stripeAdapter.verifySignature(ctx, { signingSecret: 'whsec_test' }, {});
    const r = await stripeAdapter.resolve(JSON.parse(body), ctx, { signingSecret: 'whsec_test' }, {});
    assertEqual(r.externalEventId, 'evt_1', 'id idempotente = id do evento');
    assertEqual(r.normalized.kind, 'payment_settled', 'kind');
    assertClose(r.normalized.grossAmount, 123.45, 'centavos → reais');
  }],
  ['Stripe: assinatura inválida e replay fora da janela rejeitados', async () => {
    const body = '{"id":"evt_2","type":"charge.succeeded","data":{"object":{}}}';
    const t = Math.floor(NOW.getTime() / 1000);
    await assertRejects(() => stripeAdapter.verifySignature(ctxOf(body, { 'stripe-signature': `t=${t},v1=${hmac('outro', `${t}.${body}`)}` }), { signingSecret: 'whsec_test' }, {}), /inválida/, 'assinatura errada');
    const old = t - 3600;
    await assertRejects(() => stripeAdapter.verifySignature(ctxOf(body, { 'stripe-signature': `t=${old},v1=${hmac('whsec_test', `${old}.${body}`)}` }), { signingSecret: 'whsec_test' }, {}), /tolerância/, 'replay');
  }],

  // ---------------------------------------------------------------- Mercado Pago
  ['Mercado Pago: manifesto id/request-id/ts e consulta da API (corpo não confiável)', async () => {
    const ts = String(NOW.getTime());
    const manifest = `id:123456;request-id:req-1;ts:${ts};`;
    const body = JSON.stringify({ type: 'payment', action: 'payment.updated', data: { id: '123456' } });
    const ctx = ctxOf(body, { 'x-signature': `ts=${ts},v1=${hmac('mp-secret', manifest)}`, 'x-request-id': 'req-1' }, { 'data.id': '123456' });
    let fetchedWith = '';
    const adapter = createMercadoPagoAdapter(async (id, token) => {
      fetchedWith = `${id}|${token}`;
      return { id: 123456, status: 'approved', transaction_amount: 200, fee_details: [{ amount: 9.98 }], transaction_details: { net_received_amount: 190.02 }, date_approved: '2026-11-25T10:00:00-03:00', money_release_date: '2026-11-25T10:00:00-03:00', description: 'Pedido' };
    });
    adapter.verifySignature(ctx, { signingSecret: 'mp-secret', apiAccessToken: 'APP_USR' }, {});
    const r = await adapter.resolve(JSON.parse(body), ctx, { signingSecret: 'mp-secret', apiAccessToken: 'APP_USR' }, {});
    assertEqual(fetchedWith, '123456|APP_USR', 'consulta a API com o token');
    assertEqual(r.externalEventId, 'mp:payment:123456:approved', 'idempotência por pagamento+status');
    assertClose(r.normalized.feeAmount ?? -1, 9.98, 'taxa real do MP');
    assertEqual(r.normalized.settlementDate, '2026-11-25', 'data de liberação no fuso BR');
  }],
  ['Mercado Pago: assinatura com data.id trocado é rejeitada', async () => {
    const ts = String(NOW.getTime());
    const sig = hmac('mp-secret', `id:111;request-id:req-1;ts:${ts};`);
    const ctx = ctxOf('{"type":"payment","data":{"id":"222"}}', { 'x-signature': `ts=${ts},v1=${sig}`, 'x-request-id': 'req-1' }, { 'data.id': '222' });
    await assertRejects(() => createMercadoPagoAdapter().verifySignature(ctx, { signingSecret: 'mp-secret' }, {}), /inválida/, 'id adulterado');
  }],

  // ---------------------------------------------------------------- Asaas / Custom
  ['Asaas: token do cabeçalho + taxa = value − netValue', async () => {
    const payload = { id: 'evt_a', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', value: 100, netValue: 97.01, paymentDate: '2026-11-20', creditDate: '2026-11-21' } };
    const ctx = ctxOf(JSON.stringify(payload), { 'asaas-access-token': 'tok-asaas-123' });
    asaasAdapter.verifySignature(ctx, { signingSecret: 'tok-asaas-123' }, {});
    await assertRejects(() => asaasAdapter.verifySignature(ctxOf('{}', { 'asaas-access-token': 'x' }), { signingSecret: 'tok-asaas-123' }, {}), /inválido/, 'token errado');
    const r = await asaasAdapter.resolve(payload, ctx, { signingSecret: 'tok-asaas-123' }, {});
    assertClose(r.normalized.feeAmount ?? -1, 2.99, 'taxa Asaas');
    assertEqual(r.normalized.settlementDate, '2026-11-21', 'creditDate');
  }],
  ['Mapeamento customizado: HMAC do corpo + caminhos configuráveis + centavos', async () => {
    const mapping = { ...CUSTOM_DEFAULT_MAPPING, amount_in_cents: true };
    const payload = { id: 'e1', event: 'x', payment: { id: 'p1', amount: 5000, fee: 150, status: 'paid', paid_at: '2026-11-26' } };
    const body = JSON.stringify(payload);
    const ctx = ctxOf(body, { 'x-signature': `sha256=${hmac('hmac-secret', body)}` });
    customJsonMappingAdapter.verifySignature(ctx, { signingSecret: 'hmac-secret' }, { mapping });
    const r = await customJsonMappingAdapter.resolve(payload, ctx, { signingSecret: 'hmac-secret' }, { mapping });
    assertClose(r.normalized.grossAmount, 50, 'centavos');
    assertClose(r.normalized.feeAmount ?? -1, 1.5, 'taxa');
    await assertRejects(() => customJsonMappingAdapter.verifySignature(ctxOf(body + ' ', { 'x-signature': hmac('hmac-secret', body) }), { signingSecret: 'hmac-secret' }, { mapping }), /inválida/, 'corpo alterado');
  }],

  // ---------------------------------------------------------------- Planejamento de lançamentos
  ['Núcleo: receita bruta + taxa separada (margem real preservada)', () => {
    const cats: Category[] = [
      { id: 'cat-11', tenant_id: 't', company_id: 'c', parent_id: 'p', code: '1.1', name: 'Venda', group_type: 'operational_revenue', direction: 'inflow', is_system: true, is_active: true, created_at: '', updated_at: '' },
      { id: 'cat-22', tenant_id: 't', company_id: 'c', parent_id: 'p', code: '2.2', name: 'Taxas', group_type: 'tax_deduction', direction: 'outflow', is_system: true, is_active: true, created_at: '', updated_at: '' },
    ];
    const ev: NormalizedPaymentEvent = { kind: 'payment_settled', paymentRef: 'pi_9', grossAmount: 100, feeAmount: 3.99, netAmount: null, currency: 'BRL', competenceDate: '2026-11-20', settlementDate: '2026-11-20', description: 'Venda', productHint: null };
    const rows = planTransactionsForEvent({ connection: { tenant_id: 't', company_id: 'c', account_id: 'a', provider: 'stripe', config: {} }, providerName: 'Stripe', normalized: ev, categories: cats, products: [], todayISO: '2026-11-26' });
    assertEqual(rows.length, 2, 'receita + taxa');
    assertEqual(rows[0]?.category_id, 'cat-11', 'categoria de venda');
    assertEqual(rows[1]?.category_id, 'cat-22', 'categoria de taxa');
    assertEqual(rows[0]?.status, 'paid', 'liquidado no passado → pago');
    assertClose(rows[1]?.amount ?? 0, 3.99, 'valor da taxa');
  }],
  ['Núcleo: crédito futuro (D+30) fica pendente; estorno vira despesa; ignorado não lança', () => {
    const base: NormalizedPaymentEvent = { kind: 'payment_settled', paymentRef: 'x', grossAmount: 80, feeAmount: null, netAmount: null, currency: 'BRL', competenceDate: '2026-11-26', settlementDate: '2026-12-26', description: 'Cartão', productHint: null };
    const conn = { tenant_id: 't', company_id: 'c', account_id: 'a', provider: 'asaas', config: { fee_pct: 2.5, fee_fixed: 0.5 } };
    const future = planTransactionsForEvent({ connection: conn, providerName: 'Asaas', normalized: base, categories: [], products: [], todayISO: '2026-11-26' });
    assertEqual(future[0]?.status, 'pending', 'pendente até o crédito');
    assert(future[0]?.notes.endsWith(':settled') ?? false, 'marcador para liquidação automática');
    assertClose(resolveFeeAmount(base, conn.config), 2.5, 'fee_pct + fee_fixed aplicados');
    const refund = planTransactionsForEvent({ connection: conn, providerName: 'Asaas', normalized: { ...base, kind: 'refund', settlementDate: '2026-11-25' }, categories: [], products: [], todayISO: '2026-11-26' });
    assertEqual(refund.length, 1, 'estorno = 1 lançamento');
    assertEqual(refund[0]?.transaction_type, 'expense', 'estorno é saída');
    assertEqual(planTransactionsForEvent({ connection: conn, providerName: 'Asaas', normalized: { ...base, kind: 'ignored' }, categories: [], products: [], todayISO: '2026-11-26' }).length, 0, 'ignorado');
  }],

  // ---------------------------------------------------------------- Agenda & alertas
  ['Agenda/alertas: mensagens externas usam só tokens por padrão', () => {
    const ws = {
      groups: [], vault: [], projects: [], projectForecastItems: [], productsServices: [],
      companies: [{ id: 'c1', analytical_token: 'EMP_01', legal_name: 'Padaria Segredo Ltda', trade_name: null, cnpj: '11222333000181', group_id: null, tenant_id: 't', tax_regime: null, is_active: true, created_at: '', updated_at: '' }],
      accounts: [{ id: 'a1', analytical_token: 'CTA_01', name: 'Banco Secreto', company_id: 'c1', tenant_id: 't', account_type: 'checking', institution_name: null, currency: 'BRL', last_four: null, is_active: true, created_at: '', updated_at: '' }],
      categories: [{ id: 'k1', name: 'Aluguel', code: '4.2', company_id: 'c1' }],
      transactions: [
        { id: 'tx1', company_id: 'c1', account_id: 'a1', destination_account_id: null, category_id: 'k1', transaction_type: 'expense', status: 'pending', description: 'Aluguel do Sr. Fulano', amount: 3500, due_date: '2026-11-26', competence_date: '2026-11-01', payment_date: null, project_id: null },
        { id: 'tx2', company_id: 'c1', account_id: 'a1', destination_account_id: null, category_id: null, transaction_type: 'expense', status: 'overdue', description: 'Fornecedor Confidencial', amount: 900, due_date: '2026-11-10', competence_date: '2026-11-01', payment_date: null, project_id: null },
      ],
      debts: [], debtInstallments: [], taxObligations: [],
    } as unknown as WorkspaceCfoSource;
    const items = buildAgendaItems(ws, { todayISO: '2026-11-26', fromISO: '2026-10-01', toISO: '2026-12-31' });
    assertEqual(items.length, 2, 'dois itens');
    const due = composeDueTodayMessage(items, false, '2026-11-26');
    const overdue = composeOverdueMessage(items, false, '2026-11-26');
    const all = `${due?.text}\n${overdue?.text}\n${due?.html}`;
    for (const secret of ['Fulano', 'Fornecedor Confidencial', 'Padaria', 'Banco Secreto']) {
      assert(!all.includes(secret), `"${secret}" não pode sair em alertas tokenizados`);
    }
    assert(all.includes('CTA_01') && all.includes('Aluguel'), 'usa token + categoria genérica');
    assert((composeDueTodayMessage(items, true, '2026-11-26')?.text ?? '').includes('Fulano'), 'com rótulos reais ativados mostra a descrição');
  }],
  ['retorno do OAuth do Google abre Alertas, Agenda & Backup (spec 002)', () => {
    assertEqual(buildGoogleReturnUrl('connected'), '/alertas-agenda-backup?google=connected', 'sucesso');
    assertEqual(
      buildGoogleReturnUrl('error', 'acesso negado & tentar'),
      '/alertas-agenda-backup?google=error&reason=acesso%20negado%20%26%20tentar',
      'erro com motivo codificado'
    );
    assertEqual(buildGoogleReturnUrl('error'), '/alertas-agenda-backup?google=error&reason=falha', 'erro sem motivo');
  }],
];

export async function runModule6ServerTests(): Promise<TestCaseResult[]> {
  return runCases(cases);
}
