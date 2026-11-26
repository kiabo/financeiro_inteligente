import type {
  Category,
  Company,
  Debt,
  DebtInstallment,
  FinancialAccount,
  ProductService,
  Project,
  TaxObligation,
  Transaction,
} from '../../core/types';
import {
  calculateAmortizationSchedule,
  computeDreReport,
  computeFinancialHealthDiagnostics,
  computeWinnersAndLosers,
  resolveComparisonPeriods,
} from '../healthEngine';

export interface HealthUnitTestResult {
  name: string;
  passed: boolean;
  details: string;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertClose(actual: number | null, expected: number, tolerance: number, message: string): void {
  if (actual === null || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message} (esperado ~${expected}, obtido ${String(actual)})`);
  }
}

const COMP: Company = {
  id: 'comp-1',
  tenant_id: 't-1',
  group_id: null,
  legal_name: 'Alpha Ltda',
  trade_name: 'Alpha',
  cnpj: '12345678000190',
  tax_regime: 'Simples Nacional',
  analytical_token: 'EMP_01',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const ACC_1: FinancialAccount = {
  id: 'acc-1',
  tenant_id: 't-1',
  company_id: 'comp-1',
  name: 'Conta Principal',
  account_type: 'checking',
  institution_name: 'Itaú',
  currency: 'BRL',
  last_four: '1234',
  analytical_token: 'CTA_01',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const ACC_2: FinancialAccount = {
  id: 'acc-2',
  tenant_id: 't-1',
  company_id: 'comp-1',
  name: 'Reserva CDB',
  account_type: 'investment',
  institution_name: 'Itaú',
  currency: 'BRL',
  last_four: '5678',
  analytical_token: 'CTA_02',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const CATEGORIES: Category[] = [
  { id: 'c-rev', tenant_id: 't-1', company_id: 'comp-1', parent_id: null, code: '1.1', name: 'Venda de Produtos', group_type: 'operational_revenue', direction: 'inflow', is_system: true, is_active: true, created_at: '', updated_at: '' },
  { id: 'c-tax', tenant_id: 't-1', company_id: 'comp-1', parent_id: null, code: '2.1', name: 'Impostos sobre Vendas', group_type: 'tax_deduction', direction: 'outflow', is_system: true, is_active: true, created_at: '', updated_at: '' },
  { id: 'c-dir', tenant_id: 't-1', company_id: 'comp-1', parent_id: null, code: '3.1', name: 'Custos Diretos', group_type: 'direct_cost', direction: 'outflow', is_system: true, is_active: true, created_at: '', updated_at: '' },
  { id: 'c-fix', tenant_id: 't-1', company_id: 'comp-1', parent_id: null, code: '4.1', name: 'Folha Fixa', group_type: 'fixed_expense', direction: 'outflow', is_system: true, is_active: true, created_at: '', updated_at: '' },
  { id: 'c-var', tenant_id: 't-1', company_id: 'comp-1', parent_id: null, code: '5.1', name: 'Marketing', group_type: 'variable_expense', direction: 'outflow', is_system: true, is_active: true, created_at: '', updated_at: '' },
  { id: 'c-fin-in', tenant_id: 't-1', company_id: 'comp-1', parent_id: null, code: '8.1', name: 'Rendimentos CDB', group_type: 'financial_income', direction: 'inflow', is_system: true, is_active: true, created_at: '', updated_at: '' },
  { id: 'c-fin-out', tenant_id: 't-1', company_id: 'comp-1', parent_id: null, code: '8.2', name: 'Juros Pagos', group_type: 'financial_expense', direction: 'outflow', is_system: true, is_active: true, created_at: '', updated_at: '' },
];

function makeTx(partial: Partial<Transaction> & { id: string; amount: number }): Transaction {
  return {
    tenant_id: 't-1',
    company_id: 'comp-1',
    account_id: 'acc-1',
    destination_account_id: null,
    category_id: 'c-rev',
    product_service_id: null,
    project_id: null,
    transaction_type: 'income',
    status: 'paid',
    description: 'Tx teste',
    counterparty_name: null,
    competence_date: '2026-11-10',
    due_date: '2026-11-10',
    payment_date: '2026-11-10',
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

export function runHealthEngineUnitTests(): HealthUnitTestResult[] {
  const results: HealthUnitTestResult[] = [];

  // Teste 1: DRE Gerencial (9 linhas, AV%, AH%) + Exclusão absoluta de Transferências Internas
  try {
    const txs: Transaction[] = [
      makeTx({ id: '1', category_id: 'c-rev', transaction_type: 'income', amount: 100000 }),
      makeTx({ id: '2', category_id: 'c-tax', transaction_type: 'expense', amount: 10000 }),
      makeTx({ id: '3', category_id: 'c-dir', transaction_type: 'expense', amount: 30000 }),
      makeTx({ id: '4', category_id: 'c-fix', transaction_type: 'expense', amount: 20000 }),
      makeTx({ id: '5', category_id: 'c-var', transaction_type: 'expense', amount: 5000 }),
      makeTx({ id: '6', category_id: 'c-fin-in', transaction_type: 'income', amount: 2000 }),
      makeTx({ id: '7', category_id: 'c-fin-out', transaction_type: 'expense', amount: 7000 }),
      // Transferência interna de R$ 50.000 — NÃO pode contaminar Receita nem Despesa
      makeTx({
        id: '8',
        category_id: null,
        transaction_type: 'transfer',
        destination_account_id: 'acc-2',
        amount: 50000,
      }),
      // Mês anterior (Outubro) para Análise Horizontal
      makeTx({
        id: '9',
        category_id: 'c-rev',
        transaction_type: 'income',
        amount: 80000,
        competence_date: '2026-10-10',
        due_date: '2026-10-10',
        payment_date: '2026-10-10',
      }),
    ];

    const dre = computeDreReport({
      transactions: txs,
      categories: CATEGORIES,
      companies: [COMP],
      accounts: [ACC_1, ACC_2],
      activeContext: { scope: 'company', companyId: 'comp-1' },
      regime: 'cash',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      compareStartDate: '2026-10-01',
      compareEndDate: '2026-10-31',
    });

    assertClose(dre.grossRevenueCurrent, 100000, 0.01, 'Receita Bruta deve ser 100k (sem transferência)');
    assertClose(dre.netRevenueCurrent, 90000, 0.01, 'Receita Líquida deve ser 90k');
    assertClose(dre.contributionMarginCurrent, 60000, 0.01, 'Margem de Contribuição deve ser 60k');
    assertClose(dre.ebitdaCurrent, 35000, 0.01, 'EBITDA deve ser 35k');
    assertClose(dre.financialResultCurrent, -5000, 0.01, 'Resultado Financeiro deve ser -5k');
    assertClose(dre.netResultCurrent, 30000, 0.01, 'Resultado Líquido deve ser 30k');
    assertClose(dre.netMarginPctCurrent, 30.0, 0.1, 'Margem Líquida deve ser 30,0%');
    // AH% da Receita Bruta: 100k vs 80k = +25%
    assertClose(dre.lines[0]?.horizontalDeltaPct ?? null, 25.0, 0.1, 'AH% Receita Bruta = +25,0%');

    results.push({
      name: '1. DRE Gerencial (9 linhas, AV%, AH%) e exclusão de transferências internas',
      passed: true,
      details: 'Receita 100k -> EBITDA 35k -> Resultado Líquido 30k (30,0% AV, +25,0% AH).',
    });
  } catch (err) {
    results.push({
      name: '1. DRE Gerencial (9 linhas, AV%, AH%) e exclusão de transferências internas',
      passed: false,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // Teste 2: Ranking Winners & Losers (Produtos & Projetos)
  try {
    const prods: ProductService[] = [
      { id: 'p-win', tenant_id: 't-1', company_id: 'comp-1', group_id: null, name: 'SaaS Winner', item_type: 'product', offer_kind: 'digital_product', sku_code: null, base_price: 1000, estimated_direct_cost: 100, payment_fee_pct: 2, estimated_tax_pct: 6, description: null, analytical_token: 'PRD_01', is_active: true, created_at: '', updated_at: '' },
      { id: 'p-lose', tenant_id: 't-1', company_id: 'comp-1', group_id: null, name: 'Hardware Drain', item_type: 'product', offer_kind: 'physical_product', sku_code: null, base_price: 1000, estimated_direct_cost: 900, payment_fee_pct: 3, estimated_tax_pct: 10, description: null, analytical_token: 'PRD_02', is_active: true, created_at: '', updated_at: '' },
    ];
    const txs: Transaction[] = [
      makeTx({ id: 'w1', product_service_id: 'p-win', category_id: 'c-rev', transaction_type: 'income', amount: 50000 }),
      makeTx({ id: 'w2', product_service_id: 'p-win', category_id: 'c-dir', transaction_type: 'expense', amount: 5000 }),
      makeTx({ id: 'w3', product_service_id: 'p-win', category_id: 'c-tax', transaction_type: 'expense', amount: 5000 }),
      makeTx({ id: 'l1', product_service_id: 'p-lose', category_id: 'c-rev', transaction_type: 'income', amount: 20000 }),
      makeTx({ id: 'l2', product_service_id: 'p-lose', category_id: 'c-dir', transaction_type: 'expense', amount: 24000 }),
    ];

    const ranking = computeWinnersAndLosers({
      transactions: txs,
      categories: CATEGORIES,
      productsServices: prods,
      projects: [],
      companies: [COMP],
      accounts: [ACC_1],
      activeContext: { scope: 'company', companyId: 'comp-1' },
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      targetMarginPct: 15,
    });

    assert(ranking.products.length === 2, 'Deve ranquear 2 produtos');
    assert(ranking.products[0]?.id === 'p-win', 'Winner deve ficar em 1º');
    assert(ranking.products[0]?.classification === 'cash_generator', 'SaaS deve ser Gerador de Caixa');
    assert(ranking.products[1]?.id === 'p-lose', 'Loser deve ficar em último');
    assert(ranking.products[1]?.classification === 'cash_drain', 'Hardware negativo deve ser Dreno de Caixa');

    results.push({
      name: '2. Ranking Winners & Losers (Geradores vs. Drenos de Caixa)',
      passed: true,
      details: 'Produtos ordenados por resultado líquido real com classificação correta.',
    });
  } catch (err) {
    results.push({
      name: '2. Ranking Winners & Losers (Geradores vs. Drenos de Caixa)',
      passed: false,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // Teste 3: Amortização SAC vs Price (saldo final zerado e consistência matemática)
  try {
    const sac = calculateAmortizationSchedule({
      principal: 60000,
      monthlyInterestRatePct: 1.5,
      totalInstallments: 12,
      system: 'sac',
      firstDueDate: '2026-12-05',
    });
    const price = calculateAmortizationSchedule({
      principal: 60000,
      monthlyInterestRatePct: 1.5,
      totalInstallments: 12,
      system: 'price',
      firstDueDate: '2026-12-05',
    });

    assert(sac.rows.length === 12 && price.rows.length === 12, '12 parcelas geradas');
    assertClose(sac.rows[11]?.remaining_balance ?? null, 0, 0.01, 'Saldo final SAC = 0');
    assertClose(price.rows[11]?.remaining_balance ?? null, 0, 0.01, 'Saldo final Price = 0');
    assert(sac.firstInstallmentAmount > sac.lastInstallmentAmount, 'SAC tem parcela decrescente');
    assert(sac.totalInterest < price.totalInterest, 'SAC paga menos juros totais que Price');

    results.push({
      name: '3. Cronogramas de Amortização SAC e Tabela Price com saldo final zero',
      passed: true,
      details: `SAC Juros R$ ${sac.totalInterest} vs Price Juros R$ ${price.totalInterest}.`,
    });
  } catch (err) {
    results.push({
      name: '3. Cronogramas de Amortização SAC e Tabela Price com saldo final zero',
      passed: false,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // Teste 4: Score de Saúde Financeira (0-100) e Runway
  try {
    const periods = resolveComparisonPeriods({ preset: 'month_mom', referenceMonth: '2026-11' });
    const txs: Transaction[] = [
      makeTx({ id: 'h1', category_id: 'c-rev', transaction_type: 'income', amount: 120000 }),
      makeTx({ id: 'h2', category_id: 'c-fix', transaction_type: 'expense', amount: 25000 }),
      makeTx({ id: 'h3', category_id: 'c-dir', transaction_type: 'expense', amount: 30000 }),
    ];
    const debts: Debt[] = [];
    const installments: DebtInstallment[] = [];
    const taxes: TaxObligation[] = [];

    const diag = computeFinancialHealthDiagnostics({
      transactions: txs,
      categories: CATEGORIES,
      companies: [COMP],
      accounts: [ACC_1],
      productsServices: [],
      projects: [] as Project[],
      debts,
      debtInstallments: installments,
      taxObligations: taxes,
      activeContext: { scope: 'company', companyId: 'comp-1' },
      regime: 'cash',
      periods,
      todayISO: '2026-11-25',
    });

    assert(diag.healthScore >= 0 && diag.healthScore <= 100, 'Score entre 0 e 100');
    assert(diag.healthScore >= 75, `Cenário superavitário sem dívidas deve ter score alto (obtido ${diag.healthScore})`);
    assertClose(diag.freeCash, 65000, 0.01, 'Caixa livre = 65k');
    assert(diag.runwayMonths !== null && diag.runwayMonths > 2, 'Runway calculado sobre despesas fixas');

    results.push({
      name: '4. Motor de Score de Saúde (0-100) e Runway de Caixa',
      passed: true,
      details: `Score ${diag.healthScore}/100 · Caixa Livre R$ ${diag.freeCash} · Runway ${diag.runwayMonths} meses.`,
    });
  } catch (err) {
    results.push({
      name: '4. Motor de Score de Saúde (0-100) e Runway de Caixa',
      passed: false,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  return results;
}

if (
  typeof window === 'undefined' &&
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]?.includes('healthEngine.test')
) {
  const outcomes = runHealthEngineUnitTests();
  let failures = 0;
  for (const t of outcomes) {
    const prefix = t.passed ? 'PASS' : 'FAIL';
    console.log(`[${prefix}] ${t.name} — ${t.details}`);
    if (!t.passed) failures += 1;
  }
  if (failures > 0) {
    process.exit(1);
  }
}
