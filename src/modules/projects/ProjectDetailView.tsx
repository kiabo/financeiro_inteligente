import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Edit3,
  Package,
  Plus,
  RotateCcw,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
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
import { cn, formatCurrencyBRL, formatDateBR, getTodayISO } from '../../lib/utils';
import { InfoTooltip } from '../core/components/InfoTooltip';
import { TransactionModal } from '../core/components/TransactionModal';
import {
  cloneProjectScenario,
  createProjectForecastItem,
  deleteProjectForecastItem,
  deleteTransaction,
  markTransactionPaid,
  reopenTransactionPending,
  resolveEffectiveStatus,
  updateProject,
  type ScenarioCloneProfile,
} from '../core/repository';
import type {
  ActiveContext,
  AuthSessionState,
  Category,
  Company,
  FinancialAccount,
  ForecastItemDirection,
  ProductService,
  Project,
  ProjectForecastItem,
  ProjectScenarioType,
  ProjectStatus,
  Transaction,
  TransactionType,
} from '../core/types';
import {
  calculateProjectFeasibility,
  computeCompanyCashBeforeProject,
  computeForecastLineTotals,
} from './projectCalculator';

interface ProjectDetailViewProps {
  session: AuthSessionState;
  project: Project;
  company: Company | undefined;
  companies: Company[];
  accounts: FinancialAccount[];
  categories: Category[];
  productsServices: ProductService[];
  projects: Project[];
  forecastItems: ProjectForecastItem[];
  transactions: Transaction[];
  activeContext: ActiveContext;
  onBack: () => void;
  onEditProject: (project: Project) => void;
  onRefresh: () => Promise<void>;
}

const SCENARIO_LABELS: Record<ProjectScenarioType, string> = {
  realistic: 'Realista',
  conservative: 'Conservador',
  optimistic: 'Otimista',
};

const STATUS_LABELS: Record<ProjectStatus, string> = {
  idea_simulation: 'Simulação / Ideia',
  approved: 'Aprovado',
  in_progress: 'Em Execução',
  completed: 'Concluído',
  canceled: 'Cancelado',
};

const DIRECTION_LABELS: Record<ForecastItemDirection, string> = {
  revenue: 'Receita Prevista',
  direct_cost: 'Custo Direto',
  fixed_cost: 'Custo Fixo',
  capex: 'Investimento (CAPEX)',
};

type ChartViewMode = 'comparison' | 'cash_curve';

