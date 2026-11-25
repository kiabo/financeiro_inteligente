import { Check, Copy, Database, History, RotateCcw, Shield, UserPlus, X } from 'lucide-react';
import React, { useState } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { formatDateTimeBR } from '../../lib/utils';
import { InfoTooltip } from '../core/components/InfoTooltip';
import { inviteUser, resetSandboxStore, revokeInvite } from '../core/repository';
import { isSupabaseConfigured } from '../core/supabase';
import type { AppRole, AuditLogEntry, AuthSessionState, InvitedUser } from '../core/types';
import sqlMigrationRaw from '../../../supabase/migrations/0001_module1_foundation.sql?raw';

interface SecurityAuditViewProps {
  session: AuthSessionState;
  auditLogs: AuditLogEntry[];
  invitedUsers: InvitedUser[];
  onRefresh: () => Promise<void>;
}

export const SecurityAuditView: React.FC<SecurityAuditViewProps> = ({
  session,
  auditLogs,
  invitedUsers,
  onRefresh,
}) => {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AppRole>('analyst');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    try {
      await inviteUser(session.userId, session.email, inviteEmail, inviteRole);
      setInviteEmail('');
      await onRefresh();
      setFeedback('Convite autorizado registrado. Somente e-mails listados podem criar conta.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao registrar convite.');
    }
  };

  const handleCopySql = async () => {
    await navigator.clipboard.writeText(sqlMigrationRaw);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Segurança, Auditoria &amp; Infraestrutura
          </h1>
          <InfoTooltip glossaryKey="rls_isolamento" />
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Controle de convites Invite-Only, histórico imutável de auditoria e migração SQL Supabase.
        </p>
      </div>

      <Tabs defaultValue="invites">
        <TabsList>
          <TabsTrigger value="invites" className="gap-1.5">
            <Shield className="h-3.5 w-3.5" />
            <span>Convites ({invitedUsers.filter((u) => u.is_active).length})</span>
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-1.5">
            <History className="h-3.5 w-3.5" />
            <span>Auditoria ({auditLogs.length})</span>
          </TabsTrigger>
          <TabsTrigger value="sql" className="gap-1.5">
            <Database className="h-3.5 w-3.5" />
            <span>Esquema SQL &amp; .env</span>
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: INVITE-ONLY */}
        <TabsContent value="invites" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Pré-aprovar Usuário Convidado (Invite-Only)</CardTitle>
              <CardDescription>
                O trigger <span className="font-mono">enforce_invite_only_signup</span> no PostgreSQL
                bloqueia qualquer tentativa de cadastro que não conste nesta lista ativa.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-200">
                  {error}
                </div>
              )}
              {feedback && (
                <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-900 dark:border-teal-900 dark:bg-teal-950/60 dark:text-teal-200">
                  {feedback}
                </div>
              )}

              <form onSubmit={handleInviteSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="invite-email">E-mail autorizado *</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="controller@empresa.com.br"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-role">Perfil de Acesso</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as AppRole)}>
                    <SelectTrigger id="invite-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="owner">Titular (Owner)</SelectItem>
                      <SelectItem value="admin">Administrador</SelectItem>
                      <SelectItem value="analyst">Analista Financeiro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button type="submit" variant="primary" className="w-full">
                    <UserPlus className="h-4 w-4" />
                    <span>Autorizar Convite</span>
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lista de Convites &amp; Sessão Atual</CardTitle>
              <CardDescription>
                Sessão conectada: <span className="font-mono">{session.email}</span> · MFA{' '}
                <span className="font-mono">{session.aal.toUpperCase()}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="divide-y divide-slate-100 p-0 dark:divide-slate-800">
              {invitedUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between gap-4 px-6 py-3.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                      {u.email}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Perfil: {u.role} · {u.is_active ? 'Convite ativo' : 'Revogado'}
                      {u.accepted_at ? ` · Aceito em ${formatDateTimeBR(u.accepted_at)}` : ' · Aguardando primeiro login'}
                    </p>
                  </div>
                  {u.is_active && u.email.toLowerCase() !== session.email.toLowerCase() && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        await revokeInvite(session.userId, session.email, u.id);
                        await onRefresh();
                      }}
                    >
                      <X className="h-4 w-4" />
                      <span>Revogar</span>
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: AUDIT LOGS */}
        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle>Trilha de Auditoria (`audit_logs`)</CardTitle>
              <CardDescription>
                Registros append-only de autenticação, MFA, cadastros e verificações do Cofre.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-y border-slate-200 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                    <tr>
                      <th className="px-6 py-3 font-medium">Data / Hora</th>
                      <th className="px-6 py-3 font-medium">Ação</th>
                      <th className="px-6 py-3 font-medium">Entidade</th>
                      <th className="px-6 py-3 font-medium">Token</th>
                      <th className="px-6 py-3 font-medium">Metadados</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="whitespace-nowrap px-6 py-3 font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {formatDateTimeBR(log.created_at)}
                        </td>
                        <td className="px-6 py-3 font-mono font-medium text-slate-900 dark:text-slate-100">
                          {log.action}
                        </td>
                        <td className="px-6 py-3 text-slate-600 dark:text-slate-300">
                          {log.entity_type}
                        </td>
                        <td className="px-6 py-3 font-mono text-teal-700 dark:text-teal-400">
                          {log.analytical_token ?? '—'}
                        </td>
                        <td className="px-6 py-3 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          {JSON.stringify(log.metadata)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: SQL & ENV */}
        <TabsContent value="sql" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configuração de Variáveis de Ambiente Supabase</CardTitle>
              <CardDescription>
                Status atual:{' '}
                <strong>
                  {isSupabaseConfigured
                    ? 'Conectado ao projeto Supabase configurado'
                    : 'Operando em Sandbox Local (variáveis ainda não definidas)'}
                </strong>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-600 dark:text-slate-300">
              <ol className="list-decimal space-y-2 pl-5 text-xs sm:text-sm leading-relaxed">
                <li>
                  No painel do Supabase, acesse <strong>Project Settings → API</strong> e copie a{' '}
                  <span className="font-mono">Project URL</span> e a chave pública{' '}
                  <span className="font-mono">anon public</span>.
                </li>
                <li>
                  Configure <span className="font-mono">VITE_SUPABASE_URL</span> e{' '}
                  <span className="font-mono">VITE_SUPABASE_ANON_KEY</span> no painel de Secrets /
                  variáveis de ambiente (ou arquivo <span className="font-mono">.env</span> local).
                </li>
                <li>
                  No Supabase Auth, desative <strong>Enable email signups</strong> e ative{' '}
                  <strong>MFA (TOTP)</strong>.
                </li>
                <li>
                  Execute o script SQL abaixo no <strong>SQL Editor</strong> do Supabase e insira seu
                  e-mail inicial em <span className="font-mono">public.invited_users</span>.
                </li>
              </ol>

              {!isSupabaseConfigured && (
                <div className="pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      resetSandboxStore();
                      await onRefresh();
                      setFeedback('Armazenamento Sandbox local reiniciado.');
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Reiniciar Dados Sandbox Local</span>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle>Migração PostgreSQL (`0001_module1_foundation.sql`)</CardTitle>
                <CardDescription>
                  Inclui triggers de tokenização imutável, Invite-Only Gate e RLS forçado em 100% das tabelas.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => void handleCopySql()}>
                {copiedSql ? <Check className="h-4 w-4 text-teal-600" /> : <Copy className="h-4 w-4" />}
                <span>{copiedSql ? 'Copiado' : 'Copiar SQL'}</span>
              </Button>
            </CardHeader>
            <CardContent>
              <pre className="max-h-96 overflow-auto rounded-xl border border-slate-200 bg-slate-950 p-4 font-mono text-xs text-slate-200 dark:border-slate-800">
                {sqlMigrationRaw}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
