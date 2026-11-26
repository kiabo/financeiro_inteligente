import crypto from 'crypto';
import type { Request, Response } from 'express';
import { addMonthsISO, getTodayISO } from '../src/lib/utils.ts';
import type {
  McpAccessToken,
  McpCallLog,
  McpTokenScope,
  Project,
  ProjectForecastItem,
} from '../src/modules/core/types.ts';
import {
  calculateProjectFeasibility,
  computeForecastLineTotals,
  roundCurrency,
} from '../src/modules/projects/projectCalculator.ts';
import type { AnonymizedFinancialContext } from '../src/modules/ai-cfo/aiContextBuilder.ts';
import { assertServerPayloadZeroLeak } from './aiProvider.ts';

export interface McpTokenRegistryRecord {
  id: string;
  tenant_id: string;
  label: string;
  token_prefix: string;
  token_hash: string;
  scope: McpTokenScope;
  is_active: boolean;
  last_used_at: string | null;
  call_count: number;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface PendingSimulatedProjectDraft {
  draftId: string;
  tenantId: string;
  companyToken: string;
  offerToken: string | null;
  suggestedProjectToken: string;
  status: 'idea_simulation';
  plannedStartDate: string;
  plannedEndDate: string;
  initialInvestment: number;
  monthlyFixedCostAllocation: number;
  monthlyRevenue: number;
  durationMonths: number;
  paymentFeePct: number;
  taxRatePct: number;
  unitDirectCostRatio: number;
  feasibility: {
    totalPlannedRevenue: number;
    totalPlannedDirectCostsAndTaxes: number;
    contributionMarginPct: number;
    netProjectResult: number;
    roiPct: number | null;
    paybackMonthIndex: number | null;
    paybackExactMonths: number | null;
    breakEvenRevenue: number | null;
    companyCashBeforeProject: number;
    minimumCompanyCashWithProject: number;
    cashExposureAlert: boolean;
    cashExposureShortfall: number;
    budgetHealth: string;
  };
  createdAt: string;
  consumedByClient: boolean;
}

interface TenantMcpBridgeState {
  tenantId: string;
  anonymizedContext: AnonymizedFinancialContext;
  tokens: McpTokenRegistryRecord[];
  callLogs: McpCallLog[];
  pendingDrafts: PendingSimulatedProjectDraft[];
  nextDraftSeq: number;
  updatedAt: string;
}

const tenantStates = new Map<string, TenantMcpBridgeState>();
const tokenHashToTenant = new Map<string, string>();

export function hashMcpToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

export function syncTenantMcpBridge(params: {
  tenantId: string;
  anonymizedContext: AnonymizedFinancialContext;
  tokens: McpAccessToken[];
}): { syncedTokens: number; pendingDraftsCount: number } {
  assertServerPayloadZeroLeak(params.anonymizedContext);

  const existing = tenantStates.get(params.tenantId);

  // Remove stale token hashes for this tenant before re-indexing
  for (const [hash, tid] of tokenHashToTenant.entries()) {
    if (tid === params.tenantId) {
      tokenHashToTenant.delete(hash);
    }
  }

  const registryTokens: McpTokenRegistryRecord[] = params.tokens.map((t) => {
    const prev = existing?.tokens.find((p) => p.id === t.id);
    if (t.is_active && !t.revoked_at) {
      tokenHashToTenant.set(t.token_hash, params.tenantId);
    }
    return {
      id: t.id,
      tenant_id: t.tenant_id,
      label: t.label,
      token_prefix: t.token_prefix,
      token_hash: t.token_hash,
      scope: t.scope,
      is_active: t.is_active,
      last_used_at: prev?.last_used_at ?? t.last_used_at,
      call_count: Math.max(prev?.call_count ?? 0, t.call_count),
      expires_at: t.expires_at,
      revoked_at: t.revoked_at,
    };
  });

  const maxProjNum = params.anonymizedContext.projects.reduce((maxVal, prj) => {
    const m = /^PRJ_(\d+)$/.exec(prj.projectToken);
    return m ? Math.max(maxVal, Number(m[1])) : maxVal;
  }, 0);

  const nextState: TenantMcpBridgeState = {
    tenantId: params.tenantId,
    anonymizedContext: params.anonymizedContext,
    tokens: registryTokens,
    callLogs: existing?.callLogs ?? [],
    pendingDrafts: existing?.pendingDrafts ?? [],
    nextDraftSeq: Math.max(existing?.nextDraftSeq ?? 1, maxProjNum + 1),
    updatedAt: new Date().toISOString(),
  };

  tenantStates.set(params.tenantId, nextState);

  return {
    syncedTokens: registryTokens.filter((t) => t.is_active && !t.revoked_at).length,
    pendingDraftsCount: nextState.pendingDrafts.filter((d) => !d.consumedByClient).length,
  };
}

export function pullTenantMcpUpdates(tenantId: string): {
  callLogs: McpCallLog[];
  tokenStats: Array<{ id: string; call_count: number; last_used_at: string | null }>;
  pendingDrafts: PendingSimulatedProjectDraft[];
} {
  const state = tenantStates.get(tenantId);
  if (!state) {
    return { callLogs: [], tokenStats: [], pendingDrafts: [] };
  }

  const unconsumed = state.pendingDrafts.filter((d) => !d.consumedByClient);
  for (const d of unconsumed) {
    d.consumedByClient = true;
  }

  return {
    callLogs: [...state.callLogs].slice(0, 50),
    tokenStats: state.tokens.map((t) => ({
      id: t.id,
      call_count: t.call_count,
      last_used_at: t.last_used_at,
    })),
    pendingDrafts: unconsumed,
  };
}

function authenticateMcpBearer(req: Request): {
  ok: true;
  state: TenantMcpBridgeState;
  token: McpTokenRegistryRecord;
} | {
  ok: false;
  status: number;
  message: string;
} {
  const authHeader = req.headers.authorization;
  const fallbackHeader = req.headers['x-mcp-token'];
  let rawToken = '';

  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    rawToken = authHeader.slice(7).trim();
  } else if (typeof fallbackHeader === 'string') {
    rawToken = fallbackHeader.trim();
  }

