import { readFileSync } from 'node:fs';
import {
  assert,
  assertClose,
  assertEqual,
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

type Obj = Record<string, unknown>;

const NOW = new Date('2026-11-26T15:00:00Z');

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
    const r = mapMercadoPagoPayment(byId(mpPage1, 90000001), NOW);
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
    const r = mapMercadoPagoPayment(byId(mpPage1, 90000002), NOW);
    assertEqual(r.lifecycle, 'open', 'ciclo');
    assertEqual(r.normalized.kind, 'payment_pending', 'tipo');
    assertEqual(r.normalized.settlementDate, '2026-02-10', 'expiração');
    assertEqual(r.normalized.counterpartyName ?? null, null, 'sem nome');
  }],
  ['Mercado Pago: in_mediation fica em aberto com o valor cheio; nome só com first_name é aceito', () => {
    const r = mapMercadoPagoPayment(byId(mpPage1, 90000003), NOW);
    assertEqual(r.lifecycle, 'open', 'ciclo');
    assertClose(r.normalized.grossAmount, 45, 'valor cheio');
    assertEqual(r.normalized.counterpartyName, 'Ana', 'só primeiro nome');
  }],
  ['Mercado Pago: cancelled/rejected são cancelados e refunded/charged_back são estornados, com valor cheio (CA13)', () => {
    const cancelled = mapMercadoPagoPayment(byId(mpPage2, 90000004), NOW);
    assertEqual(cancelled.lifecycle, 'canceled', 'cancelled');
    assertClose(cancelled.normalized.grossAmount, 70, 'valor cancelado');
    const refunded = mapMercadoPagoPayment(byId(mpPage2, 90000005), NOW);
    assertEqual(refunded.lifecycle, 'refunded', 'refunded');
    assertClose(refunded.normalized.grossAmount, 120, 'valor cheio');
    const rejected = mapMercadoPagoPayment(byId(mpPage2, 90000006), NOW);
    assertEqual(rejected.lifecycle, 'canceled', 'rejected');
    const chargedBack = mapMercadoPagoPayment({ ...byId(mpPage2, 90000005), status: 'charged_back' }, NOW);
    assertEqual(chargedBack.lifecycle, 'refunded', 'charged_back');
  }],
  ['Mercado Pago: status desconhecido ou sem id é ignorado com motivo', () => {
    const unknown = mapMercadoPagoPayment({ ...byId(mpPage1, 90000001), status: 'xyz' }, NOW);
    assertEqual(unknown.lifecycle, 'unknown', 'desconhecido');
    assert(/xyz/.test(unknown.normalized.ignoredReason ?? ''), 'motivo cita o status');
    assertEqual(mapMercadoPagoPayment({ ...byId(mpPage1, 90000001), id: undefined }, NOW).lifecycle, 'unknown', 'sem id');
  }],
  ['Mercado Pago: totais das duas páginas (1 paga, 2 abertas, 1 estornada, 2 canceladas)', () => {
    const mapped = [...mpPage1, ...mpPage2].map((p) => mapMercadoPagoPayment(p, NOW));
    const count = (l: string) => mapped.filter((m) => m.lifecycle === l).length;
    assertEqual(count('settled'), 1, 'pagas');
    assertEqual(count('open'), 2, 'abertas');
    assertEqual(count('refunded'), 1, 'estornadas');
    assertEqual(count('canceled'), 2, 'canceladas');
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
    const mp = mapMercadoPagoPayment(byId(mpPage1, 90000001), NOW);
    assert(!JSON.stringify(mp.normalized).includes('@'), 'sem e-mail no evento normalizado');
  }],
];

export async function runHistoryTests(): Promise<TestCaseResult[]> {
  return runCases(cases);
}
