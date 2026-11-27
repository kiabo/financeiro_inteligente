import { assert, assertEqual, runCases, type TestCase, type TestCaseResult } from '../../scripts/testHarness.ts';
import { upsertPayment, type PlannedPaymentRow, type UpsertIntent } from '../integrations/history/paymentUpsert.ts';
import { MemoryTransactionStore } from './helpers/memoryStore.ts';

const T = 'tenant-1';
const SRC = 'asaas';
const REF = 'pay_0001';
const ACC_A = 'acc-a'; // conta escolhida na importação
const ACC_B = 'acc-b'; // conta fixa da conexão de webhook

const marker = (state: string) => `webhook:${SRC}:${REF}:${state}`;
const income = (over: Partial<PlannedPaymentRow> = {}): PlannedPaymentRow => ({
  role: 'income', status: 'pending', account_id: ACC_A, amount: 150, due_date: '2026-02-10', payment_date: null, notes: marker('pending'), ...over,
});
const fee = (over: Partial<PlannedPaymentRow> = {}): PlannedPaymentRow => ({
  role: 'fee', status: 'pending', account_id: ACC_A, amount: 3.99, due_date: '2026-02-10', payment_date: null, notes: marker('pending'), ...over,
});
const paidIncome = (over: Partial<PlannedPaymentRow> = {}) =>
  income({ status: 'paid', due_date: '2026-02-09', payment_date: '2026-02-09', notes: marker('settled'), ...over });
const paidFee = (over: Partial<PlannedPaymentRow> = {}) =>
  fee({ status: 'paid', due_date: '2026-02-09', payment_date: '2026-02-09', notes: marker('settled'), ...over });
const canceledIncome = (over: Partial<PlannedPaymentRow> = {}) =>
  income({ status: 'canceled', notes: marker('canceled'), ...over });
const refundRow = (amount: number, over: Partial<PlannedPaymentRow> = {}): PlannedPaymentRow => ({
  role: 'refund', status: 'paid', account_id: ACC_B, amount, due_date: '2026-02-20', payment_date: '2026-02-20', notes: marker('settled'), ...over,
});

const run = (store: MemoryTransactionStore, intent: UpsertIntent, planned: PlannedPaymentRow[]) =>
  upsertPayment(store, { tenantId: T, source: SRC, ref: REF, intent, planned });

