import { readFileSync } from 'node:fs';
import {
  assert,
  assertClose,
  assertEqual,
  assertRejects,
  runCases,
  type TestCase,
  type TestCaseResult,
} from '../../scripts/testHarness.ts';
import {
  ASAAS_KNOWN_STATUSES,
  mapAsaasPayment,
  mapMercadoPagoPayment,
  toHistoryLogPayload,
} from '../integrations/history/mappers.ts';
import { planTransactionsForEvent } from '../integrations/webhooks/webhookCore.ts';
import {
  AsaasClient,
  MercadoPagoClient,
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderRequestError,
  asaasBaseUrl,
} from '../integrations/history/providerClients.ts';

type Obj = Record<string, unknown>;

const NOW = new Date('2026-11-26T15:00:00Z');
/** Id da conta dona do token do Mercado Pago nas fixtures (`collector_id` dos recebimentos) */
export const MP_OWN_ID = '777000';

export const loadFixture = <T = Obj>(name: string): T =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T;

const asaasPage1 = loadFixture<{ data: Obj[] }>('asaas-payments-page1.json').data;
const asaasPage2 = loadFixture<{ data: Obj[] }>('asaas-payments-page2.json').data;
const mpPage1 = loadFixture<{ results: Obj[] }>('mercadopago-search-page1.json').results;
const mpPage2 = loadFixture<{ results: Obj[] }>('mercadopago-search-page2.json').results;
const byId = (list: Obj[], id: string | number): Obj => {
  const found = list.find((p) => String(p.id) === String(id));
  if (!found) throw new Error(`fixture sem ${id}`);
  return found;
};


// ---------------------------------------------------------------- Cliente HTTP (fetch falso)
const SECRET_KEY = '$aact_prod_CHAVE_DE_EXEMPLO_123';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  hasBody: boolean;
}
type Reply = { status?: number; body?: unknown; headers?: Record<string, string>; throws?: boolean };

/** Fetch falso: responde na ordem de `replies` (a última se repete) e registra cada chamada. */
function fakeHttp(replies: Reply[]) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  let clock = 1_000_000;
  const options = {
    fetchImpl: async (url: string, init: { method: 'GET'; headers: Record<string, string>; signal?: AbortSignal }) => {
      calls.push({ url, method: init.method, headers: init.headers, hasBody: 'body' in init });
      const reply = replies[Math.min(calls.length - 1, replies.length - 1)]!;
      if (reply.throws) throw new Error(`falha de rede em ${url} com ${SECRET_KEY}`);
      return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: reply.headers });
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    },
    nowMs: () => clock,
    minIntervalMs: 250,
    maxRetries: 3,
  };
  return { calls, sleeps, options, advance: (ms: number) => { clock += ms; } };
}
const asaasP1 = loadFixture('asaas-payments-page1.json');
const asaasP2 = loadFixture('asaas-payments-page2.json');
const asaasCustomers = loadFixture('asaas-customers.json');
const mpP1 = loadFixture('mercadopago-search-page1.json');
const mpP2 = loadFixture('mercadopago-search-page2.json');

