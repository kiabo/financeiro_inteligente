import {
  Building2,
  LayoutDashboard,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import React, { useState } from 'react';
import { cn } from '../../../lib/utils';
import { OfflineIndicator } from '../pwa/OfflineIndicator';
import { PWAInstallButton } from '../pwa/PWAInstallButton';
import type {
  ActiveContext,
  AppSection,
  AuthSessionState,
  BusinessGroup,
  Company,
  FinancialAccount,
} from '../types';
import { ContextSelector } from './ContextSelector';

interface AppShellProps {
  session: AuthSessionState;
  groups: BusinessGroup[];
  companies: Company[];
  accounts: FinancialAccount[];
  activeContext: ActiveContext;
  activeSection: AppSection;
  isDark: boolean;
  onToggleTheme: () => void;
  onChangeContext: (ctx: ActiveContext) => void;
  onNavigate: (section: AppSection) => void;
  onLogout: () => Promise<void>;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{
  id: AppSection;
  label: string;
  mobileLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Visão Geral', mobileLabel: 'Visão', icon: LayoutDashboard },
  { id: 'hierarchy', label: 'Empresas & Contas', mobileLabel: 'Cadastros', icon: Building2 },
  { id: 'vault', label: 'Cofre de Privacidade', mobileLabel: 'Cofre', icon: ShieldCheck },
  { id: 'security', label: 'Segurança & SQL', mobileLabel: 'Segurança', icon: Shield },
];

export const AppShell: React.FC<AppShellProps> = ({
  session,
  groups,
  companies,
  accounts,
  activeContext,
  activeSection,
  isDark,
  onToggleTheme,
  onChangeContext,
  onNavigate,
  onLogout,
  children,
}) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Desktop Sidebar (Colapsável) */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden border-r border-slate-200 bg-white transition-[width] duration-200 md:flex md:flex-col dark:border-slate-800 dark:bg-slate-900',
          sidebarCollapsed ? 'w-[72px]' : 'w-64'
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4 dark:border-slate-800">
          <div className={cn('flex items-center gap-2.5 overflow-hidden', sidebarCollapsed && 'justify-center w-full')}>
            <img
              src="/icon.svg"
              alt="Vértice"
              className="h-8 w-8 shrink-0 rounded-lg border border-slate-200 dark:border-slate-800"
            />
            {!sidebarCollapsed && (
              <span className="font-display text-base font-bold tracking-tight whitespace-nowrap">
                Vértice
              </span>
            )}
          </div>
          {!sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              aria-label="Recolher barra lateral"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}
        </div>

        <nav className="flex-1 space-y-1 p-3" aria-label="Navegação principal">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                title={sidebarCollapsed ? item.label : undefined}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap',
                  sidebarCollapsed && 'justify-center px-0',
                  active
                    ? 'bg-slate-900 text-white dark:bg-teal-600 dark:text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-3 space-y-2 dark:border-slate-800">
          {sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="Expandir barra lateral"
              className="flex h-9 w-full items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100 cursor-pointer"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          )}

          {!sidebarCollapsed && (
            <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs dark:bg-slate-950">
              <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                {session.email}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Sessão {session.aal.toUpperCase()} · {session.role}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => void onLogout()}
            title="Encerrar sessão"
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 cursor-pointer',
              sidebarCollapsed && 'justify-center px-0'
            )}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && <span>Sair</span>}
          </button>
        </div>
      </aside>

      {/* Container Principal */}
      <div
        className={cn(
          'flex min-h-screen flex-col transition-[padding-left] duration-200',
          sidebarCollapsed ? 'md:pl-[72px]' : 'md:pl-64'
        )}
      >
        {/* Header Global (Desktop & Mobile) */}
        <header className="sticky top-0 z-20 flex h-13 md:h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur-sm sm:px-6 dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/icon.svg"
              alt="Vértice"
              className="h-7 w-7 shrink-0 rounded-md border border-slate-200 md:hidden dark:border-slate-800"
            />
            <ContextSelector
              groups={groups}
              companies={companies}
              accounts={accounts}
              activeContext={activeContext}
              onChangeContext={onChangeContext}
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:block">
              <PWAInstallButton />
            </div>
            <div className="sm:hidden">
              <PWAInstallButton compact />
            </div>

            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={isDark ? 'Alternar para tema claro' : 'Alternar para tema escuro'}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <button
              type="button"
              onClick={() => void onLogout()}
              aria-label="Sair"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 md:hidden dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Área de Conteúdo */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-24 sm:px-6 md:pb-10">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav
        aria-label="Navegação móvel"
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-md md:hidden pb-safe dark:border-slate-800 dark:bg-slate-900/95"
      >
        <div className="grid h-16 grid-cols-4 items-center">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={cn(
                  'flex h-full min-h-[44px] flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors cursor-pointer',
                  active
                    ? 'text-teal-700 dark:text-teal-400'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                )}
              >
                <Icon className="h-5 w-5" />
                <span>{item.mobileLabel}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <OfflineIndicator />
    </div>
  );
};
