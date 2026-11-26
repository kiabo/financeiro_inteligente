import type { VaultEntry } from '../../core/types';
import { rehydrateFromAI, sanitizeForAI, verifyZeroLeakage } from '../anonymizer';

export interface UnitTestCaseResult {
  name: string;
  passed: boolean;
  details: string;
}

function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} (esperado: ${String(expected)}, obtido: ${String(actual)})`);
  }
}

const SAMPLE_VAULT: VaultEntry[] = [
  {
    id: 'g-1',
    tenant_id: 'tenant-1',
    entity_type: 'group',
    entity_id: 'g-1',
    analytical_token: 'GRP_01',
    real_label: 'Grupo Horizonte Participações',
    sensitive_identifier: null,
    secondary_aliases: ['Grupo Horizonte'],
    is_archived: false,
    created_at: '2026-11-25T10:00:00Z',
    updated_at: '2026-11-25T10:00:00Z',
  },
  {
    id: 'c-1',
    tenant_id: 'tenant-1',
    entity_type: 'company',
    entity_id: 'c-1',
    analytical_token: 'EMP_01',
    real_label: 'Alpha Engenharia',
    sensitive_identifier: '12345678000190',
    secondary_aliases: ['Alpha Engenharia e Projetos Ltda'],
    is_archived: false,
    created_at: '2026-11-25T10:01:00Z',
    updated_at: '2026-11-25T10:01:00Z',
  },
  {
    id: 'a-1',
    tenant_id: 'tenant-1',
    entity_type: 'account',
    entity_id: 'a-1',
    analytical_token: 'CTA_01',
    real_label: 'Conta Corrente Itaú Matriz',
    sensitive_identifier: '4419',
    secondary_aliases: ['Itaú Unibanco'],
    is_archived: false,
    created_at: '2026-11-25T10:02:00Z',
    updated_at: '2026-11-25T10:02:00Z',
  },
];

export function runAnonymizerUnitTests(): UnitTestCaseResult[] {
  const results: UnitTestCaseResult[] = [];

  // Teste 1: Remoção de Razão Social, Nome Fantasia, Grupo e CNPJ formatado/bruto
  try {
    const payload = {
      contexto: 'Análise consolidada do Grupo Horizonte Participações',
      empresaPrincipal: {
        razao: 'Alpha Engenharia e Projetos Ltda',
        fantasia: 'Alpha Engenharia',
        cnpjFormatado: '12.345.678/0001-90',
        cnpjBruto: '12345678000190',
      },
      contas: [
        {
          titulo: 'Conta Corrente Itaú Matriz',
          banco: 'Itaú Unibanco',
          observacao: 'Movimentação no cartão final 4419',
        },
      ],
    };

    const { sanitized, report } = sanitizeForAI(payload, SAMPLE_VAULT);
    const json = JSON.stringify(sanitized);

    expectEqual(report.zeroLeakageVerified, true, 'Relatório deve confirmar zero vazamento');
    expectEqual(report.leakedTerms.length, 0, 'Nenhum termo sensível pode vazar');
    expectEqual(json.includes('Grupo Horizonte'), false, 'Nome do grupo não deve aparecer');
    expectEqual(json.includes('Alpha Engenharia'), false, 'Nome da empresa não deve aparecer');
    expectEqual(json.includes('12.345.678/0001-90'), false, 'CNPJ formatado não deve aparecer');
    expectEqual(json.includes('12345678000190'), false, 'CNPJ bruto não deve aparecer');
    expectEqual(json.includes('Conta Corrente Itaú Matriz'), false, 'Nome da conta não deve aparecer');
    expectEqual(json.includes('Itaú Unibanco'), false, 'Instituição bancária não deve aparecer');
    expectEqual(json.includes('GRP_01'), true, 'Token GRP_01 deve estar presente');
    expectEqual(json.includes('EMP_01'), true, 'Token EMP_01 deve estar presente');
    expectEqual(json.includes('CTA_01'), true, 'Token CTA_01 deve estar presente');

    results.push({
      name: '1. Sanitização completa de nomes, CNPJs e aliases aninhados',
      passed: true,
      details: `${report.redactionsCount} substituições aplicadas (${report.tokensApplied.join(', ')}).`,
    });
  } catch (err) {
    results.push({
      name: '1. Sanitização completa de nomes, CNPJs e aliases aninhados',
      passed: false,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // Teste 2: Prioridade longest-match-first evita vazamento parcial
  try {
    const text = 'Consolidado Grupo Horizonte Participações vs Grupo Horizonte';
    const { sanitized } = sanitizeForAI(text, SAMPLE_VAULT);
    expectEqual(sanitized, 'Consolidado GRP_01 vs GRP_01', 'Precedência de nomes longos');
    results.push({
      name: '2. Precedência longest-match-first para nomes compostos',
      passed: true,
      details: 'Nomes longos substituídos antes de sub-aliases curtos.',
    });
  } catch (err) {
    results.push({
      name: '2. Precedência longest-match-first para nomes compostos',
      passed: false,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // Teste 3: Defesa em profundidade contra CNPJ não mapeado no cofre
  try {
    const rawPrompt = 'Fornecedor externo CNPJ 98.765.432/0001-10 emitiu fatura para Alpha Engenharia.';
    const { sanitized } = sanitizeForAI(rawPrompt, SAMPLE_VAULT);
    expectEqual(sanitized.includes('98.765.432/0001-10'), false, 'CNPJ externo deve ser redigido');
    expectEqual(sanitized.includes('[CNPJ_REDIGIDO]'), true, 'Marcador de redação deve existir');
    expectEqual(sanitized.includes('EMP_01'), true, 'Empresa conhecida vira EMP_01');

    results.push({
      name: '3. Redação automática de CNPJs externos não cadastrados',
      passed: true,
      details: 'Padrão CNPJ externo substituído por [CNPJ_REDIGIDO].',
    });
  } catch (err) {
    results.push({
      name: '3. Redação automática de CNPJs externos não cadastrados',
      passed: false,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // Teste 4: Re-hidratação funciona somente no cliente autenticado
  try {
    const aiReply = {
      resumo: 'A empresa EMP_01 ([CNPJ:EMP_01]) no grupo GRP_01 concentrou liquidez na conta CTA_01.',
    };
    const restored = rehydrateFromAI(aiReply, SAMPLE_VAULT, {
      isAuthenticatedClient: true,
      includeFormattedCnpj: true,
    });

    expectEqual(restored.resumo.includes('Alpha Engenharia'), true, 'Empresa deve ser restaurada');
    expectEqual(restored.resumo.includes('12.345.678/0001-90'), true, 'CNPJ deve ser restaurado');
    expectEqual(restored.resumo.includes('Grupo Horizonte Participações'), true, 'Grupo deve ser restaurado');
    expectEqual(restored.resumo.includes('Conta Corrente Itaú Matriz'), true, 'Conta deve ser restaurada');

    let blocked = false;
    try {
      rehydrateFromAI(aiReply, SAMPLE_VAULT, { isAuthenticatedClient: false });
    } catch {
      blocked = true;
    }
    expectEqual(blocked, true, 'Sessão não autenticada deve ser bloqueada');

    results.push({
      name: '4. Re-hidratação bidirecional restrita ao cliente autenticado',
      passed: true,
      details: 'Tokens restaurados com segurança e chamada não autenticada bloqueada.',
    });
  } catch (err) {
    results.push({
      name: '4. Re-hidratação bidirecional restrita ao cliente autenticado',
      passed: false,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // Teste 5: Detector de vazamento verifyZeroLeakage acusa vazamento simulado
  try {
    const leakCheck = verifyZeroLeakage({ texto: 'Relatório da Alpha Engenharia' }, SAMPLE_VAULT);
    expectEqual(leakCheck.clean, false, 'Deve acusar vazamento');
    expectEqual(leakCheck.leakedTerms.includes('Alpha Engenharia'), true, 'Termo vazado listado');

    results.push({
      name: '5. Verificador de vazamento identifica exposição residual',
      passed: true,
      details: 'Detector verifyZeroLeakage sinalizou corretamente o termo exposto.',
    });
  } catch (err) {
    results.push({
      name: '5. Verificador de vazamento identifica exposição residual',
      passed: false,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // Teste 6: Sanitização de Produtos/Serviços (PRD_01, SRV_01) no cofre
  try {
    const extendedVault: VaultEntry[] = [
      ...SAMPLE_VAULT,
      {
        id: 'p-1',
        tenant_id: 'tenant-1',
        entity_type: 'product',
        entity_id: 'p-1',
        analytical_token: 'PRD_01',
        real_label: 'Plataforma ERP Cloud',
        sensitive_identifier: 'SKU-ERP-01',
        secondary_aliases: ['SKU-ERP-01'],
        is_archived: false,
        created_at: '2026-11-25T10:05:00Z',
        updated_at: '2026-11-25T10:05:00Z',
      },
      {
        id: 's-1',
        tenant_id: 'tenant-1',
        entity_type: 'service',
        entity_id: 's-1',
        analytical_token: 'SRV_01',
        real_label: 'Consultoria Tributária Premium',
        sensitive_identifier: null,
        secondary_aliases: [],
        is_archived: false,
        created_at: '2026-11-25T10:06:00Z',
        updated_at: '2026-11-25T10:06:00Z',
      },
    ];

    const payload = {
      oferta: 'Plataforma ERP Cloud (SKU-ERP-01)',
      servico: 'Consultoria Tributária Premium',
    };
    const { sanitized, report } = sanitizeForAI(payload, extendedVault);
    const json = JSON.stringify(sanitized);

    expectEqual(report.zeroLeakageVerified, true, 'Zero vazamento para produtos e serviços');
    expectEqual(json.includes('Plataforma ERP Cloud'), false, 'Nome do produto não pode vazar');
    expectEqual(json.includes('Consultoria Tributária Premium'), false, 'Nome do serviço não pode vazar');
    expectEqual(json.includes('PRD_01'), true, 'Token PRD_01 presente');
    expectEqual(json.includes('SRV_01'), true, 'Token SRV_01 presente');

    const restored = rehydrateFromAI(sanitized, extendedVault, { isAuthenticatedClient: true });
    expectEqual(restored.servico, 'Consultoria Tributária Premium', 'SRV_01 deve re-hidratar');

    results.push({
      name: '6. Sanitização e re-hidratação de Produtos (PRD_XX) e Serviços (SRV_XX)',
      passed: true,
      details: 'Ofertas substituídas por PRD_01/SRV_01 e restauradas apenas no cliente autenticado.',
    });
  } catch (err) {
    results.push({
      name: '6. Sanitização e re-hidratação de Produtos (PRD_XX) e Serviços (SRV_XX)',
      passed: false,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // Teste 7: Sanitização de descrições de lançamentos e nomes de fornecedores/clientes
  try {
    const extendedVault: VaultEntry[] = [
      ...SAMPLE_VAULT,
      {
        id: 'p-1',
        tenant_id: 'tenant-1',
        entity_type: 'product',
        entity_id: 'p-1',
        analytical_token: 'PRD_01',
        real_label: 'Plataforma ERP Cloud',
        sensitive_identifier: null,
        secondary_aliases: [],
        is_archived: false,
        created_at: '2026-11-25T10:05:00Z',
        updated_at: '2026-11-25T10:05:00Z',
      },
    ];

    const txPayload = [
      {
        transaction_type: 'income',
        competence_date: '2026-11-10',
        amount: 14500,
        counterparty_name: 'Construtora Horizonte Sul S.A.',
        description: 'Fatura 1/3 Plataforma ERP Cloud para Construtora Horizonte Sul S.A.',
        notes: 'Contato financeiro@horizontesul.com.br',
      },
    ];

    const { sanitized, report } = sanitizeForAI(txPayload, extendedVault);
    const json = JSON.stringify(sanitized);

    expectEqual(report.zeroLeakageVerified, true, 'Zero vazamento em lançamentos financeiros');
    expectEqual(json.includes('Construtora Horizonte Sul'), false, 'Cliente não pode vazar');
    expectEqual(json.includes('Plataforma ERP Cloud'), false, 'Produto na descrição não pode vazar');
    expectEqual(json.includes('financeiro@horizontesul.com.br'), false, 'E-mail na nota não pode vazar');
    expectEqual(json.includes('[PARCEIRO_01]'), true, 'Cliente vira token [PARCEIRO_01]');
    expectEqual(json.includes('PRD_01'), true, 'Produto vira token PRD_01 na descrição');

    results.push({
      name: '7. Remoção de descrições sensíveis e contrapartes em lançamentos',
      passed: true,
      details: 'Descrições redigidas preservando tokens (PRD_01, 1/3) e fornecedores/clientes anonimizados.',
    });
  } catch (err) {
    results.push({
      name: '7. Remoção de descrições sensíveis e contrapartes em lançamentos',
      passed: false,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // Teste 8: Sanitização e re-hidratação de Projetos (PRJ_01) e hipóteses confidenciais
  try {
    const extendedVault: VaultEntry[] = [
      ...SAMPLE_VAULT,
      {
        id: 'prj-1',
        tenant_id: 'tenant-1',
        entity_type: 'project',
        entity_id: 'prj-1',
        analytical_token: 'PRJ_01',
        real_label: 'Expansão Planta Campinas',
        sensitive_identifier: null,
        secondary_aliases: [],
        is_archived: false,
        created_at: '2026-11-25T10:10:00Z',
        updated_at: '2026-11-25T10:10:00Z',
      },
    ];

    const projectPayload = {
      name: 'Expansão Planta Campinas',
      planned_start_date: '2026-12-01',
      initial_investment: 180000,
      hypothesis: 'Abertura da unidade Campinas para atender Alpha Engenharia sem terceiros.',
    };

    const { sanitized, report } = sanitizeForAI(projectPayload, extendedVault);
    const json = JSON.stringify(sanitized);

    expectEqual(report.zeroLeakageVerified, true, 'Zero vazamento para projetos');
    expectEqual(json.includes('Expansão Planta Campinas'), false, 'Nome do projeto não pode vazar');
    expectEqual(json.includes('Abertura da unidade Campinas'), false, 'Hipótese confidencial deve ser redigida');
    expectEqual(json.includes('PRJ_01'), true, 'Token PRJ_01 deve estar presente');

    const restored = rehydrateFromAI(sanitized, extendedVault, { isAuthenticatedClient: true });
    expectEqual(restored.name, 'Expansão Planta Campinas', 'Nome do projeto deve re-hidratar');

    results.push({
      name: '8. Sanitização e re-hidratação de Projetos (PRJ_XX) e hipóteses',
      passed: true,
      details: 'Nome do projeto convertido em PRJ_01, hipótese redigida e re-hidratação validada.',
    });
  } catch (err) {
    results.push({
      name: '8. Sanitização e re-hidratação de Projetos (PRJ_XX) e hipóteses',
      passed: false,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // Teste 9: Sanitização e re-hidratação de Credores de Dívidas (CRD_01)
  try {
    const extendedVault: VaultEntry[] = [
      ...SAMPLE_VAULT,
      {
        id: 'crd-1',
        tenant_id: 'tenant-1',
        entity_type: 'creditor',
        entity_id: 'crd-1',
        analytical_token: 'CRD_01',
        real_label: 'Banco Safra Empresas S.A.',
        sensitive_identifier: 'CTR-99210-BNDES',
        secondary_aliases: ['CTR-99210-BNDES'],
        is_archived: false,
        created_at: '2026-11-25T10:15:00Z',
        updated_at: '2026-11-25T10:15:00Z',
      },
    ];

    const debtPayload = {
      contrato: 'Financiamento Giro junto ao Banco Safra Empresas S.A. (CTR-99210-BNDES)',
      creditor_name: 'Banco Safra Empresas S.A.',
      principal_amount: 120000,
    };

    const { sanitized, report } = sanitizeForAI(debtPayload, extendedVault);
    const json = JSON.stringify(sanitized);

    expectEqual(report.zeroLeakageVerified, true, 'Zero vazamento para credor de dívida');
    expectEqual(json.includes('Banco Safra'), false, 'Nome do credor não pode vazar');
    expectEqual(json.includes('CTR-99210-BNDES'), false, 'Código do contrato não pode vazar');
    expectEqual(json.includes('CRD_01'), true, 'Token CRD_01 deve estar presente');

    const restored = rehydrateFromAI(sanitized, extendedVault, { isAuthenticatedClient: true });
    expectEqual(restored.creditor_name, 'Banco Safra Empresas S.A.', 'Nome do credor deve re-hidratar');

    results.push({
      name: '9. Sanitização e re-hidratação de Credores de Dívidas (CRD_XX)',
      passed: true,
      details: 'Credor e contrato convertidos em CRD_01 e restaurados somente no cliente autenticado.',
    });
  } catch (err) {
    results.push({
      name: '9. Sanitização e re-hidratação de Credores de Dívidas (CRD_XX)',
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
  process.argv[1]?.includes('anonymizer.test')
) {
  const outcomes = runAnonymizerUnitTests();
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
