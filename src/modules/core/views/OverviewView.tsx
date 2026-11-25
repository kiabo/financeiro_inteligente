import { ArrowRight, Building2, Layers, Lock, Plus, ShieldCheck, Wallet } from 'lucide-react';
import React, { useMemo } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { formatCNPJ } from '../../../lib/utils';
import { InfoTooltip } from '../components/InfoTooltip';
import { FINANCIAL_GLOSSARY, type GlossaryKey } from '../glossary';
import type {
  ActiveContext,
  AppSection,
  AuthSessionState,
  BusinessGroup,
  Company,
  FinancialAccount,
  VaultEntry,
} from '../types';

interface OverviewViewProps {
  session: AuthSessionState;
  groups: BusinessGroup[];
  companies: Company[];
  accounts: FinancialAccount[];
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

  return (
    <div className="space-y-6">
      {/* Cabeçalho do contexto */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Contexto Ativo</span>
            <span aria-hidden="true">·</span>
            <span>{session.mode === 'supabase' ? 'Supabase RLS' : 'Sandbox Local'}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{session.aal.toUpperCase()}</span>
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {scopedData.title}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">{scopedData.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => onNavigate('vault')}>
            <ShieldCheck className="h-4 w-4 text-teal-700 dark:text-teal-400" />
            <span>Inspecionar Cofre</span>
          </Button>
          <Button variant="primary" onClick={() => onNavigate('hierarchy')}>
            <Plus className="h-4 w-4" />
            <span>Gerenciar Cadastros</span>
          </Button>
        </div>
      </div>

      {/* KPIs estruturais do Módulo 1 */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Empresas no Escopo</span>
              <Building2 className="h-4 w-4 text-slate-400" />
            </div>
            <p className="mt-2 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {scopedData.companies.length}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {independentCompaniesCount} sem grupo (independentes)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Contas Financeiras</span>
              <Wallet className="h-4 w-4 text-slate-400" />
            </div>
            <p className="mt-2 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {scopedData.accounts.length}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Bancos, caixas, cartões e carteiras
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1">
                Tokens no Cofre
                <InfoTooltip glossaryKey="token_analitico" />
              </span>
              <ShieldCheck className="h-4 w-4 text-teal-700 dark:text-teal-400" />
            </div>
            <p className="mt-2 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {activeVaultCount}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Imutáveis e isolados por RLS
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1">
                Grupos Opcionais
                <InfoTooltip glossaryKey="consolidacao_grupo" />
              </span>
              <Layers className="h-4 w-4 text-slate-400" />
            </div>
            <p className="mt-2 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {groups.length}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {groups.filter((g) => companies.some((c) => c.group_id === g.id)).length} com
              consolidação ativa
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Estado Vazio ou Mapa da Hierarquia */}
      {companies.length === 0 ? (
        <Card>
          <CardHeader>
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
          <CardHeader className="border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Mapa da Hierarquia no Escopo</CardTitle>
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
          <CardContent className="divide-y divide-slate-100 p-0 dark:divide-slate-800">
            {scopedData.companies.map((company) => {
              const parentGroup = company.group_id
                ? groups.find((g) => g.id === company.group_id)
                : undefined;
              const compAccounts = scopedData.accounts.filter((a) => a.company_id === company.id);

              return (
                <div key={company.id} className="px-5 py-4 sm:px-6">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {company.trade_name ?? company.legal_name}
                        </span>
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-medium text-teal-800 dark:bg-slate-800 dark:text-teal-300">
                          {company.analytical_token}
                        </code>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {company.legal_name} <span aria-hidden="true">·</span>{' '}
                        <span className="font-mono tabular-nums">{formatCNPJ(company.cnpj)}</span>
                        {company.tax_regime ? ` · ${company.tax_regime}` : ''}
                      </p>
                    </div>

                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {parentGroup ? (
                        <span>
                          Grupo: <strong className="text-slate-700 dark:text-slate-200">{parentGroup.name}</strong>{' '}
                          <span className="font-mono">({parentGroup.analytical_token})</span>
                        </span>
                      ) : (
                        <span>Operação Independente (sem grupo)</span>
                      )}
                    </div>
                  </div>

                  {compAccounts.length > 0 && (
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {compAccounts.map((acc) => (
                        <div
                          key={acc.id}
                          className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/60"
                        >
                          <div className="min-w-0 pr-2">
                            <p className="truncate font-medium text-slate-800 dark:text-slate-200">
                              {acc.name}
                            </p>
                            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                              {acc.institution_name ?? acc.account_type}
                              {acc.last_four ? ` · final ${acc.last_four}` : ''}
                            </p>
                          </div>
                          <code className="shrink-0 font-mono text-[11px] font-medium text-slate-600 dark:text-slate-300">
                            {acc.analytical_token}
                          </code>
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
              <CardTitle>Glossário Financeiro Contextual</CardTitle>
              <CardDescription>
                Toque ou clique no ícone informativo ao lado de cada conceito para consultar definição
                e exemplo prático.
              </CardDescription>
            </div>
            <Lock className="h-4 w-4 text-slate-400 shrink-0" />
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
                  className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 p-3.5 dark:border-slate-800"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] text-slate-400">{item.category}</p>
                    <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
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
