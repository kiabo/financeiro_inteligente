/**
 * Spec 003: saldo inicial da conta. Mesmos cenários validados no Postgres descartável (migration 0007).
 */
import type { Company, FinancialAccount, Transaction } from '../types';
import {
  computeAccountBalances,
  computePeriodMetrics,
  normalizeOpeningBalance,
  transactionCashDate,
} from '../repository';

export interface AccountBalancesTestResult {
  name: string;
  passed: boolean;
  details: string;
}

const COMPANY: Company = {
  id: 'comp-1',
  tenant_id: 't-1',
  group_id: null,
  legal_name: 'Empresa Teste Ltda',
  trade_name: null,
  tax_id: null,
  analytical_token: 'EMP_01',
  is_active: true,
  created_at: '',
  updated_at: '',
} as unknown as Company;

function account(id: string, token: string, opening = 0, date: string | null = null): FinancialAccount {
  return {
    id,
    tenant_id: 't-1',
    company_id: 'comp-1',
    name: `Conta ${token}`,
    account_type: 'checking',
    institution_name: null,
    currency: 'BRL',
    last_four: null,
    analytical_token: token,
    is_active: true,
    opening_balance: opening,
    opening_balance_date: date,
    created_at: '',
    updated_at: '',
  };
}

let seq = 0;
function tx(partial: Partial<Transaction> & Pick<Transaction, 'account_id' | 'transaction_type' | 'status' | 'amount'>): Transaction {
  seq += 1;
  return {
    id: `tx-${seq}`,
    tenant_id: 't-1',
    company_id: 'comp-1',
    destination_account_id: null,
    category_id: null,
    product_service_id: null,
    project_id: null,
    description: `Mov ${seq}`,
    counterparty_name: null,
    competence_date: partial.due_date ?? '2026-11-01',
    due_date: '2026-11-01',
    payment_date: null,
    installment_group_id: null,
    installment_number: null,
    installment_total: null,
    is_recurring: false,
    recurrence_frequency: null,
    notes: null,
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

// A = conta antiga (sem saldo inicial); B = 1.000 em 01/11; C = −500 em 01/11
const A = account('acc-a', 'CTA_01');
const B = account('acc-b', 'CTA_02', 1000, '2026-11-01');
const C = account('acc-c', 'CTA_03', -500, '2026-11-01');
const ACCOUNTS = [A, B, C];

const TXS: Transaction[] = [
  tx({ account_id: 'acc-a', transaction_type: 'income', status: 'paid', amount: 300, due_date: '2026-10-10', payment_date: '2026-10-10' }),
  tx({ account_id: 'acc-b', transaction_type: 'expense', status: 'paid', amount: 200, due_date: '2026-11-05', payment_date: '2026-11-05' }),
  tx({ account_id: 'acc-b', transaction_type: 'income', status: 'paid', amount: 999, due_date: '2026-10-20', payment_date: '2026-10-20' }),
  tx({ account_id: 'acc-b', transaction_type: 'expense', status: 'pending', amount: 50, due_date: '2026-12-01' }),
  tx({ account_id: 'acc-c', transaction_type: 'income', status: 'paid', amount: 100, due_date: '2026-11-02', payment_date: '2026-11-02' }),
  tx({ account_id: 'acc-b', destination_account_id: 'acc-c', transaction_type: 'transfer', status: 'paid', amount: 40, due_date: '2026-11-10', payment_date: '2026-11-10' }),
  tx({ account_id: 'acc-b', transaction_type: 'expense', status: 'canceled', amount: 777, due_date: '2026-11-11' }),
];

const ALL = { scope: 'all_independent' } as const;

export function runAccountBalancesTests(): AccountBalancesTestResult[] {
  const results: AccountBalancesTestResult[] = [];
  const record = (name: string, fn: () => void) => {
    try {
      fn();
      results.push({ name, passed: true, details: 'ok' });
    } catch (err) {
      results.push({ name, passed: false, details: err instanceof Error ? err.message : String(err) });
    }
  };
  const assertEq = (actual: unknown, expected: unknown, msg: string) => {
    if (actual !== expected) throw new Error(`${msg}: esperado ${String(expected)}, obtido ${String(actual)}`);
  };
  const throws = (fn: () => unknown, fragment: string) => {
    try {
      fn();
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      if (!m.includes(fragment)) throw new Error(`mensagem inesperada: "${m}" (esperado conter "${fragment}")`);
      return;
    }
    throw new Error(`deveria lançar erro contendo "${fragment}"`);
  };
  const balanceOf = (token: string) => {
    const b = computeAccountBalances(ACCOUNTS, TXS, [COMPANY], ALL).find((x) => x.analytical_token === token);
    if (!b) throw new Error(`sem saldo para ${token}`);
    return b;
  };

  record('CA1: conta nova com saldo inicial 1.000 em 01/11 e sem lançamentos mostra 1.000', () => {
    const [b] = computeAccountBalances([account('acc-x', 'CTA_09', 1000, '2026-11-01')], [], [COMPANY], ALL);
    assertEq(b!.current_balance, 1000, 'atual');
    assertEq(b!.projected_balance, 1000, 'previsto');
  });

  record('CA2: despesa paga de 200 em 05/11 e transferência de 40 levam 1.000 a 760 (previsto 710)', () => {
    const b = balanceOf('CTA_02');
    assertEq(b.current_balance, 760, 'atual');
    assertEq(b.projected_balance, 710, 'previsto (pendente de 50 entra só no previsto; cancelado nunca)');
  });

  record('CA3: pagamento anterior à data do saldo (999 em 20/10) não entra na soma', () => {
    assertEq(balanceOf('CTA_02').current_balance, 760, 'não deve somar os 999');
  });

  record('CA5: saldo inicial negativo: −500 + 100 + 40 de transferência = −360', () => {
    const b = balanceOf('CTA_03');
    assertEq(b.current_balance, -360, 'atual');
    assertEq(b.opening_balance, -500, 'expõe o saldo inicial');
    assertEq(b.opening_balance_date, '2026-11-01', 'expõe a data');
  });

  record('CA6: conta antiga (sem saldo inicial) continua com a soma dos lançamentos', () => {
    const b = balanceOf('CTA_01');
    assertEq(b.current_balance, 300, 'atual');
    assertEq(b.opening_balance, 0, 'saldo inicial zero');
  });

  record('movimento pendente usa a data de vencimento; pago usa a data de pagamento', () => {
    assertEq(transactionCashDate({ status: 'pending', payment_date: null, due_date: '2026-12-01' }), '2026-12-01', 'pendente');
    assertEq(transactionCashDate({ status: 'paid', payment_date: '2026-11-05', due_date: '2026-11-30' }), '2026-11-05', 'pago');
    assertEq(transactionCashDate({ status: 'paid', payment_date: null, due_date: '2026-11-30' }), '2026-11-30', 'pago sem data');
  });

  record('contexto por conta devolve só o saldo daquela conta', () => {
    const only = computeAccountBalances(ACCOUNTS, TXS, [COMPANY], { scope: 'account', accountId: 'acc-b' });
    assertEq(only.length, 1, 'uma conta');
    assertEq(only[0]!.current_balance, 760, 'saldo de B');
  });

  record('Saldo Anterior de novembro inclui os saldos iniciais (300 + 1.000 − 500 = 800)', () => {
    const m = computePeriodMetrics(TXS, [COMPANY], ACCOUNTS, ALL, 'cash', '2026-11-01', '2026-11-30', '2026-11-26');
    assertEq(m.previousBalance, 800, 'saldo anterior');
    assertEq(m.openingBalanceTotal, 500, 'total de saldos iniciais no período');
  });

  record('Saldo Anterior de dezembro soma os movimentos pagos desde a data do saldo (300 + 760 − 360 = 700)', () => {
    const m = computePeriodMetrics(TXS, [COMPANY], ACCOUNTS, ALL, 'cash', '2026-12-01', '2026-12-31', '2026-12-05');
    assertEq(m.previousBalance, 700, 'saldo anterior');
  });

  record('período que termina antes da data do saldo não inclui o saldo inicial', () => {
    const m = computePeriodMetrics(TXS, [COMPANY], ACCOUNTS, ALL, 'cash', '2026-09-01', '2026-09-30', '2026-11-26');
    assertEq(m.previousBalance, 0, 'saldo anterior');
    assertEq(m.openingBalanceTotal, 0, 'sem saldo inicial no período');
  });

  record('normalizeOpeningBalance: arredonda, aceita negativo e zera a data quando o saldo é 0', () => {
    assertEq(normalizeOpeningBalance({ opening_balance: 1234.567, opening_balance_date: '2026-11-01' }, '2026-11-26').opening_balance, 1234.57, 'arredondamento');
    assertEq(normalizeOpeningBalance({ opening_balance: -50, opening_balance_date: '2026-11-01' }, '2026-11-26').opening_balance, -50, 'negativo');
    const zero = normalizeOpeningBalance({ opening_balance: 0, opening_balance_date: '2026-11-01' }, '2026-11-26');
    assertEq(zero.opening_balance_date, null, 'zero não guarda data');
    assertEq(normalizeOpeningBalance({}, '2026-11-26').opening_balance, 0, 'vazio = 0');
  });

  record('normalizeOpeningBalance: sem data usa hoje; data inválida, futura, NaN e acima do limite são recusados', () => {
    assertEq(normalizeOpeningBalance({ opening_balance: 10 }, '2026-11-26').opening_balance_date, '2026-11-26', 'padrão hoje');
    throws(() => normalizeOpeningBalance({ opening_balance: 10, opening_balance_date: '2026-02-30' }, '2026-11-26'), 'Data do saldo inválida');
    throws(() => normalizeOpeningBalance({ opening_balance: 10, opening_balance_date: '2026-12-01' }, '2026-11-26'), 'futura');
    throws(() => normalizeOpeningBalance({ opening_balance: Number.NaN }, '2026-11-26'), 'inválido');
    throws(() => normalizeOpeningBalance({ opening_balance: 1e13 }, '2026-11-26'), 'limite');
  });

  return results;
}
