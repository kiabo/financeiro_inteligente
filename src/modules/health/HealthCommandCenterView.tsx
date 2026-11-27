import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Eye,
  FolderKanban,
  Gauge,
  Landmark,
  Package,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input, Label } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { StatusChip } from '../../components/ui/status-chip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { addMonthsISO, cn, formatCurrencyBRL, formatDateBR, getTodayISO } from '../../lib/utils';
import { InfoTooltip } from '../core/components/InfoTooltip';
import {
  buildAnonymizedCfoContext,
  collectAllSensitiveTerms,
  PrivacyInspectorModal,
  rehydrateAiInsightForDisplay,
  runCfoStrategicAnalysis,
} from '../ai-cfo';
import { updateAiInsightStatus } from '../core/repository';
import type {
  AccountingRegime,
  ActiveContext,
  AiInsight,
  AppSection,
  AuthSessionState,
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
} from '../core/types';
import {
  computeFinancialHealthDiagnostics,
  resolveComparisonPeriods,
  type HealthClassification,
  type PeriodComparisonPreset,
  type ProfitabilityClassification,
} from './healthEngine';

interface HealthCommandCenterViewProps {
  session?: AuthSessionState;
  groups: BusinessGroup[];
  companies: Company[];
  accounts: FinancialAccount[];
  categories: Category[];
  productsServices: ProductService[];
  projects: Project[];
  projectForecastItems?: ProjectForecastItem[];
  transactions: Transaction[];
  debts: Debt[];
  debtInstallments: DebtInstallment[];
  taxObligations: TaxObligation[];
  vault?: VaultEntry[];
  aiInsights?: AiInsight[];
  activeContext: ActiveContext;
  onNavigate: (section: AppSection) => void;
  onRefresh?: () => Promise<void>;
}

type WinnerFilter = 'all' | 'cash_generator' | 'cash_drain';

const HEALTH_CLASSIFICATION_META: Record<
  HealthClassification,
  { label: string; variant: 'positive' | 'primary' | 'neutral' | 'alert'; barColor: string }
> = {
  excellent: {
    label: 'Excelente',
    variant: 'positive',
    barColor: 'bg-[#059669] dark:bg-[#68DBA9]',
  },
  healthy: {
    label: 'Saudável',
    variant: 'positive',
    barColor: 'bg-[#0F374A] dark:bg-[#38BDF8]',
  },
  attention: {
    label: 'Atenção',
    variant: 'neutral',
    barColor: 'bg-[#D97706] dark:bg-[#FBBF24]',
  },
  critical: {
    label: 'Crítico',
    variant: 'alert',
    barColor: 'bg-[#DC2626] dark:bg-[#FCA5A5]',
  },
};

function renderClassificationChip(c: ProfitabilityClassification): React.JSX.Element {
  if (c === 'cash_generator') {
    return (
      <StatusChip variant="positive">
        <TrendingUp className="h-3 w-3" />
        <span>Gerador de Caixa</span>
      </StatusChip>
    );
  }
  if (c === 'cash_drain') {
    return (
      <StatusChip variant="alert">
        <TrendingDown className="h-3 w-3" />
        <span>Dreno de Caixa</span>
      </StatusChip>
    );
  }
  return <StatusChip variant="neutral">Neutro</StatusChip>;
}

