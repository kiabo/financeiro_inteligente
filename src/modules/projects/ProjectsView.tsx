import {
  AlertTriangle,
  ArrowRight,
  Calculator,
  CheckCircle2,
  Edit3,
  FlaskConical,
  FolderKanban,
  Plus,
  Search,
  Trash2,
  X,
  XCircle,
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
import { addMonthsISO, cn, formatCurrencyBRL, formatDateBR, getTodayISO } from '../../lib/utils';
import { InfoTooltip } from '../core/components/InfoTooltip';
import {
  createProject,
  deleteProject,
  getScopedIds,
  updateProject,
} from '../core/repository';
import type {
  ActiveContext,
  AuthSessionState,
  BusinessGroup,
  Category,
  Company,
  FinancialAccount,
  ProductService,
  Project,
  ProjectForecastItem,
  ProjectScenarioType,
  ProjectStatus,
  Transaction,
} from '../core/types';
import { ProjectDetailView } from './ProjectDetailView';
import {
  runProjectCalculatorUnitTests,
  type ProjectUnitTestResult,
} from './__tests__/projectCalculator.test';
import {
  calculateProjectFeasibility,
  computeCompanyCashBeforeProject,
  type ProjectBudgetHealth,
  type ProjectFeasibilitySummary,
} from './projectCalculator';

interface ProjectsViewProps {
  session: AuthSessionState;
  groups: BusinessGroup[];
  companies: Company[];
  accounts: FinancialAccount[];
  categories: Category[];
  productsServices: ProductService[];
  projects: Project[];
  forecastItems: ProjectForecastItem[];
  transactions: Transaction[];
  activeContext: ActiveContext;
  onRefresh: () => Promise<void>;
  onNavigateHierarchy: () => void;
}

type StatusFilter = 'all' | ProjectStatus;

const STATUS_LABELS: Record<ProjectStatus, string> = {
  idea_simulation: 'Simulação / Ideia',
  approved: 'Aprovado',
  in_progress: 'Em Execução',
  completed: 'Concluído',
  canceled: 'Cancelado',
};

const SCENARIO_LABELS: Record<ProjectScenarioType, string> = {
  realistic: 'Realista',
  conservative: 'Conservador',
  optimistic: 'Otimista',
};

const HEALTH_LABELS: Record<ProjectBudgetHealth, string> = {
  healthy: 'Orçamento Saudável',
  attention: 'Atenção',
  critical: 'Risco / Exposição',
};

export const ProjectsView: React.FC<ProjectsViewProps> = ({
  session,
  groups,
  companies,
  accounts,
  categories,
  productsServices,
  projects,
  forecastItems,
  transactions,
  activeContext,
  onRefresh,
  onNavigateHierarchy,
}) => {
  const todayISO = getTodayISO();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [testResults, setTestResults] = useState<ProjectUnitTestResult[] | null>(null);

  // Estado do Modal Criar/Editar Projeto
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Campos do formulário
  const [companyId, setCompanyId] = useState('');
  const [name, setName] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('idea_simulation');
  const [activeScenario, setActiveScenario] = useState<ProjectScenarioType>('realistic');
  const [startDate, setStartDate] = useState(todayISO.slice(0, 7) + '-01');
  const [endDate, setEndDate] = useState(addMonthsISO(todayISO.slice(0, 7) + '-01', 5));
  const [initialInvestment, setInitialInvestment] = useState('0');
  const [monthlyFixedCost, setMonthlyFixedCost] = useState('0');

  const { companyIds } = useMemo(
    () => getScopedIds(companies, accounts, activeContext),
    [companies, accounts, activeContext]
  );

  const companyMap = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const groupMap = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  const scopedProjects = useMemo(() => {
    return projects.filter((p) => {
      if (activeContext.scope === 'all_independent') return true;
      return companyIds.has(p.company_id);
    });
  }, [projects, activeContext.scope, companyIds]);

  const feasibilityMap = useMemo(() => {
    const map = new Map<string, ProjectFeasibilitySummary>();
    for (const p of scopedProjects) {
      const cashBefore = computeCompanyCashBeforeProject(accounts, transactions, p.company_id, p.id);
      const summary = calculateProjectFeasibility({
        project: p,
        forecastItems,
        transactions,
        companyCashBeforeProject: cashBefore,
        scenario: p.active_scenario,
        todayISO,
      });
      map.set(p.id, summary);
    }
    return map;
  }, [scopedProjects, accounts, transactions, forecastItems, todayISO]);

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopedProjects.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (!q) return true;
      const comp = companyMap.get(p.company_id);
      return (
        p.name.toLowerCase().includes(q) ||
        p.analytical_token.toLowerCase().includes(q) ||
        (p.hypothesis?.toLowerCase().includes(q) ?? false) ||
        (comp?.trade_name?.toLowerCase().includes(q) ?? false) ||
        (comp?.legal_name.toLowerCase().includes(q) ?? false) ||
        (comp?.analytical_token.toLowerCase().includes(q) ?? false)
      );
    });
  }, [scopedProjects, statusFilter, search, companyMap]);

  const hubStats = useMemo(() => {
    const activeNonCanceled = scopedProjects.filter((p) => p.status !== 'canceled');
    const simulationCount = activeNonCanceled.filter(
      (p) => p.status === 'idea_simulation' || p.status === 'approved'
    ).length;
    const executionCount = activeNonCanceled.filter((p) => p.status === 'in_progress').length;

    let totalCapex = 0;
    let totalNetImpact = 0;
    let roiSum = 0;
    let roiCount = 0;
    let exposureCount = 0;
    let totalShortfall = 0;

    for (const p of activeNonCanceled) {
      const f = feasibilityMap.get(p.id);
      if (!f) continue;
      totalCapex += f.totalPlannedCapex;
      totalNetImpact += f.netImpactOnCompanyCash;
      if (f.roiPct !== null) {
        roiSum += f.roiPct;
        roiCount += 1;
      }
      if (f.cashExposureAlert) {
        exposureCount += 1;
        totalShortfall += f.cashExposureShortfall;
      }
    }

    return {
      totalCount: scopedProjects.length,
      simulationCount,
      executionCount,
      totalCapex,
      totalNetImpact,
      avgRoiPct: roiCount > 0 ? Math.round((roiSum / roiCount) * 10) / 10 : null,
      exposureCount,
      totalShortfall,
    };
  }, [scopedProjects, feasibilityMap]);

  const openCreateModal = () => {
    setEditingProject(null);
    setFormError(null);
    const defaultCompId =
      activeContext.scope === 'company'
        ? activeContext.companyId
        : companies.find((c) => companyIds.has(c.id))?.id ?? companies[0]?.id ?? '';
    const baseStart = `${todayISO.slice(0, 7)}-01`;
    setCompanyId(defaultCompId);
    setName('');
    setHypothesis('');
    setStatus('idea_simulation');
    setActiveScenario('realistic');
    setStartDate(baseStart);
    setEndDate(addMonthsISO(baseStart, 5));
    setInitialInvestment('0');
    setMonthlyFixedCost('0');
    setModalOpen(true);
  };

  const openEditModal = (project: Project) => {
    setEditingProject(project);
    setFormError(null);
    setCompanyId(project.company_id);
    setName(project.name);
    setHypothesis(project.hypothesis ?? '');
    setStatus(project.status);
    setActiveScenario(project.active_scenario);
    setStartDate(project.planned_start_date);
    setEndDate(project.planned_end_date);
    setInitialInvestment(String(project.initial_investment));
    setMonthlyFixedCost(String(project.monthly_fixed_cost_allocation));
    setModalOpen(true);
  };

  const handleSaveProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const capex = Number(initialInvestment) || 0;
      const fixedAlloc = Number(monthlyFixedCost) || 0;
      if (editingProject) {
        await updateProject(session.userId, session.email, editingProject.id, {
          name,
          hypothesis: hypothesis.trim() || null,
          status,
          active_scenario: activeScenario,
          planned_start_date: startDate,
          planned_end_date: endDate,
          initial_investment: capex,
          monthly_fixed_cost_allocation: fixedAlloc,
        });
      } else {
        const created = await createProject(session.userId, session.email, {
          company_id: companyId,
          name,
          hypothesis,
          status,
          active_scenario: activeScenario,
          planned_start_date: startDate,
          planned_end_date: endDate,
          initial_investment: capex,
          monthly_fixed_cost_allocation: fixedAlloc,
        });
        setSelectedProjectId(created.id);
      }
      setModalOpen(false);
      await onRefresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao salvar projeto.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    setSubmitting(true);
    try {
      await deleteProject(session.userId, session.email, projectId);
      setConfirmDeleteId(null);
      if (selectedProjectId === projectId) {
        setSelectedProjectId(null);
      }
      await onRefresh();
    } finally {
      setSubmitting(false);
    }
  };

  const selectedProject = useMemo(
    () => (selectedProjectId ? projects.find((p) => p.id === selectedProjectId) ?? null : null),
    [selectedProjectId, projects]
  );

  // Modal JSX reutilizável tanto no Hub quanto na tela de Detalhe
  const projectModal = (
    <Dialog open={modalOpen} onOpenChange={setModalOpen}>
      <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingProject
              ? `Editar Projeto · ${editingProject.analytical_token}`
              : 'Novo Projeto ou Simulação de Ideia'}
          </DialogTitle>
          <DialogDescription>
            Todo projeto recebe automaticamente um token anônimo imutável (PRJ_XX) no Cofre de
            Privacidade antes de qualquer análise externa.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSaveProject} className="mt-4 space-y-4">
          {formError && (
            <div className="rounded-[4px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12px] font-medium text-[#991B1B] dark:border-[#7F1D1D] dark:bg-[#3B1219] dark:text-[#FCA5A5]">
              {formError}
            </div>
          )}

          {!editingProject && (
            <div className="space-y-1.5">
              <Label htmlFor="prj-company">Empresa Responsável *</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger id="prj-company" className="min-h-[44px]">
                  <SelectValue placeholder="Selecione a empresa" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => {
                    const grp = c.group_id ? groupMap.get(c.group_id) : undefined;
                    return (
                      <SelectItem key={c.id} value={c.id}>
                        {c.analytical_token} · {c.trade_name ?? c.legal_name}
                        {grp ? ` (${grp.name})` : ''}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="prj-name">Nome do Projeto / Iniciativa *</Label>
            <Input
              id="prj-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Nova Linha B2B / Expansão Loja Sul"
              className="min-h-[44px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prj-hypothesis">Descrição / Hipótese de Negócio (Opcional)</Label>
            <textarea
              id="prj-hypothesis"
              rows={2}
              value={hypothesis}
              onChange={(e) => setHypothesis(e.target.value)}
              placeholder="Qual dor resolve, público-alvo ou tese de retorno esperada..."
              className="w-full rounded-[4px] border border-[#CBD5E1] bg-white px-3 py-2 text-[14px] text-[#0F172A] placeholder:text-[#72787D] focus:border-[#0F374A] focus:outline-none dark:border-[#2A3B4C] dark:bg-[#0D1A26] dark:text-[#EAF1FF] dark:placeholder:text-[#72787D]"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="prj-status">Estágio / Status *</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
                <SelectTrigger id="prj-status" className="min-h-[44px]">
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
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prj-scenario">Cenário Base de Análise *</Label>
              <Select
                value={activeScenario}
                onValueChange={(v) => setActiveScenario(v as ProjectScenarioType)}
              >
                <SelectTrigger id="prj-scenario" className="min-h-[44px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="realistic">Cenário Realista</SelectItem>
                  <SelectItem value="conservative">Cenário Conservador</SelectItem>
                  <SelectItem value="optimistic">Cenário Otimista</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="prj-start">Início Previsto *</Label>
              <Input
                id="prj-start"
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="min-h-[44px] tabular-nums"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prj-end">Fim Previsto *</Label>
              <Input
                id="prj-end"
                type="date"
                required
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="min-h-[44px] tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="prj-capex">Investimento Inicial · CAPEX (R$) *</Label>
              <Input
                id="prj-capex"
                type="number"
                step="0.01"
                min="0"
                required
                value={initialInvestment}
                onChange={(e) => setInitialInvestment(e.target.value)}
                className="min-h-[44px] tabular-nums"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prj-fixed">Custo Fixo Alocado / Mês (R$)</Label>
              <Input
                id="prj-fixed"
                type="number"
                step="0.01"
                min="0"
                value={monthlyFixedCost}
                onChange={(e) => setMonthlyFixedCost(e.target.value)}
                className="min-h-[44px] tabular-nums"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting
                ? 'Salvando...'
                : editingProject
                  ? 'Salvar Alterações'
                  : 'Criar e Simular Projeto'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );

  // ============================================================================
  // Subview: Análise e Simulação do Projeto Selecionado
  // ============================================================================
  if (selectedProject) {
    return (
      <>
        <ProjectDetailView
          key={selectedProject.id}
          session={session}
          project={selectedProject}
          company={companyMap.get(selectedProject.company_id)}
          companies={companies}
          accounts={accounts}
          categories={categories}
          productsServices={productsServices}
          projects={projects}
          forecastItems={forecastItems}
          transactions={transactions}
          activeContext={activeContext}
          onBack={() => setSelectedProjectId(null)}
          onEditProject={openEditModal}
          onRefresh={onRefresh}
        />
        {projectModal}
      </>
    );
  }

  // ============================================================================
  // Estado sem empresas cadastradas
  // ============================================================================
  if (companies.length === 0) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
            Projetos &amp; Viabilidade
          </span>
          <h1 className="font-display text-[24px] font-semibold leading-8 tracking-[-0.02em] text-[#0F172A] dark:text-[#EAF1FF]">
            Projetos &amp; Hub de Ideias
          </h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Cadastre uma empresa antes de simular projetos</CardTitle>
            <CardDescription>
              Cada projeto e sua análise de impacto no caixa precisam estar vinculados a uma empresa
              (CNPJ) para cruzar o fluxo futuro com a liquidez real das contas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="primary" onClick={onNavigateHierarchy}>
              <Plus className="h-4 w-4" />
              <span>Ir para Empresas &amp; Contas</span>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ============================================================================
  // Hub Principal: Listagem de Projetos & Simulações
  // ============================================================================
  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
            Projetos &amp; Viabilidade
          </span>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-[24px] font-semibold leading-8 tracking-[-0.02em] text-[#0F172A] dark:text-[#EAF1FF]">
              Projetos &amp; Hub de Ideias
            </h1>
            <InfoTooltip glossaryKey="roi_projeto" />
          </div>
          <p className="text-[14px] leading-5 text-[#42484C] dark:text-[#9DB0C2]">
            Simule viabilidade (Payback, ROI, Break-even), avalie exposição no caixa da empresa e
            acompanhe o desvio Previsto vs. Realizado.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setTestResults(runProjectCalculatorUnitTests())}
            className="min-h-[44px] sm:min-h-[38px]"
          >
            <Calculator className="h-4 w-4 text-[#0F374A] dark:text-[#A7CBE3]" />
            <span>Validar Motor (4 testes)</span>
          </Button>

          <Button
            variant="primary"
            onClick={openCreateModal}
            className="min-h-[44px] sm:min-h-[38px]"
          >
            <Plus className="h-4 w-4" />
            <span>Novo Projeto / Ideia</span>
          </Button>
        </div>
      </div>

      {/* Painel de Resultados dos Testes Unitários do Motor */}
      {testResults && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-[#E2E8F0] py-3.5 dark:border-[#1E2F3F]">
            <div>
              <CardTitle className="text-[15px]">
                Validação Matemática do Simulador (`projectCalculator.ts`)
              </CardTitle>
              <CardDescription>
                {testResults.filter((r) => r.passed).length}/{testResults.length} asserções
                aprovadas em cenários de lucro, exposição de caixa e desvio real.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setTestResults(null)}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="divide-y divide-[#F1F5F9] p-0 dark:divide-[#1E2F3F]">
            {testResults.map((res) => (
              <div key={res.name} className="flex items-start gap-3 px-5 py-3 text-[13px]">
                {res.passed ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#059669] dark:text-[#68DBA9]" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
                )}
                <div className="min-w-0">
                  <p className="font-medium text-[#0F172A] dark:text-[#EAF1FF]">{res.name}</p>
                  <p className="text-[12px] text-[#42484C] dark:text-[#9DB0C2]">{res.details}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 4 KPIs do Hub */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Projetos no Escopo
              </span>
              <FolderKanban className="h-4 w-4 text-[#72787D]" />
            </div>
            <p className="mt-2 font-display text-[26px] font-semibold leading-8 tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
              {hubStats.totalCount}
            </p>
            <p className="mt-1 text-[12px] tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
              {hubStats.simulationCount} em simulação · {hubStats.executionCount} em execução
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
              CAPEX Total Planejado
            </span>
            <p className="mt-2 font-display text-[26px] font-semibold leading-8 tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
              {formatCurrencyBRL(hubStats.totalCapex)}
            </p>
            <p className="mt-1 text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
              Investimento inicial + CAPEX previsto
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5">
            <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
              ROI Médio Projetado
              <InfoTooltip glossaryKey="roi_projeto" />
            </span>
            <p
              className={cn(
                'mt-2 font-display text-[26px] font-semibold leading-8 tabular-nums',
                hubStats.avgRoiPct === null
                  ? 'text-[#0F172A] dark:text-[#EAF1FF]'
                  : hubStats.avgRoiPct >= 0
                    ? 'text-[#059669] dark:text-[#68DBA9]'
                    : 'text-[#DC2626] dark:text-[#FCA5A5]'
              )}
            >
              {hubStats.avgRoiPct !== null
                ? `${hubStats.avgRoiPct >= 0 ? '+' : ''}${hubStats.avgRoiPct
                    .toFixed(1)
                    .replace('.', ',')}%`
                : '—'}
            </p>
            <p className="mt-1 text-[12px] tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
              Impacto líq.: {hubStats.totalNetImpact >= 0 ? '+' : ''}
              {formatCurrencyBRL(hubStats.totalNetImpact)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5">
            <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
              Alertas de Exposição
              <InfoTooltip glossaryKey="impacto_caixa_empresa" />
            </span>
            <p
              className={cn(
                'mt-2 font-display text-[26px] font-semibold leading-8 tabular-nums',
                hubStats.exposureCount > 0
                  ? 'text-[#DC2626] dark:text-[#FCA5A5]'
                  : 'text-[#059669] dark:text-[#68DBA9]'
              )}
            >
              {hubStats.exposureCount}
            </p>
            <p className="mt-1 text-[12px] tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
              {hubStats.exposureCount > 0
                ? `Déficit combinado: ${formatCurrencyBRL(hubStats.totalShortfall)}`
                : 'Caixa da empresa comporta o vale'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filtros & Busca */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['all', 'Todos'],
                ['idea_simulation', 'Simulação'],
                ['in_progress', 'Em Execução'],
                ['approved', 'Aprovado'],
                ['completed', 'Concluído'],
              ] as Array<[StatusFilter, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={cn(
                  'min-h-[38px] rounded-[4px] border px-3 text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap',
                  statusFilter === key
                    ? 'border-[#0F374A] bg-[#0F374A] text-white'
                    : 'border-[#CBD5E1] bg-white text-[#334155] hover:bg-[#F8FAFC] dark:border-[#2A3B4C] dark:bg-[#0D1A26] dark:text-[#B9CADB]'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="relative w-full lg:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#72787D]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar projeto, PRJ_XX ou empresa..."
              className="min-h-[40px] pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {/* Lista de Cards de Projetos */}
      {filteredProjects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <div className="flex items-center gap-2 text-[#0F374A] dark:text-[#A7CBE3]">
              <FlaskConical className="h-5 w-5" />
              <p className="font-display text-[16px] font-semibold text-[#0F172A] dark:text-[#EAF1FF]">
                {scopedProjects.length === 0
                  ? 'Nenhum projeto ou simulação cadastrada neste contexto'
                  : 'Nenhum projeto encontrado para o filtro aplicado'}
              </p>
            </div>
            <p className="text-[13px] text-[#42484C] dark:text-[#9DB0C2]">
              Crie uma iniciativa para simular receitas por produto/serviço, calcular Payback e
              ROI e acompanhar a execução real.
            </p>
            {scopedProjects.length === 0 && (
              <Button variant="primary" onClick={openCreateModal}>
                <Plus className="h-4 w-4" />
                <span>Criar Primeiro Projeto</span>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {filteredProjects.map((project) => {
            const comp = companyMap.get(project.company_id);
            const f = feasibilityMap.get(project.id);
            const isConfirmingDelete = confirmDeleteId === project.id;

            return (
              <Card key={project.id} className="flex flex-col justify-between">
                <CardHeader className="space-y-2.5 border-b border-[#E2E8F0] pb-4 dark:border-[#1E2F3F]">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-[17px]">{project.name}</CardTitle>
                        <StatusChip variant="primary">{project.analytical_token}</StatusChip>
                      </div>
                      <p className="text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
                        {comp
                          ? `${comp.trade_name ?? comp.legal_name} (${comp.analytical_token})`
                          : 'Empresa'}{' '}
                        · {formatDateBR(project.planned_start_date)} até{' '}
                        {formatDateBR(project.planned_end_date)} · Cenário{' '}
                        <strong>{SCENARIO_LABELS[project.active_scenario]}</strong>
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
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

                      {f && (
                        <StatusChip
                          variant={
                            f.budgetHealth === 'healthy'
                              ? 'positive'
                              : f.budgetHealth === 'critical'
                                ? 'alert'
                                : 'neutral'
                          }
                        >
                          {HEALTH_LABELS[f.budgetHealth]}
                        </StatusChip>
                      )}
                    </div>
                  </div>

                  {project.hypothesis && (
                    <p className="line-clamp-2 text-[13px] leading-5 text-[#334155] dark:text-[#B9CADB]">
                      {project.hypothesis}
                    </p>
                  )}

                  {f?.cashExposureAlert && (
                    <div className="flex items-start gap-2 rounded-[6px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#991B1B] dark:border-[#7F1D1D] dark:bg-[#3B1219] dark:text-[#FCA5A5]">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span className="tabular-nums">
                        Exposição de caixa: déficit de{' '}
                        <strong>{formatCurrencyBRL(f.cashExposureShortfall)}</strong> frente à
                        liquidez atual da empresa ({formatCurrencyBRL(f.companyCashBeforeProject)}).
                      </span>
                    </div>
                  )}
                </CardHeader>

                <CardContent className="space-y-4 pt-4">
                  {f && (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 dark:border-[#1E2F3F] dark:bg-[#08131D]">
                        <span className="block text-[10px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
                          CAPEX Total
                        </span>
                        <span className="mt-1 block text-[14px] font-semibold tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
                          {formatCurrencyBRL(f.totalPlannedCapex)}
                        </span>
                      </div>

                      <div className="rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 dark:border-[#1E2F3F] dark:bg-[#08131D]">
                        <span className="block text-[10px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
                          ROI Projetado
                        </span>
                        <span
                          className={cn(
                            'mt-1 block text-[14px] font-semibold tabular-nums',
                            f.roiPct === null
                              ? 'text-[#0F172A] dark:text-[#EAF1FF]'
                              : f.roiPct >= 0
                                ? 'text-[#059669] dark:text-[#68DBA9]'
                                : 'text-[#DC2626] dark:text-[#FCA5A5]'
                          )}
                        >
                          {f.roiPct !== null
                            ? `${f.roiPct >= 0 ? '+' : ''}${f.roiPct.toFixed(1).replace('.', ',')}%`
                            : 'CAPEX R$ 0'}
                        </span>
                      </div>

                      <div className="rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 dark:border-[#1E2F3F] dark:bg-[#08131D]">
                        <span className="block text-[10px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
                          Payback
                        </span>
                        <span className="mt-1 block text-[14px] font-semibold tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
                          {f.paybackExactMonths !== null
                            ? `${f.paybackExactMonths.toFixed(1).replace('.', ',')} meses`
                            : 'Não recupera'}
                        </span>
                      </div>

                      <div className="rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 dark:border-[#1E2F3F] dark:bg-[#08131D]">
                        <span className="block text-[10px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
                          Realizado Líq.
                        </span>
                        <span
                          className={cn(
                            'mt-1 block text-[14px] font-semibold tabular-nums',
                            f.realizedNetResult >= 0
                              ? 'text-[#059669] dark:text-[#68DBA9]'
                              : 'text-[#DC2626] dark:text-[#FCA5A5]'
                          )}
                        >
                          {f.realizedNetResult >= 0 ? '+' : ''}
                          {formatCurrencyBRL(f.realizedNetResult)}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditModal(project)}
                        className="min-h-[40px] sm:min-h-[34px]"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        <span>Editar</span>
                      </Button>

                      {isConfirmingDelete ? (
                        <div className="inline-flex items-center gap-1">
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={submitting}
                            onClick={() => void handleDeleteProject(project.id)}
                            className="min-h-[40px] sm:min-h-[34px]"
                          >
                            Confirmar Exclusão
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmDeleteId(null)}
                            className="min-h-[40px] sm:min-h-[34px]"
                          >
                            Cancelar
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmDeleteId(project.id)}
                          className="min-h-[40px] text-[#DC2626] hover:bg-[#FEF2F2] sm:min-h-[34px] dark:text-[#FCA5A5]"
                          aria-label={`Excluir ${project.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>

                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setSelectedProjectId(project.id)}
                      className="min-h-[42px] sm:min-h-[36px]"
                    >
                      <span>Analisar &amp; Simular</span>
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {projectModal}
    </div>
  );
};