export const ProjectDetailView: React.FC<ProjectDetailViewProps> = ({
  session,
  project,
  company,
  companies,
  accounts,
  categories,
  productsServices,
  projects,
  forecastItems,
  transactions,
  activeContext,
  onBack,
  onEditProject,
  onRefresh,
}) => {
  const todayISO = getTodayISO();
  const [selectedScenario, setSelectedScenario] = useState<ProjectScenarioType>(
    project.active_scenario
  );
  const [chartMode, setChartMode] = useState<ChartViewMode>('comparison');
  const [hoveredMonthIdx, setHoveredMonthIdx] = useState<number | null>(null);

  // Modal de clonar cenário
  const [cloneModalOpen, setCloneModalOpen] = useState(false);
  const [cloneTarget, setCloneTarget] = useState<ProjectScenarioType>(
    project.active_scenario === 'conservative' ? 'optimistic' : 'conservative'
  );
  const [cloneProfile, setCloneProfile] = useState<ScenarioCloneProfile>('conservative');
  const [cloning, setCloning] = useState(false);

  // Formulário de nova premissa futura
  const [fMonth, setFMonth] = useState<string>(project.planned_start_date.slice(0, 7));
  const [fDirection, setFDirection] = useState<ForecastItemDirection>('revenue');
  const [fProductId, setFProductId] = useState<string>('none');
  const [fLabel, setFLabel] = useState('');
  const [fQty, setFQty] = useState('1');
  const [fUnitPrice, setFUnitPrice] = useState('');
  const [fUnitCost, setFUnitCost] = useState('0');
  const [fFeePct, setFFeePct] = useState('0');
  const [fTaxPct, setFTaxPct] = useState('0');
  const [fExplicitAmount, setFExplicitAmount] = useState('');
  const [savingForecast, setSavingForecast] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);

  // Modal de lançamento real vinculado ao projeto
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txDefaultType, setTxDefaultType] = useState<TransactionType>('income');
  const [busyId, setBusyId] = useState<string | null>(null);

  const companyCashBeforeProject = useMemo(
    () => computeCompanyCashBeforeProject(accounts, transactions, project.company_id, project.id),
    [accounts, transactions, project.company_id, project.id]
  );

  const feasibility = useMemo(
    () =>
      calculateProjectFeasibility({
        project,
        forecastItems,
        transactions,
        companyCashBeforeProject,
        scenario: selectedScenario,
        todayISO,
      }),
    [project, forecastItems, transactions, companyCashBeforeProject, selectedScenario, todayISO]
  );

  const scenarioForecastItems = useMemo(
    () =>
      forecastItems
        .filter((f) => f.project_id === project.id && f.scenario === selectedScenario)
        .sort((a, b) => a.month_date.localeCompare(b.month_date)),
    [forecastItems, project.id, selectedScenario]
  );

  const projectTransactions = useMemo(
    () =>
      transactions
        .filter((t) => t.project_id === project.id)
        .sort((a, b) => (b.payment_date ?? b.due_date).localeCompare(a.payment_date ?? a.due_date)),
    [transactions, project.id]
  );

  const availableProducts = useMemo(() => {
    return productsServices.filter(
      (p) =>
        p.is_active &&
        (p.company_id === project.company_id || (company?.group_id && p.group_id === company.group_id))
    );
  }, [productsServices, project.company_id, company]);

  const productMap = useMemo(
    () => new Map(productsServices.map((p) => [p.id, p])),
    [productsServices]
  );

  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const handleSwitchScenario = async (next: ProjectScenarioType) => {
    setSelectedScenario(next);
    await updateProject(session.userId, session.email, project.id, { active_scenario: next });
    await onRefresh();
  };

  const handleStatusChange = async (nextStatus: ProjectStatus) => {
    await updateProject(session.userId, session.email, project.id, { status: nextStatus });
    await onRefresh();
  };

  const handleSelectForecastProduct = (val: string) => {
    setFProductId(val);
    if (val === 'none') return;
    const prod = availableProducts.find((p) => p.id === val);
    if (!prod) return;
    setFLabel(fDirection === 'revenue' ? `Vendas · ${prod.name}` : `Custo Direto · ${prod.name}`);
    setFUnitPrice(String(prod.base_price));
    setFUnitCost(String(prod.estimated_direct_cost));
    setFFeePct(String(prod.payment_fee_pct));
    setFTaxPct(String(prod.estimated_tax_pct));
    if (fDirection !== 'revenue') {
      setFExplicitAmount(String(prod.estimated_direct_cost));
    }
  };

  const forecastPreview = useMemo(
    () =>
      computeForecastLineTotals({
        direction: fDirection,
        quantity: Number(fQty) || 1,
        unitPrice: Number(fUnitPrice) || 0,
        unitDirectCost: Number(fUnitCost) || 0,
        paymentFeePct: Number(fFeePct) || 0,
        taxRatePct: Number(fTaxPct) || 0,
        explicitAmount: fDirection === 'revenue' ? undefined : Number(fExplicitAmount) || 0,
      }),
    [fDirection, fQty, fUnitPrice, fUnitCost, fFeePct, fTaxPct, fExplicitAmount]
  );

  const handleAddForecast = async (e: React.FormEvent) => {
    e.preventDefault();
    setForecastError(null);
    setSavingForecast(true);
    try {
      await createProjectForecastItem(session.userId, session.email, {
        project_id: project.id,
        scenario: selectedScenario,
        month_date: `${fMonth}-01`,
        product_service_id: fProductId === 'none' ? null : fProductId,
        direction: fDirection,
        label: fLabel,
        quantity: Number(fQty) || 1,
        unit_price: Number(fUnitPrice) || 0,
        unit_direct_cost: Number(fUnitCost) || 0,
        payment_fee_pct: Number(fFeePct) || 0,
        tax_rate_pct: Number(fTaxPct) || 0,
        explicit_amount: fDirection === 'revenue' ? undefined : Number(fExplicitAmount) || 0,
      });
      setFLabel('');
      setFProductId('none');
      setFExplicitAmount('');
      await onRefresh();
    } catch (err) {
      setForecastError(err instanceof Error ? err.message : 'Erro ao adicionar premissa.');
    } finally {
      setSavingForecast(false);
    }
  };

  const handleCloneScenario = async (e: React.FormEvent) => {
    e.preventDefault();
    setCloning(true);
    try {
      await cloneProjectScenario(session.userId, session.email, {
        projectId: project.id,
        sourceScenario: selectedScenario,
        targetScenario: cloneTarget,
        profile: cloneProfile,
      });
      setSelectedScenario(cloneTarget);
      setCloneModalOpen(false);
      await onRefresh();
    } finally {
      setCloning(false);
    }
  };

  // ==========================================================================
  // Geometria Responsiva para Gráficos SVG
  // ==========================================================================
  const chartGeom = useMemo(() => {
    const points = feasibility.timeline;
    const width = Math.max(560, points.length * 92 + 90);
    const height = 250;
    const padLeft = 72;
    const padRight = 24;
    const padTop = 22;
    const padBottom = 38;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    // Escala de barras (Previsto vs Realizado)
    let maxBar = 1000;
    for (const p of points) {
      maxBar = Math.max(
        maxBar,
        p.plannedRevenue,
        p.realizedRevenue,
        p.plannedTotalOutflows,
        p.realizedOutflows
      );
    }

    // Escala de curvas (Caixa Acumulado + Empresa)
    let minLine = 0;
    let maxLine = 1000;
    for (const p of points) {
      minLine = Math.min(minLine, p.plannedCumulativeCash, p.companyCashWithProject);
      maxLine = Math.max(
        maxLine,
        p.plannedCumulativeCash,
        p.companyCashWithProject,
        feasibility.companyCashBeforeProject
      );
    }
    if (maxLine - minLine < 100) {
      maxLine = minLine + 1000;
    }
    const lineRange = maxLine - minLine;
    const yForLine = (val: number) => padTop + plotH - ((val - minLine) / lineRange) * plotH;
    const yForBar = (val: number) => padTop + plotH - (val / maxBar) * plotH;

    return {
      points,
      width,
      height,
      padLeft,
      padRight,
      padTop,
      padBottom,
      plotW,
      plotH,
      maxBar,
      minLine,
      maxLine,
      yForLine,
      yForBar,
    };
  }, [feasibility]);

  const activeHoverPoint =
    hoveredMonthIdx !== null ? chartGeom.points[hoveredMonthIdx] ?? null : null;

  return (
    <div className="space-y-6">
      {/* Navegação de Retorno & Cabeçalho */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#0F374A] hover:underline dark:text-[#A7CBE3] cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Voltar para Projetos &amp; Hub de Ideias</span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-[24px] font-semibold leading-8 tracking-[-0.02em] text-[#0F172A] dark:text-[#EAF1FF]">
              {project.name}
            </h1>
            <StatusChip variant="primary">{project.analytical_token}</StatusChip>
            <StatusChip
              variant={
                project.status === 'completed' || project.status === 'approved'
                  ? 'positive'
                  : project.status === 'canceled'
                    ? 'alert'
                    : 'neutral'
              }
            >
              {STATUS_LABELS[project.status]}
            </StatusChip>
          </div>

          <p className="text-[13px] leading-5 text-[#42484C] dark:text-[#9DB0C2]">
            {company ? `${company.trade_name ?? company.legal_name} (${company.analytical_token})` : 'Empresa'} ·{' '}
            Janela: {formatDateBR(project.planned_start_date)} até{' '}
            {formatDateBR(project.planned_end_date)} · CAPEX Inicial:{' '}
            <span className="font-semibold tabular-nums">
              {formatCurrencyBRL(project.initial_investment)}
            </span>
          </p>
          {project.hypothesis && (
            <p className="max-w-3xl text-[13px] leading-5 text-[#334155] dark:text-[#B9CADB]">
              {project.hypothesis}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={project.status} onValueChange={(v) => void handleStatusChange(v as ProjectStatus)}>
            <SelectTrigger className="w-[175px] whitespace-nowrap">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="idea_simulation">Simulação / Ideia</SelectItem>
              <SelectItem value="approved">Aprovado</SelectItem>
              <SelectItem value="in_progress">Em Execução</SelectItem>
              <SelectItem value="completed">Concluído</SelectItem>
              <SelectItem value="canceled">Cancelado</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" onClick={() => onEditProject(project)}>
            <Edit3 className="h-4 w-4" />
            <span>Editar</span>
          </Button>

          <Button
            variant="primary"
            onClick={() => {
              setTxDefaultType('income');
              setTxModalOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            <span>Lançar no Projeto</span>
          </Button>
        </div>
      </div>

      {/* Barra de Cenários de Simulação + Clonagem */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[12px] font-semibold text-[#0F172A] dark:text-[#EAF1FF]">
              Cenário de Simulação Ativo:
            </span>
            <div className="inline-flex rounded-[6px] border border-[#CBD5E1] bg-[#F1F5F9] p-1 dark:border-[#2A3B4C] dark:bg-[#08131D]">
              {(['realistic', 'conservative', 'optimistic'] as ProjectScenarioType[]).map((sc) => {
                const count = forecastItems.filter(
                  (f) => f.project_id === project.id && f.scenario === sc
                ).length;
                return (
                  <button
                    key={sc}
                    type="button"
                    onClick={() => void handleSwitchScenario(sc)}
                    className={cn(
                      'min-h-[34px] rounded-[4px] px-3 text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap',
                      selectedScenario === sc
                        ? 'bg-[#0F374A] text-white shadow-sm'
                        : 'text-[#42484C] hover:text-[#0F172A] dark:text-[#9DB0C2] dark:hover:text-[#EAF1FF]'
                    )}
                  >
                    {SCENARIO_LABELS[sc]} ({count})
                  </button>
                );
              })}
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const fallbackTarget: ProjectScenarioType =
                selectedScenario === 'conservative' ? 'optimistic' : 'conservative';
              setCloneTarget(fallbackTarget);
              setCloneProfile(fallbackTarget === 'optimistic' ? 'optimistic' : 'conservative');
              setCloneModalOpen(true);
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            <span>Clonar Cenário</span>
          </Button>
        </CardContent>
      </Card>

      {/* Alerta de Exposição de Caixa */}
      {feasibility.cashExposureAlert && (
        <div className="flex items-start gap-3 rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#991B1B] dark:border-[#7F1D1D] dark:bg-[#3B1219] dark:text-[#FCA5A5]">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="space-y-0.5">
            <p className="font-semibold">
              Alerta de Exposição de Caixa: o vale negativo do projeto excede a liquidez atual/prevista da empresa
            </p>
            <p className="text-[12px] tabular-nums opacity-95">
              Vale máximo acumulado do projeto:{' '}
              <strong>{formatCurrencyBRL(feasibility.maxNegativeValley)}</strong> · Caixa livre da
              empresa antes do projeto:{' '}
              <strong>{formatCurrencyBRL(feasibility.companyCashBeforeProject)}</strong> · Déficit
              projetado de <strong>{formatCurrencyBRL(feasibility.cashExposureShortfall)}</strong>.
              Considere parcelar o investimento ou reforçar o caixa antes da execução.
            </p>
          </div>
        </div>
      )}

      {/* 4 Cards de Viabilidade no Topo */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Payback Estimado
                <InfoTooltip glossaryKey="payback" />
              </span>
            </div>
            <p className="mt-2 font-display text-[24px] font-semibold leading-8 tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
              {feasibility.paybackExactMonths !== null
                ? `${feasibility.paybackExactMonths.toFixed(1).replace('.', ',')} meses`
                : 'Não recupera'}
            </p>
            <p className="mt-1 text-[12px] tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
              {feasibility.paybackMonthIndex !== null
                ? `Equilíbrio acumulado no Mês ${feasibility.paybackMonthIndex}`
                : `Sem retorno em ${feasibility.horizonMonths} meses`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                ROI Projetado (%)
                <InfoTooltip glossaryKey="roi_projeto" />
              </span>
            </div>
            <p
              className={cn(
                'mt-2 font-display text-[24px] font-semibold leading-8 tabular-nums',
                feasibility.roiPct === null
                  ? 'text-[#0F172A] dark:text-[#EAF1FF]'
                  : feasibility.roiPct >= 0
                    ? 'text-[#059669] dark:text-[#68DBA9]'
                    : 'text-[#DC2626] dark:text-[#FCA5A5]'
              )}
            >
              {feasibility.roiPct !== null
                ? `${feasibility.roiPct >= 0 ? '+' : ''}${feasibility.roiPct.toFixed(1).replace('.', ',')}%`
                : 'CAPEX R$ 0'}
            </p>
            <p className="mt-1 text-[12px] tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
              Margem Contrib.: {formatCurrencyBRL(feasibility.contributionMargin)} (
              {feasibility.contributionMarginPct.toFixed(1).replace('.', ',')}%)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Ponto de Equilíbrio
                <InfoTooltip glossaryKey="break_even" />
              </span>
            </div>
            <p className="mt-2 font-display text-[24px] font-semibold leading-8 tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
              {feasibility.breakEvenRevenue !== null
                ? formatCurrencyBRL(feasibility.breakEvenRevenue)
                : 'N/D'}
            </p>
            <p className="mt-1 text-[12px] tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
              Receita prevista: {formatCurrencyBRL(feasibility.totalPlannedRevenue)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Impacto Líquido no Caixa
                <InfoTooltip glossaryKey="impacto_caixa_empresa" />
              </span>
            </div>
            <p
              className={cn(
                'mt-2 font-display text-[24px] font-semibold leading-8 tabular-nums',
                feasibility.netImpactOnCompanyCash >= 0
                  ? 'text-[#059669] dark:text-[#68DBA9]'
                  : 'text-[#DC2626] dark:text-[#FCA5A5]'
              )}
            >
              {feasibility.netImpactOnCompanyCash >= 0 ? '+' : ''}
              {formatCurrencyBRL(feasibility.netImpactOnCompanyCash)}
            </p>
            <p className="mt-1 text-[12px] tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
              Caixa empresa após projeto:{' '}
              {formatCurrencyBRL(
                feasibility.companyCashBeforeProject + feasibility.netImpactOnCompanyCash
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Gráfico Comparativo Mensal & Curva de Caixa Acumulada */}
      <Card>
        <CardHeader className="border-b border-[#E2E8F0] dark:border-[#1E2F3F]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Projeção Temporal &amp; Execução Real</CardTitle>
              <CardDescription>
                Acompanhe mês a mês o desempenho Previsto vs. Realizado e a curva de impacto no
                caixa da empresa ({SCENARIO_LABELS[selectedScenario]}).
              </CardDescription>
            </div>
            <div className="inline-flex rounded-[6px] border border-[#CBD5E1] bg-[#F1F5F9] p-1 dark:border-[#2A3B4C] dark:bg-[#08131D]">
              <button
                type="button"
                onClick={() => setChartMode('comparison')}
                className={cn(
                  'min-h-[34px] rounded-[4px] px-3 text-[12px] font-medium cursor-pointer whitespace-nowrap',
                  chartMode === 'comparison'
                    ? 'bg-white text-[#0F172A] shadow-sm dark:bg-[#162838] dark:text-[#EAF1FF]'
                    : 'text-[#42484C] dark:text-[#9DB0C2]'
                )}
              >
                Previsto vs. Realizado
              </button>
              <button
                type="button"
                onClick={() => setChartMode('cash_curve')}
                className={cn(
                  'min-h-[34px] rounded-[4px] px-3 text-[12px] font-medium cursor-pointer whitespace-nowrap',
                  chartMode === 'cash_curve'
                    ? 'bg-white text-[#0F172A] shadow-sm dark:bg-[#162838] dark:text-[#EAF1FF]'
                    : 'text-[#42484C] dark:text-[#9DB0C2]'
                )}
              >
                Curva de Caixa &amp; Empresa
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          {/* Legenda + Leitura do Mês Selecionado */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {chartMode === 'comparison' ? (
              <div className="flex flex-wrap items-center gap-4 text-[12px] text-[#334155] dark:text-[#B9CADB]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[2px] bg-[#94A3B8]" />
                  Receita Prevista
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[2px] bg-[#059669]" />
                  Receita Realizada
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[2px] bg-[#FCA5A5]" />
                  Saída Prevista
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[2px] bg-[#DC2626]" />
                  Saída Realizada
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-4 text-[12px] text-[#334155] dark:text-[#B9CADB]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-4 bg-[#0F374A] dark:bg-[#68DBA9]" />
                  Caixa Acumulado do Projeto
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-4 bg-[#2563EB]" />
                  Caixa da Empresa com Projeto
                </span>
              </div>
            )}

            {activeHoverPoint && (
              <div className="text-[12px] tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
                <strong className="capitalize">{activeHoverPoint.monthLabel}</strong>:{' '}
                {chartMode === 'comparison' ? (
                  <>
                    Prev. Líq. {formatCurrencyBRL(activeHoverPoint.plannedNetCashFlow)} · Real. Líq.{' '}
                    {formatCurrencyBRL(activeHoverPoint.realizedNetCashFlow)}
                  </>
                ) : (
                  <>
                    Acum. Projeto {formatCurrencyBRL(activeHoverPoint.plannedCumulativeCash)} · Caixa
                    Empresa {formatCurrencyBRL(activeHoverPoint.companyCashWithProject)}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <svg
              viewBox={`0 0 ${chartGeom.width} ${chartGeom.height}`}
              className="h-[240px] w-full min-w-[540px]"
              role="img"
              aria-label="Gráfico financeiro do projeto"
            >
              {/* Linhas de grade horizontais */}
              {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                const y = chartGeom.padTop + chartGeom.plotH * t;
                const val =
                  chartMode === 'comparison'
                    ? chartGeom.maxBar * (1 - t)
                    : chartGeom.maxLine - (chartGeom.maxLine - chartGeom.minLine) * t;
                return (
                  <g key={t}>
                    <line
                      x1={chartGeom.padLeft}
                      x2={chartGeom.width - chartGeom.padRight}
                      y1={y}
                      y2={y}
                      stroke="currentColor"
                      className="text-[#E2E8F0] dark:text-[#1E2F3F]"
                      strokeDasharray={t === 1 ? undefined : '3 3'}
                    />
                    <text
                      x={chartGeom.padLeft - 8}
                      y={y + 4}
                      textAnchor="end"
                      className="fill-[#64748B] text-[10px] font-mono tabular-nums dark:fill-[#9DB0C2]"
                    >
                      {Math.round(val / 1000)}k
                    </text>
                  </g>
                );
              })}

              {/* Linha de Zero na Curva de Caixa */}
              {chartMode === 'cash_curve' &&
                chartGeom.minLine < 0 &&
                chartGeom.maxLine > 0 && (
                  <line
                    x1={chartGeom.padLeft}
                    x2={chartGeom.width - chartGeom.padRight}
                    y1={chartGeom.yForLine(0)}
                    y2={chartGeom.yForLine(0)}
                    stroke="#DC2626"
                    strokeWidth={1.25}
                    strokeDasharray="4 4"
                  />
                )}

              {chartMode === 'comparison' ? (
                chartGeom.points.map((pt, idx) => {
                  const slotW = chartGeom.plotW / Math.max(1, chartGeom.points.length);
                  const cx = chartGeom.padLeft + slotW * idx + slotW / 2;
                  const barW = Math.min(14, Math.max(7, slotW / 6));
                  const baseY = chartGeom.padTop + chartGeom.plotH;

                  const hPlanRev = Math.max(0, baseY - chartGeom.yForBar(pt.plannedRevenue));
                  const hRealRev = Math.max(0, baseY - chartGeom.yForBar(pt.realizedRevenue));
                  const hPlanOut = Math.max(0, baseY - chartGeom.yForBar(pt.plannedTotalOutflows));
                  const hRealOut = Math.max(0, baseY - chartGeom.yForBar(pt.realizedOutflows));

                  return (
                    <g
                      key={pt.monthKey}
                      onMouseEnter={() => setHoveredMonthIdx(idx)}
                      onMouseLeave={() => setHoveredMonthIdx(null)}
                      className="cursor-pointer"
                    >
                      <rect
                        x={cx - barW * 2 - 3}
                        y={baseY - hPlanRev}
                        width={barW}
                        height={hPlanRev}
                        rx={2}
                        fill="#94A3B8"
                      />
                      <rect
                        x={cx - barW - 1}
                        y={baseY - hRealRev}
                        width={barW}
                        height={hRealRev}
                        rx={2}
                        fill="#059669"
                      />
                      <rect
                        x={cx + 1}
                        y={baseY - hPlanOut}
                        width={barW}
                        height={hPlanOut}
                        rx={2}
                        fill="#FCA5A5"
                      />
                      <rect
                        x={cx + barW + 3}
                        y={baseY - hRealOut}
                        width={barW}
                        height={hRealOut}
                        rx={2}
                        fill="#DC2626"
                      />
                      <text
                        x={cx}
                        y={chartGeom.height - 12}
                        textAnchor="middle"
                        className="fill-[#64748B] text-[10px] font-mono dark:fill-[#9DB0C2]"
                      >
                        {pt.monthKey}
                      </text>
                    </g>
                  );
                })
              ) : (
                <>
                  {/* Polilinha Caixa da Empresa com Projeto */}
                  {chartGeom.points.length > 0 && (
                    <polyline
                      fill="none"
                      stroke="#2563EB"
                      strokeWidth={2}
                      points={chartGeom.points
                        .map((pt, idx) => {
                          const slotW = chartGeom.plotW / Math.max(1, chartGeom.points.length);
                          const cx = chartGeom.padLeft + slotW * idx + slotW / 2;
                          return `${cx},${chartGeom.yForLine(pt.companyCashWithProject)}`;
                        })
                        .join(' ')}
                    />
                  )}

                  {/* Polilinha Caixa Acumulado do Projeto */}
                  {chartGeom.points.length > 0 && (
                    <polyline
                      fill="none"
                      stroke="#059669"
                      strokeWidth={2.5}
                      points={chartGeom.points
                        .map((pt, idx) => {
                          const slotW = chartGeom.plotW / Math.max(1, chartGeom.points.length);
                          const cx = chartGeom.padLeft + slotW * idx + slotW / 2;
                          return `${cx},${chartGeom.yForLine(pt.plannedCumulativeCash)}`;
                        })
                        .join(' ')}
                    />
                  )}

                  {chartGeom.points.map((pt, idx) => {
                    const slotW = chartGeom.plotW / Math.max(1, chartGeom.points.length);
                    const cx = chartGeom.padLeft + slotW * idx + slotW / 2;
                    return (
                      <g
                        key={pt.monthKey}
                        onMouseEnter={() => setHoveredMonthIdx(idx)}
                        onMouseLeave={() => setHoveredMonthIdx(null)}
                        className="cursor-pointer"
                      >
                        <circle
                          cx={cx}
                          cy={chartGeom.yForLine(pt.companyCashWithProject)}
                          r={3.5}
                          fill="#2563EB"
                        />
                        <circle
                          cx={cx}
                          cy={chartGeom.yForLine(pt.plannedCumulativeCash)}
                          r={4}
                          fill={pt.plannedCumulativeCash >= 0 ? '#059669' : '#DC2626'}
                        />
                        <text
                          x={cx}
                          y={chartGeom.height - 12}
                          textAnchor="middle"
                          className="fill-[#64748B] text-[10px] font-mono dark:fill-[#9DB0C2]"
                        >
                          {pt.monthKey}
                        </text>
                      </g>
                    );
                  })}
                </>
              )}
            </svg>
          </div>
        </CardContent>
      </Card>

      {/* Abas: Premissas Futuras vs. Execução Real */}
      <Tabs defaultValue="forecast">
        <TabsList>
          <TabsTrigger value="forecast" className="gap-1.5 tabular-nums">
            <TrendingUp className="h-3.5 w-3.5" />
            <span>Premissas Futuras ({scenarioForecastItems.length})</span>
          </TabsTrigger>
          <TabsTrigger value="execution" className="gap-1.5 tabular-nums">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Execução Real · Previsto vs. Realizado ({projectTransactions.length})</span>
          </TabsTrigger>
        </TabsList>

        {/* ABA 1: PREMISSAS FUTURAS */}
        <TabsContent value="forecast" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Adicionar Premissa ao Cenário {SCENARIO_LABELS[selectedScenario]}</CardTitle>
              <CardDescription>
                Selecione um Produto/Serviço do catálogo para preencher automaticamente preço base,
                custo direto, taxa de pagamento e imposto estimado.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddForecast} className="space-y-4">
                {forecastError && (
                  <div className="rounded-[4px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12px] font-medium text-[#991B1B] dark:border-[#7F1D1D] dark:bg-[#3B1219] dark:text-[#FCA5A5]">
                    {forecastError}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="f-month">Mês de Referência *</Label>
                    <Input
                      id="f-month"
                      type="month"
                      required
                      value={fMonth}
                      onChange={(e) => setFMonth(e.target.value)}
                      className="min-h-[40px] tabular-nums"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="f-dir">Natureza da Premissa *</Label>
                    <Select
                      value={fDirection}
                      onValueChange={(v) => setFDirection(v as ForecastItemDirection)}
                    >
                      <SelectTrigger id="f-dir" className="min-h-[40px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="revenue">Receita (Venda de Oferta)</SelectItem>
                        <SelectItem value="direct_cost">Custo Direto Adicional</SelectItem>
                        <SelectItem value="fixed_cost">Custo Fixo Específico</SelectItem>
                        <SelectItem value="capex">Investimento / CAPEX</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="f-product" className="flex items-center gap-1.5">
                      <Package className="h-3.5 w-3.5 text-[#0F374A] dark:text-[#A7CBE3]" />
                      <span>Produto / Serviço Vinculado (Opcional)</span>
                    </Label>
                    <Select value={fProductId} onValueChange={handleSelectForecastProduct}>
                      <SelectTrigger id="f-product" className="min-h-[40px]">
                        <SelectValue placeholder="Selecione para puxar preço e custos" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Premissa livre (sem oferta vinculada)</SelectItem>
                        {availableProducts.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.analytical_token} · {p.name} ({formatCurrencyBRL(p.base_price)})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {fDirection === 'revenue' ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
                    <div className="space-y-1.5 lg:col-span-2">
                      <Label htmlFor="f-label">Descrição da Premissa *</Label>
                      <Input
                        id="f-label"
                        required
                        value={fLabel}
                        onChange={(e) => setFLabel(e.target.value)}
                        placeholder="Ex.: Vendas Kit Automação B2B"
                        className="min-h-[40px]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="f-qty">Qtd. *</Label>
                      <Input
                        id="f-qty"
                        type="number"
                        step="0.1"
                        min="0.1"
                        required
                        value={fQty}
                        onChange={(e) => setFQty(e.target.value)}
                        className="min-h-[40px] tabular-nums"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="f-price">Preço Unit. (R$) *</Label>
                      <Input
                        id="f-price"
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        value={fUnitPrice}
                        onChange={(e) => setFUnitPrice(e.target.value)}
                        className="min-h-[40px] tabular-nums"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="f-cost">Custo Direto Unit.</Label>
                      <Input
                        id="f-cost"
                        type="number"
                        step="0.01"
                        min="0"
                        value={fUnitCost}
                        onChange={(e) => setFUnitCost(e.target.value)}
                        className="min-h-[40px] tabular-nums"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="f-tax">Taxas + Imp. (%)</Label>
                      <div className="grid grid-cols-2 gap-1.5">
                        <Input
                          id="f-fee"
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          value={fFeePct}
                          onChange={(e) => setFFeePct(e.target.value)}
                          placeholder="Taxa%"
                          className="min-h-[40px] tabular-nums"
                        />
                        <Input
                          id="f-tax"
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          value={fTaxPct}
                          onChange={(e) => setFTaxPct(e.target.value)}
                          placeholder="Imp%"
                          className="min-h-[40px] tabular-nums"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="f-label-cost">Descrição do Custo / Investimento *</Label>
                      <Input
                        id="f-label-cost"
                        required
                        value={fLabel}
                        onChange={(e) => setFLabel(e.target.value)}
                        placeholder="Ex.: Tráfego pago de lançamento / Adequação elétrica"
                        className="min-h-[40px]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="f-amount">Valor Previsto (R$) *</Label>
                      <Input
                        id="f-amount"
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={fExplicitAmount}
                        onChange={(e) => setFExplicitAmount(e.target.value)}
                        className="min-h-[40px] tabular-nums"
                      />
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-3 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-[#1E2F3F] dark:bg-[#08131D]">
                  <div className="text-[12px] tabular-nums text-[#334155] dark:text-[#B9CADB]">
                    {fDirection === 'revenue' ? (
                      <>
                        Bruto: <strong>{formatCurrencyBRL(forecastPreview.grossAmount)}</strong> ·
                        Custos Diretos:{' '}
                        <strong>
                          {formatCurrencyBRL(forecastPreview.estimatedDirectCostTotal)}
                        </strong>{' '}
                        · Taxas/Impostos:{' '}
                        <strong>
                          {formatCurrencyBRL(forecastPreview.estimatedDeductionsTotal)}
                        </strong>{' '}
                        · Contribuição:{' '}
                        <strong className="text-[#059669] dark:text-[#68DBA9]">
                          {formatCurrencyBRL(
                            forecastPreview.grossAmount -
                              forecastPreview.estimatedDirectCostTotal -
                              forecastPreview.estimatedDeductionsTotal
                          )}
                        </strong>
                      </>
                    ) : (
                      <>
                        Saída prevista neste mês:{' '}
                        <strong className="text-[#DC2626] dark:text-[#FCA5A5]">
                          -{formatCurrencyBRL(forecastPreview.grossAmount)}
                        </strong>
                      </>
                    )}
                  </div>
                  <Button type="submit" variant="primary" disabled={savingForecast}>
                    <Plus className="h-4 w-4" />
                    <span>{savingForecast ? 'Adicionando...' : 'Adicionar Premissa'}</span>
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Grade de Premissas ({SCENARIO_LABELS[selectedScenario]})</CardTitle>
              <CardDescription>
                Além destas linhas, o rateio fixo mensal de{' '}
                {formatCurrencyBRL(project.monthly_fixed_cost_allocation)}/mês é aplicado
                automaticamente dentro da janela planejada.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {scenarioForecastItems.length === 0 ? (
                <p className="px-6 pb-6 text-[13px] text-[#42484C] dark:text-[#9DB0C2]">
                  Nenhuma premissa cadastrada neste cenário ainda. Utilize o formulário acima ou
                  clone outro cenário.
                </p>
              ) : (
                <>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-left text-[13px]">
                      <thead className="border-y border-[#CBD5E1] bg-[#F8FAFC] text-[12px] font-medium text-[#64748B] dark:border-[#2A3B4C] dark:bg-[#08131D] dark:text-[#9DB0C2]">
                        <tr>
                          <th className="px-5 py-2.5">Mês</th>
                          <th className="px-4 py-2.5">Item &amp; Oferta</th>
                          <th className="px-4 py-2.5">Natureza</th>
                          <th className="px-4 py-2.5 text-right">Qtd.</th>
                          <th className="px-4 py-2.5 text-right">Valor Bruto</th>
                          <th className="px-4 py-2.5 text-right">Custos &amp; Imp.</th>
                          <th className="px-4 py-2.5 text-right">Efeito Líq.</th>
                          <th className="px-5 py-2.5 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F1F5F9] dark:divide-[#1E2F3F]">
                        {scenarioForecastItems.map((item) => {
                          const prod = item.product_service_id
                            ? productMap.get(item.product_service_id)
                            : undefined;
                          const netLine =
                            item.direction === 'revenue'
                              ? item.gross_amount -
                                item.estimated_direct_cost_total -
                                item.estimated_deductions_total
                              : -item.gross_amount;
                          const deductions =
                            item.estimated_direct_cost_total + item.estimated_deductions_total;

                          return (
                            <tr
                              key={item.id}
                              className="hover:bg-[#F1F5F9]/70 dark:hover:bg-[#162838]/50"
                            >
                              <td className="whitespace-nowrap px-5 py-3 font-mono text-[12px] tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
                                {item.month_date.slice(0, 7)}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                                    {item.label}
                                  </span>
                                  {prod && (
                                    <StatusChip variant="primary">
                                      {prod.analytical_token}
                                    </StatusChip>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
                                {DIRECTION_LABELS[item.direction]}
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums text-[#334155] dark:text-[#B9CADB]">
                                {item.quantity}
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
                                {formatCurrencyBRL(item.gross_amount)}
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                                {item.direction === 'revenue' ? formatCurrencyBRL(deductions) : '—'}
                              </td>
                              <td
                                className={cn(
                                  'px-4 py-3 text-right font-semibold tabular-nums',
                                  netLine >= 0
                                    ? 'text-[#059669] dark:text-[#68DBA9]'
                                    : 'text-[#DC2626] dark:text-[#FCA5A5]'
                                )}
                              >
                                {netLine >= 0 ? '+' : ''}
                                {formatCurrencyBRL(netLine)}
                              </td>
                              <td className="px-5 py-3 text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={busyId === item.id}
                                  onClick={async () => {
                                    setBusyId(item.id);
                                    try {
                                      await deleteProjectForecastItem(
                                        session.userId,
                                        session.email,
                                        item.id
                                      );
                                      await onRefresh();
                                    } finally {
                                      setBusyId(null);
                                    }
                                  }}
                                  className="text-[#DC2626] hover:bg-[#FEF2F2] dark:text-[#FCA5A5]"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Cards Mobile */}
                  <div className="divide-y divide-[#E2E8F0] md:hidden dark:divide-[#1E2F3F]">
                    {scenarioForecastItems.map((item) => {
                      const prod = item.product_service_id
                        ? productMap.get(item.product_service_id)
                        : undefined;
                      const netLine =
                        item.direction === 'revenue'
                          ? item.gross_amount -
                            item.estimated_direct_cost_total -
                            item.estimated_deductions_total
                          : -item.gross_amount;
                      return (
                        <div key={item.id} className="space-y-2 p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-[11px] font-mono tabular-nums text-[#72787D]">
                                {item.month_date.slice(0, 7)} · {DIRECTION_LABELS[item.direction]}
                              </p>
                              <p className="font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                                {item.label}
                              </p>
                              {prod && (
                                <span className="text-[11px] text-[#0F374A] dark:text-[#A7CBE3]">
                                  {prod.analytical_token} · Qtd {item.quantity}
                                </span>
                              )}
                            </div>
                            <p
                              className={cn(
                                'font-semibold tabular-nums',
                                netLine >= 0
                                  ? 'text-[#059669] dark:text-[#68DBA9]'
                                  : 'text-[#DC2626] dark:text-[#FCA5A5]'
                              )}
                            >
                              {netLine >= 0 ? '+' : ''}
                              {formatCurrencyBRL(netLine)}
                            </p>
                          </div>
                          <div className="flex justify-end">
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={async () => {
                                await deleteProjectForecastItem(
                                  session.userId,
                                  session.email,
                                  item.id
                                );
                                await onRefresh();
                              }}
                              className="min-h-[40px]"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>Remover</span>
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ABA 2: EXECUÇÃO REAL (PREVISTO VS. REALIZADO) */}
        <TabsContent value="execution" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                  Receita Realizada (Paga)
                </span>
                <p className="mt-1.5 font-display text-[20px] font-semibold tabular-nums text-[#059669] dark:text-[#68DBA9]">
                  +{formatCurrencyBRL(feasibility.realizedRevenueTotal)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                  Saídas Realizadas (Pagas)
                </span>
                <p className="mt-1.5 font-display text-[20px] font-semibold tabular-nums text-[#DC2626] dark:text-[#FCA5A5]">
                  -{formatCurrencyBRL(feasibility.realizedOutflowsTotal)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                  Resultado Realizado Atual
                </span>
                <p
                  className={cn(
                    'mt-1.5 font-display text-[20px] font-semibold tabular-nums',
                    feasibility.realizedNetResult >= 0
                      ? 'text-[#059669] dark:text-[#68DBA9]'
                      : 'text-[#DC2626] dark:text-[#FCA5A5]'
                  )}
                >
                  {feasibility.realizedNetResult >= 0 ? '+' : ''}
                  {formatCurrencyBRL(feasibility.realizedNetResult)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                  Desvio (Realizado vs. Previsto)
                </span>
                <p
                  className={cn(
                    'mt-1.5 font-display text-[20px] font-semibold tabular-nums',
                    feasibility.realizedVsPlannedVarianceAmount >= 0
                      ? 'text-[#059669] dark:text-[#68DBA9]'
                      : 'text-[#DC2626] dark:text-[#FCA5A5]'
                  )}
                >
                  {feasibility.realizedVsPlannedVarianceAmount >= 0 ? '+' : ''}
                  {formatCurrencyBRL(feasibility.realizedVsPlannedVarianceAmount)}
                  {feasibility.realizedVsPlannedVariancePct !== null
                    ? ` (${feasibility.realizedVsPlannedVariancePct >= 0 ? '+' : ''}${feasibility.realizedVsPlannedVariancePct.toFixed(1).replace('.', ',')}%)`
                    : ''}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="border-b border-[#E2E8F0] dark:border-[#1E2F3F]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Lançamentos Reais Vinculados ao Projeto</CardTitle>
                  <CardDescription>
                    Transações pagas compõem o Realizado; transações previstas aparecem para
                    acompanhamento de compromissos em aberto.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setTxDefaultType('expense');
                      setTxModalOpen(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Lançar Gasto</span>
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setTxDefaultType('income');
                      setTxModalOpen(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Lançar Receita</span>
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {projectTransactions.length === 0 ? (
                <div className="flex flex-col items-start gap-3 p-6">
                  <p className="text-[14px] font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                    Nenhuma transação real vinculada a este projeto ainda.
                  </p>
                  <p className="text-[13px] text-[#42484C] dark:text-[#9DB0C2]">
                    Ao registrar uma receita ou despesa, selecione o projeto{' '}
                    <strong>{project.analytical_token}</strong> para acompanhar o desvio Previsto
                    vs. Realizado em tempo real.
                  </p>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setTxDefaultType('income');
                      setTxModalOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    <span>Registrar Primeira Transação do Projeto</span>
                  </Button>
                </div>
              ) : (
                <div className="divide-y divide-[#F1F5F9] dark:divide-[#1E2F3F]">
                  {projectTransactions.map((tx) => {
                    const effStatus = resolveEffectiveStatus(tx, todayISO);
                    const acc = accountMap.get(tx.account_id);
                    const prod = tx.product_service_id
                      ? productMap.get(tx.product_service_id)
                      : undefined;
                    return (
                      <div
                        key={tx.id}
                        className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusChip
                              variant={
                                effStatus === 'paid'
                                  ? 'positive'
                                  : effStatus === 'overdue'
                                    ? 'alert'
                                    : 'neutral'
                              }
                            >
                              {effStatus === 'paid'
                                ? 'Pago'
                                : effStatus === 'overdue'
                                  ? 'Atrasado'
                                  : 'Previsto'}
                            </StatusChip>
                            {prod && (
                              <StatusChip variant="primary">{prod.analytical_token}</StatusChip>
                            )}
                            <span className="text-[12px] tabular-nums text-[#72787D]">
                              {formatDateBR(tx.payment_date ?? tx.due_date)}
                            </span>
                          </div>
                          <p className="font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                            {tx.description}
                          </p>
                          <p className="text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
                            {acc?.name ?? 'Conta'} ({acc?.analytical_token})
                            {tx.counterparty_name ? ` · ${tx.counterparty_name}` : ''}
                          </p>
                        </div>

                        <div className="flex items-center justify-between gap-3 sm:justify-end">
                          <span
                            className={cn(
                              'font-display text-[16px] font-semibold tabular-nums',
                              tx.transaction_type === 'income'
                                ? 'text-[#059669] dark:text-[#68DBA9]'
                                : 'text-[#DC2626] dark:text-[#FCA5A5]'
                            )}
                          >
                            {tx.transaction_type === 'income' ? '+' : '-'}
                            {formatCurrencyBRL(tx.amount)}
                          </span>

                          <div className="inline-flex items-center gap-1">
                            {(effStatus === 'pending' || effStatus === 'overdue') && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busyId === tx.id}
                                onClick={async () => {
                                  setBusyId(tx.id);
                                  try {
                                    await markTransactionPaid(
                                      session.userId,
                                      session.email,
                                      tx.id,
                                      todayISO
                                    );
                                    await onRefresh();
                                  } finally {
                                    setBusyId(null);
                                  }
                                }}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span>Dar Baixa</span>
                              </Button>
                            )}
                            {effStatus === 'paid' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busyId === tx.id}
                                onClick={async () => {
                                  setBusyId(tx.id);
                                  try {
                                    await reopenTransactionPending(
                                      session.userId,
                                      session.email,
                                      tx.id
                                    );
                                    await onRefresh();
                                  } finally {
                                    setBusyId(null);
                                  }
                                }}
                                title="Reabrir como previsto"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busyId === tx.id}
                              onClick={async () => {
                                setBusyId(tx.id);
                                try {
                                  await deleteTransaction(session.userId, session.email, tx.id);
                                  await onRefresh();
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                              className="text-[#DC2626] hover:bg-[#FEF2F2] dark:text-[#FCA5A5]"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Modal de Clonar Cenário */}
      <Dialog open={cloneModalOpen} onOpenChange={setCloneModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Clonar Cenário de Simulação</DialogTitle>
            <DialogDescription>
              Copie as premissas de <strong>{SCENARIO_LABELS[selectedScenario]}</strong> para testar
              variações sem alterar o plano original.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCloneScenario} className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="clone-target">Cenário de Destino *</Label>
              <Select
                value={cloneTarget}
                onValueChange={(v) => setCloneTarget(v as ProjectScenarioType)}
              >
                <SelectTrigger id="clone-target" className="min-h-[40px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['realistic', 'conservative', 'optimistic'] as ProjectScenarioType[])
                    .filter((s) => s !== selectedScenario)
                    .map((s) => (
                      <SelectItem key={s} value={s}>
                        Cenário {SCENARIO_LABELS[s]}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="clone-profile">Premissa de Ajuste Automático</Label>
              <Select
                value={cloneProfile}
                onValueChange={(v) => setCloneProfile(v as ScenarioCloneProfile)}
              >
                <SelectTrigger id="clone-profile" className="min-h-[40px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="conservative">
                    Conservador (-25% volume de receita / +10% custos)
                  </SelectItem>
                  <SelectItem value="optimistic">
                    Otimista (+25% volume de receita / -5% custos)
                  </SelectItem>
                  <SelectItem value="exact">Cópia Exata (1:1 sem ajustes)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setCloneModalOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={cloning}>
                {cloning ? 'Clonando...' : 'Clonar e Abrir Cenário'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal de Lançamento Real pré-vinculado ao Projeto */}
      <TransactionModal
        open={txModalOpen}
        onOpenChange={setTxModalOpen}
        session={session}
        companies={companies}
        accounts={accounts}
        categories={categories}
        productsServices={productsServices}
        projects={projects}
        activeContext={activeContext}
        defaultType={txDefaultType}
        defaultProjectId={project.id}
        onCreated={onRefresh}
      />
    </div>
  );
};
