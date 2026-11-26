import type {
  ActiveContext,
  AiInsight,
  AiInsightCategory,
  AiInsightSeverity,
  BusinessGroup,
  Category,
  Company,
  Debt,
  DebtInstallment,
  FinancialAccount,
  McpAccessToken,
  McpCallLog,
  ProductService,
  Project,
  ProjectForecastItem,
  TaxObligation,
  Transaction,
  VaultEntry,
} from '../core/types';
import {
  persistMcpServerUpdates,
  saveAiInsightsBatch,
  type CreateAiInsightInput,
  type PendingMcpDraftPayload,
} from '../core/repository';
import { rehydrateFromAI } from '../vault/anonymizer';
import {
  buildAnonymizedCfoContext,
  collectAllSensitiveTerms,
  sanitizeUserQuestionForAI,
  type AnonymizedFinancialContext,
} from './aiContextBuilder';

export interface WorkspaceCfoSource {
  groups: BusinessGroup[];
  companies: Company[];
  accounts: FinancialAccount[];
  categories: Category[];
  productsServices: ProductService[];
  projects: Project[];
  projectForecastItems: ProjectForecastItem[];
  transactions: Transaction[];
  debts: Debt[];
  debtInstallments: DebtInstallment[];
  taxObligations: TaxObligation[];
  vault: VaultEntry[];
}

export interface AiProviderStatus {
  provider: 'gemini' | 'openai';
  model: string;
  configured: boolean;
}

export async function fetchAiProviderStatus(): Promise<AiProviderStatus> {
  const res = await fetch('/api/cfo/status');
  if (!res.ok) {
    return { provider: 'gemini', model: 'gemini-4-hydrogen', configured: false };
  }
  return (await res.json()) as AiProviderStatus;
}

export async function runCfoStrategicAnalysis(params: {
  tenantId: string;
  userEmail: string;
  workspace: WorkspaceCfoSource;
  activeContext: ActiveContext;
  regime?: 'cash' | 'competence';
}): Promise<{
  createdInsights: AiInsight[];
  anonymizedContext: AnonymizedFinancialContext;
  provider: string;
  model: string;
}> {
  const built = buildAnonymizedCfoContext({
    ...params.workspace,
    activeContext: params.activeContext,
    regime: params.regime ?? 'cash',
  });

  const response = await fetch('/api/cfo/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      anonymizedContext: built.context,
    }),
  });

  const data = (await response.json()) as {
    error?: string;
    provider?: string;
    model?: string;
    insights?: Array<{
      category: AiInsightCategory;
      severity: AiInsightSeverity;
      title_tokenized: string;
      summary_tokenized: string;
      recommendation_tokenized: string;
      related_tokens: string[];
      estimated_financial_impact: number;
      impact_horizon_days: number;
      confidence_pct: number;
    }>;
  };

  if (!response.ok) {
    throw new Error(data.error ?? 'Falha ao executar análise estratégica do CFO Virtual.');
  }

  const rawInsights = Array.isArray(data.insights) ? data.insights : [];
  if (rawInsights.length === 0) {
    throw new Error('O modelo de IA não retornou recomendações estruturadas.');
  }

  const providerUsed = data.provider ?? 'gemini';
  const modelUsed = data.model ?? 'gemini-4-hydrogen';

  const toSave: CreateAiInsightInput[] = rawInsights.map((ins) => ({
    scope_type: built.context.scopeType,
    scope_token: built.context.scopeToken,
    category: ins.category,
    severity: ins.severity,
    title_tokenized: ins.title_tokenized,
    summary_tokenized: ins.summary_tokenized,
    recommendation_tokenized: ins.recommendation_tokenized,
    related_tokens: Array.isArray(ins.related_tokens) ? ins.related_tokens : [],
    estimated_financial_impact: Number(ins.estimated_financial_impact ?? 0),
    impact_horizon_days: Math.max(1, Math.round(Number(ins.impact_horizon_days ?? 45))),
    confidence_pct: Math.min(100, Math.max(0, Number(ins.confidence_pct ?? 85))),
    provider_used: providerUsed,
    model_used: modelUsed,
    sanitized_context_snapshot: built.context as unknown as Record<string, unknown>,
  }));

  const createdInsights = await saveAiInsightsBatch(params.tenantId, params.userEmail, toSave);

  return {
    createdInsights,
    anonymizedContext: built.context,
    provider: providerUsed,
    model: modelUsed,
  };
}

