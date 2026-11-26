import {
  Activity,
  ArrowLeftRight,
  ArrowRight,
  Building2,
  FileSpreadsheet,
  FolderKanban,
  Layers,
  Lock,
  Package,
  Plus,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import React, { useMemo } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { StatusChip } from '../../../components/ui/status-chip';
import { formatCNPJ, formatCurrencyBRL } from '../../../lib/utils';
import { InfoTooltip } from '../components/InfoTooltip';
import { FINANCIAL_GLOSSARY, type GlossaryKey } from '../glossary';
import {
  computeAccountBalances,
  getScopedIds,
  resolveEffectiveStatus,
  transactionTouchesContext,
} from '../repository';
import type {
  ActiveContext,
  AppSection,
  AuthSessionState,
  BusinessGroup,
  Company,
  FinancialAccount,
  ProductService,
  Project,
  Transaction,
  VaultEntry,
} from '../types';

interface OverviewViewProps {
  session: AuthSessionState;
  groups: BusinessGroup[];
  companies: Company[];
  accounts: FinancialAccount[];
  productsServices?: ProductService[];
  projects?: Project[];
  transactions?: Transaction[];
  vault: VaultEntry[];
  activeContext: ActiveContext;
  onNavigate: (section: AppSection) => void;
  onSeedExample: () => Promise<void>;
  seeding: boolean;
}

const FEATURED_GLOSSARY_KEYS: GlossaryKey[] = [
  'regime_de_caixa',
  'regime_de_competencia',
  'payback',
  'break_even',
];

export const OverviewView: React.FC<OverviewViewProps> = ({
  session,
  groups,
  companies,
  accounts,
  productsServices = [],
  projects = [],
  transactions = [],
  vault,
  activeContext,
  onNavigate,
  onSeedExample,
  seeding,
}) => {
  const scopedData = useMemo(() => {
    if (activeContext.scope === 'group') {
      const grp = groups.find((g) => g.id === activeContext.groupId);
      const grpCompanies = companies.filter((c) => c.group_id === activeContext.groupId);
      const companyIds = new Set(grpCompanies.map((c) => c.id));
      const grpAccounts = accounts.filter((a) => companyIds.has(a.company_id));
      return {
        title: grp ? `Consolidado · ${grp.name}` : 'Grupo Consolidado',
        subtitle: grp
          ? `Token ${grp.analytical_token} · Visão consolidada habilitada por vínculo ativo`
          : 'Visão consolidada',
        companies: grpCompanies,
        accounts: grpAccounts,
      };
    }

    if (activeContext.scope === 'company') {
      const comp = companies.find((c) => c.id === activeContext.companyId);
      const compAccounts = accounts.filter((a) => a.company_id === activeContext.companyId);
      return {
        title: comp ? (comp.trade_name ?? comp.legal_name) : 'Empresa Isolada',
        subtitle: comp
          ? `Token ${comp.analytical_token} · CNPJ ${formatCNPJ(comp.cnpj)} · ${
              comp.group_id ? 'Vinculada a grupo' : 'Operação independente'
            }`
          : 'Escopo empresarial',
        companies: comp ? [comp] : [],
        accounts: compAccounts,
      };
    }

    if (activeContext.scope === 'account') {
      const acc = accounts.find((a) => a.id === activeContext.accountId);
      const comp = acc ? companies.find((c) => c.id === acc.company_id) : undefined;
      return {
        title: acc ? acc.name : 'Conta Financeira',
        subtitle: acc
          ? `Token ${acc.analytical_token} · ${comp?.trade_name ?? comp?.legal_name ?? 'Empresa'} (${
              comp?.analytical_token ?? ''
            })`
          : 'Escopo de conta',
        companies: comp ? [comp] : [],
        accounts: acc ? [acc] : [],
      };
    }

    return {
      title: 'Estrutura Organizacional & Privacidade',
      subtitle: 'Módulo 1 · Fundação Segura, Hierarquia Flexível e Cofre de Anonimização',
      companies,
      accounts,
    };
  }, [activeContext, groups, companies, accounts]);

  const activeVaultCount = vault.filter((v) => !v.is_archived).length;
  const independentCompaniesCount = companies.filter((c) => !c.group_id).length;

  const module2Pulse = useMemo(() => {
    const scoped = getScopedIds(companies, accounts, activeContext);
    const balances = computeAccountBalances(accounts, transactions, companies, activeContext);
    const currentTotal = balances.reduce((sum, b) => sum + b.current_balance, 0);
    const projectedTotal = balances.reduce((sum, b) => sum + b.projected_balance, 0);
    const overdueCount = transactions.filter(
      (t) =>
        transactionTouchesContext(t, scoped.accountIds) &&
        resolveEffectiveStatus(t) === 'overdue'
    ).length;
    const scopedOffersCount = productsServices.filter((p) => {
      if (!p.is_active) return false;
      if (p.company_id && scoped.companyIds.has(p.company_id)) return true;
      if (p.group_id && activeContext.scope === 'group' && p.group_id === activeContext.groupId) {
        return true;
      }
      if (p.group_id) {
        return companies.some(
          (c) => scoped.companyIds.has(c.id) && c.group_id === p.group_id
        );
      }
      return false;
    }).length;

    return {
      currentTotal,
      projectedTotal,
      overdueCount,
      scopedOffersCount,
    };
  }, [activeContext, companies, accounts, transactions, productsServices]);

  return (
    <div className="space-y-6">
      {/* Cabeçalho executivo */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
              Contexto Ativo
            </span>
            <StatusChip variant={session.mode === 'supabase' ? 'positive' : 'neutral'}>
              {session.mode === 'supabase' ? 'Supabase RLS' : 'Sandbox Local'}
            </StatusChip>
            <StatusChip variant="primary">{session.aal.toUpperCase()}</StatusChip>
          </div>
          <h1 className="font-display text-[24px] font-semibold leading-8 tracking-[-0.02em] text-[#0F172A] dark:text-[#EAF1FF]">
            {scopedData.title}
          </h1>
          <p className="text-[14px] leading-5 text-[#42484C] dark:text-[#9DB0C2]">
            {scopedData.subtitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => onNavigate('health')}>
            <Activity className="h-4 w-4 text-[#059669] dark:text-[#68DBA9]" />
            <span>Saúde Financeira</span>
          </Button>
          <Button variant="outline" onClick={() => onNavigate('dre')}>
            <FileSpreadsheet className="h-4 w-4 text-[#0F374A] dark:text-[#A7CBE3]" />
            <span>DRE Gerencial</span>
          </Button>
          <Button variant="outline" onClick={() => onNavigate('projects')}>
            <FolderKanban className="h-4 w-4 text-[#0F374A] dark:text-[#A7CBE3]" />
            <span>Projetos ({projects.length})</span>
          </Button>
          <Button variant="outline" onClick={() => onNavigate('catalog')}>
            <Package className="h-4 w-4 text-[#0F374A] dark:text-[#A7CBE3]" />
            <span>Produtos &amp; Serviços</span>
          </Button>
          <Button variant="primary" onClick={() => onNavigate('transactions')}>
            <ArrowLeftRight className="h-4 w-4" />
            <span>Fluxo &amp; Lançamentos</span>
          </Button>
        </div>
      </div>

      {/* KPIs estruturais do Módulo 1 (tabular-metric-lg) */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6">
        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Empresas no Escopo
              </span>
              <Building2 className="h-4 w-4 text-[#72787D]" />
            </div>
            <p className="mt-2 font-display text-[28px] font-semibold leading-9 tracking-[-0.02em] tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
              {scopedData.companies.length}
            </p>
            <p className="mt-1 text-[12px] leading-4 text-[#42484C] tabular-nums dark:text-[#9DB0C2]">
              {independentCompaniesCount} sem grupo (independentes)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Contas Financeiras
              </span>
              <Wallet className="h-4 w-4 text-[#72787D]" />
            </div>
            <p className="mt-2 font-display text-[28px] font-semibold leading-9 tracking-[-0.02em] tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
              {scopedData.accounts.length}
            </p>
            <p className="mt-1 text-[12px] leading-4 text-[#42484C] dark:text-[#9DB0C2]">
              Bancos, caixas, cartões e carteiras
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Tokens no Cofre
                <InfoTooltip glossaryKey="token_analitico" />
              </span>
              <ShieldCheck className="h-4 w-4 text-[#059669] dark:text-[#68DBA9]" />
            </div>
            <p className="mt-2 font-display text-[28px] font-semibold leading-9 tracking-[-0.02em] tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
              {activeVaultCount}
            </p>
            <p className="mt-1 text-[12px] leading-4 text-[#065F46] dark:text-[#68DBA9]">
              Imutáveis e isolados por RLS
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Grupos Opcionais
                <InfoTooltip glossaryKey="consolidacao_grupo" />
              </span>
              <Layers className="h-4 w-4 text-[#72787D]" />
            </div>
            <p className="mt-2 font-display text-[28px] font-semibold leading-9 tracking-[-0.02em] tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
              {groups.length}
            </p>
            <p className="mt-1 text-[12px] leading-4 text-[#42484C] tabular-nums dark:text-[#9DB0C2]">
              {groups.filter((g) => companies.some((c) => c.group_id === g.id)).length} com
              consolidação ativa
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Resumo Rápido Módulo 2 (Saldo Atual, Projetado e Catálogo) */}
      {companies.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="flex items-center justify-between p-4 sm:p-5">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                  Saldo Realizado Atual
                </span>
                <p
                  className={`mt-1.5 font-display text-[22px] font-semibold tabular-nums ${
                    module2Pulse.currentTotal >= 0
                      ? 'text-[#059669] dark:text-[#68DBA9]'
                      : 'text-[#DC2626] dark:text-[#FCA5A5]'
                  }`}
                >
                  {formatCurrencyBRL(module2Pulse.currentTotal)}
                </p>
                <p className="mt-0.5 text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
                  Considerando apenas baixas efetuadas
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => onNavigate('transactions')}>
                <span>Ver Fluxo</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center justify-between p-4 sm:p-5">
              <div>
                <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                  Saldo Projetado
                  <InfoTooltip glossaryKey="saldo_projetado" />
                </span>
                <p className="mt-1.5 font-display text-[22px] font-semibold tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
                  {formatCurrencyBRL(module2Pulse.projectedTotal)}
                </p>
                <p className="mt-0.5 text-[12px] tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                  {module2Pulse.overdueCount > 0
                    ? `${module2Pulse.overdueCount} lançamento(s) atrasado(s)`
                    : 'Inclui previsões a pagar/receber'}
                </p>
              </div>
              {module2Pulse.overdueCount > 0 && (
                <StatusChip variant="alert">{module2Pulse.overdueCount} atrasado(s)</StatusChip>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center justify-between p-4 sm:p-5">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                  Ofertas no Catálogo
                </span>
                <p className="mt-1.5 font-display text-[22px] font-semibold tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
                  {module2Pulse.scopedOffersCount}
                </p>
                <p className="mt-0.5 text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
                  Produtos &amp; Serviços com tokens PRD/SRV
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => onNavigate('catalog')}>
                <span>Catálogo</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Estado Vazio ou Mapa da Hierarquia */}
      {companies.length === 0 ? (
        <Card>
          <CardHeader>
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
              Configuração Inicial
            </span>
            <CardTitle>Comece cadastrando sua primeira empresa</CardTitle>
            <CardDescription>
              Não é obrigatório criar um Grupo Empresarial. Cadastre diretamente suas empresas (CNPJs)
              e contas bancárias para operar de forma independente e gerar automaticamente os tokens
              no Cofre de Anonimização.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => onNavigate('hierarchy')}>
              <Plus className="h-4 w-4" />
              <span>Cadastrar Primeira Empresa</span>
            </Button>
            {session.mode === 'sandbox' && (
              <Button
                variant="outline"
                disabled={seeding}
                onClick={() => void onSeedExample()}
              >
                <span>{seeding ? 'Carregando...' : 'Preencher Exemplo de Teste (Sandbox)'}</span>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="border-b border-[#E2E8F0] dark:border-[#1E2F3F]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
                  Estrutura &amp; Tokenização
                </span>
                <CardTitle className="mt-0.5">Mapa da Hierarquia no Escopo</CardTitle>
                <CardDescription>
                  Cada entidade possui um token analítico imutável exibido ao lado da razão social.
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => onNavigate('hierarchy')}>
                <span>Editar</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="divide-y divide-[#F1F5F9] p-0 dark:divide-[#1E2F3F]">
            {scopedData.companies.map((company) => {
              const parentGroup = company.group_id
                ? groups.find((g) => g.id === company.group_id)
                : undefined;
              const compAccounts = scopedData.accounts.filter((a) => a.company_id === company.id);

              return (
                <div key={company.id} className="px-4 py-4 sm:px-6">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-[15px] font-semibold text-[#0F172A] dark:text-[#EAF1FF]">
                          {company.trade_name ?? company.legal_name}
                        </span>
                        <StatusChip variant="primary">{company.analytical_token}</StatusChip>
                      </div>
                      <p className="text-[12px] leading-4 text-[#42484C] dark:text-[#9DB0C2]">
                        {company.legal_name} ·{' '}
                        <span className="tabular-nums font-medium">{formatCNPJ(company.cnpj)}</span>
                        {company.tax_regime ? ` · ${company.tax_regime}` : ''}
                      </p>
                    </div>

                    <div className="text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
                      {parentGroup ? (
                        <StatusChip variant="neutral">
                          Grupo: {parentGroup.name} ({parentGroup.analytical_token})
                        </StatusChip>
                      ) : (
                        <StatusChip variant="neutral">Operação Independente</StatusChip>
                      )}
                    </div>
                  </div>

                  {compAccounts.length > 0 && (
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {compAccounts.map((acc) => (
                        <div
                          key={acc.id}
                          className="flex items-center justify-between rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-[12px] dark:border-[#1E2F3F] dark:bg-[#08131D]"
                        >
                          <div className="min-w-0 pr-2">
                            <p className="truncate font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                              {acc.name}
                            </p>
                            <p className="truncate text-[11px] tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                              {acc.institution_name ?? acc.account_type}
                              {acc.last_four ? ` · final ${acc.last_four}` : ''}
                            </p>
                          </div>
                          <StatusChip variant="neutral">{acc.analytical_token}</StatusChip>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Glossário Contextual Integrado (<InfoTooltip />) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
                Referência Técnica
              </span>
              <CardTitle className="mt-0.5">Glossário Financeiro Contextual</CardTitle>
              <CardDescription>
                Toque ou clique no ícone informativo ao lado de cada conceito para consultar definição
                e exemplo prático.
              </CardDescription>
            </div>
            <Lock className="h-4 w-4 text-[#72787D] shrink-0" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURED_GLOSSARY_KEYS.map((key) => {
              const item = FINANCIAL_GLOSSARY[key];
              if (!item) return null;
              return (
                <div
                  key={key}
                  className="flex items-start justify-between gap-2 rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 dark:border-[#1E2F3F] dark:bg-[#08131D]"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
                      {item.category}
                    </p>
                    <p className="mt-1 text-[13px] font-semibold leading-5 text-[#0F172A] dark:text-[#EAF1FF]">
                      {item.term}
                    </p>
                  </div>
                  <InfoTooltip glossaryKey={key} align="end" />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
