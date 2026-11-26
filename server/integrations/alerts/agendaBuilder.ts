import type { WorkspaceCfoSource } from '../../../src/modules/ai-cfo/cfoAgent.ts';
import { addMonthsISO } from '../../../src/lib/utils.ts';
import { calculateProjectFeasibility } from '../../../src/modules/projects/projectCalculator.ts';

/**
 * Agenda unificada de vencimentos e marcos (função pura).
 * Cada item carrega DOIS rótulos:
 *   - labelToken: apenas tokens do cofre + termos genéricos (padrão para canais externos)
 *   - labelReal:  nomes reais (somente se o titular ativar include_real_labels)
 */

export type AgendaSourceType =
  | 'transaction'
  | 'debt_installment'
  | 'tax_obligation'
  | 'project_start'
  | 'project_end'
  | 'project_payback';

export type AgendaKind = 'payable' | 'receivable' | 'debt' | 'tax' | 'project';

export interface AgendaItem {
  sourceType: AgendaSourceType;
  sourceId: string;
  kind: AgendaKind;
  date: string;
  amount: number | null;
  status: 'pending' | 'overdue' | 'milestone';
  labelToken: string;
  labelReal: string;
  companyToken: string;
}

export interface AgendaWindow {
  todayISO: string;
  fromISO: string;
  toISO: string;
}

export function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number.isFinite(value) ? value : 0);
}

export function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

export function buildAgendaItems(ws: WorkspaceCfoSource, window: AgendaWindow): AgendaItem[] {
  const companyToken = new Map(ws.companies.map((c) => [c.id, c.analytical_token]));
  const accountToken = new Map(ws.accounts.map((a) => [a.id, a.analytical_token]));
  const categoryName = new Map(ws.categories.map((c) => [c.id, c.name]));
  const inWindow = (d: string) => d >= window.fromISO && d <= window.toISO;
  const items: AgendaItem[] = [];

  for (const tx of ws.transactions) {
    if (tx.transaction_type === 'transfer') continue;
    if (tx.status !== 'pending' && tx.status !== 'overdue') continue;
    if (!inWindow(tx.due_date)) continue;
    const overdue = tx.due_date < window.todayISO;
    const kind: AgendaKind = tx.transaction_type === 'expense' ? 'payable' : 'receivable';
    const cat = (tx.category_id && categoryName.get(tx.category_id)) || (kind === 'payable' ? 'Conta a pagar' : 'Conta a receber');
    const acc = accountToken.get(tx.account_id) ?? 'CTA';
    items.push({
      sourceType: 'transaction',
      sourceId: tx.id,
      kind,
      date: tx.due_date,
      amount: tx.amount,
      status: overdue ? 'overdue' : 'pending',
      labelToken: `${kind === 'payable' ? 'Pagar' : 'Receber'} · ${cat} · ${acc}`,
      labelReal: `${kind === 'payable' ? 'Pagar' : 'Receber'} · ${tx.description}`,
      companyToken: companyToken.get(tx.company_id) ?? 'EMP',
    });
  }

  const debtById = new Map(ws.debts.map((d) => [d.id, d]));
  for (const inst of ws.debtInstallments) {
    if (inst.status !== 'pending' && inst.status !== 'overdue') continue;
    if (!inWindow(inst.due_date)) continue;
    const debt = debtById.get(inst.debt_id);
    if (!debt) continue;
    const total = debt.total_installments;
    items.push({
      sourceType: 'debt_installment',
      sourceId: inst.id,
      kind: 'debt',
      date: inst.due_date,
      amount: inst.total_amount,
      status: inst.due_date < window.todayISO ? 'overdue' : 'pending',
      labelToken: `Parcela ${inst.installment_number}/${total} · ${debt.creditor_token}`,
      labelReal: `Parcela ${inst.installment_number}/${total} · ${debt.creditor_name}`,
      companyToken: companyToken.get(debt.company_id) ?? 'EMP',
    });
  }

  for (const tax of ws.taxObligations) {
    if (tax.status !== 'pending' && tax.status !== 'overdue') continue;
    if (!inWindow(tax.due_date)) continue;
    const comp = companyToken.get(tax.company_id) ?? 'EMP';
    items.push({
      sourceType: 'tax_obligation',
      sourceId: tax.id,
      kind: 'tax',
      date: tax.due_date,
      amount: tax.amount,
      status: tax.due_date < window.todayISO ? 'overdue' : 'pending',
      labelToken: `Imposto ${tax.tax_type.toUpperCase()} · ${comp}`,
      labelReal: `Imposto ${tax.tax_name}`,
      companyToken: comp,
    });
  }

  for (const project of ws.projects) {
    if (!project.is_active || project.status === 'canceled' || project.status === 'completed') continue;
    const comp = companyToken.get(project.company_id) ?? 'EMP';
    const milestones: Array<{ type: AgendaSourceType; date: string; prefix: string }> = [
      { type: 'project_start', date: project.planned_start_date, prefix: 'Início' },
      { type: 'project_end', date: project.planned_end_date, prefix: 'Fim' },
    ];
    try {
      const feasibility = calculateProjectFeasibility({
        project,
        forecastItems: ws.projectForecastItems.filter((f) => f.project_id === project.id),
        transactions: ws.transactions.filter((t) => t.project_id === project.id),
        companyCashBeforeProject: 0,
        todayISO: window.todayISO,
      });
      if (feasibility.paybackMonthIndex !== null) {
        milestones.push({
          type: 'project_payback',
          date: addMonthsISO(project.planned_start_date, feasibility.paybackMonthIndex - 1),
          prefix: 'Payback previsto',
        });
      }
    } catch {
      /* projeto sem premissas suficientes: só início/fim */
    }
    for (const m of milestones) {
      if (!inWindow(m.date)) continue;
      items.push({
        sourceType: m.type,
        sourceId: project.id,
        kind: 'project',
        date: m.date,
        amount: null,
        status: 'milestone',
        labelToken: `${m.prefix} · ${project.analytical_token}`,
        labelReal: `${m.prefix} · ${project.name}`,
        companyToken: comp,
      });
    }
  }

  return items.sort((a, b) => a.date.localeCompare(b.date) || (b.amount ?? 0) - (a.amount ?? 0));
}

export function pickLabel(item: AgendaItem, includeRealLabels: boolean): string {
  return includeRealLabels ? item.labelReal : item.labelToken;
}
