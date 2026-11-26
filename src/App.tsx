import React, { useCallback, useEffect, useState } from 'react';
import { Button } from './components/ui/button';
import { getTodayISO } from './lib/utils';
import {
  AiCfoView,
  fetchAiProviderStatus,
  McpSettingsView,
  pullAndPersistMcpUpdates,
  runCfoStrategicAnalysis,
  syncMcpContextBridge,
} from './modules/ai-cfo';
import { LoginScreen } from './modules/auth/LoginScreen';
import { AppShell } from './modules/core/components/AppShell';
import {
  fetchWorkspaceSnapshot,
  recordSecurityEvent,
  seedSandboxExampleStructure,
  type WorkspaceSnapshot,
} from './modules/core/repository';
import { getSupabaseClient, isSupabaseConfigured } from './modules/core/supabase';
import type { ActiveContext, AppSection, AuthSessionState } from './modules/core/types';
import { CashFlowView } from './modules/core/views/CashFlowView';
import { OverviewView } from './modules/core/views/OverviewView';
import {
  DebtsTaxesView,
  DreView,
  HealthCommandCenterView,
} from './modules/health';
import { CatalogView } from './modules/products';
import { ProjectsView } from './modules/projects';
import { HierarchySettingsView } from './modules/settings/HierarchySettingsView';
import { SecurityAuditView } from './modules/settings/SecurityAuditView';
import { PrivacyVaultView } from './modules/vault/PrivacyVaultView';

const EMPTY_SNAPSHOT: WorkspaceSnapshot = {
  groups: [],
  companies: [],
  accounts: [],
  vault: [],
  auditLogs: [],
  invitedUsers: [],
  productsServices: [],
  categories: [],
  transactions: [],
  projects: [],
  projectForecastItems: [],
  debts: [],
  debtInstallments: [],
  taxObligations: [],
  aiInsights: [],
  mcpTokens: [],
  mcpCallLogs: [],
};