  if (!rawToken) {
    return {
      ok: false,
      status: 401,
      message: 'Token Bearer MCP ausente. Envie Authorization: Bearer <seu_token_mcp>.',
    };
  }

  const hash = hashMcpToken(rawToken);
  const tenantId = tokenHashToTenant.get(hash);
  if (!tenantId) {
    return {
      ok: false,
      status: 401,
      message:
        'Token MCP inválido, revogado ou sessão web ainda não sincronizada com o servidor MCP.',
    };
  }

  const state = tenantStates.get(tenantId);
  const token = state?.tokens.find((t) => t.token_hash === hash);
  if (!state || !token || !token.is_active || token.revoked_at) {
    return {
      ok: false,
      status: 401,
      message: 'Token MCP revogado ou inativo.',
    };
  }

  if (token.expires_at && new Date(token.expires_at).getTime() < Date.now()) {
    return {
      ok: false,
      status: 401,
      message: 'Token MCP expirado.',
    };
  }

  return { ok: true, state, token };
}

function recordMcpCall(
  state: TenantMcpBridgeState,
  token: McpTokenRegistryRecord,
  entry: Omit<McpCallLog, 'id' | 'tenant_id' | 'token_id' | 'created_at'>
): void {
  const now = new Date().toISOString();
  token.call_count += 1;
  token.last_used_at = now;

  state.callLogs.unshift({
    id: crypto.randomUUID(),
    tenant_id: state.tenantId,
    token_id: token.id,
    tool_name: entry.tool_name,
    scope_used: entry.scope_used,
    status: entry.status,
    zero_leak_verified: entry.zero_leak_verified,
    sanitized_args: entry.sanitized_args,
    response_summary: entry.response_summary,
    created_at: now,
  });

  if (state.callLogs.length > 100) {
    state.callLogs.length = 100;
  }
}

function parseBrazilianNumber(raw: string): number {
  const cleaned = raw.trim().replace(/\s+/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) {
    return Number(cleaned.replace(/\./g, '').replace(',', '.'));
  }
  if (/^\d+(,\d+)$/.test(cleaned)) {
    return Number(cleaned.replace(',', '.'));
  }
  return Number(cleaned.replace(/,/g, ''));
}

