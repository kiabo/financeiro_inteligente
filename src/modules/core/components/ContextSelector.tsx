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
          className="inline-flex h-9 max-w-[230px] sm:max-w-[340px] items-center justify-between gap-2 rounded-[4px] border border-[#CBD5E1] bg-white px-3 text-[13px] font-medium text-[#0F172A] transition-colors hover:bg-[#F8FAFC] focus:border-[#0F374A] focus:outline-none focus:ring-2 focus:ring-[#0F374A]/12 dark:border-[#2A3B4C] dark:bg-[#0D1A26] dark:text-[#EAF1FF] dark:hover:bg-[#162838] cursor-pointer"
        >
          <span className="flex items-center gap-2 truncate">
            {activeContext.scope === 'group' ? (
              <Layers className="h-3.5 w-3.5 shrink-0 text-[#0F374A] dark:text-[#A7CBE3]" />
            ) : activeContext.scope === 'account' ? (
              <Wallet className="h-3.5 w-3.5 shrink-0 text-[#0F374A] dark:text-[#A7CBE3]" />
            ) : (
              <Building2 className="h-3.5 w-3.5 shrink-0 text-[#0F374A] dark:text-[#A7CBE3]" />
            )}
            <span className="truncate tabular-nums">{activeLabel}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#72787D]" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 p-2 max-h-[75vh] overflow-y-auto">
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => selectAndClose({ scope: 'all_independent' })}
            className={cn(
              'flex w-full items-center justify-between rounded-[4px] px-2.5 py-2 text-left text-[12px] font-medium transition-colors cursor-pointer',
              activeContext.scope === 'all_independent'
                ? 'bg-[#EFF4FF] text-[#0F374A] dark:bg-[#162838] dark:text-[#EAF1FF]'
                : 'text-[#334155] hover:bg-[#F1F5F9] dark:text-[#B9CADB] dark:hover:bg-[#162838]/60'
            )}
          >
            <span>Todas as Empresas / Estrutura</span>
            {activeContext.scope === 'all_independent' && (
              <Check className="h-3.5 w-3.5 text-[#0F374A] dark:text-[#68DBA9]" />
            )}
          </button>

          {/* Visão Consolidada por Grupo (somente quando há empresas vinculadas) */}
          <div className="border-t border-[#E2E8F0] pt-2 dark:border-[#1E2F3F]">
            <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
              Grupos Consolidados
            </p>
            {consolidatedGroups.length === 0 ? (
              <p className="px-2.5 py-1.5 text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
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
                        'flex w-full items-center justify-between rounded-[4px] px-2.5 py-2 text-left text-[12px] transition-colors cursor-pointer',
                        isSelected
                          ? 'bg-[#EFF4FF] text-[#0F374A] dark:bg-[#162838] dark:text-[#EAF1FF]'
                          : 'text-[#334155] hover:bg-[#F1F5F9] dark:text-[#B9CADB] dark:hover:bg-[#162838]/60'
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{group.name}</p>
                        <p className="text-[11px] tabular-nums text-[#72787D]">
                          {group.analytical_token} · {linkedCompanies.length}{' '}
                          {linkedCompanies.length === 1 ? 'empresa' : 'empresas'}
                        </p>
                      </div>
                      {isSelected && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-[#0F374A] dark:text-[#68DBA9]" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Empresas e Contas Individuais */}
          <div className="border-t border-[#E2E8F0] pt-2 dark:border-[#1E2F3F]">
            <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
              Empresas &amp; Contas
            </p>
            {companies.length === 0 ? (
              <p className="px-2.5 py-1.5 text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
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
                          'flex w-full items-center justify-between rounded-[4px] px-2.5 py-2 text-left text-[12px] transition-colors cursor-pointer',
                          isCompSelected
                            ? 'bg-[#EFF4FF] text-[#0F374A] dark:bg-[#162838] dark:text-[#EAF1FF]'
                            : 'text-[#334155] hover:bg-[#F1F5F9] dark:text-[#B9CADB] dark:hover:bg-[#162838]/60'
                        )}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {company.trade_name ?? company.legal_name}
                          </p>
                          <p className="text-[11px] tabular-nums text-[#72787D]">
                            {company.analytical_token} ·{' '}
                            {company.group_id ? 'Vinculada a grupo' : 'Independente'}
                          </p>
                        </div>
                        {isCompSelected && (
                          <Check className="h-3.5 w-3.5 shrink-0 text-[#0F374A] dark:text-[#68DBA9]" />
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
                              'flex w-full items-center justify-between rounded-[4px] py-1.5 pl-6 pr-2.5 text-left text-[12px] transition-colors cursor-pointer',
                              isAccSelected
                                ? 'bg-[#EFF4FF] text-[#0F374A] dark:bg-[#162838] dark:text-[#EAF1FF]'
                                : 'text-[#42484C] hover:bg-[#F1F5F9] dark:text-[#9DB0C2] dark:hover:bg-[#162838]/60'
                            )}
                          >
                            <div className="min-w-0">
                              <p className="truncate">{account.name}</p>
                              <p className="text-[11px] tabular-nums text-[#72787D]">
                                {account.analytical_token}
                              </p>
                            </div>
                            {isAccSelected && (
                              <Check className="h-3.5 w-3.5 shrink-0 text-[#0F374A] dark:text-[#68DBA9]" />
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
