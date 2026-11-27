import { assert, assertEqual, runCases, type TestCase, type TestCaseResult } from '../../scripts/testHarness.ts';
import {
  HistoryRunError,
  cancelRun,
  startRun,
  stepRun,
  type HistoryDeps,
  type HistorySource,
  type PublicRun,
} from '../integrations/history/historyRunner.ts';
import { ProviderAuthError, ProviderRequestError } from '../integrations/history/providerClients.ts';
import type { IntegrationConnectionRow } from '../integrations/webhooks/webhookCore.ts';
import { MP_OWN_ID, loadFixture } from './history.test.ts';
import { MemoryEventLog, MemoryRunStore } from './helpers/memoryRuns.ts';
import { MemoryTransactionStore } from './helpers/memoryStore.ts';

type Obj = Record<string, unknown>;

const T = 'tenant-1';
const NOW = new Date('2026-11-26T15:00:00Z');
const KEY = '$aact_prod_CHAVE_DE_EXEMPLO_123';
const ACC = 'acc-a';

const asaasItems = [
  ...loadFixture<{ data: Obj[] }>('asaas-payments-page1.json').data,
  ...loadFixture<{ data: Obj[] }>('asaas-payments-page2.json').data,
];
const asaasCustomers = loadFixture<{ data: Array<{ id: string; name: string; deleted: boolean }> }>('asaas-customers.json').data;
const mpItems = [
  ...loadFixture<{ results: Obj[] }>('mercadopago-search-page1.json').results,
  ...loadFixture<{ results: Obj[] }>('mercadopago-search-page2.json').results,
];

const connection = (provider: string, over: Partial<IntegrationConnectionRow> = {}): IntegrationConnectionRow => ({
  id: `conn-${provider}`, tenant_id: T, provider, label: provider, company_id: 'comp-1', account_id: 'acc-da-conexao',
  webhook_secret_id: null, signing_secret_encrypted: null, credentials_encrypted: null, config: {}, status: 'active', ...over,
});

/** Fonte falsa: devolve as fixtures filtradas por janela, em páginas pequenas (para exercitar o cursor). */
class FakeSource implements HistorySource {
  readonly pageSize = 2;
  paymentCalls = 0;
  verifyCalls = 0;
  failOnPaymentCall: { at: number; error: Error } | null = null;
  verifyError: Error | null = null;
  identifyCalls = 0;
  identifyError: Error | null = null;

  constructor(
    private readonly provider: 'asaas' | 'mercadopago',
    private readonly items: Obj[]
  ) {}

  async verifyKey() {
    this.verifyCalls += 1;
    if (this.verifyError) throw this.verifyError;
  }

  identifyAccount = this.provider === 'mercadopago'
    ? async () => {
        this.identifyCalls += 1;
        if (this.identifyError) throw this.identifyError;
        return MP_OWN_ID;
      }
    : undefined;

  listCustomers = this.provider === 'asaas' ? async () => ({ items: asaasCustomers, hasMore: false }) : undefined;

  async listPayments(window: { start: string; end: string }, offset: number) {
    this.paymentCalls += 1;
    if (this.failOnPaymentCall && this.failOnPaymentCall.at === this.paymentCalls) {
      const err = this.failOnPaymentCall.error;
      this.failOnPaymentCall = null;
      throw err;
    }
    const created = (p: Obj) => String(this.provider === 'asaas' ? p.dateCreated : p.date_created).slice(0, 10);
    const inWindow = this.items.filter((p) => created(p) >= window.start && created(p) <= window.end);
    const items = inWindow.slice(offset, offset + this.pageSize);
    return { items, hasMore: offset + items.length < inWindow.length, total: inWindow.length };
  }
}

