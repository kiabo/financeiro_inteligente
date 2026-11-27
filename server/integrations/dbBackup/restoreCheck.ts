/** Tabelas conferidas no teste de restauração (spec 006): as mais importantes para as contas e os lançamentos. */
export const RESTORE_CHECK_TABLES = [
  'user_profiles',
  'business_groups',
  'companies',
  'financial_accounts',
  'categories',
  'transactions',
  'debts',
  'tax_obligations',
  'integration_connections',
  'webhook_events',
  'audit_logs',
] as const;

/** `select 'tabela', count(*) from public.tabela union all ...` (nomes vêm da lista fixa acima, nunca de entrada externa). */
export function countsSql(tables: readonly string[]): string {
  if (tables.some((t) => !/^[a-z_]+$/.test(t))) throw new Error('Nome de tabela inválido.');
  return tables.map((t) => `select '${t}', count(*) from public.${t}`).join(' union all ');
}

export type CountVerdict = 'igual' | 'live-maior' | 'divergente';

export interface CountComparison {
  table: string;
  restored: number | null;
  live: number | null;
  verdict: CountVerdict;
}

/** Linhas `tabela|numero` → mapa. Linhas em branco são ignoradas. */
export function parseCounts(text: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of text.split('\n')) {
    const [table, n] = line.trim().split('|');
    if (!table || n === undefined || n === '') continue;
    const value = Number(n);
    if (Number.isFinite(value)) map.set(table, value);
  }
  return map;
}

/**
 * Compara o banco restaurado com o real. Igual = ok; o real ter MAIS linhas é esperado (dados novos desde o backup);
 * restaurado com mais linhas que o real, ou tabela ausente, é divergência (falha).
 */
export function compareCounts(restored: Map<string, number>, live: Map<string, number>, tables: readonly string[] = RESTORE_CHECK_TABLES): CountComparison[] {
  return tables.map((table) => {
    const r = restored.get(table) ?? null;
    const l = live.get(table) ?? null;
    let verdict: CountVerdict;
    if (r === null || l === null) verdict = 'divergente';
    else if (r === l) verdict = 'igual';
    else if (l > r) verdict = 'live-maior';
    else verdict = 'divergente';
    return { table, restored: r, live: l, verdict };
  });
}

export const restoreOk = (rows: CountComparison[]) => rows.every((r) => r.verdict !== 'divergente');
