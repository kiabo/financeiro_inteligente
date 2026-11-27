import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Eye,
  Lock,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { StatusChip } from '../../components/ui/status-chip';
import { cn, formatCurrencyBRL, formatDateTimeBR } from '../../lib/utils';
import { InfoTooltip } from '../core/components/InfoTooltip';
import { updateAiInsightStatus } from '../core/repository';
import type {
  ActiveContext,
  AiInsight,
  AiInsightCategory,
  AiInsightSeverity,
  AiInsightStatus,
  AppSection,
  AuthSessionState,
  CfoChatMessage,
} from '../core/types';
import {
  buildAnonymizedCfoContext,
  collectAllSensitiveTerms,
  rehydrateAiInsightForDisplay,
  sanitizeUserQuestionForAI,
} from './aiContextBuilder';
import {
  askCfoPrivateChat,
  fetchAiProviderStatus,
  runCfoStrategicAnalysis,
  type AiProviderStatus,
  type WorkspaceCfoSource,
} from './cfoAgent';
import { PrivacyInspectorModal } from './PrivacyInspectorModal';

interface AiCfoViewProps {
  session: AuthSessionState;
  workspace: WorkspaceCfoSource;
  aiInsights: AiInsight[];
  activeContext: ActiveContext;
  onRefresh: () => Promise<void>;
  onNavigate: (section: AppSection) => void;
  autoCadence: 'manual' | 'daily_open';
  onChangeAutoCadence: (cadence: 'manual' | 'daily_open') => void;
}

const CATEGORY_LABELS: Record<AiInsightCategory, string> = {
  margin_drop: 'Queda de Margem',
  budget_deviation: 'Desvio de Orçamento',
  cash_risk_45d: 'Risco de Caixa (45d)',
  capital_reallocation: 'Realocação de Capital',
  debt_optimization: 'Otimização de Dívida',
  tax_alert: 'Alerta Tributário',
  project_viability: 'Viabilidade de Projeto',
};

const SEVERITY_META: Record<
  AiInsightSeverity,
  { label: string; variant: 'alert' | 'neutral' | 'positive' | 'primary' }
> = {
  critical: { label: 'Crítico', variant: 'alert' },
  warning: { label: 'Atenção', variant: 'neutral' },
  opportunity: { label: 'Oportunidade', variant: 'positive' },
  info: { label: 'Informativo', variant: 'primary' },
};

const QUICK_PROMPTS = [
  'Qual produto ou serviço mais drena caixa hoje e como corrigir a margem?',
  'Há risco de caixa nos próximos 45 dias considerando dívidas e impostos?',
  'Quais projetos têm desvio de orçamento e onde realocar capital?',
];