function makeDeps(source: FakeSource, over: Partial<HistoryDeps> = {}) {
  const runs = new MemoryRunStore();
  const txStore = new MemoryTransactionStore();
  const events = new MemoryEventLog();
  const audits: Array<{ action: string; metadata: Record<string, unknown> }> = [];
  const deps: HistoryDeps = {
    runs,
    txStore,
    events,
    loadCatalog: async () => ({ categories: [], products: [] }),
    getAccount: async (tenantId, id) =>
      tenantId === T && id === 'acc-a' ? { id, company_id: 'comp-1' } : tenantId === T && id === 'acc-outra-empresa' ? { id, company_id: 'comp-2' } : null,
    createSource: () => source,
    audit: async (_t, action, _id, metadata) => void audits.push({ action, metadata }),
    now: () => NOW,
    ...over,
  };
  return { deps, runs, txStore, events, audits };
}

const start = (deps: HistoryDeps, conn: IntegrationConnectionRow, over: Partial<{ apiKey: string | null; accountId: string; start: string; end: string }> = {}) =>
  startRun(deps, { tenantId: T, connection: conn, apiKey: KEY, accountId: ACC, start: '2026-01-01', end: '2026-02-28', ...over });

/** Executa passos até concluir (ou falhar/cancelar). */
async function runToEnd(deps: HistoryDeps, conn: IntegrationConnectionRow, runId: string, maxSteps = 30): Promise<{ run: PublicRun; steps: number }> {
  let run: PublicRun | null = null;
  for (let steps = 1; steps <= maxSteps; steps += 1) {
    run = await stepRun(deps, { tenantId: T, runId, connection: conn, apiKey: KEY });
    if (run.status !== 'running') return { run, steps };
  }
  throw new Error('execução não terminou');
}

const rejects = async (fn: () => Promise<unknown>): Promise<HistoryRunError> => {
  try {
    await fn();
  } catch (err) {
    assert(err instanceof HistoryRunError, `erro inesperado: ${String(err)}`);
    return err;
  }
  throw new Error('era esperado erro');
};