function parseSimulationIdeaText(text: string): {
  initialInvestment?: number;
  monthlyRevenue?: number;
  durationMonths?: number;
  monthlyFixedCost?: number;
  offerToken?: string;
  companyToken?: string;
} {
  const result: {
    initialInvestment?: number;
    monthlyRevenue?: number;
    durationMonths?: number;
    monthlyFixedCost?: number;
    offerToken?: string;
    companyToken?: string;
  } = {};

  const offerMatch = /\b((?:PRD|SRV)_\d{2,})\b/i.exec(text);
  if (offerMatch?.[1]) result.offerToken = offerMatch[1].toUpperCase();

  const companyMatch = /\b(EMP_\d{2,})\b/i.exec(text);
  if (companyMatch?.[1]) result.companyToken = companyMatch[1].toUpperCase();

  const investMatch =
    /(?:investimento|aporte|capex|inicial)[^0-9]{0,20}(?:r\$\s*)?([\d.,]+)/i.exec(text);
  if (investMatch?.[1]) {
    const val = parseBrazilianNumber(investMatch[1]);
    if (Number.isFinite(val) && val > 0) result.initialInvestment = val;
  }

  const revMatch =
    /(?:receita|faturamento)(?:\s+mensal)?[^0-9]{0,20}(?:r\$\s*)?([\d.,]+)/i.exec(text);
  if (revMatch?.[1]) {
    const val = parseBrazilianNumber(revMatch[1]);
    if (Number.isFinite(val) && val > 0) result.monthlyRevenue = val;
  }

  const fixedMatch =
    /(?:custo\s+fixo|aloca[cç][aã]o\s+fixa)[^0-9]{0,20}(?:r\$\s*)?([\d.,]+)/i.exec(text);
  if (fixedMatch?.[1]) {
    const val = parseBrazilianNumber(fixedMatch[1]);
    if (Number.isFinite(val) && val >= 0) result.monthlyFixedCost = val;
  }

  const monthsMatch = /(?:por|durante|prazo\s+de|horizonte\s+de)?\s*(\d{1,3})\s*mes(?:es)?/i.exec(
    text
  );
  if (monthsMatch?.[1]) {
    const m = Math.min(60, Math.max(1, Number(monthsMatch[1])));
    if (Number.isFinite(m)) result.durationMonths = m;
  }

  return result;
}

