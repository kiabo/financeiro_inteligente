import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
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
import { addMonthsISO, cn, formatCurrencyBRL, getTodayISO } from '../../lib/utils';
import { InfoTooltip } from '../core/components/InfoTooltip';
import type {
  AccountingRegime,
  ActiveContext,
  AppSection,
  BusinessGroup,
  Category,
  Company,
  FinancialAccount,
  Transaction,
} from '../core/types';
import {
  computeDreReport,
  resolveComparisonPeriods,
  type DreLine,
  type PeriodComparisonPreset,
} from './healthEngine';

interface DreViewProps {
  groups: BusinessGroup[];
  companies: Company[];
  accounts: FinancialAccount[];
  categories: Category[];
  transactions: Transaction[];
  activeContext: ActiveContext;
  onNavigate: (section: AppSection) => void;
}

function formatPct(value: number | null): string {
  if (value === null) return '—';
  return `${value.toFixed(1).replace('.', ',')}%`;
}

function formatHorizontalPct(value: number | null): string {
  if (value === null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1).replace('.', ',')}%`;
}

export const DreView: React.FC<DreViewProps> = ({
  groups,
  companies,
  accounts,
  categories,
  transactions,
  activeContext,
  onNavigate,
}) => {
  const todayISO = getTodayISO();
  const [regime, setRegime] = useState<AccountingRegime>('cash');
  const [includePendingInCash, setIncludePendingInCash] = useState(false);
  const [preset, setPreset] = useState<PeriodComparisonPreset>('month_mom');
  const [referenceMonth, setReferenceMonth] = useState<string>(todayISO.slice(0, 7));
  const [customStart, setCustomStart] = useState<string>(
    addMonthsISO(`${todayISO.slice(0, 7)}-01`, -1)
  );
  const [customEnd, setCustomEnd] = useState<string>(todayISO);

  const [expandedLines, setExpandedLines] = useState<Record<string, boolean>>({
    gross_revenue: true,
    operating_expenses: true,
    financial_result: true,
  });
  const [expandedSubGroups, setExpandedSubGroups] = useState<Record<string, boolean>>({
    fixed_expense: true,
    variable_expense: true,
    financial_income: true,
    financial_expense: true,
  });

  const resolvedPeriods = useMemo(
    () =>
      resolveComparisonPeriods({
        preset,
        referenceMonth,
        customStart,
        customEnd,
      }),
    [preset, referenceMonth, customStart, customEnd]
  );

  const dre = useMemo(
    () =>
      computeDreReport({
        transactions,
        categories,
        companies,
        accounts,
        activeContext,
        regime,
        includePendingInCash,
        startDate: resolvedPeriods.current.start,
        endDate: resolvedPeriods.current.end,
        compareStartDate: resolvedPeriods.compare.start,
        compareEndDate: resolvedPeriods.compare.end,
      }),
    [
      transactions,
      categories,
      companies,
      accounts,
      activeContext,
      regime,
      includePendingInCash,
      resolvedPeriods,
    ]
  );

  const contextLabel = useMemo(() => {
    if (activeContext.scope === 'group') {
      const g = groups.find((item) => item.id === activeContext.groupId);
      return g ? `Grupo · ${g.name} (${g.analytical_token})` : 'Grupo Consolidado';
    }
    if (activeContext.scope === 'company') {
      const c = companies.find((item) => item.id === activeContext.companyId);
      return c ? `${c.trade_name ?? c.legal_name} (${c.analytical_token})` : 'Empresa Isolada';
    }
    if (activeContext.scope === 'account') {
      const a = accounts.find((item) => item.id === activeContext.accountId);
      return a ? `${a.name} (${a.analytical_token})` : 'Conta Isolada';
    }
    return 'Visão Global Independente';
  }, [activeContext, groups, companies, accounts]);

  const hasAnyExpanded = Object.values(expandedLines).some(Boolean);

  const toggleAll = () => {
    const nextState = !hasAnyExpanded;
    const lineState: Record<string, boolean> = {};
    const subState: Record<string, boolean> = {};
    for (const line of dre.lines) {
      lineState[line.id] = nextState;
      for (const sg of line.subGroups) {
        subState[sg.id] = nextState;
      }
    }
    setExpandedLines(lineState);
    setExpandedSubGroups(subState);
  };

  const toggleLine = (id: string) => {
    setExpandedLines((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleSubGroup = (id: string) => {
    setExpandedSubGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleExportCsv = () => {
    const rows: string[][] = [
      [
        'Ordem',
        'Conta / Grupo DRE',
        `Atual (${resolvedPeriods.current.label})`,
        'AV (%)',
        `Comparado (${resolvedPeriods.compare.label})`,
        'AH (R$)',
        'AH (%)',
      ],
    ];

    for (const line of dre.lines) {
      const signVal = line.isNegativeDisplay ? -line.currentAmount : line.currentAmount;
      const signComp = line.isNegativeDisplay ? -line.compareAmount : line.compareAmount;
      rows.push([
        String(line.order),
        `${line.prefix} ${line.label}`,
        signVal.toFixed(2),
        line.verticalPct !== null ? line.verticalPct.toFixed(1) : '',
        signComp.toFixed(2),
        line.horizontalDeltaAmount.toFixed(2),
        line.horizontalDeltaPct !== null ? line.horizontalDeltaPct.toFixed(1) : '',
      ]);
      for (const sg of line.subGroups) {
        rows.push([
          `${line.order}.*`,
          `  ${sg.label}`,
          sg.currentAmount.toFixed(2),
          sg.verticalPct !== null ? sg.verticalPct.toFixed(1) : '',
          sg.compareAmount.toFixed(2),
          sg.horizontalDeltaAmount.toFixed(2),
          sg.horizontalDeltaPct !== null ? sg.horizontalDeltaPct.toFixed(1) : '',
        ]);
        for (const ch of sg.children) {
          rows.push([
            ch.code,
            `    ${ch.code} ${ch.label}`,
            ch.currentAmount.toFixed(2),
            ch.verticalPct !== null ? ch.verticalPct.toFixed(1) : '',
            ch.compareAmount.toFixed(2),
            ch.horizontalDeltaAmount.toFixed(2),
            ch.horizontalDeltaPct !== null ? ch.horizontalDeltaPct.toFixed(1) : '',
          ]);
        }
      }
      for (const ch of line.children) {
        rows.push([
          ch.code,
          `  ${ch.code} ${ch.label}`,
          ch.currentAmount.toFixed(2),
          ch.verticalPct !== null ? ch.verticalPct.toFixed(1) : '',
          ch.compareAmount.toFixed(2),
          ch.horizontalDeltaAmount.toFixed(2),
          ch.horizontalDeltaPct !== null ? ch.horizontalDeltaPct.toFixed(1) : '',
        ]);
      }
    }

    const csvContent =
      '\uFEFF' +
      rows.map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dre_gerencial_${regime}_${resolvedPeriods.current.start}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderAmountDisplay = (line: DreLine, amount: number) => {
    if (line.isNegativeDisplay && amount > 0) {
      return `-${formatCurrencyBRL(amount)}`;
    }
    return formatCurrencyBRL(amount);
  };

  if (companies.length === 0) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
            Módulo 4 · Demonstração de Resultados
          </span>
          <h1 className="font-display text-[24px] font-semibold leading-8 tracking-[-0.02em] text-[#0F172A] dark:text-[#EAF1FF]">
            DRE Gerencial Estruturada
          </h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Cadastre uma empresa para visualizar a DRE</CardTitle>
            <CardDescription>
              A DRE consolida automaticamente categorias operacionais, custos diretos e resultado
              financeiro do contexto ativo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="primary" onClick={() => onNavigate('hierarchy')}>
              Ir para Empresas &amp; Contas
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho & Controles */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
              Módulo 4 · Análise Vertical &amp; Horizontal
            </span>
            <StatusChip variant="primary">{contextLabel}</StatusChip>
          </div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-[24px] font-semibold leading-8 tracking-[-0.02em] text-[#0F172A] dark:text-[#EAF1FF]">
              DRE Gerencial Estruturada
            </h1>
            <InfoTooltip glossaryKey="dre_gerencial" />
          </div>
          <p className="text-[14px] leading-5 text-[#42484C] dark:text-[#9DB0C2]">
            Comparativo <strong className="font-medium">{resolvedPeriods.current.label}</strong> vs.{' '}
            <strong className="font-medium">{resolvedPeriods.compare.label}</strong> · Transferências
            internas excluídas por definição contábil.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Alternador Caixa vs Competência */}
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
            <SelectTrigger className="h-9 w-[205px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month_mom">Mês vs. Mês Anterior</SelectItem>
              <SelectItem value="month_yoy">Mês vs. Ano Anterior</SelectItem>
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
                aria-label="Mês DRE"
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

      {/* Opções secundárias de Regime e Período Customizado */}
      {preset === 'custom' && (
        <Card>
          <CardContent className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="dre-cstart">Data Inicial</Label>
              <Input
                id="dre-cstart"
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dre-cend">Data Final</Label>
              <Input
                id="dre-cend"
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Faixa de Indicadores Cascata */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
              Receita Bruta
            </span>
            <p className="mt-1 font-display text-[20px] font-semibold tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
              {formatCurrencyBRL(dre.grossRevenueCurrent)}
            </p>
            <p className="mt-0.5 text-[11px] tabular-nums text-[#72787D]">100,0% base AV</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
              Receita Líquida
            </span>
            <p className="mt-1 font-display text-[20px] font-semibold tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
              {formatCurrencyBRL(dre.netRevenueCurrent)}
            </p>
            <p className="mt-0.5 text-[11px] tabular-nums text-[#72787D]">
              Após deduções &amp; tributos
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
              Marg. Contribuição
              <InfoTooltip glossaryKey="margem_contribuicao_global" />
            </span>
            <p className="mt-1 font-display text-[20px] font-semibold tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
              {formatCurrencyBRL(dre.contributionMarginCurrent)}
            </p>
            <p className="mt-0.5 text-[11px] tabular-nums text-[#059669] dark:text-[#68DBA9]">
              {dre.contributionMarginPctCurrent.toFixed(1).replace('.', ',')}% AV
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
              EBITDA
              <InfoTooltip glossaryKey="ebitda" />
            </span>
            <p
              className={cn(
                'mt-1 font-display text-[20px] font-semibold tabular-nums',
                dre.ebitdaCurrent >= 0
                  ? 'text-[#059669] dark:text-[#68DBA9]'
                  : 'text-[#DC2626] dark:text-[#FCA5A5]'
              )}
            >
              {formatCurrencyBRL(dre.ebitdaCurrent)}
            </p>
            <p className="mt-0.5 text-[11px] tabular-nums text-[#72787D]">
              {dre.ebitdaPctCurrent.toFixed(1).replace('.', ',')}% sobre Rec. Bruta
            </p>
          </CardContent>
        </Card>

        <Card className="col-span-2 lg:col-span-1">
          <CardContent className="p-4">
            <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
              Resultado Líquido
              <InfoTooltip glossaryKey="margem_liquida" />
            </span>
            <p
              className={cn(
                'mt-1 font-display text-[20px] font-semibold tabular-nums',
                dre.netResultCurrent >= 0
                  ? 'text-[#059669] dark:text-[#68DBA9]'
                  : 'text-[#DC2626] dark:text-[#FCA5A5]'
              )}
            >
              {formatCurrencyBRL(dre.netResultCurrent)}
            </p>
            <p className="mt-0.5 text-[11px] tabular-nums text-[#72787D]">
              Margem Líquida: {dre.netMarginPctCurrent.toFixed(1).replace('.', ',')}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabela Hierárquica DRE */}
      <Card>
        <CardHeader className="border-b border-[#E2E8F0] dark:border-[#1E2F3F]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle>Demonstrativo Hierárquico (9 Níveis)</CardTitle>
                <InfoTooltip glossaryKey="analise_vertical_horizontal" />
              </div>
              <CardDescription>
                Clique nas linhas analíticas para expandir subgrupos e categorias do plano de contas.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {regime === 'cash' && (
                <label className="inline-flex items-center gap-2 rounded-[4px] border border-[#CBD5E1] bg-[#F8FAFC] px-2.5 py-1.5 text-[12px] text-[#334155] dark:border-[#2A3B4C] dark:bg-[#08131D] dark:text-[#B9CADB] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includePendingInCash}
                    onChange={(e) => setIncludePendingInCash(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#0F374A]"
                  />
                  <span>Incluir previstos em aberto</span>
                </label>
              )}

              <Button variant="outline" size="sm" onClick={toggleAll}>
                {hasAnyExpanded ? (
                  <ChevronsDownUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronsUpDown className="h-3.5 w-3.5" />
                )}
                <span>{hasAnyExpanded ? 'Recolher tudo' : 'Expandir tudo'}</span>
              </Button>

              <Button variant="outline" size="sm" onClick={handleExportCsv}>
                <Download className="h-3.5 w-3.5" />
                <span>Exportar CSV</span>
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {/* Desktop Table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-[#CBD5E1] bg-[#F8FAFC] text-[12px] font-medium text-[#64748B] dark:border-[#2A3B4C] dark:bg-[#08131D] dark:text-[#9DB0C2]">
                <tr>
                  <th className="px-6 py-3">Linha / Categoria DRE</th>
                  <th className="px-4 py-3 text-right">Valor R$ ({resolvedPeriods.current.label})</th>
                  <th className="px-4 py-3 text-right">AV (%)</th>
                  <th className="px-4 py-3 text-right">Comparado R$</th>
                  <th className="px-4 py-3 text-right">AH (R$)</th>
                  <th className="px-6 py-3 text-right">AH (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9] dark:divide-[#1E2F3F]">
                {dre.lines.map((line) => {
                  const hasChildren = line.children.length > 0 || line.subGroups.length > 0;
                  const isExpanded = Boolean(expandedLines[line.id]);

                  return (
                    <React.Fragment key={line.id}>
                      <tr
                        className={cn(
                          line.isSummary
                            ? 'bg-[#F8FAFC] font-semibold dark:bg-[#112231]'
                            : 'hover:bg-[#F1F5F9]/60 dark:hover:bg-[#162838]/50'
                        )}
                      >
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-2">
                            {hasChildren ? (
                              <button
                                type="button"
                                onClick={() => toggleLine(line.id)}
                                aria-label={`Expandir ${line.label}`}
                                className="inline-flex h-5 w-5 items-center justify-center rounded-[3px] text-[#42484C] hover:bg-[#E2E8F0] dark:text-[#9DB0C2] dark:hover:bg-[#223548] cursor-pointer"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                )}
                              </button>
                            ) : (
                              <span className="inline-block w-5" />
                            )}

                            <span className="font-mono text-[11px] text-[#72787D]">
                              {line.prefix}
                            </span>
                            <span
                              className={cn(
                                line.isSummary
                                  ? 'text-[#0F172A] dark:text-[#EAF1FF]'
                                  : 'font-medium text-[#0F172A] dark:text-[#EAF1FF]'
                              )}
                            >
                              {line.label}
                            </span>
                            <InfoTooltip glossaryKey={line.glossaryKey} />
                          </div>
                        </td>
                        <td
                          className={cn(
                            'px-4 py-3 text-right tabular-nums',
                            line.isSummary &&
                              (line.currentAmount >= 0
                                ? 'text-[#059669] dark:text-[#68DBA9]'
                                : 'text-[#DC2626] dark:text-[#FCA5A5]'),
                            line.isNegativeDisplay &&
                              line.currentAmount > 0 &&
                              'text-[#991B1B] dark:text-[#FCA5A5]'
                          )}
                        >
                          {renderAmountDisplay(line, line.currentAmount)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                          {formatPct(line.verticalPct)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                          {renderAmountDisplay(line, line.compareAmount)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                          {formatCurrencyBRL(line.horizontalDeltaAmount)}
                        </td>
                        <td
                          className={cn(
                            'px-6 py-3 text-right font-medium tabular-nums',
                            line.horizontalDeltaPct === null
                              ? 'text-[#72787D]'
                              : (line.isNegativeDisplay
                                  ? line.horizontalDeltaPct <= 0
                                  : line.horizontalDeltaPct >= 0)
                                ? 'text-[#059669] dark:text-[#68DBA9]'
                                : 'text-[#DC2626] dark:text-[#FCA5A5]'
                          )}
                        >
                          {formatHorizontalPct(line.horizontalDeltaPct)}
                        </td>
                      </tr>

                      {/* Subgrupos (ex.: Fixas vs Variáveis; Juros Recebidos vs Pagos) */}
                      {isExpanded &&
                        line.subGroups.map((sg) => {
                          const sgExpanded = Boolean(expandedSubGroups[sg.id]);
                          return (
                            <React.Fragment key={sg.id}>
                              <tr className="bg-white/60 text-[12px] dark:bg-[#0B1722]">
                                <td className="py-2.5 pl-12 pr-4">
                                  <div className="flex items-center gap-2">
                                    {sg.children.length > 0 ? (
                                      <button
                                        type="button"
                                        onClick={() => toggleSubGroup(sg.id)}
                                        className="inline-flex h-4 w-4 items-center justify-center rounded-[2px] text-[#72787D] hover:bg-[#E2E8F0] dark:hover:bg-[#1E2F3F] cursor-pointer"
                                      >
                                        {sgExpanded ? (
                                          <ChevronDown className="h-3 w-3" />
                                        ) : (
                                          <ChevronRight className="h-3 w-3" />
                                        )}
                                      </button>
                                    ) : (
                                      <span className="inline-block w-4" />
                                    )}
                                    <span className="font-medium text-[#334155] dark:text-[#B9CADB]">
                                      {sg.label}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-4 py-2.5 text-right tabular-nums text-[#334155] dark:text-[#B9CADB]">
                                  {formatCurrencyBRL(sg.currentAmount)}
                                </td>
                                <td className="px-4 py-2.5 text-right tabular-nums text-[#72787D]">
                                  {formatPct(sg.verticalPct)}
                                </td>
                                <td className="px-4 py-2.5 text-right tabular-nums text-[#72787D]">
                                  {formatCurrencyBRL(sg.compareAmount)}
                                </td>
                                <td className="px-4 py-2.5 text-right tabular-nums text-[#72787D]">
                                  {formatCurrencyBRL(sg.horizontalDeltaAmount)}
                                </td>
                                <td className="px-6 py-2.5 text-right tabular-nums text-[#72787D]">
                                  {formatHorizontalPct(sg.horizontalDeltaPct)}
                                </td>
                              </tr>

                              {sgExpanded &&
                                sg.children.map((ch) => (
                                  <tr
                                    key={ch.id}
                                    className="text-[12px] text-[#42484C] dark:text-[#9DB0C2]"
                                  >
                                    <td className="py-2 pl-20 pr-4">
                                      <span className="mr-2 font-mono text-[11px] text-[#72787D]">
                                        {ch.code}
                                      </span>
                                      <span>{ch.label}</span>
                                    </td>
                                    <td className="px-4 py-2 text-right tabular-nums">
                                      {formatCurrencyBRL(ch.currentAmount)}
                                    </td>
                                    <td className="px-4 py-2 text-right tabular-nums">
                                      {formatPct(ch.verticalPct)}
                                    </td>
                                    <td className="px-4 py-2 text-right tabular-nums">
                                      {formatCurrencyBRL(ch.compareAmount)}
                                    </td>
                                    <td className="px-4 py-2 text-right tabular-nums">
                                      {formatCurrencyBRL(ch.horizontalDeltaAmount)}
                                    </td>
                                    <td className="px-6 py-2 text-right tabular-nums">
                                      {formatHorizontalPct(ch.horizontalDeltaPct)}
                                    </td>
                                  </tr>
                                ))}
                            </React.Fragment>
                          );
                        })}

                      {/* Filhos diretos (categorias) */}
                      {isExpanded &&
                        line.children.map((ch) => (
                          <tr
                            key={ch.id}
                            className="text-[12px] text-[#42484C] dark:text-[#9DB0C2]"
                          >
                            <td className="py-2 pl-14 pr-4">
                              <span className="mr-2 font-mono text-[11px] text-[#72787D]">
                                {ch.code}
                              </span>
                              <span>{ch.label}</span>
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatCurrencyBRL(ch.currentAmount)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatPct(ch.verticalPct)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatCurrencyBRL(ch.compareAmount)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatCurrencyBRL(ch.horizontalDeltaAmount)}
                            </td>
                            <td className="px-6 py-2 text-right tabular-nums">
                              {formatHorizontalPct(ch.horizontalDeltaPct)}
                            </td>
                          </tr>
                        ))}
                    </React.Fragment>
                  );
                })}

                {/* Linha Informativa de CAPEX (fora do Resultado Líquido) */}
                <tr className="border-t-2 border-[#E2E8F0] bg-[#F8FAFC]/70 text-[12px] text-[#42484C] dark:border-[#1E2F3F] dark:bg-[#08131D] dark:text-[#9DB0C2]">
                  <td className="px-6 py-3">
                    <span className="mr-2 font-mono text-[11px] text-[#72787D]">Memo</span>
                    <span>Investimentos / CAPEX (não deduzido do EBITDA nem do Resultado)</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCurrencyBRL(dre.capexMemoCurrent)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">—</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCurrencyBRL(dre.capexMemoCompare)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCurrencyBRL(dre.capexMemoCurrent - dre.capexMemoCompare)}
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums">—</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Mobile Cards View */}
          <div className="divide-y divide-[#E2E8F0] md:hidden dark:divide-[#1E2F3F]">
            {dre.lines.map((line) => {
              const hasChildren = line.children.length > 0 || line.subGroups.length > 0;
              const isExpanded = Boolean(expandedLines[line.id]);

              return (
                <div
                  key={line.id}
                  className={cn(
                    'p-4',
                    line.isSummary ? 'bg-[#F8FAFC] dark:bg-[#112231]' : ''
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {hasChildren && (
                        <button
                          type="button"
                          onClick={() => toggleLine(line.id)}
                          aria-label={`Expandir ${line.label}`}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-[3px] text-[#42484C] dark:text-[#9DB0C2]"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      )}
                      <div>
                        <p className="text-[13px] font-semibold text-[#0F172A] dark:text-[#EAF1FF]">
                          <span className="mr-1 font-mono text-[11px] text-[#72787D]">
                            {line.prefix}
                          </span>
                          {line.label}
                        </p>
                      </div>
                      <InfoTooltip glossaryKey={line.glossaryKey} />
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-2 text-[12px] tabular-nums">
                    <div>
                      <span className="block text-[10px] uppercase text-[#72787D]">Atual</span>
                      <span
                        className={cn(
                          'font-semibold',
                          line.isSummary &&
                            (line.currentAmount >= 0
                              ? 'text-[#059669] dark:text-[#68DBA9]'
                              : 'text-[#DC2626] dark:text-[#FCA5A5]')
                        )}
                      >
                        {renderAmountDisplay(line, line.currentAmount)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase text-[#72787D]">AV %</span>
                      <span>{formatPct(line.verticalPct)}</span>
                    </div>
                    <div className="text-right">
                      <span className="block text-[10px] uppercase text-[#72787D]">AH %</span>
                      <span>{formatHorizontalPct(line.horizontalDeltaPct)}</span>
                    </div>
                  </div>

                  {isExpanded && (line.children.length > 0 || line.subGroups.length > 0) && (
                    <div className="mt-3 space-y-2 border-t border-[#E2E8F0] pt-2.5 text-[12px] dark:border-[#1E2F3F]">
                      {line.subGroups.map((sg) => (
                        <div key={sg.id} className="space-y-1">
                          <div className="flex justify-between font-medium text-[#334155] dark:text-[#B9CADB]">
                            <span>{sg.label}</span>
                            <span className="tabular-nums">{formatCurrencyBRL(sg.currentAmount)}</span>
                          </div>
                          {sg.children.map((ch) => (
                            <div
                              key={ch.id}
                              className="flex justify-between pl-3 text-[11px] text-[#72787D]"
                            >
                              <span>
                                {ch.code} {ch.label}
                              </span>
                              <span className="tabular-nums">{formatCurrencyBRL(ch.currentAmount)}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                      {line.children.map((ch) => (
                        <div
                          key={ch.id}
                          className="flex justify-between text-[11px] text-[#42484C] dark:text-[#9DB0C2]"
                        >
                          <span>
                            {ch.code} {ch.label}
                          </span>
                          <span className="tabular-nums">{formatCurrencyBRL(ch.currentAmount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
