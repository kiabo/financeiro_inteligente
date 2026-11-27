/**
 * Clientes HTTP dos provedores para a importação de histórico (spec 004).
 *
 * Regras duras:
 *  - **Somente leitura**: toda chamada é `GET`, sem corpo. Não existe método de escrita nestes clientes.
 *  - A chave de API só vai no cabeçalho; **nunca** em mensagem de erro, log ou resposta.
 *  - Limites respeitados: espaçamento mínimo entre chamadas e espera no `429` (sem repetir de imediato).
 */

export class ProviderError extends Error {
  /** true = a execução pode ser retomada depois sem perder o que já foi importado */
  readonly resumable: boolean;
  constructor(message: string, resumable: boolean) {
    super(message);
    this.name = 'ProviderError';
    this.resumable = resumable;
  }
}

/** Chave inválida, revogada ou sem permissão (401/403 sem bloqueio temporário). */
export class ProviderAuthError extends ProviderError {
  constructor(message: string) {
    super(message, false);
    this.name = 'ProviderAuthError';
  }
}

/** Limite de requisições esgotou as tentativas: retomar mais tarde. */
export class ProviderRateLimitError extends ProviderError {
  constructor(message: string) {
    super(message, true);
    this.name = 'ProviderRateLimitError';
  }
}

/** Falha de rede, 5xx ou resposta inesperada. */
export class ProviderRequestError extends ProviderError {}