const MCP_TOOLS_DEFINITIONS = [
  {
    name: 'get_financial_health_summary',
    description:
      'Retorna score de saúde financeira, runway, margens, risco de caixa em 45 dias e comparativo de períodos identificados estritamente por tokens do Cofre (EMP_XX, GRP_XX). Zero vazamento de identidades reais.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_token: {
          type: 'string',
          description:
            'Token analítico opcional (ex.: EMP_01 ou GRP_01) para filtrar o detalhamento por entidade.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'analyze_project_viability',
    description:
      'Consulta métricas previstas vs. realizadas de um projeto tokenizado (PRJ_XX), incluindo ROI, Payback, Break-even, desvio orçamentário e impacto no caixa da empresa (EMP_XX).',
    inputSchema: {
      type: 'object',
      properties: {
        project_token: {
          type: 'string',
          description:
            'Token do projeto (ex.: PRJ_01). Se omitido, retorna a visão consolidada de todos os projetos no escopo.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_winners_and_losers',
    description:
      'Lista os tokens de produtos (PRD_XX), serviços (SRV_XX), projetos (PRJ_XX) e empresas (EMP_XX) classificados como geradores de caixa ou drenos de caixa.',
    inputSchema: {
      type: 'object',
      properties: {
        dimension: {
          type: 'string',
          enum: ['all', 'products', 'projects', 'companies'],
          description: 'Dimensão desejada do ranking (padrão: all).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'simulate_new_project_idea',
    description:
      'Simula a viabilidade financeira de uma nova ideia de projeto (usando tokens PRD_XX / SRV_XX / EMP_XX), executa o motor determinístico (Payback, ROI, Break-even, impacto no caixa), salva como rascunho (status = idea_simulation) e devolve o diagnóstico anonimizado. Requer escopo simulate_drafts.',
    inputSchema: {
      type: 'object',
      properties: {
        idea_description: {
          type: 'string',
          description:
            'Descrição em linguagem natural usando tokens (ex.: "Simule um projeto com investimento de R$ 25.000, receita mensal de R$ 9.000 por 6 meses usando PRD_01").',
        },
        company_token: {
          type: 'string',
          description: 'Token da empresa alvo (ex.: EMP_01).',
        },
        product_token: {
          type: 'string',
          description: 'Token do produto ou serviço de referência (ex.: PRD_01 ou SRV_01).',
        },
        initial_investment: {
          type: 'number',
          description: 'Investimento inicial / CAPEX em BRL.',
        },
        monthly_revenue: {
          type: 'number',
          description: 'Receita bruta mensal estimada em BRL.',
        },
        duration_months: {
          type: 'integer',
          description: 'Duração da simulação em meses (1 a 60).',
        },
        monthly_fixed_cost: {
          type: 'number',
          description: 'Alocação mensal de custos fixos em BRL (opcional, padrão 0).',
        },
      },
      additionalProperties: false,
    },
  },
];

function executeMcpTool(
  state: TenantMcpBridgeState,
  token: McpTokenRegistryRecord,
  toolName: string,
  rawArgs: Record<string, unknown>
): { ok: true; payload: Record<string, unknown>; summary: string } | {
  ok: false;
  code: number;
  message: string;
} {
  // Valida que nenhum argumento enviado contém PII ou campo identificável
  assertServerPayloadZeroLeak(rawArgs);
  const ctx = state.anonymizedContext;

  if (toolName === 'get_financial_health_summary') {
    const entityToken =
      typeof rawArgs.entity_token === 'string' ? rawArgs.entity_token.trim().toUpperCase() : null;

    const companyFiltered = entityToken
      ? ctx.companies.filter(
          (c) => c.companyToken === entityToken || c.groupToken === entityToken
        )
      : ctx.companies;

    const accountsFiltered = entityToken
      ? ctx.accounts.filter((a) => a.companyToken === entityToken)
      : ctx.accounts;

    const payload = {
      privacyNotice: '100% Anonimizado via Cofre Vértice (Zero-Leak Verified)',
      scopeToken: entityToken ?? ctx.scopeToken,
      regime: ctx.regime,
      periodCurrent: ctx.periodCurrentLabel,
      periodCompare: ctx.periodCompareLabel,
      healthSummary: ctx.healthSummary,
      cashRisk45d: ctx.cashRisk45d,
      companies: companyFiltered,
      accounts: accountsFiltered,
      monthlyEvolution6m: ctx.monthlyEvolution6m,
    };

    assertServerPayloadZeroLeak(payload);
    return {
      ok: true,
      payload,
      summary: `Health score ${ctx.healthSummary.healthScore}/100 · Runway ${ctx.healthSummary.runwayMonths ?? 'N/A'}m`,
    };
  }

  if (toolName === 'analyze_project_viability') {
    const projectToken =
      typeof rawArgs.project_token === 'string' ? rawArgs.project_token.trim().toUpperCase() : null;

    const matchedProjects = projectToken
      ? ctx.projects.filter((p) => p.projectToken === projectToken)
      : ctx.projects;

    if (projectToken && matchedProjects.length === 0) {
      return {
        ok: false,
        code: -32602,
        message: `Projeto ${projectToken} não encontrado no escopo atual.`,
      };
    }

    const payload = {
      privacyNotice: '100% Anonimizado via Cofre Vértice (Zero-Leak Verified)',
      filterToken: projectToken ?? 'ALL_PROJECTS',
      projects: matchedProjects,
      companyCashContext: ctx.companies.map((c) => ({
        companyToken: c.companyToken,
        netResult: c.netResult,
        netMarginPct: c.netMarginPct,
      })),
    };

    assertServerPayloadZeroLeak(payload);
    return {
      ok: true,
      payload,
      summary: `${matchedProjects.length} projeto(s) analisado(s)`,
    };
  }

  if (toolName === 'get_winners_and_losers') {
    const dimension =
      typeof rawArgs.dimension === 'string' ? rawArgs.dimension.toLowerCase() : 'all';

    const sortByMargin = <T extends { netMarginCurrent?: number; realizedNetResult?: number; netResult?: number }>(
      arr: T[]
    ) =>
      [...arr].sort((a, b) => {
        const va = a.netMarginCurrent ?? a.realizedNetResult ?? a.netResult ?? 0;
        const vb = b.netMarginCurrent ?? b.realizedNetResult ?? b.netResult ?? 0;
        return vb - va;
      });

    const payload: Record<string, unknown> = {
      privacyNotice: '100% Anonimizado via Cofre Vértice (Zero-Leak Verified)',
      periodCurrent: ctx.periodCurrentLabel,
      dimension,
    };

    if (dimension === 'all' || dimension === 'products') {
      const sorted = sortByMargin(ctx.productsAndServices);
      payload.products = {
        winners: sorted.filter((p) => p.classification === 'cash_generator'),
        losers: sorted.filter((p) => p.classification === 'cash_drain'),
        neutral: sorted.filter((p) => p.classification === 'neutral'),
      };
    }
    if (dimension === 'all' || dimension === 'projects') {
      const sorted = sortByMargin(ctx.projects);
      payload.projects = {
        healthy: sorted.filter((p) => p.budgetHealth === 'healthy'),
        attentionOrCritical: sorted.filter((p) => p.budgetHealth !== 'healthy'),
      };
    }
    if (dimension === 'all' || dimension === 'companies') {
      const sorted = sortByMargin(ctx.companies);
      payload.companies = {
        winners: sorted.filter((c) => c.classification === 'cash_generator'),
        losers: sorted.filter((c) => c.classification === 'cash_drain'),
      };
    }

    assertServerPayloadZeroLeak(payload);
    return {
      ok: true,
      payload,
      summary: `Ranking Winners & Losers (${dimension}) retornado`,
    };
  }

  if (toolName === 'simulate_new_project_idea') {
    if (token.scope !== 'simulate_drafts') {
      return {
        ok: false,
        code: -32003,
        message:
          'Permissão insuficiente: esta chave MCP possui escopo read_only. Crie uma chave com escopo simulate_drafts para salvar simulações de projetos.',
      };
    }

    const parsedFromText =
      typeof rawArgs.idea_description === 'string'
        ? parseSimulationIdeaText(rawArgs.idea_description)
        : {};

    const offerTokenRaw =
      (typeof rawArgs.product_token === 'string' && rawArgs.product_token.trim().toUpperCase()) ||
      parsedFromText.offerToken ||
      null;

    const matchedOffer = offerTokenRaw
      ? ctx.productsAndServices.find((p) => p.offerToken === offerTokenRaw)
      : undefined;

    const companyToken =
      (typeof rawArgs.company_token === 'string' && rawArgs.company_token.trim().toUpperCase()) ||
      parsedFromText.companyToken ||
      matchedOffer?.companyToken ||
      ctx.companies[0]?.companyToken ||
      'EMP_01';

    const initialInvestment = roundCurrency(
      Math.max(
        0,
        Number(rawArgs.initial_investment ?? parsedFromText.initialInvestment ?? 25000) || 0
      )
    );
    const monthlyRevenue = roundCurrency(
      Math.max(
        1,
        Number(rawArgs.monthly_revenue ?? parsedFromText.monthlyRevenue ?? 9000) || 9000
      )
    );
    const durationMonths = Math.min(
      60,
      Math.max(
        1,
        Math.floor(Number(rawArgs.duration_months ?? parsedFromText.durationMonths ?? 6) || 6)
      )
    );
    const monthlyFixedCost = roundCurrency(
      Math.max(0, Number(rawArgs.monthly_fixed_cost ?? parsedFromText.monthlyFixedCost ?? 0) || 0)
    );

    const paymentFeePct = matchedOffer?.paymentFeePct ?? 2.5;
    const taxRatePct = matchedOffer?.estimatedTaxPct ?? 8.0;
    const unitDirectCostRatio =
      matchedOffer && matchedOffer.unitPrice > 0
        ? Math.min(0.95, Math.max(0, matchedOffer.estimatedDirectCost / matchedOffer.unitPrice))
        : 0.3;

    const todayISO = getTodayISO();
    const plannedStartDate = `${todayISO.slice(0, 7)}-01`;
    const plannedEndDate = addMonthsISO(plannedStartDate, durationMonths - 1);
    const suggestedProjectToken = `PRJ_${String(state.nextDraftSeq).padStart(2, '0')}`;
    state.nextDraftSeq += 1;

    const syntheticProject: Project = {
      id: `mcp-sim-${crypto.randomUUID()}`,
      tenant_id: state.tenantId,
      company_id: companyToken,
      name: `Simulação MCP ${suggestedProjectToken}`,
      hypothesis: null,
      status: 'idea_simulation',
      active_scenario: 'realistic',
      planned_start_date: plannedStartDate,
      planned_end_date: plannedEndDate,
      initial_investment: initialInvestment,
      monthly_fixed_cost_allocation: monthlyFixedCost,
      analytical_token: suggestedProjectToken,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const syntheticItems: ProjectForecastItem[] = [];
    for (let m = 0; m < durationMonths; m++) {
      const monthDate = addMonthsISO(plannedStartDate, m);
      const unitDirectCost = roundCurrency(monthlyRevenue * unitDirectCostRatio);
      const totals = computeForecastLineTotals({
        direction: 'revenue',
        quantity: 1,
        unitPrice: monthlyRevenue,
        unitDirectCost,
        paymentFeePct,
        taxRatePct,
      });

      syntheticItems.push({
        id: `mcp-item-${m}`,
        tenant_id: state.tenantId,
        project_id: syntheticProject.id,
        scenario: 'realistic',
        month_date: monthDate,
        product_service_id: matchedOffer?.offerToken ?? null,
        direction: 'revenue',
        label: matchedOffer ? `Projeção ${matchedOffer.offerToken}` : `Projeção ${suggestedProjectToken}`,
        quantity: 1,
        unit_price: monthlyRevenue,
        unit_direct_cost: unitDirectCost,
        payment_fee_pct: paymentFeePct,
        tax_rate_pct: taxRatePct,
        gross_amount: totals.grossAmount,
        estimated_direct_cost_total: totals.estimatedDirectCostTotal,
        estimated_deductions_total: totals.estimatedDeductionsTotal,
        notes: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    const companyCashBefore = ctx.accounts
      .filter((a) => a.companyToken === companyToken)
      .reduce((sum, a) => sum + a.currentBalance, 0);

    const feasibility = calculateProjectFeasibility({
      project: syntheticProject,
      forecastItems: syntheticItems,
      transactions: [],
      companyCashBeforeProject: roundCurrency(companyCashBefore),
      scenario: 'realistic',
      todayISO,
    });

    const draft: PendingSimulatedProjectDraft = {
      draftId: syntheticProject.id,
      tenantId: state.tenantId,
      companyToken,
      offerToken: matchedOffer?.offerToken ?? offerTokenRaw,
      suggestedProjectToken,
      status: 'idea_simulation',
      plannedStartDate,
      plannedEndDate,
      initialInvestment,
      monthlyFixedCostAllocation: monthlyFixedCost,
      monthlyRevenue,
      durationMonths,
      paymentFeePct,
      taxRatePct,
      unitDirectCostRatio,
      feasibility: {
        totalPlannedRevenue: feasibility.totalPlannedRevenue,
        totalPlannedDirectCostsAndTaxes: feasibility.totalPlannedDirectCostsAndTaxes,
        contributionMarginPct: feasibility.contributionMarginPct,
        netProjectResult: feasibility.netProjectResult,
        roiPct: feasibility.roiPct,
        paybackMonthIndex: feasibility.paybackMonthIndex,
        paybackExactMonths: feasibility.paybackExactMonths,
        breakEvenRevenue: feasibility.breakEvenRevenue,
        companyCashBeforeProject: feasibility.companyCashBeforeProject,
        minimumCompanyCashWithProject: feasibility.minimumCompanyCashWithProject,
        cashExposureAlert: feasibility.cashExposureAlert,
        cashExposureShortfall: feasibility.cashExposureShortfall,
        budgetHealth: feasibility.budgetHealth,
      },
      createdAt: new Date().toISOString(),
      consumedByClient: false,
    };

    state.pendingDrafts.push(draft);

    const payload = {
      privacyNotice: '100% Anonimizado via Cofre Vértice (Zero-Leak Verified)',
      savedAsDraft: true,
      draftStatus: 'idea_simulation',
      draftId: draft.draftId,
      projectToken: suggestedProjectToken,
      companyToken,
      offerToken: draft.offerToken,
      assumptions: {
        initialInvestment,
        monthlyRevenue,
        durationMonths,
        monthlyFixedCost,
        paymentFeePct,
        taxRatePct,
        unitDirectCostRatioPct: Math.round(unitDirectCostRatio * 1000) / 10,
      },
      diagnostic: draft.feasibility,
    };

    assertServerPayloadZeroLeak(payload);
    return {
      ok: true,
      payload,
      summary: `Simulação ${suggestedProjectToken} salva (ROI ${feasibility.roiPct ?? 'N/A'}% · Payback ${feasibility.paybackExactMonths ?? 'N/A'}m)`,
    };
  }

  return {
    ok: false,
    code: -32601,
    message: `Ferramenta MCP desconhecida: ${toolName}`,
  };
}

export function handleMcpJsonRpcPost(req: Request, res: Response): void {
  const auth = authenticateMcpBearer(req);
  if (!auth.ok) {
    res.status(auth.status).json({
      jsonrpc: '2.0',
      id: (req.body as { id?: unknown } | undefined)?.id ?? null,
      error: {
        code: -32001,
        message: auth.message,
      },
    });
    return;
  }

  const body = req.body as {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: Record<string, unknown>;
  };

  if (!body || typeof body.method !== 'string') {
    res.status(400).json({
      jsonrpc: '2.0',
      id: body?.id ?? null,
      error: { code: -32600, message: 'Requisição JSON-RPC 2.0 inválida.' },
    });
    return;
  }

  const rpcId = body.id ?? null;

  if (body.method === 'initialize') {
    res.json({
      jsonrpc: '2.0',
      id: rpcId,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: 'vertice-privacy-mcp',
          version: '1.0.0',
        },
      },
    });
    return;
  }

  if (body.method === 'notifications/initialized' || body.method === 'ping') {
    res.json({
      jsonrpc: '2.0',
      id: rpcId,
      result: {},
    });
    return;
  }

  if (body.method === 'tools/list') {
    const visibleTools = MCP_TOOLS_DEFINITIONS.map((tool) => ({
      ...tool,
      description:
        tool.name === 'simulate_new_project_idea' && auth.token.scope !== 'simulate_drafts'
          ? `${tool.description} [Bloqueado para este token: requer escopo simulate_drafts]`
          : tool.description,
    }));

    res.json({
      jsonrpc: '2.0',
      id: rpcId,
      result: {
        tools: visibleTools,
      },
    });
    return;
  }

  if (body.method === 'tools/call') {
    const params = body.params ?? {};
    const toolName = typeof params.name === 'string' ? params.name : '';
    const args =
      params.arguments && typeof params.arguments === 'object'
        ? (params.arguments as Record<string, unknown>)
        : {};

    try {
      const outcome = executeMcpTool(auth.state, auth.token, toolName, args);
      if (!outcome.ok) {
        recordMcpCall(auth.state, auth.token, {
          tool_name: toolName || 'unknown',
          scope_used: auth.token.scope,
          status: outcome.code === -32003 ? 'denied' : 'error',
          zero_leak_verified: true,
          sanitized_args: args,
          response_summary: outcome.message,
        });

        res.status(outcome.code === -32003 ? 403 : 400).json({
          jsonrpc: '2.0',
          id: rpcId,
          error: {
            code: outcome.code,
            message: outcome.message,
          },
        });
        return;
      }

      recordMcpCall(auth.state, auth.token, {
        tool_name: toolName,
        scope_used: auth.token.scope,
        status: 'success',
        zero_leak_verified: true,
        sanitized_args: args,
        response_summary: outcome.summary,
      });

      res.json({
        jsonrpc: '2.0',
        id: rpcId,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(outcome.payload, null, 2),
            },
          ],
          structuredContent: outcome.payload,
          isError: false,
        },
      });
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro interno ao executar tool MCP.';
      recordMcpCall(auth.state, auth.token, {
        tool_name: toolName || 'unknown',
        scope_used: auth.token.scope,
        status: 'error',
        zero_leak_verified: true,
        sanitized_args: args,
        response_summary: message,
      });

      res.status(400).json({
        jsonrpc: '2.0',
        id: rpcId,
        error: {
          code: -32002,
          message,
        },
      });
      return;
    }
  }

  res.status(404).json({
    jsonrpc: '2.0',
    id: rpcId,
    error: {
      code: -32601,
      message: `Método JSON-RPC não suportado: ${body.method}`,
    },
  });
}

export function handleMcpSseGet(req: Request, res: Response): void {
  const auth = authenticateMcpBearer(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.message });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const endpointPayload = JSON.stringify({
    server: 'vertice-privacy-mcp',
    version: '1.0.0',
    scope: auth.token.scope,
    tools: MCP_TOOLS_DEFINITIONS.map((t) => t.name),
  });

  res.write(`event: ready\ndata: ${endpointPayload}\n\n`);

  const keepAlive = setInterval(() => {
    res.write(': ping\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    res.end();
  });
}
