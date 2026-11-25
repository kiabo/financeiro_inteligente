import { Building2, Check, ChevronDown, Layers, Wallet } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import { cn } from '../../../lib/utils';
import type { ActiveContext, BusinessGroup, Company, FinancialAccount } from '../types';

interface ContextSelectorProps {
  groups: BusinessGroup[];
  companies: Company[];
  accounts: FinancialAccount[];
  activeContext: ActiveContext;
  onChangeContext: (ctx: ActiveContext) => void;
}

export const ContextSelector: React.FC<ContextSelectorProps> = ({
  groups,
  companies,
  accounts,
  activeContext,
  onChangeContext,
}) => {
  const [open, setOpen] = useState(false);

  // Regra Crítica: Visão consolidada de grupo só é habilitada para grupos com empresas vinculadas
  const consolidatedGroups = useMemo(() => {
    return groups
      .map((group) => ({
        group,
        linkedCompanies: companies.filter((c) => c.group_id === group.id),
      }))
      .filter((item) => item.linkedCompanies.length > 0);
  }, [groups, companies]);

  const activeLabel = useMemo(() => {
    if (activeContext.scope === 'all_independent') {
      return companies.length === 0
        ? 'Nenhuma empresa cadastrada'
        : `Visão Geral (${companies.length} ${companies.length === 1 ? 'empresa' : 'empresas'})`;
    }
    if (activeContext.scope === 'group') {
      const grp = groups.find((g) => g.id === activeContext.groupId);
      return grp ? `Consolidado · ${grp.name}` : 'Grupo Consolidado';
    }
    if (activeContext.scope === 'company') {
      const comp = companies.find((c) => c.id === activeContext.companyId);
      return comp ? `${comp.trade_name ?? comp.legal_name} · ${comp.analytical_token}` : 'Empresa';
    }
    const acc = accounts.find((a) => a.id === activeContext.accountId);
    return acc ? `${acc.name} · ${acc.analytical_token}` : 'Conta Financeira';
  }, [activeContext, groups, companies, accounts]);

  const selectAndClose = (ctx: ActiveContext) => {
    onChangeContext(ctx);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Seletor Global de Contexto"
          className="inline-flex h-9 max-w-[230px] sm:max-w-[320px] items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs sm:text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          <span className="flex items-center gap-2 truncate">
            {activeContext.scope === 'group' ? (
              <Layers className="h-3.5 w-3.5 shrink-0 text-teal-700 dark:text-teal-400" />
            ) : activeContext.scope === 'account' ? (
              <Wallet className="h-3.5 w-3.5 shrink-0 text-teal-700 dark:text-teal-400" />
            ) : (
              <Building2 className="h-3.5 w-3.5 shrink-0 text-teal-700 dark:text-teal-400" />
            )}
            <span className="truncate">{activeLabel}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 p-2 max-h-[75vh] overflow-y-auto">
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => selectAndClose({ scope: 'all_independent' })}
            className={cn(
              'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors cursor-pointer',
              activeContext.scope === 'all_independent'
                ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60'
            )}
          >
            <span>Todas as Empresas / Estrutura</span>
            {activeContext.scope === 'all_independent' && (
              <Check className="h-3.5 w-3.5 text-teal-700 dark:text-teal-400" />
            )}
          </button>

          {/* Visão Consolidada por Grupo (somente quando há empresas vinculadas) */}
          <div className="border-t border-slate-100 pt-2 dark:border-slate-800">
            <p className="px-2.5 pb-1 text-[11px] font-medium text-slate-400">
              Grupos Consolidados
            </p>
            {consolidatedGroups.length === 0 ? (
              <p className="px-2.5 py-1.5 text-xs text-slate-500 dark:text-slate-400">
                Nenhuma empresa vinculada a grupo. Operação independente ativa.
              </p>
            ) : (
              <div className="space-y-0.5">
                {consolidatedGroups.map(({ group, linkedCompanies }) => {
                  const isSelected =
                    activeContext.scope === 'group' && activeContext.groupId === group.id;
                  return (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => selectAndClose({ scope: 'group', groupId: group.id })}
                      className={cn(
                        'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors cursor-pointer',
                        isSelected
                          ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                          : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60'
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{group.name}</p>
                        <p className="font-mono text-[11px] text-slate-400">
                          {group.analytical_token} · {linkedCompanies.length}{' '}
                          {linkedCompanies.length === 1 ? 'empresa' : 'empresas'}
                        </p>
                      </div>
                      {isSelected && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-teal-700 dark:text-teal-400" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Empresas e Contas Individuais */}
          <div className="border-t border-slate-100 pt-2 dark:border-slate-800">
            <p className="px-2.5 pb-1 text-[11px] font-medium text-slate-400">
              Empresas &amp; Contas
            </p>
            {companies.length === 0 ? (
              <p className="px-2.5 py-1.5 text-xs text-slate-500 dark:text-slate-400">
                Cadastre sua primeira empresa em Configurações.
              </p>
            ) : (
              <div className="space-y-1">
                {companies.map((company) => {
                  const companyAccounts = accounts.filter((a) => a.company_id === company.id);
                  const isCompSelected =
                    activeContext.scope === 'company' && activeContext.companyId === company.id;
                  return (
                    <div key={company.id} className="space-y-0.5">
                      <button
                        type="button"
                        onClick={() => selectAndClose({ scope: 'company', companyId: company.id })}
                        className={cn(
                          'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors cursor-pointer',
                          isCompSelected
                            ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                            : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60'
                        )}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {company.trade_name ?? company.legal_name}
                          </p>
                          <p className="font-mono text-[11px] text-slate-400">
                            {company.analytical_token} ·{' '}
                            {company.group_id ? 'Vinculada a grupo' : 'Independente'}
                          </p>
                        </div>
                        {isCompSelected && (
                          <Check className="h-3.5 w-3.5 shrink-0 text-teal-700 dark:text-teal-400" />
                        )}
                      </button>

                      {companyAccounts.map((account) => {
                        const isAccSelected =
                          activeContext.scope === 'account' &&
                          activeContext.accountId === account.id;
                        return (
                          <button
                            key={account.id}
                            type="button"
                            onClick={() =>
                              selectAndClose({ scope: 'account', accountId: account.id })
                            }
                            className={cn(
                              'flex w-full items-center justify-between rounded-lg py-1.5 pl-6 pr-2.5 text-left text-xs transition-colors cursor-pointer',
                              isAccSelected
                                ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                                : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/60'
                            )}
                          >
                            <div className="min-w-0">
                              <p className="truncate">{account.name}</p>
                              <p className="font-mono text-[10px] text-slate-400">
                                {account.analytical_token}
                              </p>
                            </div>
                            {isAccSelected && (
                              <Check className="h-3.5 w-3.5 shrink-0 text-teal-700 dark:text-teal-400" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