const cases: TestCase[] = [
  // ---------------------------------------------------------------- Asaas
  ['Asaas: RECEIVED vira liquidado com taxa = value - netValue, crédito e cliente (CA2, CA11)', () => {
    const r = mapAsaasPayment(byId(asaasPage1, 'pay_0001'), 'Maria Souza Teste', NOW);
    assertEqual(r.lifecycle, 'settled', 'ciclo');
    assertEqual(r.normalized.kind, 'payment_settled', 'tipo');
    assertEqual(r.normalized.paymentRef, 'pay_0001', 'ref');
    assertClose(r.normalized.grossAmount, 150, 'bruto');
    assertClose(r.normalized.feeAmount ?? -1, 3.99, 'taxa');
    assertEqual(r.normalized.settlementDate, '2026-02-09', 'crédito');
    assertEqual(r.normalized.counterpartyName, 'Maria Souza Teste', 'cliente');
    assertEqual(r.normalized.productHint, 'SRV_01', 'produto por referência');
    assertEqual(r.providerStatus, 'RECEIVED', 'status do provedor');
  }],
  ['Asaas: CONFIRMED fica a receber com vencimento no crédito estimado', () => {
    const r = mapAsaasPayment(byId(asaasPage1, 'pay_0002'), null, NOW);
    assertEqual(r.lifecycle, 'open', 'ciclo');
    assertEqual(r.normalized.kind, 'payment_pending', 'tipo');
    assertEqual(r.normalized.settlementDate, '2026-03-13', 'crédito estimado');
    assertEqual(r.normalized.counterpartyName ?? null, null, 'cliente ausente não aborta');
  }],
  ['Asaas: PENDING e OVERDUE ficam a receber com vencimento = dueDate (o banco marca vencido)', () => {
    const pending = mapAsaasPayment(byId(asaasPage1, 'pay_0003'), null, NOW);
    assertEqual(pending.lifecycle, 'open', 'PENDING');
    assertEqual(pending.normalized.settlementDate, '2099-12-31', 'vencimento');
    assertEqual(pending.normalized.description, 'Asaas BOLETO', 'descrição padrão sem description');
    const overdue = mapAsaasPayment(byId(asaasPage2, 'pay_0004'), null, NOW);
    assertEqual(overdue.lifecycle, 'open', 'OVERDUE');
    assertEqual(overdue.normalized.settlementDate, '2026-01-20', 'vencimento passado');
  }],
  ['Asaas: REFUNDED e CHARGEBACK_* são "estornado" com o valor cheio (CA13)', () => {
    const refunded = mapAsaasPayment(byId(asaasPage2, 'pay_0005'), null, NOW);
    assertEqual(refunded.lifecycle, 'refunded', 'REFUNDED');
    assertClose(refunded.normalized.grossAmount, 99.9, 'valor cheio');
    for (const status of ['REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL']) {
      const r = mapAsaasPayment({ ...byId(asaasPage2, 'pay_0005'), status }, null, NOW);
      assertEqual(r.lifecycle, 'refunded', status);
    }
  }],
  ['Asaas: cobrança removida (deleted) vira cancelada, qualquer que seja o status (CA13)', () => {
    const r = mapAsaasPayment(byId(asaasPage2, 'pay_0006'), null, NOW);
    assertEqual(r.lifecycle, 'canceled', 'cancelada');
    assertClose(r.normalized.grossAmount, 60, 'valor');
  }],
  ['Asaas: os 14 status documentados têm mapeamento; DUNNING_* seguem o pago/vencido', () => {
    assertEqual(ASAAS_KNOWN_STATUSES.length, 14, 'quantidade de status documentados');
    for (const status of ASAAS_KNOWN_STATUSES) {
      const r = mapAsaasPayment({ ...byId(asaasPage1, 'pay_0001'), status }, null, NOW);
      assert(r.lifecycle !== 'unknown', `status ${status} sem mapeamento`);
    }
    assertEqual(mapAsaasPayment({ ...byId(asaasPage1, 'pay_0001'), status: 'DUNNING_RECEIVED' }, null, NOW).lifecycle, 'settled', 'DUNNING_RECEIVED');
    assertEqual(mapAsaasPayment({ ...byId(asaasPage1, 'pay_0001'), status: 'DUNNING_REQUESTED' }, null, NOW).lifecycle, 'open', 'DUNNING_REQUESTED');
    assertEqual(mapAsaasPayment({ ...byId(asaasPage1, 'pay_0001'), status: 'RECEIVED_IN_CASH' }, null, NOW).lifecycle, 'settled', 'RECEIVED_IN_CASH');
  }],
  ['Asaas: status desconhecido, sem id ou sem valor é ignorado com motivo (não aborta)', () => {
    const unknown = mapAsaasPayment({ ...byId(asaasPage1, 'pay_0001'), status: 'STATUS_NOVO' }, null, NOW);
    assertEqual(unknown.lifecycle, 'unknown', 'desconhecido');
    assertEqual(unknown.normalized.kind, 'ignored', 'tipo');
    assert(/STATUS_NOVO/.test(unknown.normalized.ignoredReason ?? ''), 'motivo cita o status');
    const noId = mapAsaasPayment({ ...byId(asaasPage1, 'pay_0001'), id: undefined }, null, NOW);
    assertEqual(noId.lifecycle, 'unknown', 'sem id');
    const zero = mapAsaasPayment({ ...byId(asaasPage1, 'pay_0001'), value: 0 }, null, NOW);
    assertEqual(zero.lifecycle, 'unknown', 'valor zero');
  }],
  ['Asaas: totais das duas páginas de exemplo (6 cobranças: 3 abertas, 1 paga, 1 estornada, 1 cancelada)', () => {
    const mapped = [...asaasPage1, ...asaasPage2].map((p) => mapAsaasPayment(p, null, NOW));
    const count = (l: string) => mapped.filter((m) => m.lifecycle === l).length;
    assertEqual(count('settled'), 1, 'pagas');
    assertEqual(count('open'), 3, 'abertas');
    assertEqual(count('refunded'), 1, 'estornadas');
    assertEqual(count('canceled'), 1, 'canceladas');
    const grossOpenAndPaid = mapped.filter((m) => m.lifecycle === 'settled' || m.lifecycle === 'open').reduce((s, m) => s + m.normalized.grossAmount, 0);
    assertClose(grossOpenAndPaid, 150 + 200 + 80.5 + 120, 'soma dos brutos que contam');
  }],

  // ---------------------------------------------------------------- Mercado Pago
  ['Mercado Pago: approved vira liquidado com taxa dos fee_details, líquido e pagador (CA6, CA11)', () => {
    const r = mapMercadoPagoPayment(byId(mpPage1, 90000001), NOW, MP_OWN_ID);
    assertEqual(r.lifecycle, 'settled', 'ciclo');
    assertEqual(r.normalized.kind, 'payment_settled', 'tipo');
    assertEqual(r.normalized.paymentRef, '90000001', 'ref numérica como texto');
    assertClose(r.normalized.grossAmount, 150, 'bruto');
    assertClose(r.normalized.feeAmount ?? -1, 5.99, 'taxa');
    assertClose(r.normalized.netAmount ?? -1, 144.01, 'líquido');
    assertEqual(r.normalized.settlementDate, '2026-02-16', 'liberação do dinheiro');
    assertEqual(r.normalized.counterpartyName, 'Carlos Pereira Teste', 'nome do pagador');
    assertEqual(r.normalized.productHint, 'SRV_01', 'produto por referência externa');
  }],
  ['Mercado Pago: pending usa date_of_expiration como vencimento; pagador sem nome → contraparte nula', () => {
    const r = mapMercadoPagoPayment(byId(mpPage1, 90000002), NOW, MP_OWN_ID);
    assertEqual(r.lifecycle, 'open', 'ciclo');
    assertEqual(r.normalized.kind, 'payment_pending', 'tipo');
    assertEqual(r.normalized.settlementDate, '2026-02-10', 'expiração');
    assertEqual(r.normalized.counterpartyName ?? null, null, 'sem nome');
    assertEqual(r.normalized.feeAmount, null, 'sem taxa antes da aprovação (o líquido 0 do MP não é taxa)');
    assertEqual(r.normalized.netAmount, null, 'sem líquido antes da aprovação');
  }],
  ['Mercado Pago: in_mediation fica em aberto com o valor cheio; nome só com first_name é aceito', () => {
    const r = mapMercadoPagoPayment(byId(mpPage1, 90000003), NOW, MP_OWN_ID);
    assertEqual(r.lifecycle, 'open', 'ciclo');
    assertClose(r.normalized.grossAmount, 45, 'valor cheio');
    assertEqual(r.normalized.counterpartyName, 'Ana', 'só primeiro nome');
  }],
  ['Mercado Pago: cancelled/rejected são cancelados e refunded/charged_back são estornados, com valor cheio (CA13)', () => {
    const cancelled = mapMercadoPagoPayment(byId(mpPage2, 90000004), NOW, MP_OWN_ID);
    assertEqual(cancelled.lifecycle, 'canceled', 'cancelled');
    assertClose(cancelled.normalized.grossAmount, 70, 'valor cancelado');
    const refunded = mapMercadoPagoPayment(byId(mpPage2, 90000005), NOW, MP_OWN_ID);
    assertEqual(refunded.lifecycle, 'refunded', 'refunded');
    assertClose(refunded.normalized.grossAmount, 120, 'valor cheio');
    const rejected = mapMercadoPagoPayment(byId(mpPage2, 90000006), NOW, MP_OWN_ID);
    assertEqual(rejected.lifecycle, 'canceled', 'rejected');
    const chargedBack = mapMercadoPagoPayment({ ...byId(mpPage2, 90000005), status: 'charged_back' }, NOW, MP_OWN_ID);
    assertEqual(chargedBack.lifecycle, 'refunded', 'charged_back');
  }],
  ['Mercado Pago: status desconhecido ou sem id é ignorado com motivo', () => {
    const unknown = mapMercadoPagoPayment({ ...byId(mpPage1, 90000001), status: 'xyz' }, NOW, MP_OWN_ID);
    assertEqual(unknown.lifecycle, 'unknown', 'desconhecido');
    assert(/xyz/.test(unknown.normalized.ignoredReason ?? ''), 'motivo cita o status');
    assertEqual(mapMercadoPagoPayment({ ...byId(mpPage1, 90000001), id: undefined }, NOW, MP_OWN_ID).lifecycle, 'unknown', 'sem id');
  }],
  ['Mercado Pago: totais das duas páginas (1 paga, 2 abertas, 1 estornada, 2 canceladas)', () => {
    const mapped = [...mpPage1, ...mpPage2].map((p) => mapMercadoPagoPayment(p, NOW, MP_OWN_ID));
    const count = (l: string) => mapped.filter((m) => m.lifecycle === l).length;
    assertEqual(count('settled'), 1, 'pagas');
    assertEqual(count('open'), 2, 'abertas');
    assertEqual(count('refunded'), 1, 'estornadas');
    assertEqual(count('canceled'), 2, 'canceladas');
    assertEqual(count('unknown'), 1, 'a compra feita pela própria conta não entra');
  }],
  ['Mercado Pago: pagamento feito por esta conta (compra) NÃO vira receita — só os que ela recebe (defeito encontrado no cfo)', () => {
    const outgoing = mapMercadoPagoPayment(byId(mpPage2, 90000007), NOW, MP_OWN_ID);
    assertEqual(outgoing.lifecycle, 'unknown', 'compra da própria conta');
    assertEqual(outgoing.normalized.kind, 'ignored', 'tipo');
    assert(/não é recebimento/.test(outgoing.normalized.ignoredReason ?? ''), 'motivo claro');
    // Sem collector_id (formato inesperado) também não entra: falha para o lado seguro
    const noCollector = mapMercadoPagoPayment({ ...byId(mpPage1, 90000001), collector_id: undefined }, NOW, MP_OWN_ID);
    assertEqual(noCollector.lifecycle, 'unknown', 'sem collector_id');
    // collector_id como texto ou número é igual
    assertEqual(mapMercadoPagoPayment({ ...byId(mpPage1, 90000001), collector_id: '777000' }, NOW, MP_OWN_ID).lifecycle, 'settled', 'texto');
    // outra conta como "dona" → o recebimento vira ignorado
    assertEqual(mapMercadoPagoPayment(byId(mpPage1, 90000001), NOW, '999').lifecycle, 'unknown', 'outra conta');
  }],

  // ---------------------------------------------------------------- Planejamento dos lançamentos
  ['planejador: a conta da importação sobrepõe a conta da conexão e o cliente vira contraparte da receita (CA10, CA11)', () => {
    const conn = { tenant_id: 't', company_id: 'c', account_id: 'conta-da-conexao', provider: 'asaas', config: {} };
    const settled = mapAsaasPayment(byId(asaasPage1, 'pay_0001'), 'Maria Souza Teste', NOW);
    const rows = planTransactionsForEvent({
      connection: conn, providerName: 'Asaas', normalized: settled.normalized, categories: [], products: [], todayISO: '2026-11-26',
      accountId: 'conta-escolhida',
    });
    assertEqual(rows.length, 2, 'receita + taxa');
    assert(rows.every((r) => r.account_id === 'conta-escolhida'), 'conta escolhida na importação');
    assertEqual(rows[0]!.counterparty_name, 'Maria Souza Teste', 'contraparte na receita');
    assertEqual(rows[1]!.counterparty_name, null, 'taxa sem contraparte');
    assertEqual(rows[0]!.status, 'paid', 'crédito no passado → pago');
    const noOverride = planTransactionsForEvent({ connection: conn, providerName: 'Asaas', normalized: settled.normalized, categories: [], products: [], todayISO: '2026-11-26' });
    assertEqual(noOverride[0]!.account_id, 'conta-da-conexao', 'sem sobreposição usa a conta da conexão (webhook)');
  }],
  ['planejador: cancelado/estornado vira só a receita "canceled" marcada à parte, sem taxa nem estorno (CA13)', () => {
    const conn = { tenant_id: 't', company_id: 'c', account_id: 'a', provider: 'asaas', config: { fee_pct: 3 } };
    for (const [voidAs, label] of [['canceled', 'Cancelado'], ['refunded', 'Estornado']] as const) {
      const mapped = mapAsaasPayment(byId(asaasPage2, voidAs === 'refunded' ? 'pay_0005' : 'pay_0006'), null, NOW);
      const rows = planTransactionsForEvent({ connection: conn, providerName: 'Asaas', normalized: mapped.normalized, categories: [], products: [], todayISO: '2026-11-26', voidAs });
      assertEqual(rows.length, 1, `${label}: uma linha`);
      assertEqual(rows[0]!.role, 'income', 'papel');
      assertEqual(rows[0]!.status, 'canceled', 'status');
      assertEqual(rows[0]!.payment_date, null, 'sem data de pagamento');
      assert(rows[0]!.description.includes(`[${label}]`), `descrição marcada [${label}]`);
      assert(rows[0]!.notes.endsWith(':canceled'), 'marcador');
    }
  }],
  ['planejador: pendente do Asaas vence na data de vencimento e fica sem data de pagamento', () => {
    const conn = { tenant_id: 't', company_id: 'c', account_id: 'a', provider: 'asaas', config: {} };
    const open = mapAsaasPayment(byId(asaasPage1, 'pay_0003'), null, NOW);
    const rows = planTransactionsForEvent({ connection: conn, providerName: 'Asaas', normalized: open.normalized, categories: [], products: [], todayISO: '2026-11-26' });
    assertEqual(rows[0]!.status, 'pending', 'pendente');
    assertEqual(rows[0]!.due_date, '2099-12-31', 'vencimento');
    assertEqual(rows[0]!.payment_date, null, 'sem pagamento');
  }],

  // ---------------------------------------------------------------- Cliente HTTP
  ['cliente: toda chamada é GET, sem corpo, nos dois provedores (só leitura)', async () => {
    const http = fakeHttp([{ body: asaasP1 }, { body: asaasCustomers }, { body: mpP1 }]);
    const asaas = new AsaasClient(SECRET_KEY, http.options);
    await asaas.listPayments({ start: '2026-01-01', end: '2026-01-31', offset: 0 });
    await asaas.listCustomers({ offset: 0 });
    await new MercadoPagoClient('APP_USR_TOKEN_EXEMPLO', http.options).searchPayments({ start: '2026-01-01', end: '2026-01-31', offset: 0 });
    assertEqual(http.calls.length, 3, 'chamadas');
    for (const c of http.calls) {
      assertEqual(c.method, 'GET', `método de ${c.url}`);
      assert(!c.hasBody, 'sem corpo');
    }
  }],
  ['cliente Asaas: pagina as 2 páginas de exemplo (hasMore) com filtro por data de criação e cabeçalho access_token (CA2, CA8)', async () => {
    const http = fakeHttp([{ body: asaasP1 }, { body: asaasP2 }]);
    const client = new AsaasClient(SECRET_KEY, http.options);
    const first = await client.listPayments({ start: '2026-01-01', end: '2026-02-28', offset: 0, limit: 3 });
    assertEqual(first.hasMore, true, 'página 1 tem mais');
    assertEqual(first.items.length, 3, 'itens da página 1');
    assertEqual(first.totalCount, 6, 'totalCount');
    const second = await client.listPayments({ start: '2026-01-01', end: '2026-02-28', offset: 3, limit: 3 });
    assertEqual(second.hasMore, false, 'página 2 é a última');
    assertEqual(first.items.length + second.items.length, 6, 'todas as cobranças');
    const url = decodeURIComponent(http.calls[0]!.url);
    assert(url.startsWith('https://api.asaas.com/v3/payments?'), `URL de produção: ${url}`);
    assert(url.includes('dateCreated[ge]=2026-01-01') && url.includes('dateCreated[le]=2026-02-28'), 'filtro de datas');
    assert(url.includes('offset=0') && url.includes('limit=3'), 'paginação');
    assertEqual(http.calls[0]!.headers.access_token, SECRET_KEY, 'chave só no cabeçalho');
    assert(!http.calls[0]!.url.includes('CHAVE_DE_EXEMPLO'), 'chave fora da URL');
    assert(decodeURIComponent(http.calls[1]!.url).includes('offset=3'), 'segunda página usa offset 3');
  }],
  ['cliente Asaas: chave de sandbox usa a URL de sandbox; a lista de clientes devolve só id, nome e removido (CA11)', async () => {
    assertEqual(asaasBaseUrl('$aact_hmlg_abc'), 'https://api-sandbox.asaas.com/v3', 'sandbox');
    assertEqual(asaasBaseUrl('$aact_prod_abc'), 'https://api.asaas.com/v3', 'produção');
    assertEqual(asaasBaseUrl('qualquer'), 'https://api.asaas.com/v3', 'desconhecida usa produção');
    const http = fakeHttp([{ body: asaasCustomers }]);
    const res = await new AsaasClient(SECRET_KEY, http.options).listCustomers({ offset: 0 });
    assertEqual(res.items.length, 3, 'clientes');
    assertEqual(res.items[0]!.name, 'Maria Souza Teste', 'nome');
    assertEqual(res.items[2]!.deleted, true, 'removido');
    const dump = JSON.stringify(res);
    for (const forbidden of ['example.com', 'cpfCnpj', '00000000000']) assert(!dump.includes(forbidden), `vazou "${forbidden}"`);
  }],
  ['cliente Mercado Pago: pagina pelo paging.total e envia janela de datas em Brasília (CA6, CA8)', async () => {
    const http = fakeHttp([{ body: mpP1 }, { body: mpP2 }]);
    const client = new MercadoPagoClient('APP_USR_TOKEN_EXEMPLO', http.options);
    const first = await client.searchPayments({ start: '2026-01-01', end: '2026-02-28', offset: 0, limit: 3 });
    assertEqual(first.hasMore, true, 'tem mais');
    assertEqual(first.total, 7, 'total');
    const second = await client.searchPayments({ start: '2026-01-01', end: '2026-02-28', offset: 3, limit: 3 });
    assertEqual(second.hasMore, false, 'fim');
    const url = decodeURIComponent(http.calls[0]!.url);
    assert(url.startsWith('https://api.mercadopago.com/v1/payments/search?'), url);
    assert(url.includes('range=date_created') && url.includes('sort=date_created') && url.includes('criteria=asc'), 'ordenação/range');
    assert(url.includes('begin_date=2026-01-01T00:00:00.000-03:00') && url.includes('end_date=2026-02-28T23:59:59.999-03:00'), 'datas');
    assertEqual(http.calls[0]!.headers.Authorization, 'Bearer APP_USR_TOKEN_EXEMPLO', 'token no cabeçalho');
  }],
  ['cliente Mercado Pago: identifica a conta por GET /users/me; cai no sufixo do token; erro de chave não é escondido; sem nada, falha', async () => {
    const ok = fakeHttp([{ body: { id: 777000, nickname: 'x' } }]);
    assertEqual(await new MercadoPagoClient('APP_USR-1-2-abc-999', ok.options).identifyAccount(), '777000', '/users/me tem prioridade');
    assertEqual(ok.calls[0]!.url, 'https://api.mercadopago.com/users/me', 'URL');
    assertEqual(ok.calls[0]!.method, 'GET', 'só leitura');
    const fallback = fakeHttp([{ status: 404 }]);
    assertEqual(await new MercadoPagoClient('APP_USR-1234-112233-abcdef-445566', fallback.options).identifyAccount(), '445566', 'sufixo do token');
    const auth = fakeHttp([{ status: 401 }]);
    await assertRejects(() => new MercadoPagoClient('APP_USR-1234-112233-abcdef-445566', auth.options).identifyAccount(), /recusou o access token/, 'chave inválida');
    const none = fakeHttp([{ status: 404 }]);
    await assertRejects(() => new MercadoPagoClient('token-sem-sufixo', none.options).identifyAccount(), /identificar a conta/, 'sem como identificar');
  }],
  ['cliente: 429 espera o RateLimit-Reset (sem repetir de imediato) e continua (CA8)', async () => {
    const http = fakeHttp([{ status: 429, headers: { 'RateLimit-Reset': '2' } }, { body: asaasP1 }]);
    const res = await new AsaasClient(SECRET_KEY, http.options).listPayments({ start: '2026-01-01', end: '2026-01-31', offset: 0 });
    assertEqual(res.items.length, 3, 'depois da espera, traz a página');
    assertEqual(http.calls.length, 2, 'duas tentativas');
    assert(http.sleeps.includes(2000), `esperou 2 s: ${http.sleeps.join(',')}`);
  }],
  ['cliente: 429 sem cabeçalho usa espera progressiva; Retry-After também é respeitado e o teto é 30 s', async () => {
    const noHeader = fakeHttp([{ status: 429 }, { body: asaasP1 }]);
    await new AsaasClient(SECRET_KEY, noHeader.options).listPayments({ start: '2026-01-01', end: '2026-01-31', offset: 0 });
    assert(noHeader.sleeps.some((ms) => ms >= 2000), 'espera progressiva');
    const retryAfter = fakeHttp([{ status: 429, headers: { 'Retry-After': '120' } }, { body: asaasP1 }]);
    await new AsaasClient(SECRET_KEY, retryAfter.options).listPayments({ start: '2026-01-01', end: '2026-01-31', offset: 0 });
    assert(retryAfter.sleeps.includes(30_000), `teto de 30 s: ${retryAfter.sleeps.join(',')}`);
  }],
  ['cliente: 429 esgotadas as tentativas → erro retomável, sem chave na mensagem (CA1, CA8)', async () => {
    const http = fakeHttp([{ status: 429, headers: { 'RateLimit-Reset': '1' } }]);
    const client = new AsaasClient(SECRET_KEY, http.options);
    try {
      await client.listPayments({ start: '2026-01-01', end: '2026-01-31', offset: 0 });
      throw new Error('era esperado erro');
    } catch (err) {
      assert(err instanceof ProviderRateLimitError, `tipo: ${String(err)}`);
      assertEqual((err as ProviderRateLimitError).resumable, true, 'retomável');
      assert(!String((err as Error).message).includes('CHAVE_DE_EXEMPLO'), 'sem chave');
      assert(/Retomar/.test((err as Error).message), 'orienta a retomar');
    }
    assertEqual(http.calls.length, 4, '1 tentativa + 3 repetições');
  }],
  ['cliente: 401 e 403 viram ProviderAuthError com mensagem clara, sem repetir e sem a chave (CA1, CA7)', async () => {
    for (const status of [401, 403]) {
      const http = fakeHttp([{ status, body: { errors: [{ code: 'invalid_access_token' }] } }]);
      try {
        await new AsaasClient(SECRET_KEY, http.options).verifyKey();
        throw new Error('era esperado erro');
      } catch (err) {
        assert(err instanceof ProviderAuthError, `tipo para ${status}: ${String(err)}`);
        const message = (err as Error).message;
        assert(/chave de API/.test(message) && !message.includes('CHAVE_DE_EXEMPLO'), `mensagem: ${message}`);
        assertEqual((err as ProviderAuthError).resumable, false, 'não retomável sem trocar a chave');
      }
      assertEqual(http.calls.length, 1, `sem repetição no ${status}`);
    }
    const mp = fakeHttp([{ status: 401 }]);
    await assertRejects(() => new MercadoPagoClient('APP_USR_TOKEN_EXEMPLO', mp.options).verifyKey(), /Mercado Pago recusou o access token/, 'MP 401');
  }],
  ['cliente: 403 com Retry-After é bloqueio temporário (espera), não chave inválida', async () => {
    const http = fakeHttp([{ status: 403, headers: { 'Retry-After': '5' } }, { body: asaasP1 }]);
    const res = await new AsaasClient(SECRET_KEY, http.options).listPayments({ start: '2026-01-01', end: '2026-01-31', offset: 0 });
    assertEqual(res.items.length, 3, 'continuou');
    assert(http.sleeps.includes(5000), 'esperou 5 s');
  }],
  ['cliente: 5xx e falha de rede são repetidos; esgotado vira erro retomável sem vazar a chave (CA7)', async () => {
    const recovers = fakeHttp([{ status: 503 }, { body: asaasP1 }]);
    const ok = await new AsaasClient(SECRET_KEY, recovers.options).listPayments({ start: '2026-01-01', end: '2026-01-31', offset: 0 });
    assertEqual(ok.items.length, 3, 'recuperou');
    const down = fakeHttp([{ throws: true }]);
    try {
      await new AsaasClient(SECRET_KEY, down.options).listPayments({ start: '2026-01-01', end: '2026-01-31', offset: 0 });
      throw new Error('era esperado erro');
    } catch (err) {
      assert(err instanceof ProviderRequestError && (err as ProviderRequestError).resumable, `tipo: ${String(err)}`);
      assert(!(err as Error).message.includes('CHAVE_DE_EXEMPLO') && !(err as Error).message.includes('http'), 'mensagem sem URL nem chave');
    }
    assertEqual(down.calls.length, 4, 'tentativas');
  }],
  ['cliente: erro 4xx que não é de chave não é repetido e não é retomável; corpo inesperado é erro claro', async () => {
    const bad = fakeHttp([{ status: 400 }]);
    try {
      await new AsaasClient(SECRET_KEY, bad.options).listPayments({ start: '2026-01-01', end: '2026-01-31', offset: 0 });
      throw new Error('era esperado erro');
    } catch (err) {
      assert(err instanceof ProviderRequestError && !(err as ProviderRequestError).resumable, 'tipo');
    }
    assertEqual(bad.calls.length, 1, 'sem repetição');
    const weird = fakeHttp([{ body: { qualquer: 'coisa' } }]);
    await assertRejects(() => new AsaasClient(SECRET_KEY, weird.options).listPayments({ start: '2026-01-01', end: '2026-01-31', offset: 0 }), /Resposta inesperada/, 'corpo');
  }],
  ['cliente: espaçamento mínimo entre chamadas consecutivas', async () => {
    const http = fakeHttp([{ body: asaasP1 }]);
    const client = new AsaasClient(SECRET_KEY, http.options);
    await client.listPayments({ start: '2026-01-01', end: '2026-01-31', offset: 0 });
    await client.listPayments({ start: '2026-01-01', end: '2026-01-31', offset: 3 });
    assert(http.sleeps.some((ms) => ms > 0 && ms <= 250), `esperou o intervalo entre chamadas: ${http.sleeps.join(',')}`);
  }],

  // ---------------------------------------------------------------- Privacidade do log
  ['log de importação: payload reduzido não contém nome, e-mail, documento nem id do cliente (CA11)', () => {
    const asaasRaw = byId(asaasPage1, 'pay_0001');
    const asaas = JSON.stringify(toHistoryLogPayload('asaas', asaasRaw));
    for (const forbidden of ['Maria', 'example.com', 'cus_0001', 'customer', 'cpfCnpj']) {
      assert(!asaas.includes(forbidden), `payload do Asaas contém "${forbidden}"`);
    }
    assert(asaas.includes('pay_0001') && asaas.includes('RECEIVED'), 'mantém id e status');

    const mpRaw = byId(mpPage1, 90000001);
    const mp = JSON.stringify(toHistoryLogPayload('mercadopago', mpRaw));
    for (const forbidden of ['Carlos', 'Pereira', 'example.com', 'payer', 'identification', '00000000000']) {
      assert(!mp.includes(forbidden), `payload do Mercado Pago contém "${forbidden}"`);
    }
    assert(mp.includes('90000001') && mp.includes('approved'), 'mantém id e status');
  }],
  ['mapeamento: o nome do cliente só aparece em counterpartyName', () => {
    const r = mapAsaasPayment(byId(asaasPage1, 'pay_0001'), 'Maria Souza Teste', NOW);
    const { counterpartyName, ...rest } = r.normalized;
    assertEqual(counterpartyName, 'Maria Souza Teste', 'contraparte');
    assert(!JSON.stringify(rest).includes('Maria'), 'nome fora de outros campos');
    const mp = mapMercadoPagoPayment(byId(mpPage1, 90000001), NOW, MP_OWN_ID);
    assert(!JSON.stringify(mp.normalized).includes('@'), 'sem e-mail no evento normalizado');
  }],
];

export async function runHistoryTests(): Promise<TestCaseResult[]> {
  return runCases(cases);
}