export default function App(): React.JSX.Element {
  const [session, setSession] = useState<AuthSessionState | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(EMPTY_SNAPSHOT);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const [activeContext, setActiveContext] = useState<ActiveContext>({ scope: 'all_independent' });
  const [activeSection, setActiveSection] = useState<AppSection>('overview');
  const [autoCadence, setAutoCadence] = useState<'manual' | 'daily_open'>(() => {
    if (typeof window === 'undefined') return 'manual';
    return localStorage.getItem('vertice_cfo_cadence') === 'daily_open'
      ? 'daily_open'
      : 'manual';
  });
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('vertice_theme') === 'dark';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('vertice_theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  // Verifica sessão Supabase existente (AAL2) ao carregar
  useEffect(() => {
    let mounted = true;
    const bootstrapSession = async () => {
      if (!isSupabaseConfigured) {
        if (mounted) setInitializing(false);
        return;
      }

      const supabase = getSupabaseClient();
      if (!supabase) {
        if (mounted) setInitializing(false);
        return;
      }

      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) {
        if (mounted) setInitializing(false);
        return;
      }

      const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const { data: factorsData } = await supabase.auth.mfa.listFactors();
      const hasVerifiedTotp = Boolean(factorsData?.totp?.some((f) => f.status === 'verified'));

      if (mounted && hasVerifiedTotp && aalData?.currentLevel === 'aal2') {
        setSession({
          mode: 'supabase',
          userId: user.id,
          email: user.email ?? '',
          fullName: (user.user_metadata?.full_name as string | undefined) ?? 'Titular',
          role: 'owner',
          mfaEnrolled: true,
          mfaVerified: true,
          aal: 'aal2',
        });
      }
      if (mounted) setInitializing(false);
    };

    void bootstrapSession();
    return () => {
      mounted = false;
    };
  }, []);

  const refreshWorkspace = useCallback(async () => {
    if (!session) return;
    setLoadingData(true);
    setDataError(null);
    try {
      const next = await fetchWorkspaceSnapshot(session.userId, session.email);
      setSnapshot(next);

      // Reseta contexto caso a entidade selecionada tenha sido excluída
      setActiveContext((prev) => {
        if (prev.scope === 'group' && !next.groups.some((g) => g.id === prev.groupId)) {
          return { scope: 'all_independent' };
        }
        if (prev.scope === 'company' && !next.companies.some((c) => c.id === prev.companyId)) {
          return { scope: 'all_independent' };
        }
        if (prev.scope === 'account' && !next.accounts.some((a) => a.id === prev.accountId)) {
          return { scope: 'all_independent' };
        }
        return prev;
      });
    } catch (err) {
      setDataError(
        err instanceof Error ? err.message : 'Não foi possível carregar os dados do tenant.'
      );
    } finally {
      setLoadingData(false);
    }
  }, [session]);

  useEffect(() => {
    if (session?.mfaVerified) {
      void refreshWorkspace();
    }
  }, [session, refreshWorkspace]);

  const handleChangeAutoCadence = (cadence: 'manual' | 'daily_open') => {
    setAutoCadence(cadence);
    localStorage.setItem('vertice_cfo_cadence', cadence);
  };

  // Ponte MCP: mantém contexto anonimizado e hashes de chaves sincronizados + importa simulações
  useEffect(() => {
    if (!session?.mfaVerified || snapshot.companies.length === 0) return;

    const runSync = async () => {
      try {
        await syncMcpContextBridge({
          tenantId: session.userId,
          workspace: snapshot,
          activeContext,
          tokens: snapshot.mcpTokens,
        });
        const imported = await pullAndPersistMcpUpdates({
          tenantId: session.userId,
          userEmail: session.email,
          companies: snapshot.companies,
          productsServices: snapshot.productsServices,
        });
        if (imported > 0) {
          void refreshWorkspace();
        }
      } catch {
        // Falha silenciosa de ponte em segundo plano
      }
    };

    void runSync();
    if (!snapshot.mcpTokens.some((t) => t.is_active)) return;

    const timer = setInterval(() => {
      void runSync();
    }, 15000);
    return () => clearInterval(timer);
  }, [session, snapshot, activeContext, refreshWorkspace]);

  // Geração agendada (1x ao dia na abertura) quando configurada pelo usuário
  useEffect(() => {
    if (
      !session?.mfaVerified ||
      autoCadence !== 'daily_open' ||
      snapshot.companies.length === 0
    ) {
      return;
    }

    const today = getTodayISO();
    const lastRunKey = `vertice_cfo_last_run_${session.userId}`;
    if (localStorage.getItem(lastRunKey) === today) return;

    let cancelled = false;
    void fetchAiProviderStatus().then(async (status) => {
      if (cancelled || !status.configured) return;
      localStorage.setItem(lastRunKey, today);
      try {
        await runCfoStrategicAnalysis({
          tenantId: session.userId,
          userEmail: session.email,
          workspace: snapshot,
          activeContext,
          regime: 'cash',
        });
        if (!cancelled) {
          void refreshWorkspace();
        }
      } catch {
        // Usuário pode acionar manualmente na tela caso ocorra erro transitório
      }
    });

    return () => {
      cancelled = true;
    };
  }, [session, autoCadence, snapshot, activeContext, refreshWorkspace]);

  const handleLogout = async () => {
    if (session) {
      await recordSecurityEvent(session.userId, session.email, 'auth.logout', 'session');
    }
    if (isSupabaseConfigured) {
      const supabase = getSupabaseClient();
      await supabase?.auth.signOut();
    }
    setSession(null);
    setSnapshot(EMPTY_SNAPSHOT);
    setActiveContext({ scope: 'all_independent' });
    setActiveSection('overview');
  };

  const handleSeedExample = async () => {
    if (!session) return;
    setSeeding(true);
    try {
      await seedSandboxExampleStructure(session.userId, session.email);
      await refreshWorkspace();
    } finally {
      setSeeding(false);
    }
  };

  if (initializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] dark:bg-[#08131D]">
        <p className="text-[14px] text-[#42484C] dark:text-[#9DB0C2]">Verificando sessão segura...</p>
      </div>
    );
  }

  if (!session || !session.mfaVerified) {
    return <LoginScreen onAuthenticated={(authSession) => setSession(authSession)} />;
  }

  return (
    <AppShell
      session={session}
      groups={snapshot.groups}
      companies={snapshot.companies}
      accounts={snapshot.accounts}
      activeContext={activeContext}
      activeSection={activeSection}
      isDark={isDark}
      onToggleTheme={() => setIsDark((prev) => !prev)}
      onChangeContext={setActiveContext}
      onNavigate={setActiveSection}
      onLogout={handleLogout}
    >
      {dataError ? (
        <div className="rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] p-6 text-[14px] text-[#991B1B] dark:border-[#7F1D1D] dark:bg-[#3B1219] dark:text-[#FCA5A5]">
          <p className="font-semibold">Erro ao consultar registros protegidos por RLS</p>
          <p className="mt-1 text-[12px] opacity-90">{dataError}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => void refreshWorkspace()}
          >
            Tentar novamente
          </Button>
        </div>
      ) : loadingData && snapshot.companies.length === 0 && snapshot.auditLogs.length === 0 ? (
        <div className="space-y-4">
          <div className="h-24 animate-pulse rounded-[8px] border border-[#E2E8F0] bg-white dark:border-[#1E2F3F] dark:bg-[#0D1A26]" />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-[8px] border border-[#E2E8F0] bg-white dark:border-[#1E2F3F] dark:bg-[#0D1A26]"
              />
            ))}
          </div>
        </div>
      ) : (
        <>
          {activeSection === 'overview' && (
            <OverviewView
              session={session}
              groups={snapshot.groups}
              companies={snapshot.companies}
              accounts={snapshot.accounts}
              productsServices={snapshot.productsServices}
              projects={snapshot.projects}
              transactions={snapshot.transactions}
              vault={snapshot.vault}
              activeContext={activeContext}
              onNavigate={setActiveSection}
              onSeedExample={handleSeedExample}
              seeding={seeding}
            />
          )}

          {activeSection === 'health' && (
            <HealthCommandCenterView
              session={session}
              groups={snapshot.groups}
              companies={snapshot.companies}
              accounts={snapshot.accounts}
              categories={snapshot.categories}
              productsServices={snapshot.productsServices}
              projects={snapshot.projects}
              projectForecastItems={snapshot.projectForecastItems}
              transactions={snapshot.transactions}
              debts={snapshot.debts}
              debtInstallments={snapshot.debtInstallments}
              taxObligations={snapshot.taxObligations}
              vault={snapshot.vault}
              aiInsights={snapshot.aiInsights}
              activeContext={activeContext}
              onNavigate={setActiveSection}
              onRefresh={refreshWorkspace}
            />
          )}

          {activeSection === 'ai_cfo' && (
            <AiCfoView
              session={session}
              workspace={snapshot}
              aiInsights={snapshot.aiInsights}
              activeContext={activeContext}
              onRefresh={refreshWorkspace}
              onNavigate={setActiveSection}
              autoCadence={autoCadence}
              onChangeAutoCadence={handleChangeAutoCadence}
            />
          )}

          {activeSection === 'dre' && (
            <DreView
              groups={snapshot.groups}
              companies={snapshot.companies}
              accounts={snapshot.accounts}
              categories={snapshot.categories}
              transactions={snapshot.transactions}
              activeContext={activeContext}
              onNavigate={setActiveSection}
            />
          )}

          {activeSection === 'debts_taxes' && (
            <DebtsTaxesView
              session={session}
              companies={snapshot.companies}
              accounts={snapshot.accounts}
              transactions={snapshot.transactions}
              debts={snapshot.debts}
              debtInstallments={snapshot.debtInstallments}
              taxObligations={snapshot.taxObligations}
              activeContext={activeContext}
              onRefresh={refreshWorkspace}
              onNavigate={setActiveSection}
            />
          )}

          {activeSection === 'transactions' && (
            <CashFlowView
              session={session}
              groups={snapshot.groups}
              companies={snapshot.companies}
              accounts={snapshot.accounts}
              categories={snapshot.categories}
              productsServices={snapshot.productsServices}
              projects={snapshot.projects}
              transactions={snapshot.transactions}
              activeContext={activeContext}
              onRefresh={refreshWorkspace}
              onNavigateHierarchy={() => setActiveSection('hierarchy')}
            />
          )}

          {activeSection === 'projects' && (
            <ProjectsView
              session={session}
              groups={snapshot.groups}
              companies={snapshot.companies}
              accounts={snapshot.accounts}
              categories={snapshot.categories}
              productsServices={snapshot.productsServices}
              projects={snapshot.projects}
              forecastItems={snapshot.projectForecastItems}
              transactions={snapshot.transactions}
              activeContext={activeContext}
              onRefresh={refreshWorkspace}
              onNavigateHierarchy={() => setActiveSection('hierarchy')}
            />
          )}

          {activeSection === 'catalog' && (
            <CatalogView
              session={session}
              groups={snapshot.groups}
              companies={snapshot.companies}
              accounts={snapshot.accounts}
              productsServices={snapshot.productsServices}
              activeContext={activeContext}
              onRefresh={refreshWorkspace}
              onNavigateHierarchy={() => setActiveSection('hierarchy')}
            />
          )}

          {activeSection === 'hierarchy' && (
            <HierarchySettingsView
              session={session}
              groups={snapshot.groups}
              companies={snapshot.companies}
              accounts={snapshot.accounts}
              onRefresh={refreshWorkspace}
            />
          )}

          {activeSection === 'vault' && (
            <PrivacyVaultView
              session={session}
              groups={snapshot.groups}
              companies={snapshot.companies}
              accounts={snapshot.accounts}
              productsServices={snapshot.productsServices}
              transactions={snapshot.transactions}
              vault={snapshot.vault}
              onRefresh={refreshWorkspace}
            />
          )}

          {activeSection === 'mcp_settings' && (
            <McpSettingsView
              session={session}
              workspace={snapshot}
              mcpTokens={snapshot.mcpTokens}
              mcpCallLogs={snapshot.mcpCallLogs}
              activeContext={activeContext}
              onRefresh={refreshWorkspace}
              onNavigate={setActiveSection}
            />
          )}

          {activeSection === 'security' && (
            <SecurityAuditView
              session={session}
              auditLogs={snapshot.auditLogs}
              invitedUsers={snapshot.invitedUsers}
              onRefresh={refreshWorkspace}
            />
          )}
        </>
      )}
    </AppShell>
  );
}