type FetchLike = (url: string, init: { method: 'GET'; headers: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

export interface ProviderClientOptions {
  fetchImpl?: FetchLike;
  /** Pausa (injetável nos testes) */
  sleep?: (ms: number) => Promise<void>;
  /** Relógio em ms (injetável nos testes) */
  nowMs?: () => number;
  /** Intervalo mínimo entre chamadas (padrão 250 ms ≈ 4 req/s) */
  minIntervalMs?: number;
  /** Repetições após 429/5xx/erro de rede (padrão 3) */
  maxRetries?: number;
  timeoutMs?: number;
}

const MAX_WAIT_MS = 30_000;
const USER_AGENT = 'FinanceiroInteligente/1.0';

abstract class ReadOnlyClient {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly nowMs: () => number;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private lastCallAt = 0;

  protected constructor(
    private readonly providerName: string,
    private readonly authErrorMessage: string,
    options: ProviderClientOptions
  ) {
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.nowMs = options.nowMs ?? Date.now;
    this.minIntervalMs = options.minIntervalMs ?? 250;
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** Segundos de espera pedidos pelo provedor (RateLimit-Reset ou Retry-After), ou null. */
  private waitHintMs(res: Response): number | null {
    for (const header of ['ratelimit-reset', 'retry-after']) {
      const raw = res.headers.get(header);
      const seconds = raw === null ? NaN : Number(raw);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_WAIT_MS, Math.ceil(seconds * 1000));
    }
    return null;
  }

  private async throttle(): Promise<void> {
    const wait = this.lastCallAt + this.minIntervalMs - this.nowMs();
    if (wait > 0) await this.sleep(wait);
    this.lastCallAt = this.nowMs();
  }

  protected async getJson(url: string, headers: Record<string, string>): Promise<unknown> {
    let lastFailure: ProviderError | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.throttle();
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: 'GET',
          headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...headers },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch {
        lastFailure = new ProviderRequestError(`Não foi possível falar com o ${this.providerName} (rede ou tempo esgotado).`, true);
        if (attempt < this.maxRetries) await this.sleep(Math.min(MAX_WAIT_MS, 1000 * 2 ** attempt));
        continue;
      }

      if (res.ok) {
        try {
          return await res.json();
        } catch {
          throw new ProviderRequestError(`Resposta inesperada do ${this.providerName}.`, true);
        }
      }

      const hint = this.waitHintMs(res);
      if (res.status === 429 || (res.status === 403 && res.headers.get('retry-after') !== null)) {
        lastFailure = new ProviderRateLimitError(
          `O limite de consultas do ${this.providerName} foi atingido. Aguarde alguns minutos e use "Retomar".`
        );
        if (attempt < this.maxRetries) await this.sleep(hint ?? Math.min(MAX_WAIT_MS, 2000 * (attempt + 1)));
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new ProviderAuthError(this.authErrorMessage);
      if (res.status >= 500) {
        lastFailure = new ProviderRequestError(`O ${this.providerName} está indisponível no momento (erro ${res.status}).`, true);
        if (attempt < this.maxRetries) await this.sleep(Math.min(MAX_WAIT_MS, 1000 * 2 ** attempt));
        continue;
      }
      throw new ProviderRequestError(`O ${this.providerName} recusou a consulta (erro ${res.status}).`, false);
    }
    throw lastFailure ?? new ProviderRequestError(`Falha ao consultar o ${this.providerName}.`, true);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

// ----------------------------------------------------------------------------
// Asaas
// ----------------------------------------------------------------------------
export const ASAAS_PAGE_SIZE = 100;

/** Chaves de sandbox começam com `$aact_hmlg_`; qualquer outra usa produção. */
export function asaasBaseUrl(apiKey: string): string {
  return apiKey.startsWith('$aact_hmlg_') ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
}

export interface AsaasPage {
  items: Array<Record<string, unknown>>;
  hasMore: boolean;
  totalCount: number | null;
}

export interface AsaasCustomerLite {
  id: string;
  name: string;
  deleted: boolean;
}

export class AsaasClient extends ReadOnlyClient {
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    options: ProviderClientOptions = {}
  ) {
    super(
      'Asaas',
      'O Asaas recusou a chave de API. Confira se é a chave de produção e se não foi revogada.',
      options
    );
    this.baseUrl = asaasBaseUrl(apiKey);
  }

  private async page(path: string, params: Record<string, string | number>): Promise<AsaasPage> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const body = await this.getJson(`${this.baseUrl}${path}?${qs.toString()}`, { access_token: this.apiKey });
    if (!isObj(body) || !Array.isArray(body.data)) {
      throw new ProviderRequestError('Resposta inesperada do Asaas.', true);
    }
    return {
      items: body.data.filter(isObj),
      hasMore: body.hasMore === true,
      totalCount: typeof body.totalCount === 'number' ? body.totalCount : null,
    };
  }

  /** Cobranças criadas entre `start` e `end` (YYYY-MM-DD, inclusive). */
  listPayments(params: { start: string; end: string; offset: number; limit?: number }): Promise<AsaasPage> {
    return this.page('/payments', {
      'dateCreated[ge]': params.start,
      'dateCreated[le]': params.end,
      offset: params.offset,
      limit: params.limit ?? ASAAS_PAGE_SIZE,
    });
  }

  /** Lista de clientes reduzida a id, nome e se foi removido (nenhum outro dado pessoal sai daqui). */
  async listCustomers(params: { offset: number; limit?: number }): Promise<{ items: AsaasCustomerLite[]; hasMore: boolean }> {
    const page = await this.page('/customers', { offset: params.offset, limit: params.limit ?? ASAAS_PAGE_SIZE });
    const items: AsaasCustomerLite[] = [];
    for (const c of page.items) {
      if (typeof c.id === 'string' && c.id) {
        items.push({ id: c.id, name: typeof c.name === 'string' ? c.name : '', deleted: c.deleted === true });
      }
    }
    return { items, hasMore: page.hasMore };
  }

  /** Teste barato de chave: 1 cobrança. Lança ProviderAuthError se a chave for recusada. */
  async verifyKey(): Promise<void> {
    await this.page('/payments', { offset: 0, limit: 1 });
  }
}

// ----------------------------------------------------------------------------
// Mercado Pago
// ----------------------------------------------------------------------------
/** Menor que qualquer teto citado na documentação (T01). */
export const MERCADOPAGO_PAGE_SIZE = 50;

export interface MercadoPagoPage {
  items: Array<Record<string, unknown>>;
  total: number | null;
  hasMore: boolean;
}

export class MercadoPagoClient extends ReadOnlyClient {
  constructor(
    private readonly accessToken: string,
    options: ProviderClientOptions = {}
  ) {
    super(
      'Mercado Pago',
      'O Mercado Pago recusou o access token. Confira se é o de produção e se não foi renovado.',
      options
    );
  }

  private async search(params: Record<string, string | number>, offset: number, limit: number): Promise<MercadoPagoPage> {
    const qs = new URLSearchParams(Object.entries({ ...params, limit, offset }).map(([k, v]) => [k, String(v)]));
    const body = await this.getJson(`https://api.mercadopago.com/v1/payments/search?${qs.toString()}`, {
      Authorization: `Bearer ${this.accessToken}`,
    });
    if (!isObj(body) || !Array.isArray(body.results)) {
      throw new ProviderRequestError('Resposta inesperada do Mercado Pago.', true);
    }
    const items = body.results.filter(isObj);
    const paging = isObj(body.paging) ? body.paging : {};
    const total = typeof paging.total === 'number' ? paging.total : null;
    const hasMore = items.length > 0 && (total === null ? items.length >= limit : offset + items.length < total);
    return { items, total, hasMore };
  }

  /** Pagamentos criados entre `start` e `end` (YYYY-MM-DD, inclusive; fuso de Brasília, sem horário de verão). */
  searchPayments(params: { start: string; end: string; offset: number; limit?: number }): Promise<MercadoPagoPage> {
    return this.search(
      {
        sort: 'date_created',
        criteria: 'asc',
        range: 'date_created',
        begin_date: `${params.start}T00:00:00.000-03:00`,
        end_date: `${params.end}T23:59:59.999-03:00`,
      },
      params.offset,
      params.limit ?? MERCADOPAGO_PAGE_SIZE
    );
  }

  /** Teste barato de token: 1 pagamento. Lança ProviderAuthError se o token for recusado. */
  async verifyKey(): Promise<void> {
    await this.search(
      { sort: 'date_created', criteria: 'desc', range: 'date_created', begin_date: 'NOW-30DAYS', end_date: 'NOW' },
      0,
      1
    );
  }
}