function formatPPDelta(delta: number | null): string {
  if (delta === null) return 'Sem base';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1).replace('.', ',')} p.p.`;
}

export const HealthCommandCenterView: React.FC<HealthCommandCenterViewProps> = ({
  session,
  groups,
  companies,
  accounts,
  categories,
  productsServices,
  projects,
  projectForecastItems = [],
  transactions,
  debts,
  debtInstallments,
  taxObligations,
  vault = [],
  aiInsights = [],
  activeContext,
  onNavigate,
  onRefresh,
}) => {
  const todayISO = getTodayISO();
  const [regime, setRegime] = useState<AccountingRegime>('cash');
  const [preset, setPreset] = useState<PeriodComparisonPreset>('month_mom');
  const [referenceMonth, setReferenceMonth] = useState<string>(todayISO.slice(0, 7));
  const [customStart, setCustomStart] = useState<string>(
    addMonthsISO(`${todayISO.slice(0, 7)}-01`, -1)
  );
  const [customEnd, setCustomEnd] = useState<string>(todayISO);
  const [customCompareStart, setCustomCompareStart] = useState<string>('');
  const [customCompareEnd, setCustomCompareEnd] = useState<string>('');

  const [targetMarginPct, setTargetMarginPct] = useState<number>(15);
  const [winnerFilter, setWinnerFilter] = useState<WinnerFilter>('all');
  const [generatingCfo, setGeneratingCfo] = useState(false);
  const [cfoError, setCfoError] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const resolvedPeriods = useMemo(
    () =>
      resolveComparisonPeriods({
        preset,
        referenceMonth,
        customStart,
        customEnd,
        customCompareStart: customCompareStart || undefined,
        customCompareEnd: customCompareEnd || undefined,
      }),
    [preset, referenceMonth, customStart, customEnd, customCompareStart, customCompareEnd]
  );

  const diagnostics = useMemo(
    () =>
      computeFinancialHealthDiagnostics({
        transactions,
        categories,
        companies,
        accounts,
        productsServices,
        projects,
        debts,
        debtInstallments,
        taxObligations,
        activeContext,
        regime,
        periods: resolvedPeriods,
        todayISO,
        targetMarginPct: Number.isFinite(targetMarginPct) ? targetMarginPct : 15,
      }),
    [
      transactions,
      categories,
      companies,
      accounts,
      productsServices,
      projects,
      debts,
      debtInstallments,
      taxObligations,
      activeContext,
      regime,
      resolvedPeriods,
      todayISO,
      targetMarginPct,
    ]
  );

  const contextLabel = useMemo(() => {
    if (activeContext.scope === 'group') {
      const g = groups.find((item) => item.id === activeContext.groupId);
      return g ? `Grupo Consolidado · ${g.name} (${g.analytical_token})` : 'Grupo Consolidado';
    }
    if (activeContext.scope === 'company') {
      const c = companies.find((item) => item.id === activeContext.companyId);
      return c
        ? `Empresa Isolada · ${c.trade_name ?? c.legal_name} (${c.analytical_token})`
        : 'Empresa Isolada';
    }
    if (activeContext.scope === 'account') {
      const a = accounts.find((item) => item.id === activeContext.accountId);
      return a ? `Conta Isolada · ${a.name} (${a.analytical_token})` : 'Conta Isolada';
    }
    return 'Visão Global Independente (Todas as Empresas)';
  }, [activeContext, groups, companies, accounts]);

  const healthMeta = HEALTH_CLASSIFICATION_META[diagnostics.classification];

  const filterRows = <T extends { classification: ProfitabilityClassification }>(rows: T[]): T[] => {
    if (winnerFilter === 'all') return rows;
    return rows.filter((r) => r.classification === winnerFilter);
  };

  const filteredProducts = useMemo(
    () => filterRows(diagnostics.rankings.products),
    [diagnostics.rankings.products, winnerFilter]
  );
  const filteredProjects = useMemo(
    () => filterRows(diagnostics.rankings.projects),
    [diagnostics.rankings.projects, winnerFilter]
  );
  const filteredCompanies = useMemo(
    () => filterRows(diagnostics.rankings.companies),
    [diagnostics.rankings.companies, winnerFilter]
  );

  // Escala do gráfico comparativo SVG (6 meses)
  const chartMaxVal = useMemo(() => {
    let maxVal = 1000;
    for (const pt of diagnostics.monthlyEvolution) {
      maxVal = Math.max(maxVal, pt.grossRevenue, pt.totalCostsAndExpenses, Math.abs(pt.netResult));
    }
    return maxVal * 1.12;
  }, [diagnostics.monthlyEvolution]);

  const hasAlerts =
    diagnostics.overdueTaxesCount > 0 ||
    diagnostics.upcomingTaxes7dCount > 0 ||
    diagnostics.overdueInstallmentsCount > 0;

  const sensitiveTerms = useMemo(
    () =>
      collectAllSensitiveTerms({
        groups,
        companies,
        accounts,
        productsServices,
        projects,
        transactions,
        debts,
        taxObligations,
        vault,
      }),
    [groups, companies, accounts, productsServices, projects, transactions, debts, taxObligations, vault]
  );

  const liveAnonymizedPayload = useMemo(() => {
    if (companies.length === 0) return null;
    try {
      return buildAnonymizedCfoContext({
        groups,
        companies,
        accounts,
        categories,
        productsServices,
        projects,
        projectForecastItems,
        transactions,
        debts,
        debtInstallments,
        taxObligations,
        vault,
        activeContext,
        regime,
      });
    } catch {
      return null;
    }
  }, [
    groups,
    companies,
    accounts,
    categories,
    productsServices,
    projects,
    projectForecastItems,
    transactions,
    debts,
    debtInstallments,
    taxObligations,
    vault,
    activeContext,
    regime,
  ]);

  const topActiveInsights = useMemo(
    () => aiInsights.filter((ins) => ins.status !== 'dismissed').slice(0, 3),
    [aiInsights]
  );

  const handleQuickAnalyzeCfo = async () => {
    if (!session) return;
    setGeneratingCfo(true);
    setCfoError(null);
    try {
      await runCfoStrategicAnalysis({
        tenantId: session.userId,
        userEmail: session.email,
        workspace: {
          groups,
          companies,
          accounts,
          categories,
          productsServices,
          projects,
          projectForecastItems,
          transactions,
          debts,
          debtInstallments,
          taxObligations,
          vault,
        },
        activeContext,
        regime,
      });
      if (onRefresh) await onRefresh();
    } catch (err) {
      setCfoError(
        err instanceof Error ? err.message : 'Erro ao executar análise do CFO Virtual.'
      );
    } finally {
      setGeneratingCfo(false);
    }
  };

  if (companies.length === 0) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
            Saúde Financeira
          </span>
          <h1 className="font-display text-[24px] font-semibold leading-8 tracking-[-0.02em] text-[#0F172A] dark:text-[#EAF1FF]">
            Command Center de Saúde Financeira
          </h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Nenhuma empresa cadastrada no escopo</CardTitle>
            <CardDescription>
              Cadastre uma empresa e conta financeira (ou carregue o exemplo Sandbox na Visão
              Geral) para ativar o Score de Saúde, Runway, DRE Gerencial e Ranking de
              Rentabilidade.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button variant="primary" onClick={() => onNavigate('hierarchy')}>
              Ir para Empresas &amp; Contas
            </Button>
            <Button variant="outline" onClick={() => onNavigate('overview')}>
              Voltar para Visão Geral
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho & Controles Comparativos */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
              Saúde Financeira
            </span>
            <StatusChip variant="primary">{contextLabel}</StatusChip>
          </div>
          <h1 className="font-display text-[24px] font-semibold leading-8 tracking-[-0.02em] text-[#0F172A] dark:text-[#EAF1FF]">
            Saúde Financeira &amp; Diagnóstico de Resultados
          </h1>
          <p className="text-[14px] leading-5 text-[#42484C] dark:text-[#9DB0C2]">
            Período analisado: <strong className="font-medium">{resolvedPeriods.current.label}</strong>{' '}
            vs. <strong className="font-medium">{resolvedPeriods.compare.label}</strong> ·
            Transferências internas 100% excluídas.
          </p>
        </div>

        {/* Controles: Regime + Preset + Navegador de Mês */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-[4px] border border-[#CBD5E1] bg-white p-0.5 dark:border-[#2A3B4C] dark:bg-[#0D1A26]">
            <button
              type="button"
              onClick={() => setRegime('cash')}
              className={cn(
                'rounded-[3px] px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer',
                regime === 'cash'
                  ? 'bg-[#0F374A] text-white'
                  : 'text-[#42484C] hover:text-[#0F172A] dark:text-[#9DB0C2] dark:hover:text-[#EAF1FF]'
              )}
            >
              Regime Caixa
            </button>
            <button
              type="button"
              onClick={() => setRegime('competence')}
              className={cn(
                'rounded-[3px] px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer',
                regime === 'competence'
                  ? 'bg-[#0F374A] text-white'
                  : 'text-[#42484C] hover:text-[#0F172A] dark:text-[#9DB0C2] dark:hover:text-[#EAF1FF]'
              )}
            >
              Competência
            </button>
          </div>

          <Select
            value={preset}
            onValueChange={(v) => setPreset(v as PeriodComparisonPreset)}
          >
            <SelectTrigger className="h-9 w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month_mom">Mês vs. Mês Anterior (MoM)</SelectItem>
              <SelectItem value="month_yoy">Mês vs. Ano Anterior (YoY)</SelectItem>
              <SelectItem value="quarter">Trimestre vs. Anterior</SelectItem>
              <SelectItem value="custom">Período Customizado</SelectItem>
            </SelectContent>
          </Select>

          {preset !== 'custom' && (
            <div className="flex items-center gap-1 rounded-[4px] border border-[#CBD5E1] bg-white px-1 py-0.5 dark:border-[#2A3B4C] dark:bg-[#0D1A26]">
              <button
                type="button"
                aria-label="Mês anterior"
                onClick={() =>
                  setReferenceMonth((m) => addMonthsISO(`${m}-01`, -1).slice(0, 7))
                }
                className="inline-flex h-7 w-7 items-center justify-center rounded-[3px] text-[#42484C] hover:bg-[#F1F5F9] dark:text-[#9DB0C2] dark:hover:bg-[#162838] cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <input
                type="month"
                aria-label="Mês de referência"
                value={referenceMonth}
                onChange={(e) => {
                  if (e.target.value) setReferenceMonth(e.target.value);
                }}
                className="h-7 bg-transparent px-1 text-[12px] font-medium tabular-nums text-[#0F172A] focus:outline-none dark:text-[#EAF1FF]"
              />
              <button
                type="button"
                aria-label="Próximo mês"
                onClick={() =>
                  setReferenceMonth((m) => addMonthsISO(`${m}-01`, 1).slice(0, 7))
                }
                className="inline-flex h-7 w-7 items-center justify-center rounded-[3px] text-[#42484C] hover:bg-[#F1F5F9] dark:text-[#9DB0C2] dark:hover:bg-[#162838] cursor-pointer"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Filtro de Período Customizado (quando selecionado) */}
      {preset === 'custom' && (
        <Card>
          <CardContent className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="hc-start">Início Período Atual</Label>
              <Input
                id="hc-start"
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="hc-end">Fim Período Atual</Label>
              <Input
                id="hc-end"
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="hc-cstart">Início Comparado (opcional)</Label>
              <Input
                id="hc-cstart"
                type="date"
                value={customCompareStart}
                onChange={(e) => setCustomCompareStart(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="hc-cend">Fim Comparado (opcional)</Label>
              <Input
                id="hc-cend"
                type="date"
                value={customCompareEnd}
                onChange={(e) => setCustomCompareEnd(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Alerta Operacional de Obrigações Vencidas / Próximas */}
      {hasAlerts && (
        <div className="flex flex-col gap-3 rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-[#7F1D1D] dark:bg-[#3B1219]/60">
          <div className="flex items-start gap-2.5 text-[13px] text-[#991B1B] dark:text-[#FCA5A5]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Atenção a Obrigações Fiscais e Parcelamentos</p>
              <p className="text-[12px] opacity-90 tabular-nums">
                {diagnostics.overdueTaxesCount > 0 &&
                  `${diagnostics.overdueTaxesCount} imposto(s) vencido(s) · `}
                {diagnostics.upcomingTaxes7dCount > 0 &&
                  `${diagnostics.upcomingTaxes7dCount} guia(s) vence(m) nos próximos 7 dias · `}
                {diagnostics.overdueInstallmentsCount > 0 &&
                  `${diagnostics.overdueInstallmentsCount} parcela(s) de dívida em atraso`}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => onNavigate('debts_taxes')}>
            <span>Gerenciar Dívidas &amp; Impostos</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* 4 KPIs Principais do Command Center */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* KPI 1: Score de Saúde Financeira (0-100) */}
        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Score de Saúde
                <InfoTooltip glossaryKey="score_saude_financeira" />
              </span>
              <StatusChip variant={healthMeta.variant}>{healthMeta.label}</StatusChip>
            </div>

            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-display text-[32px] font-semibold leading-9 tracking-[-0.02em] tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
                {diagnostics.healthScore}
              </span>
              <span className="text-[13px] font-medium tabular-nums text-[#72787D]">/ 100</span>
            </div>

            <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-[#E2E8F0] dark:bg-[#1E2F3F]">
              <div
                className={cn('h-full transition-all', healthMeta.barColor)}
                style={{ width: `${diagnostics.healthScore}%` }}
              />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
              {diagnostics.pillars.map((pillar) => (
                <div key={pillar.id} className="flex items-center justify-between gap-1">
                  <span className="truncate text-[#42484C] dark:text-[#9DB0C2]">
                    {pillar.id === 'cash_generation'
                      ? 'Caixa/Runway'
                      : pillar.id === 'net_margin'
                        ? 'Margem Líq.'
                        : pillar.id === 'liquidity'
                          ? 'Liquidez'
                          : 'Dívida'}
                  </span>
                  <span className="font-semibold tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
                    {pillar.score}/{pillar.maxScore}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* KPI 2: Caixa Livre Atual */}
        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Caixa Livre Atual
              </span>
              <Wallet className="h-4 w-4 text-[#72787D]" />
            </div>
            <p
              className={cn(
                'mt-2 font-display text-[28px] font-semibold leading-9 tracking-[-0.02em] tabular-nums',
                diagnostics.freeCash >= 0
                  ? 'text-[#059669] dark:text-[#68DBA9]'
                  : 'text-[#DC2626] dark:text-[#FCA5A5]'
              )}
            >
              {formatCurrencyBRL(diagnostics.freeCash)}
            </p>
            <p className="mt-1 text-[12px] tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
              Projetado com previsões: <strong>{formatCurrencyBRL(diagnostics.projectedCash)}</strong>
            </p>
            <div className="mt-3 flex items-center justify-between border-t border-[#F1F5F9] pt-2.5 text-[11px] dark:border-[#1E2F3F]">
              <span className="text-[#72787D]">Dívida + Impostos em aberto</span>
              <span className="font-semibold tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
                {formatCurrencyBRL(diagnostics.totalDebtBalance + diagnostics.openTaxesAmount)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* KPI 3: Runway (Fôlego de Caixa) */}
        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Runway (Fôlego)
                <InfoTooltip glossaryKey="runway" />
              </span>
              <Gauge className="h-4 w-4 text-[#72787D]" />
            </div>

            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-display text-[28px] font-semibold leading-9 tracking-[-0.02em] tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
                {diagnostics.runwayMonths === null
                  ? '—'
                  : `${diagnostics.runwayMonths.toFixed(1).replace('.', ',')} m`}
              </span>
              {diagnostics.isOperatingCashPositive && (
                <StatusChip variant="positive">Caixa Superavitário</StatusChip>
              )}
            </div>

            <p className="mt-1 text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
              {diagnostics.runwayMode === 'net_burn'
                ? `Queima líquida média de ${formatCurrencyBRL(diagnostics.monthlyBurnBase)}/mês`
                : diagnostics.runwayMode === 'fixed_coverage'
                  ? `Cobertura de fixos + dívida (${formatCurrencyBRL(diagnostics.monthlyBurnBase)}/mês)`
                  : 'Sem saída fixa recorrente registrada'}
            </p>

            <div className="mt-3 flex items-center justify-between border-t border-[#F1F5F9] pt-2.5 text-[11px] dark:border-[#1E2F3F]">
              <span className="text-[#72787D]">Parcelas do mês</span>
              <span className="font-semibold tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
                {formatCurrencyBRL(diagnostics.monthlyDebtService)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* KPI 4: Resultado Líquido & Margens MoM / YoY */}
        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Resultado Líquido
                <InfoTooltip glossaryKey="margem_liquida" />
              </span>
              <Activity className="h-4 w-4 text-[#72787D]" />
            </div>

            <p
              className={cn(
                'mt-2 font-display text-[28px] font-semibold leading-9 tracking-[-0.02em] tabular-nums',
                diagnostics.netResultCurrent >= 0
                  ? 'text-[#059669] dark:text-[#68DBA9]'
                  : 'text-[#DC2626] dark:text-[#FCA5A5]'
              )}
            >
              {formatCurrencyBRL(diagnostics.netResultCurrent)}
            </p>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] tabular-nums">
              <span className="font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                Marg. Líq.: {diagnostics.netMarginPct.toFixed(1).replace('.', ',')}%
              </span>
              <span className="text-[#72787D]">MoM {formatPPDelta(diagnostics.netMarginMoMDeltaPct)}</span>
              <span className="text-[#72787D]">YoY {formatPPDelta(diagnostics.netMarginYoYDeltaPct)}</span>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-[#F1F5F9] pt-2.5 text-[11px] dark:border-[#1E2F3F]">
              <span className="flex items-center gap-1 text-[#72787D]">
                Margem Contribuição
                <InfoTooltip glossaryKey="margem_contribuicao_global" />
              </span>
              <span className="font-semibold tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
                {diagnostics.contributionMarginPct.toFixed(1).replace('.', ',')}% (MoM{' '}
                {formatPPDelta(diagnostics.contributionMarginMoMDeltaPct)})
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Evolução Comparativa (6 Meses) + Pilares & Resumo Executivo DRE */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Gráfico SVG Comparativo de Evolução */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Evolução Comparativa (Últimos 6 Meses)</CardTitle>
              <CardDescription>
                Receita Bruta Operacional vs. Custos, Impostos e Despesas Totais ({regime === 'cash' ? 'Caixa' : 'Competência'}).
              </CardDescription>
            </div>
            <div className="flex items-center gap-4 text-[11px] font-medium text-[#42484C] dark:text-[#9DB0C2]">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-[2px] bg-[#0F374A] dark:bg-[#38BDF8]" />
                Receita Bruta
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-[2px] bg-[#94A3B8] dark:bg-[#475569]" />
                Custos &amp; Despesas
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#059669] dark:bg-[#68DBA9]" />
                Resultado Líquido
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <div className="min-w-[500px]">
                <svg
                  viewBox="0 0 600 220"
                  className="h-[220px] w-full"
                  role="img"
                  aria-label="Gráfico comparativo de evolução financeira dos últimos 6 meses"
                >
                  {/* Linhas horizontais de grade */}
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                    const y = 180 - ratio * 150;
                    return (
                      <g key={ratio}>
                        <line
                          x1="48"
                          y1={y}
                          x2="585"
                          y2={y}
                          stroke="currentColor"
                          className="text-[#E2E8F0] dark:text-[#1E2F3F]"
                          strokeDasharray={ratio === 0 ? undefined : '3 3'}
                        />
                        <text
                          x="42"
                          y={y + 4}
                          textAnchor="end"
                          className="fill-[#72787D] text-[10px] tabular-nums"
                        >
                          {Math.round((chartMaxVal * ratio) / 1000)}k
                        </text>
                      </g>
                    );
                  })}

                  {/* Barras agrupadas por mês */}
                  {diagnostics.monthlyEvolution.map((pt, idx) => {
                    const groupWidth = (585 - 58) / diagnostics.monthlyEvolution.length;
                    const xCenter = 58 + groupWidth * idx + groupWidth / 2;
                    const barW = 20;
                    const revH = Math.max(0, (pt.grossRevenue / chartMaxVal) * 150);
                    const costH = Math.max(0, (pt.totalCostsAndExpenses / chartMaxVal) * 150);
                    const netY = 180 - Math.max(0, (pt.netResult / chartMaxVal) * 150);

                    return (
                      <g key={pt.monthKey}>
                        {/* Receita */}
                        <rect
                          x={xCenter - barW - 2}
                          y={180 - revH}
                          width={barW}
                          height={revH}
                          rx={2}
                          className="fill-[#0F374A] dark:fill-[#38BDF8]"
                        >
                          <title>{`${pt.monthLabel} · Receita: ${formatCurrencyBRL(pt.grossRevenue)}`}</title>
                        </rect>

                        {/* Custos & Despesas */}
                        <rect
                          x={xCenter + 2}
                          y={180 - costH}
                          width={barW}
                          height={costH}
                          rx={2}
                          className="fill-[#94A3B8] dark:fill-[#475569]"
                        >
                          <title>{`${pt.monthLabel} · Custos/Desp: ${formatCurrencyBRL(pt.totalCostsAndExpenses)}`}</title>
                        </rect>

                        {/* Ponto Resultado Líquido */}
                        <circle
                          cx={xCenter}
                          cy={netY}
                          r={4}
                          className={
                            pt.netResult >= 0
                              ? 'fill-[#059669] stroke-white dark:fill-[#68DBA9] dark:stroke-[#0D1A26]'
                              : 'fill-[#DC2626] stroke-white dark:fill-[#FCA5A5] dark:stroke-[#0D1A26]'
                          }
                          strokeWidth={1.5}
                        >
                          <title>{`${pt.monthLabel} · Resultado Líquido: ${formatCurrencyBRL(pt.netResult)} (${pt.netMarginPct.toFixed(1)}%)`}</title>
                        </circle>

                        {/* Rótulo do Mês */}
                        <text
                          x={xCenter}
                          y="198"
                          textAnchor="middle"
                          className="fill-[#42484C] text-[10px] font-medium capitalize dark:fill-[#9DB0C2]"
                        >
                          {pt.monthLabel.slice(0, 3)}/{pt.monthKey.slice(2, 4)}
                        </text>
                        <text
                          x={xCenter}
                          y="211"
                          textAnchor="middle"
                          className={cn(
                            'text-[9px] font-semibold tabular-nums',
                            pt.netResult >= 0
                              ? 'fill-[#059669] dark:fill-[#68DBA9]'
                              : 'fill-[#DC2626] dark:fill-[#FCA5A5]'
                          )}
                        >
                          {pt.netResult >= 0 ? '+' : ''}
                          {Math.round(pt.netResult / 1000)}k
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Detalhamento dos 4 Pilares & Atalhos DRE / Dívidas */}
        <Card>
          <CardHeader>
            <CardTitle>Composição do Score &amp; Atalhos</CardTitle>
            <CardDescription>
              Pesos iguais (25 pts por pilar) calculados deterministicamente.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              {diagnostics.pillars.map((pillar) => {
                const pct = Math.round((pillar.score / pillar.maxScore) * 100);
                return (
                  <div key={pillar.id} className="space-y-1">
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                        {pillar.label}
                      </span>
                      <span className="font-semibold tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                        {pillar.score}/{pillar.maxScore} · {pillar.metricDisplay}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E2E8F0] dark:bg-[#1E2F3F]">
                      <div
                        className="h-full bg-[#0F374A] dark:bg-[#38BDF8]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-[11px] leading-4 text-[#72787D]">{pillar.description}</p>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-1 gap-2 border-t border-[#E2E8F0] pt-3 dark:border-[#1E2F3F]">
              <Button variant="outline" className="justify-between" onClick={() => onNavigate('dre')}>
                <span>Abrir DRE Gerencial Completa</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                className="justify-between"
                onClick={() => onNavigate('debts_taxes')}
              >
                <span>Dívidas, Parcelamentos &amp; Impostos</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Ranking de Rentabilidade — Winners & Losers */}
      <Card>
        <CardHeader className="border-b border-[#E2E8F0] dark:border-[#1E2F3F]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle>Ranking de Rentabilidade — Winners &amp; Losers</CardTitle>
              </div>
              <CardDescription>
                Cruzamento multidimensional de transações realizadas (<span className="font-mono">paid</span>) entre{' '}
                {formatDateBR(resolvedPeriods.current.start)} e {formatDateBR(resolvedPeriods.current.end)}.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-[4px] border border-[#CBD5E1] bg-white px-2.5 py-1 text-[12px] dark:border-[#2A3B4C] dark:bg-[#0D1A26]">
                <label htmlFor="target-margin-input" className="text-[#42484C] dark:text-[#9DB0C2]">
                  Meta margem (%):
                </label>
                <input
                  id="target-margin-input"
                  type="number"
                  min={0}
                  max={90}
                  step={1}
                  value={targetMarginPct}
                  onChange={(e) => setTargetMarginPct(Number(e.target.value))}
                  className="w-12 bg-transparent text-right font-semibold tabular-nums text-[#0F172A] focus:outline-none dark:text-[#EAF1FF]"
                />
              </div>

              <Select
                value={winnerFilter}
                onValueChange={(v) => setWinnerFilter(v as WinnerFilter)}
              >
                <SelectTrigger className="h-9 w-[185px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os itens</SelectItem>
                  <SelectItem value="cash_generator">Somente Geradores</SelectItem>
                  <SelectItem value="cash_drain">Somente Drenos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 sm:p-6">
          <Tabs defaultValue="products">
            <TabsList>
              <TabsTrigger value="products" className="gap-1.5 tabular-nums">
                <Package className="h-3.5 w-3.5" />
                <span>Produtos &amp; Serviços ({filteredProducts.length})</span>
              </TabsTrigger>
              <TabsTrigger value="projects" className="gap-1.5 tabular-nums">
                <FolderKanban className="h-3.5 w-3.5" />
                <span>Projetos ({filteredProjects.length})</span>
              </TabsTrigger>
              <TabsTrigger value="companies" className="gap-1.5 tabular-nums">
                <Building2 className="h-3.5 w-3.5" />
                <span>Empresas ({filteredCompanies.length})</span>
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: PRODUTOS / SERVIÇOS */}
            <TabsContent value="products" className="mt-4">
              {filteredProducts.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-[#72787D]">
                  Nenhum produto ou serviço com transações liquidadas neste filtro e período.
                </p>
              ) : (
                <>
                  {/* Tabela Desktop */}
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-left text-[13px]">
                      <thead className="border-y border-[#CBD5E1] bg-[#F8FAFC] text-[12px] font-medium text-[#64748B] dark:border-[#2A3B4C] dark:bg-[#08131D] dark:text-[#9DB0C2]">
                        <tr>
                          <th className="px-4 py-2.5">Produto / Serviço</th>
                          <th className="px-4 py-2.5 text-right">Receita</th>
                          <th className="px-4 py-2.5 text-right">Custos Diretos</th>
                          <th className="px-4 py-2.5 text-right">Impostos</th>
                          <th className="px-4 py-2.5 text-right">Margem Líquida</th>
                          <th className="px-4 py-2.5 text-right">Margem %</th>
                          <th className="px-4 py-2.5 text-right">Partic. %</th>
                          <th className="px-4 py-2.5">Diagnóstico</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F1F5F9] dark:divide-[#1E2F3F]">
                        {filteredProducts.map((row) => (
                          <tr
                            key={row.id}
                            className="hover:bg-[#F1F5F9]/70 dark:hover:bg-[#162838]/50"
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <StatusChip variant="primary">{row.token}</StatusChip>
                                <span className="font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                                  {row.name}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {formatCurrencyBRL(row.revenue)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                              {formatCurrencyBRL(row.directCosts)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                              {formatCurrencyBRL(row.taxes)}
                            </td>
                            <td
                              className={cn(
                                'px-4 py-3 text-right font-semibold tabular-nums',
                                row.netMargin >= 0
                                  ? 'text-[#059669] dark:text-[#68DBA9]'
                                  : 'text-[#DC2626] dark:text-[#FCA5A5]'
                              )}
                            >
                              {formatCurrencyBRL(row.netMargin)}
                            </td>
                            <td className="px-4 py-3 text-right font-medium tabular-nums">
                              {row.netMarginPct.toFixed(1).replace('.', ',')}%
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                              {row.shareOfResultPct.toFixed(1).replace('.', ',')}%
                            </td>
                            <td className="px-4 py-3">
                              {renderClassificationChip(row.classification)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Cards Mobile */}
                  <div className="space-y-3 md:hidden">
                    {filteredProducts.map((row) => (
                      <div
                        key={row.id}
                        className="rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 dark:border-[#1E2F3F] dark:bg-[#08131D]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <StatusChip variant="primary">{row.token}</StatusChip>
                            <p className="mt-1 font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                              {row.name}
                            </p>
                          </div>
                          {renderClassificationChip(row.classification)}
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] tabular-nums">
                          <div>
                            <span className="text-[#72787D]">Receita: </span>
                            <span className="font-medium">{formatCurrencyBRL(row.revenue)}</span>
                          </div>
                          <div>
                            <span className="text-[#72787D]">Custos+Imp: </span>
                            <span className="font-medium">
                              {formatCurrencyBRL(row.directCosts + row.taxes)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[#72787D]">Líquido: </span>
                            <span
                              className={cn(
                                'font-semibold',
                                row.netMargin >= 0
                                  ? 'text-[#059669] dark:text-[#68DBA9]'
                                  : 'text-[#DC2626] dark:text-[#FCA5A5]'
                              )}
                            >
                              {formatCurrencyBRL(row.netMargin)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[#72787D]">Margem: </span>
                            <span className="font-semibold">
                              {row.netMarginPct.toFixed(1).replace('.', ',')}%
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>

            {/* TAB 2: PROJETOS */}
            <TabsContent value="projects" className="mt-4">
              {filteredProjects.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-[#72787D]">
                  Nenhum projeto com movimentações liquidadas neste filtro e período.
                </p>
              ) : (
                <>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-left text-[13px]">
                      <thead className="border-y border-[#CBD5E1] bg-[#F8FAFC] text-[12px] font-medium text-[#64748B] dark:border-[#2A3B4C] dark:bg-[#08131D] dark:text-[#9DB0C2]">
                        <tr>
                          <th className="px-4 py-2.5">Projeto</th>
                          <th className="px-4 py-2.5 text-right">Invest. Inicial</th>
                          <th className="px-4 py-2.5 text-right">Receita Realizada</th>
                          <th className="px-4 py-2.5 text-right">Custos/Saídas</th>
                          <th className="px-4 py-2.5 text-right">Retorno Líquido</th>
                          <th className="px-4 py-2.5 text-right">ROI Real</th>
                          <th className="px-4 py-2.5">Diagnóstico</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F1F5F9] dark:divide-[#1E2F3F]">
                        {filteredProjects.map((row) => (
                          <tr
                            key={row.id}
                            className="hover:bg-[#F1F5F9]/70 dark:hover:bg-[#162838]/50"
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <StatusChip variant="primary">{row.token}</StatusChip>
                                <span className="font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                                  {row.name}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                              {formatCurrencyBRL(row.initialInvestment)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {formatCurrencyBRL(row.realizedRevenue)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                              {formatCurrencyBRL(row.realizedCosts)}
                            </td>
                            <td
                              className={cn(
                                'px-4 py-3 text-right font-semibold tabular-nums',
                                row.realizedNetReturn >= 0
                                  ? 'text-[#059669] dark:text-[#68DBA9]'
                                  : 'text-[#DC2626] dark:text-[#FCA5A5]'
                              )}
                            >
                              {formatCurrencyBRL(row.realizedNetReturn)}
                            </td>
                            <td className="px-4 py-3 text-right font-medium tabular-nums">
                              {row.realizedRoiPct !== null
                                ? `${row.realizedRoiPct.toFixed(1).replace('.', ',')}%`
                                : '—'}
                            </td>
                            <td className="px-4 py-3">
                              {renderClassificationChip(row.classification)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="space-y-3 md:hidden">
                    {filteredProjects.map((row) => (
                      <div
                        key={row.id}
                        className="rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 dark:border-[#1E2F3F] dark:bg-[#08131D]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <StatusChip variant="primary">{row.token}</StatusChip>
                            <p className="mt-1 font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                              {row.name}
                            </p>
                          </div>
                          {renderClassificationChip(row.classification)}
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] tabular-nums">
                          <div>
                            <span className="text-[#72787D]">Receita: </span>
                            <span className="font-medium">
                              {formatCurrencyBRL(row.realizedRevenue)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[#72787D]">Saídas: </span>
                            <span className="font-medium">
                              {formatCurrencyBRL(row.realizedCosts)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[#72787D]">Retorno Líq.: </span>
                            <span
                              className={cn(
                                'font-semibold',
                                row.realizedNetReturn >= 0
                                  ? 'text-[#059669] dark:text-[#68DBA9]'
                                  : 'text-[#DC2626] dark:text-[#FCA5A5]'
                              )}
                            >
                              {formatCurrencyBRL(row.realizedNetReturn)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[#72787D]">ROI Real: </span>
                            <span className="font-semibold">
                              {row.realizedRoiPct !== null
                                ? `${row.realizedRoiPct.toFixed(1).replace('.', ',')}%`
                                : '—'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>

            {/* TAB 3: EMPRESAS (Grupo Consolidado / Escopo Global) */}
            <TabsContent value="companies" className="mt-4">
              {filteredCompanies.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-[#72787D]">
                  Nenhuma empresa com movimentações liquidadas neste filtro e período.
                </p>
              ) : (
                <>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-left text-[13px]">
                      <thead className="border-y border-[#CBD5E1] bg-[#F8FAFC] text-[12px] font-medium text-[#64748B] dark:border-[#2A3B4C] dark:bg-[#08131D] dark:text-[#9DB0C2]">
                        <tr>
                          <th className="px-4 py-2.5">Empresa</th>
                          <th className="px-4 py-2.5 text-right">Receita Realizada</th>
                          <th className="px-4 py-2.5 text-right">Custos Diretos &amp; Imp.</th>
                          <th className="px-4 py-2.5 text-right">Despesas Op.</th>
                          <th className="px-4 py-2.5 text-right">Resultado Líquido</th>
                          <th className="px-4 py-2.5 text-right">Margem %</th>
                          <th className="px-4 py-2.5 text-right">Partic. %</th>
                          <th className="px-4 py-2.5">Diagnóstico</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F1F5F9] dark:divide-[#1E2F3F]">
                        {filteredCompanies.map((row) => (
                          <tr
                            key={row.id}
                            className="hover:bg-[#F1F5F9]/70 dark:hover:bg-[#162838]/50"
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <StatusChip variant="primary">{row.token}</StatusChip>
                                <span className="font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                                  {row.name}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {formatCurrencyBRL(row.revenue)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                              {formatCurrencyBRL(row.directAndTaxCosts)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                              {formatCurrencyBRL(row.operatingExpenses)}
                            </td>
                            <td
                              className={cn(
                                'px-4 py-3 text-right font-semibold tabular-nums',
                                row.netResult >= 0
                                  ? 'text-[#059669] dark:text-[#68DBA9]'
                                  : 'text-[#DC2626] dark:text-[#FCA5A5]'
                              )}
                            >
                              {formatCurrencyBRL(row.netResult)}
                            </td>
                            <td className="px-4 py-3 text-right font-medium tabular-nums">
                              {row.netMarginPct.toFixed(1).replace('.', ',')}%
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                              {row.shareOfResultPct.toFixed(1).replace('.', ',')}%
                            </td>
                            <td className="px-4 py-3">
                              {renderClassificationChip(row.classification)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="space-y-3 md:hidden">
                    {filteredCompanies.map((row) => (
                      <div
                        key={row.id}
                        className="rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 dark:border-[#1E2F3F] dark:bg-[#08131D]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <StatusChip variant="primary">{row.token}</StatusChip>
                            <p className="mt-1 font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                              {row.name}
                            </p>
                          </div>
                          {renderClassificationChip(row.classification)}
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] tabular-nums">
                          <div>
                            <span className="text-[#72787D]">Receita: </span>
                            <span className="font-medium">{formatCurrencyBRL(row.revenue)}</span>
                          </div>
                          <div>
                            <span className="text-[#72787D]">Resultado: </span>
                            <span
                              className={cn(
                                'font-semibold',
                                row.netResult >= 0
                                  ? 'text-[#059669] dark:text-[#68DBA9]'
                                  : 'text-[#DC2626] dark:text-[#FCA5A5]'
                              )}
                            >
                              {formatCurrencyBRL(row.netResult)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[#72787D]">Margem: </span>
                            <span className="font-semibold">
                              {row.netMarginPct.toFixed(1).replace('.', ',')}%
                            </span>
                          </div>
                          <div>
                            <span className="text-[#72787D]">Partic.: </span>
                            <span className="font-medium">
                              {row.shareOfResultPct.toFixed(1).replace('.', ',')}%
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Painel Integrado: CFO Virtual Proativo (IA Zero-Leak) */}
      <Card>
        <CardHeader className="border-b border-[#E2E8F0] dark:border-[#1E2F3F]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Cpu className="h-4 w-4 text-[#0F374A] dark:text-[#38BDF8]" />
                <CardTitle>CFO Virtual Proativo (IA Zero-Leak)</CardTitle>
                <StatusChip variant="positive">
                  <ShieldCheck className="h-3 w-3" />
                  <span>100% Anonimizado</span>
                </StatusChip>
              </div>
              <CardDescription>
                Recomendações acionáveis geradas apenas com tokens do Cofre e séries agregadas.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!liveAnonymizedPayload}
                onClick={() => setInspectorOpen(true)}
              >
                <Eye className="h-3.5 w-3.5" />
                <span>Auditoria de Privacidade</span>
              </Button>
              {session && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={generatingCfo || !liveAnonymizedPayload}
                  onClick={() => void handleQuickAnalyzeCfo()}
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', generatingCfo && 'animate-spin')} />
                  <span>{generatingCfo ? 'Analisando...' : 'Gerar Nova Análise Estratégica'}</span>
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => onNavigate('ai_cfo')}>
                <span>Abrir CFO Virtual</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 sm:p-5 space-y-3">
          {cfoError && (
            <div className="rounded-[6px] border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-[12px] text-[#991B1B] dark:border-[#7F1D1D] dark:bg-[#3B1219] dark:text-[#FCA5A5]">
              {cfoError}
            </div>
          )}

          {topActiveInsights.length === 0 ? (
            <div className="flex flex-col gap-2 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] p-4 sm:flex-row sm:items-center sm:justify-between dark:border-[#1E2F3F] dark:bg-[#08131D]">
              <p className="text-[13px] text-[#42484C] dark:text-[#9DB0C2]">
                Nenhuma recomendação ativa gerada para este escopo ainda. Clique em{' '}
                <strong>Gerar Nova Análise Estratégica</strong> ou abra o chat do CFO Virtual.
              </p>
              <Button variant="outline" size="sm" onClick={() => onNavigate('ai_cfo')}>
                <span>Consultar CFO</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {topActiveInsights.map((ins) => {
                const rehydrated = rehydrateAiInsightForDisplay(
                  ins,
                  vault,
                  Boolean(session?.mfaVerified)
                );
                return (
                  <div
                    key={ins.id}
                    className="flex flex-col justify-between gap-3 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 dark:border-[#1E2F3F] dark:bg-[#08131D]"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <StatusChip
                          variant={
                            ins.severity === 'critical'
                              ? 'alert'
                              : ins.severity === 'opportunity'
                                ? 'positive'
                                : 'neutral'
                          }
                        >
                          {ins.severity === 'critical'
                            ? 'Crítico'
                            : ins.severity === 'opportunity'
                              ? 'Oportunidade'
                              : 'Atenção'}
                        </StatusChip>
                        <span className="text-[12px] font-semibold tabular-nums text-[#059669] dark:text-[#68DBA9]">
                          {formatCurrencyBRL(ins.estimated_financial_impact)}
                        </span>
                      </div>
                      <p className="text-[13px] font-semibold text-[#0F172A] dark:text-[#EAF1FF]">
                        {rehydrated.title}
                      </p>
                      <p className="line-clamp-3 text-[12px] leading-relaxed text-[#42484C] dark:text-[#9DB0C2]">
                        {rehydrated.recommendation}
                      </p>
                    </div>

                    {session && onRefresh && ins.status === 'new' && (
                      <div className="flex items-center justify-end gap-1.5 border-t border-[#E2E8F0] pt-2 dark:border-[#1E2F3F]">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            await updateAiInsightStatus(
                              session.userId,
                              session.email,
                              ins.id,
                              'acknowledged'
                            );
                            await onRefresh();
                          }}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 text-[#059669]" />
                          <span>Reconhecer</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            await updateAiInsightStatus(
                              session.userId,
                              session.email,
                              ins.id,
                              'dismissed'
                            );
                            await onRefresh();
                          }}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rodapé de Acesso Rápido */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="flex items-center gap-3">
              <Landmark className="h-5 w-5 text-[#0F374A] dark:text-[#38BDF8]" />
              <div>
                <p className="text-[13px] font-semibold text-[#0F172A] dark:text-[#EAF1FF]">
                  Endividamento &amp; Calendário Fiscal
                </p>
                <p className="text-[12px] text-[#42484C] tabular-nums dark:text-[#9DB0C2]">
                  {formatCurrencyBRL(diagnostics.totalDebtBalance)} de saldo devedor ·{' '}
                  {formatCurrencyBRL(diagnostics.openTaxesAmount)} em guias em aberto
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('debts_taxes')}>
              <span>Abrir</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-[#0F374A] dark:text-[#38BDF8]" />
              <div>
                <p className="text-[13px] font-semibold text-[#0F172A] dark:text-[#EAF1FF]">
                  DRE Gerencial Estruturada
                </p>
                <p className="text-[12px] text-[#42484C] tabular-nums dark:text-[#9DB0C2]">
                  EBITDA {formatCurrencyBRL(diagnostics.dre.ebitdaCurrent)} (
                  {diagnostics.dre.ebitdaPctCurrent.toFixed(1).replace('.', ',')}% AV)
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('dre')}>
              <span>Ver DRE</span>
              <ArrowDownRight className="h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>
      </div>

      <PrivacyInspectorModal
        open={inspectorOpen}
        onOpenChange={setInspectorOpen}
        payload={liveAnonymizedPayload?.context ?? {}}
        vault={vault}
        sensitiveTerms={sensitiveTerms}
      />
    </div>
  );
};
