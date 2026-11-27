/**
 * Upsert por pagamento (spec 004) — decisão única usada pela importação de histórico e pelo webhook.
 *
 * A chave de deduplicação é (tenant, provedor, id do pagamento, papel), independente de conta e de conexão.
 * A decisão é feita sobre o que já existe no armazenamento (`TransactionStore`); a implementação Supabase
 * fica em `supabaseTransactionStore.ts` e os testes usam um armazenamento em memória que simula o índice único.
 */

export type ExternalRole = 'income' | 'fee' | 'refund';
export type PaymentRowStatus = 'pending' | 'paid' | 'overdue' | 'canceled';

/** Linha já gravada para o pagamento. */
export interface StoredPaymentRow {
  id: string;
  role: ExternalRole;
  status: PaymentRowStatus;
  account_id: string;
  amount: number;
  due_date: string;
  payment_date: string | null;
  notes: string | null;
}

/** Linha planejada para um pagamento (saída de `planTransactionsForEvent`). */
export interface PlannedPaymentRow {
  role: ExternalRole;
  status: PaymentRowStatus;
  account_id: string;
  amount: number;
  due_date: string;
  payment_date: string | null;
  notes: string;
  [extra: string]: unknown;
}

/** Violação da chave única (outro processo gravou o mesmo pagamento no meio do caminho). */
export class StoreConflictError extends Error {
  constructor() {
    super('Pagamento já gravado.');
    this.name = 'StoreConflictError';
  }
}

export interface PaymentPatch {
  status?: PaymentRowStatus;
  payment_date?: string | null;
  due_date?: string;
  amount?: number;
  notes?: string;
  external_source?: string;
  external_ref?: string;
  external_role?: ExternalRole;
}

export interface TransactionStore {
  /** Linhas com a chave externa do pagamento, em qualquer conta. */
  findByPayment(tenantId: string, source: string, ref: string): Promise<StoredPaymentRow[]>;
  /** Linhas antigas (anteriores à chave) reconhecidas só pelo marcador em `notes`. */
  findLegacy(tenantId: string, source: string, ref: string): Promise<StoredPaymentRow[]>;
  /** Insere linhas já com `external_*`; lança `StoreConflictError` na violação da chave única. */
  insert(tenantId: string, source: string, ref: string, rows: PlannedPaymentRow[]): Promise<string[]>;
  update(tenantId: string, id: string, patch: PaymentPatch): Promise<void>;
}

/**
 * Intenção do evento:
 *  - `open`    pendente/confirmado/vencido (cria se não existe; senão não mexe);
 *  - `settled` pago (pendente → liquidado; nunca regride);
 *  - `void`    cancelado/estornado vindo da importação (marca a receita como `canceled`, sem linha de estorno);
 *  - `refund`  evento de estorno do webhook (cria/atualiza a linha de estorno, salvo receita já cancelada).
 */
export type UpsertIntent = 'open' | 'settled' | 'void' | 'refund';

export interface UpsertParams {
  tenantId: string;
  source: string;
  ref: string;
  intent: UpsertIntent;
  /** Linhas que seriam criadas (com a conta de destino correta); em `void`, só a receita já com status `canceled`. */
  planned: PlannedPaymentRow[];
}

export interface UpsertOutcome {
  action: 'created' | 'updated' | 'marked_apart' | 'ignored';
  ids: string[];
  reason?: string;
}

const isOpen = (status: PaymentRowStatus) => status === 'pending' || status === 'overdue';
/** pendente e vencido são o mesmo estado lógico (o banco troca um pelo outro conforme a data). */
const sameStatus = (a: PaymentRowStatus, b: PaymentRowStatus) => a === b || (isOpen(a) && isOpen(b));

type Decision =
  | { kind: 'insert'; rows: PlannedPaymentRow[]; action: 'created' | 'marked_apart' }
  | { kind: 'update'; updates: Array<{ id: string; patch: PaymentPatch }>; action: 'updated' | 'marked_apart' }
  | { kind: 'ignore'; reason: string };

const byRole = (rows: readonly StoredPaymentRow[], role: ExternalRole) => rows.find((r) => r.role === role);

