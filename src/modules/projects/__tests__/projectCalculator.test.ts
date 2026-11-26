import type { Project, ProjectForecastItem, Transaction } from '../../core/types';
import { calculateProjectFeasibility, computeForecastLineTotals } from '../projectCalculator';

export interface ProjectUnitTestResult {
  name: string;
  passed: boolean;
  details: string;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertClose(actual: number | null, expected: number, tolerance: number, message: string): void {
  if (actual === null || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message} (esperado ~${expected}, obtido ${String(actual)})`);
  }
}

const BASE_PROJECT: Project = {
  id: 'prj-test-1',
  tenant_id: 'tenant-1',
  company_id: 'comp-1',
  name: 'Linha Automação IoT',
  hypothesis: 'Expansão para vendas recorrentes B2B',
  status: 'in_progress',
  active_scenario: 'realistic',
  planned_start_date: '2026-01-01',
  planned_end_date: '2026-06-30',
  initial_investment: 60000,
  monthly_fixed_cost_allocation: 5000,
  analytical_token: 'PRJ_01',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function makeRevenueForecast(monthDate: string, gross: number, direct: number, dedPct: number): ProjectForecastItem {
  const deductions = Math.round(gross * (dedPct / 100) * 100) / 100;
  return {
    id: `f-${monthDate}`,
    tenant_id: 'tenant-1',
    project_id: BASE_PROJECT.id,
    scenario: 'realistic',
    month_date: monthDate,
    product_service_id: 'prd-1',
    direction: 'revenue',
    label: 'Venda Kit IoT',
    quantity: 1,
    unit_price: gross,
    unit_direct_cost: direct,
    payment_fee_pct: 2,
    tax_rate_pct: dedPct - 2,
    gross_amount: gross,
    estimated_direct_cost_total: direct,
    estimated_deductions_total: deductions,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

export function runProjectCalculatorUnitTests(): ProjectUnitTestResult[] {
  const results: ProjectUnitTestResult[] = [];

  // Teste 1: Cenário lucrativo — Payback, Break-even e ROI exatos
  try {
    // 6 meses: cada mês receita 35.000, custo direto 10.000, deduções 10% (3.500) => margem mensal = 21.500
    // Custo fixo mensal = 5.000 => fluxo operacional mensal = +16.500/mês
    // Em 6 meses: margem total = 129.000, custo fixo total = 30.000 => lucro operacional = 99.000
    // Investimento = 60.000 => ROI = ((99.000 - 60.000) / 60.000) * 100 = +65.0%
    // Payback: -60.000 + 3*16.500 = -10.500 -> mês 4 atinge +6.000 => ~3.6 meses
    const months = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01'];
    const forecasts = months.map((m) => makeRevenueForecast(m, 35000, 10000, 10));

    const summary = calculateProjectFeasibility({
      project: BASE_PROJECT,
      forecastItems: forecasts,
      transactions: [],
      companyCashBeforeProject: 90000,
      todayISO: '2026-03-15',
    });

    assertClose(summary.totalPlannedRevenue, 210000, 0.01, 'Receita total deve ser 210.000');
    assertClose(summary.contributionMargin, 129000, 0.01, 'Margem de contribuição deve ser 129.000');
    assertClose(summary.roiPct, 65.0, 0.1, 'ROI projetado deve ser +65,0%');
    assert(summary.paybackMonthIndex === 4, `Payback deve ocorrer no mês 4 (obtido ${summary.paybackMonthIndex})`);
    assertClose(summary.paybackExactMonths, 3.6, 0.1, 'Payback interpolado deve ser ~3.6 meses');
    assert(summary.breakEvenRevenue !== null && summary.breakEvenRevenue > 140000, 'Break-even coerente');
    assert(summary.cashExposureAlert === false, 'Caixa de 90k cobre vale inicial de -60k sem alerta');

    results.push({
      name: '1. Viabilidade lucrativa (ROI +65%, Payback mês 4, Break-even e caixa saudável)',
      passed: true,
      details: `ROI ${summary.roiPct}% · Payback ${summary.paybackExactMonths} meses · Break-even R$ ${summary.breakEvenRevenue}.`,
    });
  } catch (err) {
    results.push({
      name: '1. Viabilidade lucrativa (ROI +65%, Payback mês 4, Break-even e caixa saudável)',
      passed: false,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // Teste 2: Cenário deficitário + Alerta de Exposição de Caixa
  try {
    // Receita baixa (10.000/mês, margem 4.000 - custo fixo 5.000 = -1.000/mês) com CAPEX inicial 60k
    // Caixa disponível da empresa = 45.000 -> vale de -66.000 estoura caixa da empresa!
    const months = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01'];
    const forecasts = months.map((m) => makeRevenueForecast(m, 10000, 5000, 10));

    const summary = calculateProjectFeasibility({
      project: BASE_PROJECT,
      forecastItems: forecasts,
      transactions: [],
      companyCashBeforeProject: 45000,
      todayISO: '2026-03-15',
    });

    assert(summary.roiPct !== null && summary.roiPct < 0, 'ROI deve ser negativo no cenário deficitário');
    assert(summary.paybackMonthIndex === null, 'Payback deve ser null quando nunca recupera investimento');
    assert(summary.cashExposureAlert === true, 'Alerta de Exposição de Caixa deve disparar');
    assertClose(summary.cashExposureShortfall, 21000, 0.1, 'Exposição de caixa deve ser R$ 21.000');
    assert(summary.budgetHealth === 'critical', 'Saúde orçamentária deve ser critical');

    results.push({
      name: '2. Cenário de prejuízo + Alerta de Exposição de Caixa',
      passed: true,
      details: `ROI ${summary.roiPct}% · Sem payback no horizonte · Exposição detectada de R$ ${summary.cashExposureShortfall}.`,
    });
  } catch (err) {
    results.push({
      name: '2. Cenário de prejuízo + Alerta de Exposição de Caixa',
      passed: false,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // Teste 3: Execução Real (Previsto vs. Realizado) e exclusão de transferências internas
  try {
    const forecasts = [makeRevenueForecast('2026-01-01', 30000, 10000, 10)]; // net = 17.000 - 5.000 = +12.000
    const txs: Transaction[] = [
      {
        id: 'tx-1',
        tenant_id: 'tenant-1',
        company_id: 'comp-1',
        account_id: 'acc-1',
        destination_account_id: null,
        category_id: null,
        product_service_id: 'prd-1',
        project_id: BASE_PROJECT.id,
        transaction_type: 'income',
        status: 'paid',
        description: 'Venda Realizada Jan',
        counterparty_name: 'Cliente X',
        amount: 34000,
        competence_date: '2026-01-15',
        due_date: '2026-01-15',
        payment_date: '2026-01-20',
        installment_group_id: null,
        installment_number: null,
        installment_total: null,
        is_recurring: false,
        recurrence_frequency: null,
        notes: null,
        created_at: '2026-01-20T00:00:00Z',
        updated_at: '2026-01-20T00:00:00Z',
      },
      {
        id: 'tx-2',
        tenant_id: 'tenant-1',
        company_id: 'comp-1',
        account_id: 'acc-1',
        destination_account_id: null,
        category_id: null,
        product_service_id: null,
        project_id: BASE_PROJECT.id,
        transaction_type: 'expense',
        status: 'paid',
        description: 'Gasto Realizado Jan',
        counterparty_name: 'Fornecedor Y',
        amount: 14000,
        competence_date: '2026-01-10',
        due_date: '2026-01-10',
        payment_date: '2026-01-12',
        installment_group_id: null,
        installment_number: null,
        installment_total: null,
        is_recurring: false,
        recurrence_frequency: null,
        notes: null,
        created_at: '2026-01-12T00:00:00Z',
        updated_at: '2026-01-12T00:00:00Z',
      },
    ];

    const singleMonthProject: Project = {
      ...BASE_PROJECT,
      planned_start_date: '2026-01-01',
      planned_end_date: '2026-01-31',
      initial_investment: 0,
    };

    const summary = calculateProjectFeasibility({
      project: singleMonthProject,
      forecastItems: forecasts,
      transactions: txs,
      companyCashBeforeProject: 50000,
      todayISO: '2026-01-31',
    });

    assertClose(summary.realizedRevenueTotal, 34000, 0.01, 'Receita realizada = 34.000');
    assertClose(summary.realizedOutflowsTotal, 14000, 0.01, 'Saída realizada = 14.000');
    assertClose(summary.realizedNetResult, 20000, 0.01, 'Resultado líquido realizado = +20.000');
    // Previsto em jan: 30.000 - (10.000 + 3.000 + 5.000) = +12.000 -> Desvio = +8.000 (+66.7%)
    assertClose(summary.realizedVsPlannedVarianceAmount, 8000, 0.01, 'Desvio líquido = +8.000');
    assertClose(summary.realizedVsPlannedVariancePct, 66.7, 0.2, 'Desvio % = +66.7%');

    results.push({
      name: '3. Apuração Previsto vs. Realizado e desvio (R$ e %)',
      passed: true,
      details: `Realizado R$ ${summary.realizedNetResult} vs Previsto R$ ${summary.plannedNetToDate} (desvio +R$ ${summary.realizedVsPlannedVarianceAmount}).`,
    });
  } catch (err) {
    results.push({
      name: '3. Apuração Previsto vs. Realizado e desvio (R$ e %)',
      passed: false,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // Teste 4: Cálculo automático de premissa vinculada a produto/serviço
  try {
    const totals = computeForecastLineTotals({
      direction: 'revenue',
      quantity: 10,
      unitPrice: 2500,
      unitDirectCost: 800,
      paymentFeePct: 3,
      taxRatePct: 9,
    });
    assertClose(totals.grossAmount, 25000, 0.01, 'Receita bruta = 25.000');
    assertClose(totals.estimatedDirectCostTotal, 8000, 0.01, 'Custo direto = 8.000');
    assertClose(totals.estimatedDeductionsTotal, 3000, 0.01, 'Taxas + Impostos (12%) = 3.000');

    results.push({
      name: '4. Premissa unitária vinculada ao catálogo de produtos/serviços',
      passed: true,
      details: 'Quantidade × Preço, Custo Direto e Deduções (Taxa + Imposto) calculados com precisão.',
    });
  } catch (err) {
    results.push({
      name: '4. Premissa unitária vinculada ao catálogo de produtos/serviços',
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
  process.argv[1]?.includes('projectCalculator.test')
) {
  const outcomes = runProjectCalculatorUnitTests();
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
