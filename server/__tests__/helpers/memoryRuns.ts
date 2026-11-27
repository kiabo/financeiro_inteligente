import type { EventLog, HistoryEvent, RunRecord, RunStore } from '../../integrations/history/historyRunner.ts';

/** Execuções em memória; simula o índice único "uma execução ativa por conexão". */
export class MemoryRunStore implements RunStore {
  runs: RunRecord[] = [];
  private seq = 0;

  async create(run: Omit<RunRecord, 'id'>): Promise<RunRecord> {
    if (run.status === 'running' && this.runs.some((r) => r.connection_id === run.connection_id && r.status === 'running')) {
      throw new Error('duplicate key value violates unique constraint "uq_import_runs_one_running"');
    }
    const created: RunRecord = { ...run, id: `run-${++this.seq}` };
    this.runs.push(created);
    return { ...created };
  }

  async get(tenantId: string, id: string): Promise<RunRecord | null> {
    const r = this.runs.find((x) => x.id === id && x.tenant_id === tenantId);
    return r ? JSON.parse(JSON.stringify(r)) : null;
  }

  async findRunning(tenantId: string, connectionId: string): Promise<RunRecord | null> {
    const r = this.runs.find((x) => x.tenant_id === tenantId && x.connection_id === connectionId && x.status === 'running');
    return r ? JSON.parse(JSON.stringify(r)) : null;
  }

  async update(tenantId: string, id: string, patch: Partial<Omit<RunRecord, 'id' | 'tenant_id'>>): Promise<RunRecord> {
    const r = this.runs.find((x) => x.id === id && x.tenant_id === tenantId);
    if (!r) throw new Error('execução não encontrada');
    Object.assign(r, patch);
    return JSON.parse(JSON.stringify(r));
  }
}

/** Log de eventos em memória; simula UNIQUE (connection_id, external_event_id). */
export class MemoryEventLog implements EventLog {
  events: HistoryEvent[] = [];

  async record(event: HistoryEvent): Promise<void> {
    if (this.events.some((e) => e.connection_id === event.connection_id && e.external_event_id === event.external_event_id)) return;
    this.events.push(event);
  }
}
