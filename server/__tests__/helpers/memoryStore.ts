import {
  StoreConflictError,
  type ExternalRole,
  type PaymentPatch,
  type PlannedPaymentRow,
  type StoredPaymentRow,
  type TransactionStore,
} from '../../integrations/history/paymentUpsert.ts';

interface MemoryRow extends StoredPaymentRow {
  tenant_id: string;
  external_source: string | null;
  external_ref: string | null;
  external_role: ExternalRole | null;
}

/**
 * Armazenamento em memória que **simula o índice único** de `transactions`
 * (tenant, external_source, external_ref, external_role) e o fallback por marcador em `notes`.
 */
export class MemoryTransactionStore implements TransactionStore {
  rows: MemoryRow[] = [];
  private seq = 0;
  /** Executa antes do próximo insert (simula outro processo gravando o mesmo pagamento). */
  beforeInsert: (() => void) | null = null;
  insertCalls = 0;
  /** Linhas planejadas recebidas em cada insert bem-sucedido (com contraparte, descrição etc.) */
  inserted: PlannedPaymentRow[] = [];

  private nextId = () => `tx-${++this.seq}`;

  /** Linha antiga: sem chave externa, só o marcador em notes (como as criadas antes da migration). */
  seedLegacy(tenantId: string, row: Omit<StoredPaymentRow, 'id'>): string {
    const id = this.nextId();
    this.rows.push({ ...row, id, tenant_id: tenantId, external_source: null, external_ref: null, external_role: null });
    return id;
  }

  private matches(r: MemoryRow, tenantId: string, source: string, ref: string) {
    return r.tenant_id === tenantId && r.external_source === source && r.external_ref === ref;
  }

  async findByPayment(tenantId: string, source: string, ref: string): Promise<StoredPaymentRow[]> {
    return this.rows.filter((r) => this.matches(r, tenantId, source, ref)).map(({ tenant_id: _t, external_source: _s, external_ref: _r, external_role: _x, ...row }) => ({ ...row }));
  }

  async findLegacy(tenantId: string, source: string, ref: string): Promise<StoredPaymentRow[]> {
    const markers = [`webhook:${source}:${ref}:pending`, `webhook:${source}:${ref}:settled`];
    return this.rows
      .filter((r) => r.tenant_id === tenantId && r.external_ref === null && r.notes !== null && markers.includes(r.notes))
      .map(({ tenant_id: _t, external_source: _s, external_ref: _r, external_role: _x, ...row }) => ({ ...row }));
  }

  async insert(tenantId: string, source: string, ref: string, rows: PlannedPaymentRow[]): Promise<string[]> {
    this.insertCalls += 1;
    this.beforeInsert?.();
    this.beforeInsert = null;
    // Tudo ou nada, como um INSERT de várias linhas
    for (const row of rows) {
      if (this.rows.some((r) => this.matches(r, tenantId, source, ref) && r.external_role === row.role)) {
        throw new StoreConflictError();
      }
    }
    const ids: string[] = [];
    for (const row of rows) {
      this.inserted.push({ ...row });
      const id = this.nextId();
      this.rows.push({
        id,
        tenant_id: tenantId,
        role: row.role,
        status: row.status,
        account_id: row.account_id,
        amount: row.amount,
        due_date: row.due_date,
        payment_date: row.payment_date,
        notes: row.notes,
        external_source: source,
        external_ref: ref,
        external_role: row.role,
      });
      ids.push(id);
    }
    return ids;
  }

  async update(tenantId: string, id: string, patch: PaymentPatch): Promise<void> {
    const row = this.rows.find((r) => r.id === id && r.tenant_id === tenantId);
    if (!row) throw new Error('linha não encontrada');
    if (patch.external_ref !== undefined || patch.external_role !== undefined) {
      const source = patch.external_source ?? row.external_source;
      const ref = patch.external_ref ?? row.external_ref;
      const role = patch.external_role ?? row.external_role;
      if (this.rows.some((r) => r.id !== id && r.tenant_id === tenantId && r.external_source === source && r.external_ref === ref && r.external_role === role)) {
        throw new StoreConflictError();
      }
    }
    Object.assign(row, patch);
  }
}