export async function askCfoPrivateChat(params: {
  question: string;
  history: Array<{ role: 'user' | 'assistant'; contentTokenized: string }>;
  workspace: WorkspaceCfoSource;
  activeContext: ActiveContext;
  isAuthenticatedClient: boolean;
}): Promise<{
  sanitizedQuestion: string;
  answerTokenized: string;
  answerRehydrated: string;
  referencedTokens: string[];
  suggestedFollowupRehydrated: string;
  anonymizedContext: AnonymizedFinancialContext;
}> {
  if (!params.isAuthenticatedClient) {
    throw new Error('Sessão não autenticada para consulta ao CFO Virtual.');
  }

  const extraTerms = collectAllSensitiveTerms(params.workspace);
  const { sanitizedQuestion } = sanitizeUserQuestionForAI(
    params.question,
    params.workspace.vault,
    extraTerms
  );

  const built = buildAnonymizedCfoContext({
    ...params.workspace,
    activeContext: params.activeContext,
    regime: 'cash',
  });

  const response = await fetch('/api/cfo/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: sanitizedQuestion,
      history: params.history.map((h) => ({
        role: h.role,
        content: h.contentTokenized,
      })),
      anonymizedContext: built.context,
    }),
  });

  const data = (await response.json()) as {
    error?: string;
    answer_tokenized?: string;
    referenced_tokens?: string[];
    suggested_followup?: string;
  };

  if (!response.ok) {
    throw new Error(data.error ?? 'Erro ao consultar o CFO Virtual.');
  }

  const answerTokenized = data.answer_tokenized ?? 'Sem resposta.';
  const suggestedFollowupTokenized = data.suggested_followup ?? '';

  const restored = rehydrateFromAI(
    {
      answer: answerTokenized,
      followup: suggestedFollowupTokenized,
    },
    params.workspace.vault,
    { isAuthenticatedClient: true, includeFormattedCnpj: false }
  );

  return {
    sanitizedQuestion,
    answerTokenized,
    answerRehydrated: restored.answer,
    referencedTokens: Array.isArray(data.referenced_tokens) ? data.referenced_tokens : [],
    suggestedFollowupRehydrated: restored.followup,
    anonymizedContext: built.context,
  };
}

export async function syncMcpContextBridge(params: {
  tenantId: string;
  workspace: WorkspaceCfoSource;
  activeContext: ActiveContext;
  tokens: McpAccessToken[];
}): Promise<{ syncedTokens: number; pendingDraftsCount: number }> {
  const built = buildAnonymizedCfoContext({
    ...params.workspace,
    activeContext: params.activeContext,
    regime: 'cash',
  });

  const res = await fetch('/api/mcp/bridge/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId: params.tenantId,
      anonymizedContext: built.context,
      tokens: params.tokens,
    }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? 'Erro ao sincronizar contexto anonimizado com Servidor MCP.');
  }

  return (await res.json()) as { syncedTokens: number; pendingDraftsCount: number };
}

export async function pullAndPersistMcpUpdates(params: {
  tenantId: string;
  userEmail: string;
  companies: Company[];
  productsServices: ProductService[];
}): Promise<number> {
  const res = await fetch(
    `/api/mcp/bridge/updates?tenantId=${encodeURIComponent(params.tenantId)}`
  );
  if (!res.ok) return 0;

  const data = (await res.json()) as {
    callLogs?: McpCallLog[];
    tokenStats?: Array<{ id: string; call_count: number; last_used_at: string | null }>;
    pendingDrafts?: PendingMcpDraftPayload[];
  };

  return persistMcpServerUpdates({
    tenantId: params.tenantId,
    userEmail: params.userEmail,
    companies: params.companies,
    productsServices: params.productsServices,
    callLogs: data.callLogs ?? [],
    tokenStats: data.tokenStats ?? [],
    pendingDrafts: data.pendingDrafts ?? [],
  });
}
