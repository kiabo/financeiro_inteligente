import { getSupabaseAdmin } from '../../supabaseAdmin.ts';
import {
  StoreConflictError,
  type ExternalRole,
  type PaymentPatch,
  type PaymentRowStatus,
  type PlannedPaymentRow,
  type StoredPaymentRow,
  type TransactionStore,
} from './paymentUpsert.ts';

/**
 * Implementação Supabase (service role) do armazenamento de lançamentos por pagamento.
 * Toda consulta filtra por `tenant_id` (a service role ignora a RLS).
 */

const COLUMNS = 'id, transaction_type, status, account_id, amount, due_date, payment_date, notes, description, external_role';

interface DbRow {
  id: string;
  transaction_type: string;
  status: PaymentRowStatus;
  account_id: string;
  amount: number | string;
  due_date: string;
  payment_date: string | null;
  notes: string | null;
  description: string;
  external_role: ExternalRole | null;
}

/** Papel de uma linha antiga: receita = income; despesa "Taxa …" = fee; despesa "Estorno …" = refund. */
export function legacyRole(row: Pick<DbRow, 'transaction_type' | 'description'>): ExternalRole | null {
  if (row.transaction_type === 'income') return 'income';
  if (row.transaction_type === 'expense' && row.description.startsWith('Taxa ')) return 'fee';
  if (row.transaction_type === 'expense' && row.description.startsWith('Estorno ')) return 'refund';
  return null;
}

function toStored(row: DbRow, role: ExternalRole): StoredPaymentRow {
  return {
    id: row.id,
    role,
    status: row.status,
    account_id: row.account_id,
    amount: Number(row.amount),
    due_date: row.due_date,
    payment_date: row.payment_date,
    notes: row.notes,
  };
}

export class SupabaseTransactionStore implements TransactionStore {
  async findByPayment(tenantId: string, source: string, ref: string): Promise<StoredPaymentRow[]> {
    const { data, error } = await getSupabaseAdmin()
      .from('transactions')
      .select(COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('external_source', source)
      .eq('external_ref', ref);
    if (error) throw new Error(error.message);
    return ((data ?? []) as DbRow[])
      .filter((r) => r.external_role)
      .map((r) => toStored(r, r.external_role as ExternalRole));
  }

  async findLegacy(tenantId: string, source: string, ref: string): Promise<StoredPaymentRow[]> {
    const { data, error } = await getSupabaseAdmin()
      .from('transactions')
      .select(COLUMNS)
      .eq('tenant_id', tenantId)
      .is('external_ref', null)
      .in('notes', [`webhook:${source}:${ref}:pending`, `webhook:${source}:${ref}:settled`]);
    if (error) throw new Error(error.message);
    const out: StoredPaymentRow[] = [];
    const seen = new Set<ExternalRole>();
    for (const r of (data ?? []) as DbRow[]) {
      const role = legacyRole(r);
      // Uma linha por papel (a chave única não admite duas); duplicatas antigas ficam como estão
      if (role && !seen.has(role)) {
        seen.add(role);
        out.push(toStored(r, role));
      }
    }
    return out;
  }

  async insert(tenantId: string, source: string, ref: string, rows: PlannedPaymentRow[]): Promise<string[]> {
    const payload = rows.map(({ role, ...row }) => ({
      ...row,
      tenant_id: tenantId,
      external_source: source,
      external_ref: ref,
      external_role: role,
    }));
    const { data, error } = await getSupabaseAdmin().from('transactions').insert(payload).select('id');
    if (error) {
      if (error.code === '23505') throw new StoreConflictError();
      throw new Error(error.message);
    }
    return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  }

  async update(tenantId: string, id: string, patch: PaymentPatch): Promise<void> {
    // Lista explícita de colunas (as tabelas têm GRANT por coluna)
    const columns: Record<string, unknown> = {};
    if (patch.status !== undefined) columns.status = patch.status;
    if (patch.payment_date !== undefined) columns.payment_date = patch.payment_date;
    if (patch.due_date !== undefined) columns.due_date = patch.due_date;
    if (patch.amount !== undefined) columns.amount = patch.amount;
    if (patch.notes !== undefined) columns.notes = patch.notes;
    if (patch.external_source !== undefined) columns.external_source = patch.external_source;
    if (patch.external_ref !== undefined) columns.external_ref = patch.external_ref;
    if (patch.external_role !== undefined) columns.external_role = patch.external_role;
    if (Object.keys(columns).length === 0) return;
    const { error } = await getSupabaseAdmin().from('transactions').update(columns).eq('id', id).eq('tenant_id', tenantId);
    if (error) {
      if (error.code === '23505') throw new StoreConflictError();
      throw new Error(error.message);
    }
  }
}
