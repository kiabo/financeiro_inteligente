import { assert, assertEqual, runCases, type TestCase, type TestCaseResult } from '../../scripts/testHarness.ts';
import { encryptSecret } from '../crypto/secretBox.ts';
import { HistoryRunError, type HistorySource } from '../integrations/history/historyRunner.ts';
import { decryptConnectionApiKey } from '../integrations/history/historyStores.ts';
import {
  cancelHistoryImport,
  getHistoryImport,
  latestHistoryImport,
  startHistoryImport,
  stepHistoryImport,
  type HistoryServiceDeps,
} from '../integrations/history/historyService.ts';
import { presentConnection } from '../integrations/webhookRoutes.ts';
import type { IntegrationConnectionRow } from '../integrations/webhooks/webhookCore.ts';
import { loadFixture } from './history.test.ts';
import { MemoryEventLog, MemoryRunStore } from './helpers/memoryRuns.ts';
import { MemoryTransactionStore } from './helpers/memoryStore.ts';

type Obj = Record<string, unknown>;

const T = 'tenant-1';
const NOW = new Date('2026-11-26T15:00:00Z');
const API_KEY = '$aact_prod_CHAVE_SECRETA_DE_EXEMPLO_987';
const CRED_KEY_HEX = 'ab'.repeat(32);
const asaasItems = [
  ...loadFixture<{ data: Obj[] }>('asaas-payments-page1.json').data,
  ...loadFixture<{ data: Obj[] }>('asaas-payments-page2.json').data,
];

async function withCredentialsKey<T2>(fn: () => Promise<T2> | T2): Promise<T2> {
  const previous = process.env.CREDENTIALS_ENCRYPTION_KEY;
  process.env.CREDENTIALS_ENCRYPTION_KEY = CRED_KEY_HEX;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    else process.env.CREDENTIALS_ENCRYPTION_KEY = previous;
  }
}

const sealedKey = (key: string, tenant = T) => withCredentialsKey(() => encryptSecret(JSON.stringify({ api_access_token: key }), tenant));

function connectionRow(over: Partial<IntegrationConnectionRow> = {}): IntegrationConnectionRow {
  return {
    id: 'conn-1', tenant_id: T, provider: 'asaas', label: 'Asaas', company_id: 'comp-1', account_id: 'acc-da-conexao',
    webhook_secret_id: 'a'.repeat(32), signing_secret_encrypted: 'v1:segredo', credentials_encrypted: null, config: {}, status: 'active', ...over,
  };
}

function fakeSource(seen: { keys: string[] }): HistorySource {
  return {
    pageSize: 100,
    verifyKey: async () => undefined,
    listCustomers: async () => ({ items: [{ id: 'cus_0001', name: 'Maria Souza Teste', deleted: false }], hasMore: false }),
    listPayments: async (window, offset) => {
      const inWindow = asaasItems.filter((p) => String(p.dateCreated) >= window.start && String(p.dateCreated) <= window.end);
      return { items: inWindow.slice(offset), hasMore: false, total: inWindow.length };
    },
  };
}

async function makeService(connection: IntegrationConnectionRow | null, seenKeys: string[] = []) {
  const runs = new MemoryRunStore();
  const deps: HistoryServiceDeps = {
    runs,
    txStore: new MemoryTransactionStore(),
    events: new MemoryEventLog(),
    loadCatalog: async () => ({ categories: [], products: [] }),
    getAccount: async (tenantId, id) => (tenantId === T && id === 'acc-a' ? { id, company_id: 'comp-1' } : null),
    createSource: (_provider, apiKey) => {
      seenKeys.push(apiKey);
      return fakeSource({ keys: seenKeys });
    },
    audit: async () => undefined,
    now: () => NOW,
    loadConnection: async (tenantId, id) => (connection && connection.tenant_id === tenantId && connection.id === id ? connection : null),
    getApiKey: (c) => withCredentialsKeySync(() => decryptConnectionApiKey(c)),
    findLatest: async (tenantId, connectionId) => {
      const all = runs.runs.filter((r) => r.tenant_id === tenantId && r.connection_id === connectionId);
      return all.length ? JSON.parse(JSON.stringify(all[all.length - 1])) : null;
    },
  };
  return { deps, runs };
}

function withCredentialsKeySync<T2>(fn: () => T2): T2 {
  const previous = process.env.CREDENTIALS_ENCRYPTION_KEY;
  process.env.CREDENTIALS_ENCRYPTION_KEY = CRED_KEY_HEX;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    else process.env.CREDENTIALS_ENCRYPTION_KEY = previous;
  }
}

const body = { account_id: 'acc-a', period_start: '2026-01-01', period_end: '2026-02-28' };