export const AiCfoView: React.FC<AiCfoViewProps> = ({
  session,
  workspace,
  aiInsights,
  activeContext,
  onRefresh,
  onNavigate,
  autoCadence,
  onChangeAutoCadence,
}) => {
  const [providerStatus, setProviderStatus] = useState<AiProviderStatus | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | AiInsightStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | AiInsightCategory>('all');
  const [regime, setRegime] = useState<'cash' | 'competence'>('cash');

  // Privacy Inspector Modal State
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorPayload, setInspectorPayload] = useState<unknown>(null);
  const [inspectorTitle, setInspectorTitle] = useState<string>(
    'Auditoria de Privacidade (Dados Enviados à IA)'
  );

  // Private Chat State
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<CfoChatMessage[]>([]);

  useEffect(() => {
    void fetchAiProviderStatus().then(setProviderStatus);
  }, []);

  const sensitiveTerms = useMemo(
    () =>
      collectAllSensitiveTerms({
        groups: workspace.groups,
        companies: workspace.companies,
        accounts: workspace.accounts,
        productsServices: workspace.productsServices,
        projects: workspace.projects,
        transactions: workspace.transactions,
        debts: workspace.debts,
        taxObligations: workspace.taxObligations,
        vault: workspace.vault,
      }),
    [workspace]
  );

  const liveAnonymized = useMemo(() => {
    if (workspace.companies.length === 0) return null;
    try {
      return buildAnonymizedCfoContext({
        ...workspace,
        activeContext,
        regime,
      });
    } catch {
      return null;
    }
  }, [workspace, activeContext, regime]);

  const liveQuestionPreview = useMemo(() => {
    if (!chatInput.trim()) return null;
    try {
      return sanitizeUserQuestionForAI(chatInput, workspace.vault, sensitiveTerms);
    } catch {
      return null;
    }
  }, [chatInput, workspace.vault, sensitiveTerms]);

  const contextLabel = useMemo(() => {
    if (activeContext.scope === 'group') {
      const g = workspace.groups.find((item) => item.id === activeContext.groupId);
      return g ? `Grupo · ${g.name} (${g.analytical_token})` : 'Grupo Consolidado';
    }
    if (activeContext.scope === 'company') {
      const c = workspace.companies.find((item) => item.id === activeContext.companyId);
      return c
        ? `Empresa · ${c.trade_name ?? c.legal_name} (${c.analytical_token})`
        : 'Empresa Isolada';
    }
    if (activeContext.scope === 'account') {
      const a = workspace.accounts.find((item) => item.id === activeContext.accountId);
      return a ? `Conta · ${a.name} (${a.analytical_token})` : 'Conta Isolada';
    }
    return 'Visão Global Independente';
  }, [activeContext, workspace.groups, workspace.companies, workspace.accounts]);

  const filteredInsights = useMemo(() => {
    return aiInsights.filter((ins) => {
      if (statusFilter !== 'all' && ins.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && ins.category !== categoryFilter) return false;
      return true;
    });
  }, [aiInsights, statusFilter, categoryFilter]);

  const activeNewCount = useMemo(
    () => aiInsights.filter((i) => i.status === 'new').length,
    [aiInsights]
  );

  const estimatedActiveImpact = useMemo(
    () =>
      aiInsights
        .filter((i) => i.status !== 'dismissed')
        .reduce((sum, i) => sum + (Number(i.estimated_financial_impact) || 0), 0),
    [aiInsights]
  );

  const handleGenerateAnalysis = async () => {
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      await runCfoStrategicAnalysis({
        tenantId: session.userId,
        userEmail: session.email,
        workspace,
        activeContext,
        regime,
      });
      await onRefresh();
    } catch (err) {
      setAnalysisError(
        err instanceof Error ? err.message : 'Erro ao executar análise estratégica do CFO Virtual.'
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const handleUpdateStatus = async (insightId: string, status: AiInsightStatus) => {
    await updateAiInsightStatus(session.userId, session.email, insightId, status);
    await onRefresh();
  };

  const handleOpenInspector = (payload: unknown, title?: string) => {
    setInspectorPayload(payload);
    setInspectorTitle(title ?? 'Auditoria de Privacidade (Dados Enviados à IA)');
    setInspectorOpen(true);
  };

  const handleSendChat = async (questionOverride?: string) => {
    const rawQ = (questionOverride ?? chatInput).trim();
    if (!rawQ || chatSending) return;

    setChatError(null);
    setChatSending(true);

    try {
      const historyForApi = chatMessages.slice(-6).map((m) => ({
        role: m.role,
        contentTokenized: m.contentTokenized,
      }));

      const result = await askCfoPrivateChat({
        question: rawQ,
        history: historyForApi,
        workspace,
        activeContext,
        isAuthenticatedClient: session.mfaVerified,
      });

      const now = new Date().toISOString();
      const userMsg: CfoChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        contentTokenized: result.sanitizedQuestion,
        contentRehydrated: rawQ,
        sanitizedPromptPreview: result.sanitizedQuestion,
        createdAt: now,
      };
      const assistantMsg: CfoChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        contentTokenized: result.answerTokenized,
        contentRehydrated: result.answerRehydrated,
        referencedTokens: result.referencedTokens,
        createdAt: now,
      };

      setChatMessages((prev) => [...prev, userMsg, assistantMsg]);
      if (!questionOverride) setChatInput('');
    } catch (err) {
      setChatError(
        err instanceof Error ? err.message : 'Falha na consulta ao CFO Virtual.'
      );
    } finally {
      setChatSending(false);
    }
  };

  if (workspace.companies.length === 0) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
            CFO Virtual (IA)
          </span>
          <h1 className="font-display text-[24px] font-semibold leading-8 tracking-[-0.02em] text-[#0F172A] dark:text-[#EAF1FF]">
            CFO Virtual &amp; Diagnóstico Estratégico
          </h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Nenhuma empresa cadastrada no escopo</CardTitle>
            <CardDescription>
              Cadastre ao menos uma empresa e conta financeira (ou carregue a estrutura Sandbox na
              Visão Geral) para ativar o CFO Virtual com barreira Zero-Leak.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button variant="primary" onClick={() => onNavigate('overview')}>
              Voltar para Visão Geral
            </Button>
            <Button variant="outline" onClick={() => onNavigate('hierarchy')}>
              Ir para Empresas &amp; Contas
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho & Ações Principais */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
              CFO Virtual (IA)
            </span>
            <StatusChip variant="primary">{contextLabel}</StatusChip>
            {providerStatus && (
              <StatusChip variant={providerStatus.configured ? 'positive' : 'neutral'}>
                {providerStatus.provider.toUpperCase()} · {providerStatus.model}
              </StatusChip>
            )}
          </div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-[24px] font-semibold leading-8 tracking-[-0.02em] text-[#0F172A] dark:text-[#EAF1FF]">
              CFO Virtual Proativo (Zero-Leak)
            </h1>
            <InfoTooltip glossaryKey="cfo_virtual" />
          </div>
          <p className="text-[14px] leading-5 text-[#42484C] dark:text-[#9DB0C2]">
            Recomendações acionáveis e chat analítico processados exclusivamente com tokens do
            Cofre e séries agregadas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={regime}
            onValueChange={(v) => setRegime(v as 'cash' | 'competence')}
          >
            <SelectTrigger className="h-9 w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Regime Caixa</SelectItem>
              <SelectItem value="competence">Competência</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={autoCadence}
            onValueChange={(v) => onChangeAutoCadence(v as 'manual' | 'daily_open')}
          >
            <SelectTrigger className="h-9 w-[185px]" aria-label="Frequência de análise">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Geração sob demanda</SelectItem>
              <SelectItem value="daily_open">Agendada (1x ao dia)</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            disabled={!liveAnonymized}
            onClick={() =>
              liveAnonymized &&
              handleOpenInspector(
                liveAnonymized.context,
                'Auditoria de Privacidade (Payload Atual Anonimizado)'
              )
            }
          >
            <Eye className="h-4 w-4" />
            <span>Auditoria de Privacidade</span>
          </Button>

          <Button
            variant="primary"
            disabled={analyzing || !liveAnonymized}
            onClick={() => void handleGenerateAnalysis()}
          >
            <RefreshCw className={cn('h-4 w-4', analyzing && 'animate-spin')} />
            <span>{analyzing ? 'Analisando...' : 'Gerar Nova Análise Estratégica'}</span>
          </Button>
        </div>
      </div>

      {/* Aviso de provedor de IA não configurado no ambiente */}
      {providerStatus && !providerStatus.configured && (
        <div className="flex flex-col gap-2 rounded-[8px] border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-[13px] text-[#92400E] dark:border-[#78350F] dark:bg-[#451A03]/40 dark:text-[#FCD34D]">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span>Chave de IA não configurada no ambiente do servidor</span>
          </div>
          <p className="text-[12px] opacity-90">
            Defina <span className="font-mono">GEMINI_API_KEY</span> (ou{' '}
            <span className="font-mono">AI_PROVIDER=openai</span> com{' '}
            <span className="font-mono">OPENAI_API_KEY</span>) nas variáveis de ambiente do
            servidor para habilitar a geração de recomendações e o chat do CFO Virtual. O Inspetor
            de Privacidade e o Servidor MCP permanecem 100% operacionais.
          </p>
        </div>
      )}

      {analysisError && (
        <div className="flex items-start gap-2.5 rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#991B1B] dark:border-[#7F1D1D] dark:bg-[#3B1219] dark:text-[#FCA5A5]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Não foi possível concluir a análise estratégica</p>
            <p className="text-[12px] opacity-90">{analysisError}</p>
          </div>
        </div>
      )}

      {/* 4 KPIs Executivos da Camada Zero-Leak */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
              Diagnósticos Novos
            </span>
            <p className="mt-1.5 font-display text-[26px] font-semibold tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
              {activeNewCount}
            </p>
            <p className="mt-1 text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
              {aiInsights.length} recomendações no histórico
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
              Impacto Financeiro Mapeado
            </span>
            <p className="mt-1.5 font-display text-[26px] font-semibold tabular-nums text-[#059669] dark:text-[#68DBA9]">
              {formatCurrencyBRL(estimatedActiveImpact)}
            </p>
            <p className="mt-1 text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
              Soma estimada das ações ativas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
              Projeção Caixa (45 Dias)
            </span>
            <p
              className={cn(
                'mt-1.5 font-display text-[26px] font-semibold tabular-nums',
                (liveAnonymized?.context.cashRisk45d.projectedCash45d ?? 0) >= 0
                  ? 'text-[#0F172A] dark:text-[#EAF1FF]'
                  : 'text-[#DC2626] dark:text-[#FCA5A5]'
              )}
            >
              {liveAnonymized
                ? formatCurrencyBRL(liveAnonymized.context.cashRisk45d.projectedCash45d)
                : '—'}
            </p>
            <p className="mt-1 text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
              {liveAnonymized?.context.cashRisk45d.hasCashRisk45d
                ? `Risco ${liveAnonymized.context.cashRisk45d.riskSeverity === 'critical' ? 'crítico' : 'moderado'} detectado`
                : 'Folga de caixa projetada em 45d'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
                Barreira Zero-Leak
              </span>
              <ShieldCheck className="h-4 w-4 text-[#059669] dark:text-[#68DBA9]" />
            </div>
            <p className="mt-1.5 font-display text-[20px] font-semibold text-[#0F172A] dark:text-[#EAF1FF]">
              100% Anonimizado
            </p>
            <p className="mt-1 text-[12px] tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
              {liveAnonymized
                ? `${liveAnonymized.tokensDetected.length} tokens isolados · 0 CNPJs expostos`
                : 'Aguardando dados'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Área Principal: Recomendações (2 cols) + Chat Privado (1 col) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Lista de Recomendações */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="border-b border-[#E2E8F0] dark:border-[#1E2F3F]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Diagnósticos &amp; Recomendações Acionáveis</CardTitle>
                  <CardDescription>
                    Tokens são re-hidratados localmente apenas na sua sessão autenticada.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={statusFilter}
                    onValueChange={(v) => setStatusFilter(v as 'all' | AiInsightStatus)}
                  >
                    <SelectTrigger className="h-8 w-[145px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os status</SelectItem>
                      <SelectItem value="new">Novas</SelectItem>
                      <SelectItem value="acknowledged">Reconhecidas</SelectItem>
                      <SelectItem value="dismissed">Dispensadas</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select
                    value={categoryFilter}
                    onValueChange={(v) => setCategoryFilter(v as 'all' | AiInsightCategory)}
                  >
                    <SelectTrigger className="h-8 w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas categorias</SelectItem>
                      {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                        <SelectItem key={k} value={k}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>

            <CardContent className="divide-y divide-[#E2E8F0] p-0 dark:divide-[#1E2F3F]">
              {filteredInsights.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-[14px] font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                    Nenhuma recomendação neste filtro
                  </p>
                  <p className="mt-1 text-[13px] text-[#72787D]">
                    Clique em &ldquo;Gerar Nova Análise Estratégica&rdquo; para avaliar margens,
                    desvios de projetos, risco de caixa em 45 dias e oportunidades de capital.
                  </p>
                </div>
              ) : (
                filteredInsights.map((ins) => {
                  const rehydrated = rehydrateAiInsightForDisplay(
                    ins,
                    workspace.vault,
                    session.mfaVerified
                  );
                  const sev = SEVERITY_META[ins.severity] ?? SEVERITY_META.info;

                  return (
                    <div key={ins.id} className="space-y-3 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusChip variant={sev.variant}>{sev.label}</StatusChip>
                            <StatusChip variant="neutral">
                              {CATEGORY_LABELS[ins.category] ?? ins.category}
                            </StatusChip>
                            {ins.status === 'acknowledged' && (
                              <StatusChip variant="positive">Reconhecida</StatusChip>
                            )}
                            {ins.status === 'dismissed' && (
                              <StatusChip variant="neutral">Dispensada</StatusChip>
                            )}
                          </div>
                          <h3 className="font-display text-[16px] font-semibold text-[#0F172A] dark:text-[#EAF1FF]">
                            {rehydrated.title}
                          </h3>
                        </div>

                        <div className="text-right tabular-nums">
                          <span className="block text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
                            Impacto Estimado ({ins.impact_horizon_days}d)
                          </span>
                          <span className="font-display text-[17px] font-semibold text-[#059669] dark:text-[#68DBA9]">
                            {formatCurrencyBRL(ins.estimated_financial_impact)}
                          </span>
                        </div>
                      </div>

                      <p className="text-[13px] leading-relaxed text-[#334155] dark:text-[#B9CADB]">
                        {rehydrated.summary}
                      </p>

                      <div className="rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] px-3.5 py-2.5 text-[13px] text-[#0F172A] dark:border-[#1E2F3F] dark:bg-[#08131D] dark:text-[#EAF1FF]">
                        <span className="font-semibold">Ação recomendada: </span>
                        {rehydrated.recommendation}
                      </div>

                      <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#72787D] tabular-nums">
                          <span>Confiança {ins.confidence_pct}%</span>
                          <span>·</span>
                          <span>{formatDateTimeBR(ins.created_at)}</span>
                          {rehydrated.relatedLabels.length > 0 && (
                            <>
                              <span>·</span>
                              <span className="font-medium text-[#334155] dark:text-[#B9CADB]">
                                {rehydrated.relatedLabels
                                  .map((r) =>
                                    r.label !== r.token ? `${r.label} (${r.token})` : r.token
                                  )
                                  .join(', ')}
                              </span>
                            </>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              handleOpenInspector(
                                ins.sanitized_context_snapshot,
                                `Payload Anonimizado · Análise ${formatDateTimeBR(ins.created_at)}`
                              )
                            }
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>Ver JSON Anonimizado</span>
                          </Button>

                          {ins.status === 'new' && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handleUpdateStatus(ins.id, 'acknowledged')}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 text-[#059669]" />
                                <span>Reconhecer</span>
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void handleUpdateStatus(ins.id, 'dismissed')}
                              >
                                <X className="h-3.5 w-3.5" />
                                <span>Dispensar</span>
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>

        {/* Chat Analítico Privado */}
        <div className="space-y-4">
          <Card className="flex flex-col">
            <CardHeader className="border-b border-[#E2E8F0] dark:border-[#1E2F3F]">
              <div className="flex items-center justify-between gap-2">
                <CardTitle>Pergunte ao seu CFO</CardTitle>
                <InfoTooltip glossaryKey="zero_leak_barreira" />
              </div>
              <CardDescription>
                Nomes digitados são substituídos automaticamente por tokens antes de sair do
                navegador.
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-1 flex-col gap-4 p-4">
              {/* Sugestões Rápidas */}
              <div className="flex flex-col gap-1.5">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={chatSending}
                    onClick={() => void handleSendChat(prompt)}
                    className="flex items-center justify-between gap-2 rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-left text-[12px] text-[#334155] transition-colors hover:bg-[#F1F5F9] hover:text-[#0F172A] disabled:opacity-50 dark:border-[#1E2F3F] dark:bg-[#08131D] dark:text-[#B9CADB] dark:hover:bg-[#162838] cursor-pointer"
                  >
                    <span className="line-clamp-2">{prompt}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#72787D]" />
                  </button>
                ))}
              </div>

              {/* Histórico de Mensagens */}
              <div className="max-h-[380px] min-h-[200px] flex-1 space-y-3 overflow-y-auto rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] p-3 dark:border-[#1E2F3F] dark:bg-[#08131D]">
                {chatMessages.length === 0 ? (
                  <div className="flex h-full min-h-[160px] flex-col items-center justify-center text-center text-[12px] text-[#72787D]">
                    <Lock className="mb-2 h-5 w-5 opacity-60" />
                    <p>Faça uma pergunta sobre margens, caixa em 45 dias, dívidas ou projetos.</p>
                  </div>
                ) : (
                  chatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        'rounded-[6px] border px-3 py-2.5 text-[13px]',
                        msg.role === 'user'
                          ? 'ml-4 border-[#CBD5E1] bg-white text-[#0F172A] dark:border-[#2A3B4C] dark:bg-[#0D1A26] dark:text-[#EAF1FF]'
                          : 'mr-2 border-[#C2C7CC] bg-[#EFF4FF]/60 text-[#0F172A] dark:border-[#264B5F] dark:bg-[#0F374A]/30 dark:text-[#EAF1FF]'
                      )}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
                        <span>{msg.role === 'user' ? 'Você (Autenticado)' : 'CFO Virtual'}</span>
                        <span>
                          {msg.role === 'user' ? 'Sanitizado na saída' : 'Re-hidratado local'}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.contentRehydrated}</p>
                      {msg.role === 'user' &&
                        msg.sanitizedPromptPreview &&
                        msg.sanitizedPromptPreview !== msg.contentRehydrated && (
                          <p className="mt-1.5 rounded-[4px] bg-[#002130] px-2 py-1 font-mono text-[10.5px] text-[#85F8C4]">
                            Enviado à IA: {msg.sanitizedPromptPreview}
                          </p>
                        )}
                    </div>
                  ))
                )}
              </div>

              {chatError && (
                <div className="rounded-[4px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#991B1B] dark:border-[#7F1D1D] dark:bg-[#3B1219] dark:text-[#FCA5A5]">
                  {chatError}
                </div>
              )}

              {/* Preview em tempo real da sanitização da pergunta */}
              {liveQuestionPreview && liveQuestionPreview.sanitizedQuestion !== chatInput && (
                <div className="rounded-[4px] border border-[#A7F3D0] bg-[#ECFDF5] px-2.5 py-1.5 text-[11px] text-[#065F46] dark:border-[#005137] dark:bg-[#003C28]/60 dark:text-[#68DBA9]">
                  <span className="font-semibold">Prévia Zero-Leak antes do envio: </span>
                  <span className="font-mono">{liveQuestionPreview.sanitizedQuestion}</span>
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSendChat();
                }}
                className="flex items-center gap-2"
              >
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ex.: Como melhorar a margem da empresa..."
                  disabled={chatSending}
                />
                <Button type="submit" variant="primary" size="icon" disabled={chatSending || !chatInput.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="text-[13px] font-semibold text-[#0F172A] dark:text-[#EAF1FF]">
                  Conectar Assistente via MCP
                </p>
                <p className="text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
                  Gere chaves Bearer e simule projetos com privacidade total.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => onNavigate('mcp_settings')}>
                <span>Abrir MCP</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <PrivacyInspectorModal
        open={inspectorOpen}
        onOpenChange={setInspectorOpen}
        payload={inspectorPayload}
        vault={workspace.vault}
        sensitiveTerms={sensitiveTerms}
        title={inspectorTitle}
      />
    </div>
  );
};