function decide(existing: readonly StoredPaymentRow[], params: UpsertParams): Decision {
  const income = byRole(existing, 'income');
  const feeRow = byRole(existing, 'fee');
  const refund = byRole(existing, 'refund');
  const plannedOf = (role: ExternalRole) => params.planned.find((r) => r.role === role);

  switch (params.intent) {
    case 'open': {
      if (existing.length === 0) return { kind: 'insert', rows: params.planned, action: 'created' };
      return { kind: 'ignore', reason: 'pagamento já importado' };
    }

    case 'settled': {
      if (existing.length === 0) return { kind: 'insert', rows: params.planned, action: 'created' };
      if (!income) {
        // Só há estorno (ou taxa) gravado: cria o que falta da receita/taxa
        const missing = params.planned.filter((r) => !byRole(existing, r.role));
        return missing.length > 0
          ? { kind: 'insert', rows: missing, action: 'created' }
          : { kind: 'ignore', reason: 'sem receita para liquidar' };
      }
      if (income.status === 'paid' || income.status === 'canceled') {
        return { kind: 'ignore', reason: income.status === 'paid' ? 'já liquidado' : 'receita cancelada' };
      }
      const updates: Array<{ id: string; patch: PaymentPatch }> = [];
      for (const [current, planned] of [[income, plannedOf('income')], [feeRow, plannedOf('fee')]] as const) {
        if (!current || !planned) continue;
        const patch: PaymentPatch = {};
        if (!sameStatus(current.status, planned.status)) patch.status = planned.status;
        if (current.payment_date !== planned.payment_date) patch.payment_date = planned.payment_date;
        if (current.due_date !== planned.due_date) patch.due_date = planned.due_date;
        if ((current.notes ?? '') !== planned.notes) patch.notes = planned.notes;
        if (Object.keys(patch).length > 0) updates.push({ id: current.id, patch });
      }
      return updates.length > 0 ? { kind: 'update', updates, action: 'updated' } : { kind: 'ignore', reason: 'sem alteração' };
    }

    case 'void': {
      if (refund) return { kind: 'ignore', reason: 'estorno já registrado' };
      if (!income) return { kind: 'insert', rows: params.planned.filter((r) => r.role === 'income'), action: 'marked_apart' };
      if (income.status === 'canceled') return { kind: 'ignore', reason: 'já marcado como cancelado' };
      const notes = plannedOf('income')?.notes;
      const updates = [income, feeRow]
        .filter((r): r is StoredPaymentRow => !!r && r.status !== 'canceled')
        .map((r) => ({ id: r.id, patch: { status: 'canceled', ...(notes ? { notes } : {}) } as PaymentPatch }));
      return { kind: 'update', updates, action: 'marked_apart' };
    }

    case 'refund': {
      const planned = plannedOf('refund');
      if (!planned) return { kind: 'ignore', reason: 'sem linha de estorno planejada' };
      if (income?.status === 'canceled') return { kind: 'ignore', reason: 'receita já marcada como cancelada' };
      if (!refund) return { kind: 'insert', rows: [planned], action: 'created' };
      if (planned.amount > refund.amount) {
        return { kind: 'update', updates: [{ id: refund.id, patch: { amount: planned.amount, notes: planned.notes } }], action: 'updated' };
      }
      return { kind: 'ignore', reason: 'estorno sem alteração' };
    }
  }
}

/** Reconhece linhas antigas (só marcador em `notes`) e grava a chave externa nelas. */
async function loadExisting(store: TransactionStore, params: UpsertParams): Promise<StoredPaymentRow[]> {
  const keyed = await store.findByPayment(params.tenantId, params.source, params.ref);
  if (keyed.length > 0) return keyed;
  const legacy = await store.findLegacy(params.tenantId, params.source, params.ref);
  for (const row of legacy) {
    await store.update(params.tenantId, row.id, {
      external_source: params.source,
      external_ref: params.ref,
      external_role: row.role,
    });
  }
  return legacy;
}

/**
 * Aplica o pagamento de forma idempotente. Se outro processo gravar o mesmo pagamento no meio do caminho
 * (violação da chave única), relê e decide de novo em vez de falhar ou duplicar.
 */
export async function upsertPayment(store: TransactionStore, params: UpsertParams): Promise<UpsertOutcome> {
  let lastConflict = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let existing: StoredPaymentRow[];
    try {
      existing = await loadExisting(store, params);
    } catch (err) {
      if (err instanceof StoreConflictError) continue;
      throw err;
    }
    const decision = decide(existing, params);

    if (decision.kind === 'ignore') return { action: 'ignored', ids: [], reason: decision.reason };

    if (decision.kind === 'update') {
      for (const u of decision.updates) await store.update(params.tenantId, u.id, u.patch);
      return { action: decision.action, ids: decision.updates.map((u) => u.id) };
    }

    if (decision.rows.length === 0) return { action: 'ignored', ids: [], reason: 'nada a gravar' };
    try {
      const ids = await store.insert(params.tenantId, params.source, params.ref, decision.rows);
      return { action: decision.action, ids };
    } catch (err) {
      if (!(err instanceof StoreConflictError)) throw err;
      lastConflict = true;
    }
  }
  return { action: 'ignored', ids: [], reason: lastConflict ? 'gravado por outro processo' : 'sem alteração' };
}
