import type {
  ActiveContext,
  AiInsight,
  BusinessGroup,
  Category,
  Company,
  Debt,
  DebtInstallment,
  FinancialAccount,
  ProductService,
  Project,
  ProjectForecastItem,
  TaxObligation,
  Transaction,
  VaultEntry,
} from '../../core/types';
import {
  ZeroLeakViolationError,
  assertZeroLeakagePayload,
  buildAnonymizedCfoContext,
  rehydrateAiInsightForDisplay,
  sanitizeUserQuestionForAI,
} from '../aiContextBuilder';

export interface AiContextTestResult {
  name: string;
  passed: boolean;
  details: string;
}

function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} (esperado: ${String(expected)}, obtido: ${String(actual)})`);
  }
}

function expectTrue(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const TENANT_ID = 'tenant-test-m5';

const GROUPS: BusinessGroup[] = [
  {
    id: 'grp-1',
    tenant_id: TENANT_ID,
    name: 'Holding Atlântica Secreta S.A.',
    description: 'Holding familiar confidencial',
    analytical_token: 'GRP_01',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const COMPANIES: Company[] = [
  {
    id: 'emp-1',
    tenant_id: TENANT_ID,
    group_id: 'grp-1',
    legal_name: 'Vanguard Tecnologia e Sistemas Ltda',
    trade_name: 'Vanguard Tech',
    cnpj: '44555666000177',
    tax_regime: 'Simples Nacional',
    analytical_token: 'EMP_01',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const ACCOUNTS: FinancialAccount[] = [
  {
    id: 'acc-1',
    tenant_id: TENANT_ID,
    company_id: 'emp-1',
    name: 'Conta Principal BTG Empresas',
    account_type: 'checking',
    institution_name: 'Banco BTG Pactual S.A.',
    currency: 'BRL',
    last_four: '9821',
    analytical_token: 'CTA_01',
    is_active: true,
  opening_balance: 0,
  opening_balance_date: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const CATEGORIES: Category[] = [
  {
    id: 'cat-rev',
    tenant_id: TENANT_ID,
    company_id: 'emp-1',
    parent_id: null,
    code: '1.1',
    name: 'Venda de Produtos',
    group_type: 'operational_revenue',
    direction: 'inflow',
    is_system: true,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'cat-cost',
    tenant_id: TENANT_ID,
    company_id: 'emp-1',
    parent_id: null,
    code: '3.1',
    name: 'Custos Diretos',
    group_type: 'direct_cost',
    direction: 'outflow',
    is_system: true,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'cat-fix',
    tenant_id: TENANT_ID,
    company_id: 'emp-1',
    parent_id: null,
    code: '4.1',
    name: 'Despesas Fixas',
    group_type: 'fixed_expense',
    direction: 'outflow',
    is_system: true,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const PRODUCTS: ProductService[] = [
  {
    id: 'prd-1',
    tenant_id: TENANT_ID,
    company_id: 'emp-1',
    group_id: null,
    name: 'Suite Analytics Enterprise',
    item_type: 'product',
    offer_kind: 'digital_product',
    sku_code: 'SKU-ANT-900',
    base_price: 5000,
    estimated_direct_cost: 1200,
    payment_fee_pct: 2.5,
    estimated_tax_pct: 8.0,
    description: 'Licença confidencial corporativa',
    analytical_token: 'PRD_01',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const PROJECTS: Project[] = [
  {
    id: 'prj-1',
    tenant_id: TENANT_ID,
    company_id: 'emp-1',
    name: 'Projeto Expansão Sul Confidencial',
    hypothesis: 'Aquisição secreta da carteira Porto Alegre',
    status: 'in_progress',
    active_scenario: 'realistic',
    planned_start_date: '2026-10-01',
    planned_end_date: '2026-12-31',
    initial_investment: 30000,
    monthly_fixed_cost_allocation: 2000,
    analytical_token: 'PRJ_01',
    is_active: true,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  },
];

const FORECAST_ITEMS: ProjectForecastItem[] = [
  {
    id: 'pfi-1',
    tenant_id: TENANT_ID,
    project_id: 'prj-1',
    scenario: 'realistic',
    month_date: '2026-11-01',
    product_service_id: 'prd-1',
    direction: 'revenue',
    label: 'Faturamento Suite Analytics Enterprise',
    quantity: 4,
    unit_price: 5000,
    unit_direct_cost: 1200,
    payment_fee_pct: 2.5,
    tax_rate_pct: 8.0,
    gross_amount: 20000,
    estimated_direct_cost_total: 4800,
    estimated_deductions_total: 2100,
    notes: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  },
];

const TRANSACTIONS: Transaction[] = [
  {
    id: 'tx-1',
    tenant_id: TENANT_ID,
    company_id: 'emp-1',
    account_id: 'acc-1',
    destination_account_id: null,
    category_id: 'cat-rev',
    product_service_id: 'prd-1',
    project_id: 'prj-1',
    transaction_type: 'income',
    status: 'paid',
    description: 'Contrato anual Cliente MegaCorp Brasil',
    counterparty_name: 'MegaCorp Brasil Participações S.A.',
    amount: 45000,
    competence_date: '2026-11-05',
    due_date: '2026-11-05',
    payment_date: '2026-11-05',
    installment_group_id: null,
    installment_number: null,
    installment_total: null,
    is_recurring: false,
    recurrence_frequency: null,
    notes: 'Contato joao.diretor@megacorp.com.br',
    created_at: '2026-11-05T00:00:00Z',
    updated_at: '2026-11-05T00:00:00Z',
  },
  {
    id: 'tx-2',
    tenant_id: TENANT_ID,
    company_id: 'emp-1',
    account_id: 'acc-1',
    destination_account_id: null,
    category_id: 'cat-cost',
    product_service_id: 'prd-1',
    project_id: 'prj-1',
    transaction_type: 'expense',
    status: 'paid',
    description: 'Servidores AWS Fornecedor CloudDelta',
    counterparty_name: 'CloudDelta Infraestrutura Ltda',
    amount: 12000,
    competence_date: '2026-11-08',
    due_date: '2026-11-08',
    payment_date: '2026-11-08',
    installment_group_id: null,
    installment_number: null,
    installment_total: null,
    is_recurring: false,
    recurrence_frequency: null,
    notes: null,
    created_at: '2026-11-08T00:00:00Z',
    updated_at: '2026-11-08T00:00:00Z',
  },
  {
    id: 'tx-3',
    tenant_id: TENANT_ID,
    company_id: 'emp-1',
    account_id: 'acc-1',
    destination_account_id: null,
    category_id: 'cat-fix',
    product_service_id: null,
    project_id: null,
    transaction_type: 'expense',
    status: 'pending',
    description: 'Folha executiva confidencial',
    counterparty_name: 'Consultoria Externa Alpha',
    amount: 60000,
    competence_date: '2026-12-10',
    due_date: '2026-12-10',
    payment_date: null,
    installment_group_id: null,
    installment_number: null,
    installment_total: null,
    is_recurring: false,
    recurrence_frequency: null,
    notes: null,
    created_at: '2026-11-10T00:00:00Z',
    updated_at: '2026-11-10T00:00:00Z',
  },
];

const DEBTS: Debt[] = [
  {
    id: 'debt-1',
    tenant_id: TENANT_ID,
    company_id: 'emp-1',
    account_id: 'acc-1',
    title: 'Capital de Giro Banco Daycoval Sigiloso',
    creditor_name: 'Banco Daycoval S.A.',
    contract_code: 'CTR-DAY-7788',
    debt_kind: 'loan',
    amortization_system: 'sac',
    principal_amount: 50000,
    monthly_interest_rate_pct: 1.8,
    total_installments: 10,
    first_due_date: '2026-12-01',
    status: 'active',
    creditor_token: 'CRD_01',
    notes: null,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
  },
];

const DEBT_INSTALLMENTS: DebtInstallment[] = [
  {
    id: 'inst-1',
    tenant_id: TENANT_ID,
    debt_id: 'debt-1',
    installment_number: 1,
    due_date: '2026-12-05',
    principal_portion: 5000,
    interest_portion: 900,
    total_amount: 5900,
    remaining_balance: 45000,
    status: 'pending',
    paid_date: null,
    transaction_id: null,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
  },
];

const TAXES: TaxObligation[] = [
  {
    id: 'tax-1',
    tenant_id: TENANT_ID,
    company_id: 'emp-1',
    account_id: 'acc-1',
    tax_name: 'DAS Simples Nacional Vanguard',
    tax_type: 'simples_nacional',
    competence_month: '2026-11',
    due_date: '2026-12-20',
    revenue_base_amount: 45000,
    estimated_rate_pct: 8.0,
    amount: 3600,
    status: 'pending',
    paid_date: null,
    is_recurring: true,
    guide_reference: 'DAS-202611-44555666',
    transaction_id: null,
    notes: null,
    created_at: '2026-11-15T00:00:00Z',
    updated_at: '2026-11-15T00:00:00Z',
  },
];

const VAULT: VaultEntry[] = [
  {
    id: 'v-grp',
    tenant_id: TENANT_ID,
    entity_type: 'group',
    entity_id: 'grp-1',
    analytical_token: 'GRP_01',
    real_label: 'Holding Atlântica Secreta S.A.',
    sensitive_identifier: null,
    secondary_aliases: [],
    is_archived: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'v-emp',
    tenant_id: TENANT_ID,
    entity_type: 'company',
    entity_id: 'emp-1',
    analytical_token: 'EMP_01',
    real_label: 'Vanguard Tech',
    sensitive_identifier: '44555666000177',
    secondary_aliases: ['Vanguard Tecnologia e Sistemas Ltda'],
    is_archived: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'v-acc',
    tenant_id: TENANT_ID,
    entity_type: 'account',
    entity_id: 'acc-1',
    analytical_token: 'CTA_01',
    real_label: 'Conta Principal BTG Empresas',
    sensitive_identifier: '9821',
    secondary_aliases: ['Banco BTG Pactual S.A.'],
    is_archived: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'v-prd',
    tenant_id: TENANT_ID,
    entity_type: 'product',
    entity_id: 'prd-1',
    analytical_token: 'PRD_01',
    real_label: 'Suite Analytics Enterprise',
    sensitive_identifier: 'SKU-ANT-900',
    secondary_aliases: ['SKU-ANT-900'],
    is_archived: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'v-prj',
    tenant_id: TENANT_ID,
    entity_type: 'project',
    entity_id: 'prj-1',
    analytical_token: 'PRJ_01',
    real_label: 'Projeto Expansão Sul Confidencial',
    sensitive_identifier: null,
    secondary_aliases: [],
    is_archived: false,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  },
  {
    id: 'v-crd',
    tenant_id: TENANT_ID,
    entity_type: 'creditor',
    entity_id: 'debt-1',
    analytical_token: 'CRD_01',
    real_label: 'Banco Daycoval S.A.',
    sensitive_identifier: 'CTR-DAY-7788',
    secondary_aliases: ['Capital de Giro Banco Daycoval Sigiloso', 'CTR-DAY-7788'],
    is_archived: false,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
  },
];

const ACTIVE_CONTEXT: ActiveContext = { scope: 'all_independent' };

export function runAiContextBuilderTests(): AiContextTestResult[] {
  const results: AiContextTestResult[] = [];

  // 1. Zero-Leak completo no buildAnonymizedCfoContext
  try {
    const built = buildAnonymizedCfoContext({
      groups: GROUPS,
      companies: COMPANIES,
      accounts: ACCOUNTS,
      categories: CATEGORIES,
      productsServices: PRODUCTS,
      projects: PROJECTS,
      projectForecastItems: FORECAST_ITEMS,
      transactions: TRANSACTIONS,
      debts: DEBTS,
      debtInstallments: DEBT_INSTALLMENTS,
      taxObligations: TAXES,
      vault: VAULT,
      activeContext: ACTIVE_CONTEXT,
      regime: 'cash',
      todayISO: '2026-11-25',
      referenceMonth: '2026-11',
    });

    const forbiddenStrings = [
      'Holding Atlântica',
      'Vanguard',
      '44555666000177',
      '44.555.666/0001-77',
      'BTG Pactual',
      '9821',
      'Suite Analytics',
      'SKU-ANT-900',
      'Expansão Sul',
      'Porto Alegre',
      'MegaCorp',
      'CloudDelta',
      'Consultoria Externa Alpha',
      'Daycoval',
      'CTR-DAY-7788',
      'DAS-202611',
      'joao.diretor@megacorp.com.br',
    ];

    for (const term of forbiddenStrings) {
      expectEqual(
        built.serializedJson.toLowerCase().includes(term.toLowerCase()),
        false,
        `Payload enviado à IA não pode conter termo sensível: ${term}`
      );
    }

    expectEqual(built.sanitizationReport.zeroLeakageVerified, true, 'Zero-Leak report deve ser true');
    expectTrue(built.serializedJson.includes('EMP_01'), 'EMP_01 deve estar presente');
    expectTrue(built.serializedJson.includes('PRD_01'), 'PRD_01 deve estar presente');
    expectTrue(built.serializedJson.includes('PRJ_01'), 'PRJ_01 deve estar presente');
    expectTrue(built.serializedJson.includes('CRD_01'), 'CRD_01 deve estar presente');
    expectEqual(built.context.cashRisk45d.hasCashRisk45d, true, 'Risco de caixa 45d deve ser detectado');
    expectTrue(
      built.context.cashRisk45d.projectedCash45d < 0,
      'Caixa projetado 45d deve refletir saídas pendentes + dívida + DAS'
    );

    results.push({
      name: '1. Zero-Leak completo em buildAnonymizedCfoContext (0 vazamentos em todas entidades)',
      passed: true,
      details: `Payload 100% anonimizado (${built.tokensDetected.join(', ')}) com risco 45d = R$ ${built.context.cashRisk45d.projectedCash45d}.`,
    });
  } catch (err) {
    results.push({
      name: '1. Zero-Leak completo em buildAnonymizedCfoContext (0 vazamentos em todas entidades)',
      passed: false,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. Mascaramento automático + rejeição ativa (ZeroLeakViolationError) para termos sensíveis ou PII
  try {
    // 2a. Deve mascarar e-mail e contraparte não mapeada antes de retornar payload seguro
    const masked = assertZeroLeakagePayload(
      {
        nota: 'Enviar para diretor@empresa-externa.com.br sobre Cliente Secreto VIP S.A.',
      },
      VAULT,
      ['Cliente Secreto VIP S.A.']
    );
    expectEqual(
      masked.serializedJson.includes('diretor@empresa-externa.com.br'),
      false,
      'E-mail deve ser mascarado automaticamente'
    );
    expectEqual(
      masked.serializedJson.includes('Cliente Secreto VIP S.A.'),
      false,
      'Contraparte deve ser mascarada como [PARCEIRO_01]'
    );
    expectTrue(
      masked.serializedJson.includes('[EMAIL_REDIGIDO]'),
      'E-mail mascarado com [EMAIL_REDIGIDO]'
    );

    // 2b. Em modo estrito de auditoria pré-envio, deve lançar ZeroLeakViolationError se houver dado real
    let threwForEmail = false;
    try {
      assertZeroLeakagePayload(
        { nota: 'Enviar para diretor@empresa-externa.com.br sem máscara' },
        VAULT,
        [],
        { rejectIfUnsanitized: true }
      );
    } catch (err) {
      threwForEmail = err instanceof ZeroLeakViolationError;
    }
    expectEqual(threwForEmail, true, 'Deve lançar ZeroLeakViolationError para e-mail não mascarado');

    let threwForRealCompany = false;
    try {
      assertZeroLeakagePayload(
        { resumo: 'Vanguard Tech e Cliente Secreto VIP S.A. em texto bruto' },
        VAULT,
        ['Cliente Secreto VIP S.A.'],
        { rejectIfUnsanitized: true }
      );
    } catch (err) {
      threwForRealCompany = err instanceof ZeroLeakViolationError;
    }
    expectEqual(
      threwForRealCompany,
      true,
      'Deve rejeitar payload bruto contendo nome real de empresa ou contraparte'
    );

    results.push({
      name: '2. Barreira Zero-Leak mascara e rejeita (ZeroLeakViolationError) PII/nomes sensíveis',
      passed: true,
      details:
        'E-mails/contrapartes são mascarados automaticamente e payloads brutos lançam ZeroLeakViolationError na auditoria estrita.',
    });
  } catch (err) {
    results.push({
      name: '2. Barreira Zero-Leak mascara e rejeita (ZeroLeakViolationError) PII/nomes sensíveis',
      passed: false,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // 3. Sanitização de perguntas do usuário no chat privado
  try {
    const { sanitizedQuestion, report } = sanitizeUserQuestionForAI(
      'Por que a Vanguard Tech (CNPJ 44.555.666/0001-77) teve queda no Suite Analytics Enterprise?',
      VAULT,
      ['MegaCorp Brasil Participações S.A.']
    );

    expectEqual(report.zeroLeakageVerified, true, 'Pergunta sanitizada deve ser Zero-Leak');
    expectEqual(sanitizedQuestion.includes('Vanguard'), false, 'Empresa na pergunta deve ser mascarada');
    expectEqual(sanitizedQuestion.includes('44.555.666/0001-77'), false, 'CNPJ na pergunta deve ser mascarado');
    expectEqual(sanitizedQuestion.includes('Suite Analytics'), false, 'Produto na pergunta deve ser mascarado');
    expectTrue(sanitizedQuestion.includes('EMP_01'), 'EMP_01 aplicado na pergunta');
    expectTrue(sanitizedQuestion.includes('PRD_01'), 'PRD_01 aplicado na pergunta');

    results.push({
      name: '3. Sanitização automática de perguntas do chat ("Pergunte ao seu CFO")',
      passed: true,
      details: `Pergunta convertida em: "${sanitizedQuestion}"`,
    });
  } catch (err) {
    results.push({
      name: '3. Sanitização automática de perguntas do chat ("Pergunte ao seu CFO")',
      passed: false,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // 4. Re-hidratação restrita ao cliente autenticado
  try {
    const mockInsight: AiInsight = {
      id: 'ins-1',
      tenant_id: TENANT_ID,
      scope_type: 'all_independent',
      scope_token: 'GLOBAL',
      category: 'cash_risk_45d',
      severity: 'critical',
      status: 'new',
      title_tokenized: 'Risco de caixa em EMP_01 nos próximos 45 dias',
      summary_tokenized: 'O projeto PRJ_01 e o produto PRD_01 impactam a conta CTA_01.',
      recommendation_tokenized: 'Renegociar parcela com CRD_01.',
      related_tokens: ['EMP_01', 'PRJ_01', 'PRD_01', 'CRD_01'],
      estimated_financial_impact: 36500,
      impact_horizon_days: 45,
      confidence_pct: 91,
      provider_used: 'gemini',
      model_used: 'gemini-4-hydrogen',
      sanitized_context_snapshot: {},
      created_at: '2026-11-25T10:00:00Z',
      updated_at: '2026-11-25T10:00:00Z',
    };

    const display = rehydrateAiInsightForDisplay(mockInsight, VAULT, true);
    expectTrue(display.title.includes('Vanguard Tech'), 'Título deve exibir nome real no cliente');
    expectTrue(
      display.summary.includes('Projeto Expansão Sul Confidencial'),
      'Projeto deve ser re-hidratado no cliente'
    );
    expectTrue(
      display.recommendation.includes('Banco Daycoval S.A.'),
      'Credor deve ser re-hidratado no cliente'
    );

    let blockedUnauth = false;
    try {
      rehydrateAiInsightForDisplay(mockInsight, VAULT, false);
    } catch {
      blockedUnauth = true;
    }
    expectEqual(blockedUnauth, true, 'Sessão não autenticada não pode re-hidratar insight');

    results.push({
      name: '4. Re-hidratação de recomendações restrita à sessão autenticada',
      passed: true,
      details: 'Tokens traduzidos com precisão na tela autenticada e bloqueados sem autenticação.',
    });
  } catch (err) {
    results.push({
      name: '4. Re-hidratação de recomendações restrita à sessão autenticada',
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
  process.argv[1]?.includes('aiContextBuilder.test')
) {
  const outcomes = runAiContextBuilderTests();
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
