import {
  Activity,
  ArrowLeftRight,
  BellRing,
  Building2,
  Camera,
  GitCompareArrows,
  Plug,
  Cpu,
  FileSpreadsheet,
  FolderKanban,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import React, { useState } from 'react';
import { cn } from '../../../lib/utils';
import { SECTION_TITLES } from '../routes';
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
  /** Abre o fluxo "Lançar por Foto (OCR) ou Manual" (botão central mobile / topo desktop) */
  onOpenReceiptCapture: () => void;
  children: React.ReactNode;
}

interface NavItem {
  id: AppSection;
  label: string;
  mobileLabel: string;
  sectionGroup: 'core' | 'governance';
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'overview',
    label: SECTION_TITLES.overview,
    mobileLabel: 'Visão',
    sectionGroup: 'core',
    icon: LayoutDashboard,
  },
  {
    id: 'health',
    label: SECTION_TITLES.health,
    mobileLabel: 'Saúde',
    sectionGroup: 'core',
    icon: Activity,
  },
  {
    id: 'ai_cfo',
    label: SECTION_TITLES.ai_cfo,
    mobileLabel: 'CFO IA',
    sectionGroup: 'core',
    icon: Cpu,
  },
  {
    id: 'dre',
    label: SECTION_TITLES.dre,
    mobileLabel: 'DRE',
    sectionGroup: 'core',
    icon: FileSpreadsheet,
  },
  {
    id: 'transactions',
    label: SECTION_TITLES.transactions,
    mobileLabel: 'Fluxo',
    sectionGroup: 'core',
    icon: ArrowLeftRight,
  },
  {
    id: 'debts_taxes',
    label: SECTION_TITLES.debts_taxes,
    mobileLabel: 'Dívidas',
    sectionGroup: 'core',
    icon: Landmark,
  },
  {
    id: 'projects',
    label: SECTION_TITLES.projects,
    mobileLabel: 'Projetos',
    sectionGroup: 'core',
    icon: FolderKanban,
  },
  {
    id: 'catalog',
    label: SECTION_TITLES.catalog,
    mobileLabel: 'Catálogo',
    sectionGroup: 'core',
    icon: Package,
  },
  {
    id: 'reconciliation',
    label: SECTION_TITLES.reconciliation,
    mobileLabel: 'Conciliar',
    sectionGroup: 'core',
    icon: GitCompareArrows,
  },
  {
    id: 'hierarchy',
    label: SECTION_TITLES.hierarchy,
    mobileLabel: 'Cadastros',
    sectionGroup: 'governance',
    icon: Building2,
  },
  {
    id: 'vault',
    label: SECTION_TITLES.vault,
    mobileLabel: 'Cofre',
    sectionGroup: 'governance',
    icon: ShieldCheck,
  },
  {
    id: 'integrations',
    label: SECTION_TITLES.integrations,
    mobileLabel: 'Integrações',
    sectionGroup: 'governance',
    icon: Plug,
  },
  {
    id: 'automation',
    label: SECTION_TITLES.automation,
    mobileLabel: 'Alertas',
    sectionGroup: 'governance',
    icon: BellRing,
  },
  {
    id: 'mcp_settings',
    label: SECTION_TITLES.mcp_settings,
    mobileLabel: 'MCP',
    sectionGroup: 'governance',
    icon: KeyRound,
  },
  {
    id: 'security',
    label: SECTION_TITLES.security,
    mobileLabel: 'Segurança',
    sectionGroup: 'governance',
    icon: Shield,
  },
];