const cases: TestCase[] = [
  ['conexão devolvida ao navegador: só api_key_configured; nenhum campo cifrado nem a chave (CA1)', async () => {
    const sealed = await sealedKey(API_KEY);
    assert(sealed.startsWith('v1:') && !sealed.includes(API_KEY) && !sealed.includes('CHAVE_SECRETA'), 'chave cifrada no formato v1');
    const withKey = presentConnection({ ...connectionRow({ credentials_encrypted: sealed }) } as unknown as Parameters<typeof presentConnection>[0], 'https://h-cfo.exemplo');
    const without = presentConnection({ ...connectionRow() } as unknown as Parameters<typeof presentConnection>[0], 'https://h-cfo.exemplo');
    assertEqual(withKey.api_key_configured, true, 'configurada');
    assertEqual(without.api_key_configured, false, 'não configurada');
    const json = JSON.stringify(withKey);
    for (const forbidden of ['credentials_encrypted', 'signing_secret_encrypted', 'v1:', 'CHAVE_SECRETA', API_KEY]) {
      assert(!json.includes(forbidden), `resposta contém "${forbidden}"`);
    }
    assert(String(withKey.webhook_url).endsWith(`/api/webhooks/asaas/${'a'.repeat(32)}`), 'URL do webhook');
  }],
  ['decifrar a chave: roundtrip da credencial; sem credencial devolve null; outro tenant não decifra', async () => {
    const sealed = await sealedKey(API_KEY);
    assertEqual(withCredentialsKeySync(() => decryptConnectionApiKey({ tenant_id: T, credentials_encrypted: sealed })), API_KEY, 'roundtrip');
    assertEqual(withCredentialsKeySync(() => decryptConnectionApiKey({ tenant_id: T, credentials_encrypted: null })), null, 'sem chave');
    let failed = false;
    try {
      withCredentialsKeySync(() => decryptConnectionApiKey({ tenant_id: 'tenant-2', credentials_encrypted: sealed }));
    } catch {
      failed = true;
    }
    assert(failed, 'credencial copiada para outro tenant não decifra');
  }],
  ['fluxo completo pelo serviço: a chave é usada no provedor mas não aparece em nenhuma resposta (CA1)', async () => {
    const seen: string[] = [];
    const sealed = await sealedKey(API_KEY);
    const { deps } = await makeService(connectionRow({ credentials_encrypted: sealed }), seen);
    const responses: unknown[] = [];
    const started = await startHistoryImport(deps, { tenantId: T, connectionId: 'conn-1', body });
    responses.push(started);
    let run = started;
    for (let i = 0; i < 10 && run.status === 'running'; i += 1) {
      run = await stepHistoryImport(deps, { tenantId: T, runId: started.id });
      responses.push(run);
    }
    responses.push(await getHistoryImport(deps, { tenantId: T, runId: started.id }));
    responses.push(await latestHistoryImport(deps, { tenantId: T, connectionId: 'conn-1' }));
    assertEqual(run.status, 'completed', 'concluiu');
    assert(seen.length > 0 && seen.every((k) => k === API_KEY), 'a chave foi usada no provedor');
    const json = JSON.stringify(responses);
    assert(!json.includes('CHAVE_SECRETA') && !json.includes('v1:'), 'chave ausente das respostas');
  }],
  ['sem chave configurada: mensagem clara e nada é criado (CA1)', async () => {
    const { deps, runs } = await makeService(connectionRow());
    try {
      await startHistoryImport(deps, { tenantId: T, connectionId: 'conn-1', body });
      throw new Error('era esperado erro');
    } catch (err) {
      assert(err instanceof HistoryRunError && /chave de API/.test(err.message), `mensagem: ${String(err)}`);
    }
    assertEqual(runs.runs.length, 0, 'nenhuma execução');
  }],
  ['período de 13 meses e conta ausente são recusados pelo serviço com mensagem legível (CA8, CA10)', async () => {
    const sealed = await sealedKey(API_KEY);
    const { deps } = await makeService(connectionRow({ credentials_encrypted: sealed }));
    for (const [over, pattern] of [
      [{ period_start: '2025-01-01', period_end: '2026-02-01' }, /12 meses/],
      [{ account_id: '' }, /conta de destino/i],
    ] as const) {
      try {
        await startHistoryImport(deps, { tenantId: T, connectionId: 'conn-1', body: { ...body, ...over } });
        throw new Error('era esperado erro');
      } catch (err) {
        assert(err instanceof HistoryRunError && pattern.test(err.message) && err.httpStatus === 400, `erro: ${String(err)}`);
      }
    }
  }],
  ['isolamento por tenant: conexão e execução de outro tenant dão 404', async () => {
    const sealed = await sealedKey(API_KEY);
    const { deps } = await makeService(connectionRow({ credentials_encrypted: sealed }));
    const started = await startHistoryImport(deps, { tenantId: T, connectionId: 'conn-1', body });
    for (const call of [
      () => startHistoryImport(deps, { tenantId: 'tenant-2', connectionId: 'conn-1', body }),
      () => stepHistoryImport(deps, { tenantId: 'tenant-2', runId: started.id }),
      () => getHistoryImport(deps, { tenantId: 'tenant-2', runId: started.id }),
      () => cancelHistoryImport(deps, { tenantId: 'tenant-2', runId: started.id }),
      () => latestHistoryImport(deps, { tenantId: 'tenant-2', connectionId: 'conn-1' }),
    ]) {
      try {
        await call();
        throw new Error('era esperado erro');
      } catch (err) {
        assert(err instanceof HistoryRunError && err.httpStatus === 404, `esperado 404: ${String(err)}`);
      }
    }
  }],
  ['última execução da conexão: nula sem importações; depois, a mais recente (para "Retomar")', async () => {
    const sealed = await sealedKey(API_KEY);
    const { deps } = await makeService(connectionRow({ credentials_encrypted: sealed }));
    assertEqual(await latestHistoryImport(deps, { tenantId: T, connectionId: 'conn-1' }), null, 'sem execuções');
    const started = await startHistoryImport(deps, { tenantId: T, connectionId: 'conn-1', body });
    const latest = await latestHistoryImport(deps, { tenantId: T, connectionId: 'conn-1' });
    assertEqual(latest?.id, started.id, 'a mais recente');
    await cancelHistoryImport(deps, { tenantId: T, runId: started.id });
    assertEqual((await latestHistoryImport(deps, { tenantId: T, connectionId: 'conn-1' }))?.status, 'canceled', 'status atualizado');
  }],
];

export async function runHistoryServiceTests(): Promise<TestCaseResult[]> {
  return runCases(cases);
}