const cases: TestCase[] = [
  ['início: período de 13 meses, no futuro, ou Mercado Pago com início antigo são recusados com mensagem clara (CA8)', async () => {
    const { deps } = makeDeps(new FakeSource('asaas', asaasItems));
    const long = await rejects(() => start(deps, connection('asaas'), { start: '2025-01-01', end: '2026-02-01' }));
    assert(/12 meses/.test(long.message) && long.httpStatus === 400, `mensagem: ${long.message}`);
    const future = await rejects(() => start(deps, connection('asaas'), { start: '2026-11-01', end: '2026-12-31' }));
    assert(/futuro/.test(future.message), 'futuro');
    const mpDeps = makeDeps(new FakeSource('mercadopago', mpItems)).deps;
    const old = await rejects(() => start(mpDeps, connection('mercadopago'), { start: '2025-01-01', end: '2025-03-01' }));
    assert(/Mercado Pago/.test(old.message), 'MP início antigo');
  }],
  ['início: conta de destino é obrigatória e precisa ser da empresa da conexão e do tenant (CA10)', async () => {
    const { deps } = makeDeps(new FakeSource('asaas', asaasItems));
    const none = await rejects(() => start(deps, connection('asaas'), { accountId: '' }));
    assert(/conta de destino/i.test(none.message), `sem conta: ${none.message}`);
    const other = await rejects(() => start(deps, connection('asaas'), { accountId: 'acc-outra-empresa' }));
    assert(/empresa desta conexão/.test(other.message), 'outra empresa');
    const unknown = await rejects(() => start(deps, connection('asaas'), { accountId: 'acc-inexistente' }));
    assertEqual(unknown.httpStatus, 400, 'conta inexistente');
  }],
  ['início: sem chave de API, ou provedor sem importação (Stripe), é recusado', async () => {
    const { deps } = makeDeps(new FakeSource('asaas', asaasItems));
    const noKey = await rejects(() => start(deps, connection('asaas'), { apiKey: null }));
    assert(/chave de API/.test(noKey.message), 'sem chave');
    const stripe = await rejects(() => start(deps, connection('stripe')));
    assert(/Asaas e Mercado Pago/.test(stripe.message), 'Stripe');
  }],
  ['início: chave inválida mostra mensagem clara, não cria execução e não grava nada (CA7)', async () => {
    const source = new FakeSource('asaas', asaasItems);
    source.verifyError = new ProviderAuthError('O Asaas recusou a chave de API. Confira se é a chave de produção e se não foi revogada.');
    const { deps, runs, txStore } = makeDeps(source);
    const err = await rejects(() => start(deps, connection('asaas')));
    assertEqual(err.httpStatus, 400, 'status');
    assert(/recusou a chave de API/.test(err.message) && !err.message.includes('CHAVE_DE_EXEMPLO'), `mensagem: ${err.message}`);
    assertEqual(runs.runs.length, 0, 'nenhuma execução');
    assertEqual(txStore.rows.length, 0, 'nada gravado');
  }],
  ['Asaas: importa 3 meses de exemplo em lotes — contagens, valores, conta escolhida e cliente (CA2, CA10, CA11, CA13)', async () => {
    const { deps, txStore, runs, audits } = makeDeps(new FakeSource('asaas', asaasItems));
    const conn = connection('asaas');
    const started = await start(deps, conn);
    assertEqual(started.status, 'running', 'começa em andamento');
    assertEqual(started.phase, 'customers', 'Asaas começa pelos clientes');
    const { run, steps } = await runToEnd(deps, conn, started.id);
    assertEqual(run.status, 'completed', 'concluída');
    assert(steps > 2, `rodou em vários lotes (${steps})`);
    assertEqual(run.counts.created, 4, 'criados: 1 paga + 3 em aberto');
    assertEqual(run.counts.marked_apart, 2, 'estornada + removida marcadas à parte');
    assertEqual(run.counts.ignored + run.counts.updated + run.counts.failed, 0, 'sem outros');
    assertEqual(txStore.rows.length, 10, '4×(receita+taxa) + 2 canceladas');
    assert(txStore.rows.every((r) => r.account_id === ACC), 'todas na conta escolhida, não na da conexão');
    const income = txStore.rows.filter((r) => r.role === 'income' && r.status !== 'canceled');
    assertEqual(income.reduce((s, r) => s + r.amount, 0), 150 + 200 + 80.5 + 120, 'soma da receita que conta');
    assertEqual(txStore.rows.filter((r) => r.status === 'canceled').length, 2, 'duas canceladas');
    const names = txStore.inserted.filter((r) => r.role === 'income').map((r) => r.counterparty_name);
    assert(names.includes('Maria Souza Teste') && names.includes('Oficina Exemplo Ltda'), 'cliente como contraparte');
    assertEqual(audits.length, 1, 'uma auditoria ao concluir');
    assertEqual(audits[0]!.action, 'integration.history_imported', 'ação');
  }],
  ['Asaas: reimportar o mesmo período resulta em 0 criados e 0 atualizados (CA3)', async () => {
    const { deps, txStore } = makeDeps(new FakeSource('asaas', asaasItems));
    const conn = connection('asaas');
    const first = await runToEnd(deps, conn, (await start(deps, conn)).id);
    assertEqual(first.run.status, 'completed', 'primeira');
    const rowsAfterFirst = txStore.rows.length;
    const second = await runToEnd(deps, conn, (await start(deps, conn)).id);
    assertEqual(second.run.status, 'completed', 'segunda');
    assertEqual(second.run.counts.created, 0, 'nada criado');
    assertEqual(second.run.counts.updated, 0, 'nada atualizado');
    assertEqual(second.run.counts.marked_apart, 0, 'nada marcado de novo');
    assertEqual(second.run.counts.ignored, 6, 'seis já importados');
    assertEqual(txStore.rows.length, rowsAfterFirst, 'mesmo número de lançamentos');
  }],
  ['Asaas: importado pendente e depois pago pelo provedor atualiza o mesmo lançamento (CA5)', async () => {
    const pendingVersion = asaasItems.map((p) => (p.id === 'pay_0001' ? { ...p, status: 'PENDING', paymentDate: null, creditDate: null, clientPaymentDate: null } : p));
    const { deps, txStore } = makeDeps(new FakeSource('asaas', pendingVersion));
    const conn = connection('asaas');
    await runToEnd(deps, conn, (await start(deps, conn)).id);
    const before = txStore.rows.length;
    assertEqual(txStore.rows.find((r) => r.role === 'income' && r.amount === 150)!.status, 'pending', 'entrou pendente');
    const paid = makeDeps(new FakeSource('asaas', asaasItems), { runs: deps.runs, txStore, events: deps.events });
    const second = await runToEnd(paid.deps, conn, (await start(paid.deps, conn)).id);
    assertEqual(second.run.counts.updated, 1, 'um atualizado');
    assertEqual(second.run.counts.created, 0, 'nenhum criado');
    assertEqual(txStore.rows.length, before, 'sem linhas novas');
    assertEqual(txStore.rows.find((r) => r.role === 'income' && r.amount === 150)!.status, 'paid', 'agora paga');
  }],
  ['falha no meio: a página já importada fica, a execução fica "failed" com cursor e "Retomar" continua sem duplicar', async () => {
    const source = new FakeSource('asaas', asaasItems);
    source.failOnPaymentCall = { at: 2, error: new ProviderRequestError('O Asaas está indisponível no momento (erro 503).', true) };
    const { deps, txStore } = makeDeps(source);
    const conn = connection('asaas');
    const started = await start(deps, conn);
    const first = await runToEnd(deps, conn, started.id);
    assertEqual(first.run.status, 'failed', 'parou');
    assert(/indisponível/.test(first.run.last_error ?? ''), 'mensagem do provedor');
    const kept = txStore.rows.length;
    assert(kept > 0, 'o que já entrou foi mantido');
    assert(first.run.counts.created + first.run.counts.marked_apart > 0, 'contadores preservados');
    const resumed = await runToEnd(deps, conn, started.id);
    assertEqual(resumed.run.status, 'completed', 'retomada concluiu');
    assertEqual(resumed.run.counts.created, 4, 'total de criados igual a uma execução limpa');
    assertEqual(resumed.run.counts.marked_apart, 2, 'total marcado à parte igual');
    assertEqual(txStore.rows.length, 10, 'sem duplicar');
  }],
  ['chave recusada no meio: execução "failed" com mensagem clara; depois de corrigir, retoma (CA7)', async () => {
    const source = new FakeSource('asaas', asaasItems);
    source.failOnPaymentCall = { at: 1, error: new ProviderAuthError('O Asaas recusou a chave de API. Confira se é a chave de produção e se não foi revogada.') };
    const { deps, txStore } = makeDeps(source);
    const conn = connection('asaas');
    const started = await start(deps, conn);
    const failed = await runToEnd(deps, conn, started.id);
    assertEqual(failed.run.status, 'failed', 'falhou');
    assert(/recusou a chave de API/.test(failed.run.last_error ?? '') && !JSON.stringify(failed.run).includes('CHAVE_DE_EXEMPLO'), 'mensagem sem a chave');
    assertEqual(txStore.rows.length, 0, 'nada gravado');
    const resumed = await runToEnd(deps, conn, started.id);
    assertEqual(resumed.run.status, 'completed', 'retomou com a chave corrigida');
    assertEqual(txStore.rows.length, 10, 'importou tudo');
  }],
  ['só uma execução ativa por conexão: iniciar outra devolve 409 com a execução em andamento', async () => {
    const { deps } = makeDeps(new FakeSource('asaas', asaasItems));
    const conn = connection('asaas');
    const first = await start(deps, conn);
    const second = await rejects(() => start(deps, conn));
    assertEqual(second.httpStatus, 409, 'conflito');
    assertEqual(second.run?.id, first.id, 'devolve a execução ativa para retomar');
  }],
  ['cancelar mantém o que já foi importado e impede novos lotes', async () => {
    const { deps, txStore } = makeDeps(new FakeSource('asaas', asaasItems));
    const conn = connection('asaas');
    const started = await start(deps, conn);
    await stepRun(deps, { tenantId: T, runId: started.id, connection: conn, apiKey: KEY });
    await stepRun(deps, { tenantId: T, runId: started.id, connection: conn, apiKey: KEY });
    const kept = txStore.rows.length;
    assert(kept > 0, 'já importou algo');
    const canceled = await cancelRun(deps, { tenantId: T, runId: started.id });
    assertEqual(canceled.status, 'canceled', 'cancelada');
    const after = await stepRun(deps, { tenantId: T, runId: started.id, connection: conn, apiKey: KEY });
    assertEqual(after.status, 'canceled', 'continua cancelada');
    assertEqual(txStore.rows.length, kept, 'nada novo depois de cancelar');
    const again = await start(deps, conn);
    assertEqual(again.status, 'running', 'depois de cancelar dá para iniciar outra');
  }],
  ['erro em um pagamento não aborta o lote: conta em "erros" só com o id, e uma nova execução completa o que faltou', async () => {
    const { deps, txStore, events } = makeDeps(new FakeSource('asaas', asaasItems));
    const realInsert = txStore.insert.bind(txStore);
    let failOnce = true;
    txStore.insert = async (tenantId, source, ref, rows) => {
      if (failOnce && ref === 'pay_0002') {
        failOnce = false;
        throw new Error('falha simulada de banco para Maria Souza Teste');
      }
      return realInsert(tenantId, source, ref, rows);
    };
    const conn = connection('asaas');
    const first = await runToEnd(deps, conn, (await start(deps, conn)).id);
    assertEqual(first.run.status, 'completed', 'terminou mesmo com erro');
    assertEqual(first.run.counts.failed, 1, 'um erro');
    assertEqual(first.run.errors[0]!.ref, 'pay_0002', 'só o id do pagamento');
    assertEqual(first.run.counts.created, 3, 'os outros foram criados');
    assert(events.events.some((e) => e.status === 'failed' && e.external_event_id.startsWith('api:pay_0002')), 'evento de falha no log');
    // O que falhou entra na próxima execução (idempotente)
    events.events.length = 0;
    const second = await runToEnd(deps, conn, (await start(deps, conn)).id);
    assertEqual(second.run.counts.created, 1, 'entrou o que faltava');
    assertEqual(txStore.rows.length, 10, 'total correto');
  }],
  ['status desconhecido é ignorado e registrado no log com o motivo', async () => {
    const weird = asaasItems.map((p) => (p.id === 'pay_0003' ? { ...p, status: 'STATUS_NOVO' } : p));
    const { deps, events } = makeDeps(new FakeSource('asaas', weird));
    const conn = connection('asaas');
    const { run } = await runToEnd(deps, conn, (await start(deps, conn)).id);
    assertEqual(run.counts.ignored, 1, 'um ignorado');
    const ev = events.events.find((e) => e.external_event_id.startsWith('api:pay_0003'))!;
    assertEqual(ev.status, 'ignored', 'log ignorado');
    assert(/STATUS_NOVO/.test(ev.error_message ?? ''), 'motivo');
  }],
  ['log de eventos: um por pagamento, origem API, sem nome de cliente e sem duplicar na reimportação (CA11)', async () => {
    const { deps, events } = makeDeps(new FakeSource('asaas', asaasItems));
    const conn = connection('asaas');
    await runToEnd(deps, conn, (await start(deps, conn)).id);
    assertEqual(events.events.length, 6, 'seis eventos');
    const payloads = JSON.stringify(events.events.map((e) => e.payload));
    for (const forbidden of ['Maria', 'Oficina', 'example.com', 'cus_0001']) assert(!payloads.includes(forbidden), `payload contém ${forbidden}`);
    assert(events.events.every((e) => e.external_event_id.startsWith('api:') && e.payload.source === 'api'), 'origem API');
    await runToEnd(deps, conn, (await start(deps, conn)).id);
    assertEqual(events.events.length, 6, 'reimportação não duplica o log');
  }],
  ['execução pública não expõe nomes de clientes nem o cursor interno', async () => {
    const { deps } = makeDeps(new FakeSource('asaas', asaasItems));
    const conn = connection('asaas');
    const { run } = await runToEnd(deps, conn, (await start(deps, conn)).id);
    const json = JSON.stringify(run);
    assert(!json.includes('Maria') && !json.includes('customers') && !json.includes('cursor'), 'sem dados internos');
    assertEqual(run.window_total, 2, 'duas janelas mensais');
  }],
  ['Mercado Pago: só recebimentos viram receita; a compra feita pela própria conta é ignorada; sem fase de clientes; pendente sem taxa (CA6, CA13)', async () => {
    const source = new FakeSource('mercadopago', mpItems);
    const { deps, txStore, runs, events } = makeDeps(source);
    const conn = connection('mercadopago');
    const started = await start(deps, conn, { accountId: ACC });
    assertEqual(started.phase, 'payments', 'MP vai direto aos pagamentos');
    assertEqual(runs.runs[0]!.cursor.providerAccountId, MP_OWN_ID, 'guarda o id da conta dona do token');
    const { run } = await runToEnd(deps, conn, started.id);
    assertEqual(run.status, 'completed', 'concluída');
    assertEqual(run.counts.created, 3, 'aprovado + 2 em aberto');
    assertEqual(run.counts.marked_apart, 3, 'cancelado, rejeitado e estornado');
    assertEqual(run.counts.ignored, 1, 'a compra da própria conta');
    assertEqual(txStore.rows.length, 7, 'aprovado (receita+taxa) + 2 abertos + 3 marcados; a compra não gera nada');
    const fees = txStore.rows.filter((r) => r.role === 'fee');
    assertEqual(fees.length, 1, 'só o aprovado tem taxa');
    assertEqual(fees[0]!.amount, 5.99, 'taxa dos fee_details');
    assert(txStore.inserted.some((r) => r.counterparty_name === 'Carlos Pereira Teste'), 'pagador como contraparte');
    assert(!txStore.inserted.some((r) => String(r.description).includes('compra feita por esta conta')), 'a compra não virou lançamento');
    const ev = events.events.find((e) => e.external_event_id.startsWith('api:90000007'))!;
    assertEqual(ev.status, 'ignored', 'registrada no log como ignorada');
    assert(/não é recebimento/.test(ev.error_message ?? ''), 'com o motivo');
    const again = await runToEnd(deps, conn, (await start(deps, conn)).id);
    assertEqual(again.run.counts.created + again.run.counts.updated + again.run.counts.marked_apart, 0, 'reimportação sem efeitos (CA3 no MP)');
    assertEqual(again.run.counts.ignored, 7, 'sete já tratados ou ignorados');
  }],
  ['Mercado Pago: se a conta dona do token não puder ser identificada, a importação não começa (não importa às cegas)', async () => {
    const source = new FakeSource('mercadopago', mpItems);
    source.identifyError = new ProviderRequestError('Não foi possível identificar a conta do Mercado Pago para separar recebimentos de compras.', false);
    const { deps, runs, txStore } = makeDeps(source);
    const err = await rejects(() => start(deps, connection('mercadopago')));
    assert(/identificar a conta/.test(err.message), `mensagem: ${err.message}`);
    assertEqual(runs.runs.length, 0, 'nenhuma execução');
    assertEqual(txStore.rows.length, 0, 'nada gravado');
  }],
  ['Mercado Pago: execução sem id da conta guardado (antiga) identifica a conta antes de importar', async () => {
    const source = new FakeSource('mercadopago', mpItems);
    const { deps, runs, txStore } = makeDeps(source);
    const conn = connection('mercadopago');
    const started = await start(deps, conn);
    delete runs.runs[0]!.cursor.providerAccountId;
    const before = source.identifyCalls;
    const { run } = await runToEnd(deps, conn, started.id);
    assertEqual(run.status, 'completed', 'concluída');
    assert(source.identifyCalls > before, 'identificou de novo');
    assertEqual(runs.runs[0]!.cursor.providerAccountId, MP_OWN_ID, 'e guardou');
    assertEqual(txStore.rows.length, 7, 'mesmo resultado');
  }],
];

export async function runHistoryRunnerTests(): Promise<TestCaseResult[]> {
  return runCases(cases);
}
