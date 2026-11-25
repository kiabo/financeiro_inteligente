import React, { useCallback, useEffect, useState } from 'react';
import { Button } from './components/ui/button';
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
import { OverviewView } from './modules/core/views/OverviewView';
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
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <p className="text-sm text-slate-500 dark:text-slate-400">Verificando sessão segura...</p>
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
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-100">
          <p className="font-semibold">Erro ao consultar registros protegidos por RLS</p>
          <p className="mt-1 text-xs opacity-90">{dataError}</p>
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
          <div className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
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
              vault={snapshot.vault}
              activeContext={activeContext}
              onNavigate={setActiveSection}
              onSeedExample={handleSeedExample}
              seeding={seeding}
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
              vault={snapshot.vault}
              onRefresh={refreshWorkspace}
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