// Barra inferior: 2 itens · botão central de ação rápida (foto/manual) · 1 item · "Mais"
const MOBILE_PRIMARY_IDS: AppSection[] = ['health', 'transactions', 'reconciliation'];
const MOBILE_BOTTOM_ITEMS = MOBILE_PRIMARY_IDS.map((id) => NAV_ITEMS.find((item) => item.id === id)).filter(
  (item): item is NavItem => Boolean(item)
);
const MOBILE_MORE_ITEMS = NAV_ITEMS.filter((item) => !MOBILE_PRIMARY_IDS.includes(item.id));

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
  onOpenReceiptCapture,
  children,
}) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  const isMoreSectionActive = MOBILE_MORE_ITEMS.some((i) => i.id === activeSection);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] dark:bg-[#08131D] dark:text-[#EAF1FF]">
      {/* Desktop Sidebar (Colapsável) */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden border-r border-[#E2E8F0] bg-white transition-[width] duration-200 md:flex md:flex-col dark:border-[#1E2F3F] dark:bg-[#0D1A26]',
          sidebarCollapsed ? 'w-[68px]' : 'w-64'
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-[#E2E8F0] px-4 dark:border-[#1E2F3F]">
          <div
            className={cn(
              'flex items-center gap-2.5 overflow-hidden',
              sidebarCollapsed && 'justify-center w-full'
            )}
          >
            <img
              src="/icon.svg"
              alt="Vértice"
              className="h-7 w-7 shrink-0 rounded-[4px] border border-[#E2E8F0] dark:border-[#2A3B4C]"
            />
            {!sidebarCollapsed && (
              <span className="font-display text-[15px] font-semibold tracking-[-0.015em] text-[#0F172A] whitespace-nowrap dark:text-[#EAF1FF]">
                Vértice
              </span>
            )}
          </div>
          {!sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              aria-label="Recolher barra lateral"
              className="inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-[#72787D] hover:bg-[#F1F5F9] hover:text-[#0F172A] dark:hover:bg-[#162838] dark:hover:text-[#EAF1FF] cursor-pointer"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto p-3" aria-label="Navegação principal">
          <div className="space-y-1">
            {!sidebarCollapsed && (
              <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
                Core Financeiro
              </p>
            )}
            {NAV_ITEMS.filter((i) => i.sectionGroup === 'core').map((item) => {
              const Icon = item.icon;
              const active = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  title={sidebarCollapsed ? item.label : undefined}
                  className={cn(
                    'flex h-9 w-full items-center gap-3 rounded-[4px] px-3 text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap',
                    sidebarCollapsed && 'justify-center px-0',
                    active
                      ? 'bg-[#0F374A] text-white dark:bg-[#0F374A] dark:text-white'
                      : 'text-[#334155] hover:bg-[#F1F5F9] hover:text-[#0F172A] dark:text-[#B9CADB] dark:hover:bg-[#162838] dark:hover:text-[#EAF1FF]'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </div>

          <div className="space-y-1">
            {!sidebarCollapsed && (
              <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
                Governança &amp; Base
              </p>
            )}
            {NAV_ITEMS.filter((i) => i.sectionGroup === 'governance').map((item) => {
              const Icon = item.icon;
              const active = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  title={sidebarCollapsed ? item.label : undefined}
                  className={cn(
                    'flex h-9 w-full items-center gap-3 rounded-[4px] px-3 text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap',
                    sidebarCollapsed && 'justify-center px-0',
                    active
                      ? 'bg-[#0F374A] text-white dark:bg-[#0F374A] dark:text-white'
                      : 'text-[#334155] hover:bg-[#F1F5F9] hover:text-[#0F172A] dark:text-[#B9CADB] dark:hover:bg-[#162838] dark:hover:text-[#EAF1FF]'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="border-t border-[#E2E8F0] p-3 space-y-2 dark:border-[#1E2F3F]">
          {sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="Expandir barra lateral"
              className="flex h-8 w-full items-center justify-center rounded-[4px] text-[#72787D] hover:bg-[#F1F5F9] hover:text-[#0F172A] dark:hover:bg-[#162838] dark:hover:text-[#EAF1FF] cursor-pointer"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          )}

          {!sidebarCollapsed && (
            <div className="rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-[12px] dark:border-[#1E2F3F] dark:bg-[#08131D]">
              <p className="truncate font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                {session.email}
              </p>
              <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] tabular-nums dark:text-[#9DB0C2]">
                {session.aal.toUpperCase()} · {session.role}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => void onLogout()}
            title="Encerrar sessão"
            className={cn(
              'flex h-8 w-full items-center gap-2.5 rounded-[4px] px-3 text-[12px] font-medium text-[#42484C] hover:bg-[#F1F5F9] hover:text-[#0F172A] dark:text-[#9DB0C2] dark:hover:bg-[#162838] dark:hover:text-[#EAF1FF] cursor-pointer',
              sidebarCollapsed && 'justify-center px-0'
            )}
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            {!sidebarCollapsed && <span>Encerrar Sessão</span>}
          </button>
        </div>
      </aside>

      {/* Container Principal */}
      <div
        className={cn(
          'flex min-h-screen flex-col transition-[padding-left] duration-200',
          sidebarCollapsed ? 'md:pl-[68px]' : 'md:pl-64'
        )}
      >
        {/* Header Global (Desktop & Mobile) */}
        <header className="sticky top-0 z-20 flex h-13 md:h-14 items-center justify-between gap-3 border-b border-[#E2E8F0] bg-white/95 px-4 backdrop-blur-sm sm:px-8 dark:border-[#1E2F3F] dark:bg-[#0D1A26]/95">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/icon.svg"
              alt="Vértice"
              className="h-7 w-7 shrink-0 rounded-[4px] border border-[#E2E8F0] md:hidden dark:border-[#2A3B4C]"
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
            <button
              type="button"
              onClick={onOpenReceiptCapture}
              className="hidden h-8 items-center gap-2 rounded-[4px] bg-[#0F374A] px-3 text-[12px] font-medium text-white hover:bg-[#164E63] md:inline-flex cursor-pointer"
            >
              <Camera className="h-4 w-4" />
              <span>Lançar por Foto</span>
            </button>
            <div className="hidden sm:block">
              <PWAInstallButton />
            </div>
            <div className="sm:hidden">
              <PWAInstallButton compact />
            </div>

            <button
              type="button"
              onClick={() => onNavigate('vault')}
              aria-label="Cofre de Privacidade"
              className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-[4px] border md:hidden cursor-pointer',
                activeSection === 'vault'
                  ? 'border-[#0F374A] bg-[#0F374A] text-white'
                  : 'border-[#CBD5E1] bg-white text-[#334155] hover:bg-[#F8FAFC] hover:text-[#0F172A] dark:border-[#2A3B4C] dark:bg-[#0D1A26] dark:text-[#B9CADB]'
              )}
            >
              <ShieldCheck className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => onNavigate('security')}
              aria-label="Segurança e SQL"
              className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-[4px] border md:hidden cursor-pointer',
                activeSection === 'security'
                  ? 'border-[#0F374A] bg-[#0F374A] text-white'
                  : 'border-[#CBD5E1] bg-white text-[#334155] hover:bg-[#F8FAFC] hover:text-[#0F172A] dark:border-[#2A3B4C] dark:bg-[#0D1A26] dark:text-[#B9CADB]'
              )}
            >
              <Shield className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={isDark ? 'Alternar para tema claro' : 'Alternar para tema escuro'}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] border border-[#CBD5E1] bg-white text-[#334155] hover:bg-[#F8FAFC] hover:text-[#0F172A] dark:border-[#2A3B4C] dark:bg-[#0D1A26] dark:text-[#B9CADB] dark:hover:bg-[#162838] cursor-pointer"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <button
              type="button"
              onClick={() => void onLogout()}
              aria-label="Sair"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] border border-[#CBD5E1] bg-white text-[#334155] hover:bg-[#F8FAFC] hover:text-[#0F172A] md:hidden dark:border-[#2A3B4C] dark:bg-[#0D1A26] dark:text-[#B9CADB] cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Área de Conteúdo (margens 16px mobile / 32px desktop) */}
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 pb-24 sm:px-8 md:pb-10">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation + Drawer "Mais" */}
      {mobileMoreOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#0F172A]/40 md:hidden"
          onClick={() => setMobileMoreOpen(false)}
        >
          <div
            className="fixed bottom-16 left-0 right-0 border-t border-[#E2E8F0] bg-white p-4 shadow-lg dark:border-[#1E2F3F] dark:bg-[#0D1A26]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
                Módulos &amp; Governança
              </span>
              <button
                type="button"
                aria-label="Fechar menu"
                onClick={() => setMobileMoreOpen(false)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-[#42484C] hover:bg-[#F1F5F9] dark:text-[#9DB0C2] dark:hover:bg-[#162838]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {MOBILE_MORE_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onNavigate(item.id);
                      setMobileMoreOpen(false);
                    }}
                    className={cn(
                      'flex items-center gap-2.5 rounded-[6px] border px-3 py-2.5 text-left text-[12px] font-medium transition-colors cursor-pointer',
                      active
                        ? 'border-[#0F374A] bg-[#0F374A] text-white'
                        : 'border-[#E2E8F0] bg-[#F8FAFC] text-[#0F172A] dark:border-[#1E2F3F] dark:bg-[#08131D] dark:text-[#EAF1FF]'
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <nav
        aria-label="Navegação móvel"
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-[#E2E8F0] bg-white/95 backdrop-blur-md md:hidden pb-safe dark:border-[#1E2F3F] dark:bg-[#0D1A26]/95"
      >
        <div className="grid h-16 grid-cols-5 items-center">
          {MOBILE_BOTTOM_ITEMS.map((item, idx) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            const button = (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setMobileMoreOpen(false);
                  onNavigate(item.id);
                }}
                className={cn(
                  'flex h-full min-h-[44px] flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors cursor-pointer',
                  active
                    ? 'text-[#0F374A] font-semibold dark:text-[#68DBA9]'
                    : 'text-[#42484C] hover:text-[#0F172A] dark:text-[#9DB0C2] dark:hover:text-[#EAF1FF]'
                )}
              >
                <Icon className="h-5 w-5" />
                <span>{item.mobileLabel}</span>
              </button>
            );
            if (idx !== 1) return button;
            return (
              <React.Fragment key={`${item.id}-with-fab`}>
                {button}
                <div className="flex h-full items-center justify-center">
                  <button
                    type="button"
                    aria-label="Lançar por foto (OCR) ou manual"
                    onClick={() => {
                      setMobileMoreOpen(false);
                      onOpenReceiptCapture();
                    }}
                    className="-mt-6 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#0F374A] text-white shadow-[0_8px_16px_-4px_rgba(15,55,74,0.45)] ring-4 ring-[#F8FAFC] active:scale-95 dark:ring-[#08131D] cursor-pointer"
                  >
                    <Camera className="h-6 w-6" />
                  </button>
                </div>
              </React.Fragment>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileMoreOpen((prev) => !prev)}
            className={cn(
              'flex h-full min-h-[44px] flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors cursor-pointer',
              mobileMoreOpen || isMoreSectionActive
                ? 'text-[#0F374A] font-semibold dark:text-[#68DBA9]'
                : 'text-[#42484C] hover:text-[#0F172A] dark:text-[#9DB0C2] dark:hover:text-[#EAF1FF]'
            )}
          >
            <Menu className="h-5 w-5" />
            <span>Mais</span>
          </button>
        </div>
      </nav>

      <OfflineIndicator />
    </div>
  );
};
