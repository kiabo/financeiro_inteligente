/**
 * Upsert por pagamento (spec 004) — decisão única usada pela importação de histórico e pelo webhook.
 *
 * A chave de deduplicação é (tenant, provedor, id do pagamento, papel), independente de conta e de conexão.
 * A decisão é pura sobre o que já existe no armazenamento (`TransactionStore`); a implementação Supabase
 * e o uso pelo webhook entram na T08/T09.
 *
 * ESTADO: esqueleto da T07 (os testes escritos antes da implementação devem falhar até a T08).
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

export async function upsertPayment(_store: TransactionStore, _params: UpsertParams): Promise<UpsertOutcome> {
  throw new Error('upsertPayment ainda não implementado (T08)');
}