const cases: TestCase[] = [
  ['pagamento novo em aberto cria receita e taxa na conta escolhida (CA2, CA10)', async () => {
    const store = new MemoryTransactionStore();
    const out = await run(store, 'open', [income(), fee()]);
    assertEqual(out.action, 'created', 'ação');
    assertEqual(out.ids.length, 2, 'duas linhas');
    assertEqual(store.rows.length, 2, 'gravadas');
    assert(store.rows.every((r) => r.account_id === ACC_A), 'conta da importação');
    assert(store.rows.every((r) => r.external_source === SRC && r.external_ref === REF), 'chave externa gravada');
  }],
  ['reimportar o mesmo pagamento não cria nada (CA3)', async () => {
    const store = new MemoryTransactionStore();
    await run(store, 'open', [income(), fee()]);
    const again = await run(store, 'open', [income(), fee()]);
    assertEqual(again.action, 'ignored', 'ação');
    assertEqual(store.rows.length, 2, 'continua com 2 linhas');
    await run(store, 'settled', [paidIncome(), paidFee()]);
    const settledAgain = await run(store, 'settled', [paidIncome(), paidFee()]);
    assertEqual(settledAgain.action, 'ignored', 'pago de novo');
    assertEqual(store.rows.length, 2, 'ainda 2 linhas');
  }],
  ['pendente que depois é liquidado atualiza as mesmas linhas, sem mudar valor nem conta (CA5)', async () => {
    const store = new MemoryTransactionStore();
    const created = await run(store, 'open', [income(), fee()]);
    const out = await run(store, 'settled', [paidIncome({ amount: 999 }), paidFee({ amount: 99 })]);
    assertEqual(out.action, 'updated', 'ação');
    assertEqual(JSON.stringify(out.ids.slice().sort()), JSON.stringify(created.ids.slice().sort()), 'mesmos ids');
    const inc = store.rows.find((r) => r.role === 'income')!;
    assertEqual(inc.status, 'paid', 'status');
    assertEqual(inc.payment_date, '2026-02-09', 'data de pagamento');
    assertEqual(inc.amount, 150, 'valor não muda');
    assertEqual(store.rows.find((r) => r.role === 'fee')!.amount, 3.99, 'taxa não muda');
    assertEqual(store.rows.length, 2, 'sem linhas novas');
  }],
  ['liquidação com crédito futuro deixa pendente com a nova data de vencimento', async () => {
    const store = new MemoryTransactionStore();
    await run(store, 'open', [income(), fee()]);
    await run(store, 'settled', [income({ due_date: '2026-03-13', notes: marker('settled') }), fee({ due_date: '2026-03-13', notes: marker('settled') })]);
    const inc = store.rows.find((r) => r.role === 'income')!;
    assertEqual(inc.status, 'pending', 'ainda pendente');
    assertEqual(inc.due_date, '2026-03-13', 'vence no crédito');
  }],
  ['um lançamento pago não regride quando chega um evento "pendente"', async () => {
    const store = new MemoryTransactionStore();
    await run(store, 'settled', [paidIncome(), paidFee()]);
    const out = await run(store, 'open', [income(), fee()]);
    assertEqual(out.action, 'ignored', 'ação');
    assertEqual(store.rows.find((r) => r.role === 'income')!.status, 'paid', 'continua pago');
    assertEqual(store.rows.length, 2, 'sem linhas novas');
  }],
  ['importado na conta A e recebido por webhook da conexão da conta B: atualiza a mesma linha, sem duplicar nem trocar de conta (CA4, CA12)', async () => {
    const store = new MemoryTransactionStore();
    await run(store, 'settled', [paidIncome({ account_id: ACC_A }), paidFee({ account_id: ACC_A })]);
    const webhook = await run(store, 'settled', [
      paidIncome({ account_id: ACC_B, amount: 151 }),
      paidFee({ account_id: ACC_B, amount: 4 }),
    ]);
    assertEqual(webhook.action, 'ignored', 'já liquidado: nada a fazer');
    assertEqual(store.rows.length, 2, 'sem duplicar');
    assert(store.rows.every((r) => r.account_id === ACC_A), 'continua na conta da importação');
    assertEqual(store.rows.find((r) => r.role === 'income')!.amount, 150, 'valor intacto');
  }],
  ['importado pendente na conta A e liquidado por webhook da conta B: mesma linha vira paga, na conta A (CA5, CA12)', async () => {
    const store = new MemoryTransactionStore();
    await run(store, 'open', [income({ account_id: ACC_A }), fee({ account_id: ACC_A })]);
    const out = await run(store, 'settled', [paidIncome({ account_id: ACC_B }), paidFee({ account_id: ACC_B })]);
    assertEqual(out.action, 'updated', 'ação');
    assertEqual(store.rows.length, 2, 'sem duplicar');
    assert(store.rows.every((r) => r.account_id === ACC_A && r.status === 'paid'), 'conta A e paga');
  }],
  ['cancelado/estornado sem nada gravado entra como receita "canceled", sem taxa nem estorno (CA13)', async () => {
    const store = new MemoryTransactionStore();
    const out = await run(store, 'void', [canceledIncome()]);
    assertEqual(out.action, 'marked_apart', 'ação');
    assertEqual(store.rows.length, 1, 'uma linha');
    assertEqual(store.rows[0]!.status, 'canceled', 'status');
    assertEqual(store.rows[0]!.role, 'income', 'papel');
  }],
  ['cancelado depois de pendente marca receita e taxa como canceladas, sem criar linhas (CA13)', async () => {
    const store = new MemoryTransactionStore();
    await run(store, 'open', [income(), fee()]);
    const out = await run(store, 'void', [canceledIncome()]);
    assertEqual(out.action, 'marked_apart', 'ação');
    assertEqual(store.rows.length, 2, 'sem linhas novas');
    assert(store.rows.every((r) => r.status === 'canceled'), 'todas canceladas');
  }],
  ['cancelar de novo não faz nada; estornado depois de pago também é marcado à parte', async () => {
    const store = new MemoryTransactionStore();
    await run(store, 'settled', [paidIncome(), paidFee()]);
    const first = await run(store, 'void', [canceledIncome()]);
    assertEqual(first.action, 'marked_apart', 'primeira vez');
    assert(store.rows.every((r) => r.status === 'canceled'), 'pago virou cancelado');
    const second = await run(store, 'void', [canceledIncome()]);
    assertEqual(second.action, 'ignored', 'segunda vez');
  }],
  ['se o webhook já criou a linha de estorno, a importação não marca de novo (sem contar duas vezes)', async () => {
    const store = new MemoryTransactionStore();
    await run(store, 'settled', [paidIncome(), paidFee()]);
    await run(store, 'refund', [refundRow(150)]);
    const out = await run(store, 'void', [canceledIncome()]);
    assertEqual(out.action, 'ignored', 'ação');
    assertEqual(store.rows.find((r) => r.role === 'income')!.status, 'paid', 'receita intacta');
  }],
  ['webhook de estorno depois da importação marcar a receita como cancelada não cria linha de estorno (CA13)', async () => {
    const store = new MemoryTransactionStore();
    await run(store, 'void', [canceledIncome()]);
    const out = await run(store, 'refund', [refundRow(150)]);
    assertEqual(out.action, 'ignored', 'ação');
    assertEqual(store.rows.length, 1, 'sem linha de estorno');
  }],
  ['webhook de estorno sobre receita paga cria a linha de estorno; estorno parcial acumulado atualiza o mesmo lançamento', async () => {
    const store = new MemoryTransactionStore();
    await run(store, 'settled', [paidIncome(), paidFee()]);
    const first = await run(store, 'refund', [refundRow(50)]);
    assertEqual(first.action, 'created', 'primeiro estorno');
    const second = await run(store, 'refund', [refundRow(120)]);
    assertEqual(second.action, 'updated', 'valor acumulado maior');
    assertEqual(store.rows.filter((r) => r.role === 'refund').length, 1, 'uma só linha de estorno');
    assertEqual(store.rows.find((r) => r.role === 'refund')!.amount, 120, 'valor acumulado');
    const same = await run(store, 'refund', [refundRow(120)]);
    assertEqual(same.action, 'ignored', 'mesmo valor');
    const lower = await run(store, 'refund', [refundRow(80)]);
    assertEqual(lower.action, 'ignored', 'valor menor não regride');
  }],
  ['corrida: outro processo grava o mesmo pagamento entre a leitura e o insert → vira "já existe", sem erro e sem duplicar (CA3, CA12)', async () => {
    const store = new MemoryTransactionStore();
    store.beforeInsert = () => {
      store.rows.push({
        id: 'tx-concorrente', tenant_id: T, role: 'income', status: 'pending', account_id: ACC_B, amount: 150, due_date: '2026-02-10',
        payment_date: null, notes: marker('pending'), external_source: SRC, external_ref: REF, external_role: 'income',
      });
    };
    const out = await run(store, 'open', [income(), fee()]);
    assertEqual(out.action, 'ignored', 'ação');
    assertEqual(store.rows.filter((r) => r.role === 'income').length, 1, 'uma receita');
  }],
  ['linhas antigas (só com marcador em notes) são reconhecidas e adotam a chave; nada duplica', async () => {
    const store = new MemoryTransactionStore();
    const legacyIncome = store.seedLegacy(T, { role: 'income', status: 'pending', account_id: ACC_B, amount: 150, due_date: '2026-02-10', payment_date: null, notes: marker('pending') });
    const legacyFee = store.seedLegacy(T, { role: 'fee', status: 'pending', account_id: ACC_B, amount: 3.99, due_date: '2026-02-10', payment_date: null, notes: marker('pending') });
    const open = await run(store, 'open', [income(), fee()]);
    assertEqual(open.action, 'ignored', 'já existia');
    assertEqual(store.rows.length, 2, 'sem duplicar');
    assert(store.rows.every((r) => r.external_ref === REF && r.external_source === SRC), 'adotou a chave externa');
    const settled = await run(store, 'settled', [paidIncome(), paidFee()]);
    assertEqual(settled.action, 'updated', 'liquidou as antigas');
    assertEqual(JSON.stringify(settled.ids.slice().sort()), JSON.stringify([legacyIncome, legacyFee].sort()), 'mesmos ids');
    assert(store.rows.every((r) => r.account_id === ACC_B && r.status === 'paid'), 'continuam na conta original e pagas');
  }],
  ['isolamento: o mesmo id de pagamento em outro tenant não é confundido', async () => {
    const store = new MemoryTransactionStore();
    await run(store, 'open', [income(), fee()]);
    const other = await upsertPayment(store, { tenantId: 'tenant-2', source: SRC, ref: REF, intent: 'open', planned: [income(), fee()] });
    assertEqual(other.action, 'created', 'tenant diferente cria');
    assertEqual(store.rows.length, 4, 'quatro linhas');
  }],
  ['isolamento: o mesmo id em outro provedor não é confundido', async () => {
    const store = new MemoryTransactionStore();
    await run(store, 'open', [income(), fee()]);
    const other = await upsertPayment(store, { tenantId: T, source: 'mercadopago', ref: REF, intent: 'open', planned: [income(), fee()] });
    assertEqual(other.action, 'created', 'provedor diferente cria');
  }],
];

export async function runHistoryUpsertTests(): Promise<TestCaseResult[]> {
  return runCases(cases);
}
