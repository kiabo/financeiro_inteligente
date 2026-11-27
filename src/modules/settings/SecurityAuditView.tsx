import { Check, Copy, Database, History, RotateCcw, Shield, UserPlus, X } from 'lucide-react';
import React, { useState } from 'react';
import sqlMigrationRaw from '../../../supabase/migrations/0001_module1_foundation.sql?raw';
import sqlMigrationModule2Raw from '../../../supabase/migrations/0002_module2_financial_core.sql?raw';
import sqlMigrationModule3Raw from '../../../supabase/migrations/0003_module3_projects.sql?raw';
import sqlMigrationModule4Raw from '../../../supabase/migrations/0004_module4_health_debts_taxes.sql?raw';
import sqlMigrationModule5Raw from '../../../supabase/migrations/0005_module5_ai_cfo_mcp.sql?raw';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { formatDateTimeBR } from '../../lib/utils';
import { InfoTooltip } from '../core/components/InfoTooltip';
import { canSeeSql } from '../core/roles';
import { inviteUser, resetSandboxStore, revokeInvite } from '../core/repository';
import { isSupabaseConfigured } from '../core/supabase';
import type { AppRole, AuditLogEntry, AuthSessionState, InvitedUser } from '../core/types';

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
  const [copiedSql, setCopiedSql] = useState<'m1' | 'm2' | 'm3' | 'm4' | 'm5' | null>(null);

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

  const showSql = canSeeSql(session.role);

  const handleCopySql = async (target: 'm1' | 'm2' | 'm3' | 'm4' | 'm5') => {
    const content =
      target === 'm1'
        ? sqlMigrationRaw
        : target === 'm2'
          ? sqlMigrationModule2Raw
          : target === 'm3'
            ? sqlMigrationModule3Raw
            : target === 'm4'
              ? sqlMigrationModule4Raw
              : sqlMigrationModule5Raw;
    await navigator.clipboard.writeText(content);
    setCopiedSql(target);
    setTimeout(() => setCopiedSql(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
          Governança &amp; Auditoria
        </span>
        <div className="flex items-center gap-2">
          <h1 className="font-display text-[24px] font-semibold leading-8 tracking-[-0.02em] text-[#0F172A] dark:text-[#EAF1FF]">
            Segurança, Auditoria &amp; Infraestrutura
          </h1>
          <InfoTooltip glossaryKey="rls_isolamento" />
        </div>
        <p className="text-[14px] leading-5 text-[#42484C] dark:text-[#9DB0C2]">
          Controle de convites Invite-Only, histórico imutável de auditoria e migração SQL Supabase.
        </p>
      </div>

      <Tabs defaultValue="invites">
        <TabsList>
          <TabsTrigger value="invites" className="gap-1.5 tabular-nums">
            <Shield className="h-3.5 w-3.5" />
            <span>Convites ({invitedUsers.filter((u) => u.is_active).length})</span>
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-1.5 tabular-nums">
            <History className="h-3.5 w-3.5" />
            <span>Auditoria ({auditLogs.length})</span>
          </TabsTrigger>
          {showSql && (
            <TabsTrigger value="sql" className="gap-1.5">
              <Database className="h-3.5 w-3.5" />
              <span>Esquema SQL &amp; .env</span>
            </TabsTrigger>
          )}
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
                <div className="rounded-[4px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12px] font-medium text-[#991B1B] dark:border-[#7F1D1D] dark:bg-[#3B1219] dark:text-[#FCA5A5]">
                  {error}
                </div>
              )}
              {feedback && (
                <div className="rounded-[4px] border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-2 text-[12px] font-medium text-[#065F46] dark:border-[#005137] dark:bg-[#003C28]/70 dark:text-[#68DBA9]">
                  {feedback}
                </div>
              )}

              <form onSubmit={handleInviteSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
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
                <div className="space-y-1.5">
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
            <CardContent className="divide-y divide-[#F1F5F9] p-0 dark:divide-[#1E2F3F]">
              {invitedUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between gap-4 px-6 py-3 text-[13px] hover:bg-[#F1F5F9] dark:hover:bg-[#162838]/50"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                        {u.email}
                      </p>
                      <StatusChip variant={u.is_active ? 'positive' : 'alert'}>
                        {u.is_active ? 'Ativo' : 'Revogado'}
                      </StatusChip>
                    </div>
                    <p className="text-[12px] tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                      Perfil: {u.role}
                      {u.accepted_at
                        ? ` · Aceito em ${formatDateTimeBR(u.accepted_at)}`
                        : ' · Aguardando primeiro login'}
                    </p>
                  </div>
                  {u.is_active && u.email.toLowerCase() !== session.email.toLowerCase() && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={async () => {
                        await revokeInvite(session.userId, session.email, u.id);
                        await onRefresh();
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
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
                <table className="w-full text-left text-[12px]">
                  <thead className="border-y border-[#CBD5E1] bg-[#F8FAFC] font-medium tracking-[0.02em] text-[#64748B] dark:border-[#2A3B4C] dark:bg-[#08131D] dark:text-[#9DB0C2]">
                    <tr>
                      <th className="px-6 py-2.5">Data / Hora</th>
                      <th className="px-6 py-2.5">Ação</th>
                      <th className="px-6 py-2.5">Entidade</th>
                      <th className="px-6 py-2.5">Token</th>
                      <th className="px-6 py-2.5">Metadados</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9] dark:divide-[#1E2F3F]">
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-[#F1F5F9] dark:hover:bg-[#162838]/50">
                        <td className="whitespace-nowrap px-6 py-2.5 tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                          {formatDateTimeBR(log.created_at)}
                        </td>
                        <td className="px-6 py-2.5 font-mono font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                          {log.action}
                        </td>
                        <td className="px-6 py-2.5 text-[#334155] dark:text-[#B9CADB]">
                          {log.entity_type}
                        </td>
                        <td className="px-6 py-2.5">
                          {log.analytical_token ? (
                            <StatusChip variant="primary">{log.analytical_token}</StatusChip>
                          ) : (
                            <span className="text-[#72787D]">—</span>
                          )}
                        </td>
                        <td className="px-6 py-2.5 font-mono text-[11px] text-[#42484C] dark:text-[#9DB0C2]">
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
        {showSql && (
        <TabsContent value="sql" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>Configuração de Variáveis de Ambiente Supabase</CardTitle>
                <StatusChip variant={isSupabaseConfigured ? 'positive' : 'neutral'}>
                  {isSupabaseConfigured ? 'Conectado' : 'Sandbox Local'}
                </StatusChip>
              </div>
              <CardDescription>
                {isSupabaseConfigured
                  ? 'Conectado ao projeto Supabase configurado'
                  : 'Operando em Sandbox Local (variáveis ainda não definidas)'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-[13px] text-[#334155] dark:text-[#B9CADB]">
              <ol className="list-decimal space-y-2 pl-5 leading-relaxed">
                <li>
                  No painel do Supabase, clique em <strong>Connect</strong> (aba <em>Framework</em> ou{' '}
                  <em>Server</em>) ou acesse <strong>Project Settings → API Keys</strong> e copie{' '}
                  <span className="font-mono">SUPABASE_URL</span> e{' '}
                  <span className="font-mono">SUPABASE_PUBLISHABLE_KEY</span> (ou a chave{' '}
                  <span className="font-mono">anon</span>). Nunca use a{' '}
                  <span className="font-mono">SUPABASE_SECRET_KEY</span> no frontend.
                </li>
                <li>
                  Configure <span className="font-mono">VITE_SUPABASE_URL</span> e{' '}
                  <span className="font-mono">VITE_SUPABASE_PUBLISHABLE_KEY</span> (ou{' '}
                  <span className="font-mono">VITE_SUPABASE_ANON_KEY</span>) no painel de Secrets /
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
                <CardTitle>Migração SQL · Estrutura base</CardTitle>
                <CardDescription>
                  Triggers de tokenização imutável, Invite-Only Gate e RLS forçado na fundação.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => void handleCopySql('m1')}>
                {copiedSql === 'm1' ? (
                  <Check className="h-4 w-4 text-[#059669]" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                <span>{copiedSql === 'm1' ? 'Copiado' : 'Copiar SQL'}</span>
              </Button>
            </CardHeader>
            <CardContent>
              <pre className="max-h-80 overflow-auto rounded-[4px] border border-[#1E293B] bg-[#002130] p-4 font-mono text-[12px] text-[#EAF1FF]">
                {sqlMigrationRaw}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle>Migração SQL · Núcleo financeiro</CardTitle>
                <CardDescription>
                  Catálogo de Produtos/Serviços (`PRD_XX`/`SRV_XX`), Plano de Contas, Lançamentos
                  Caixa/Competência, `project_id` preparado e cálculo seguro de saldos.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => void handleCopySql('m2')}>
                {copiedSql === 'm2' ? (
                  <Check className="h-4 w-4 text-[#059669]" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                <span>{copiedSql === 'm2' ? 'Copiado' : 'Copiar SQL'}</span>
              </Button>
            </CardHeader>
            <CardContent>
              <pre className="max-h-96 overflow-auto rounded-[4px] border border-[#1E293B] bg-[#002130] p-4 font-mono text-[12px] text-[#EAF1FF]">
                {sqlMigrationModule2Raw}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle>Migração SQL · Projetos</CardTitle>
                <CardDescription>
                  Projetos (`PRJ_XX`), Premissas Futuras por Cenário, FK `transactions.project_id`
                  com validação de tenant/empresa e RLS forçado.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => void handleCopySql('m3')}>
                {copiedSql === 'm3' ? (
                  <Check className="h-4 w-4 text-[#059669]" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                <span>{copiedSql === 'm3' ? 'Copiado' : 'Copiar SQL'}</span>
              </Button>
            </CardHeader>
            <CardContent>
              <pre className="max-h-96 overflow-auto rounded-[4px] border border-[#1E293B] bg-[#002130] p-4 font-mono text-[12px] text-[#EAF1FF]">
                {sqlMigrationModule3Raw}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle>Migração SQL · Saúde, dívidas e impostos</CardTitle>
                <CardDescription>
                  Dívidas (`CRD_XX`), Parcelas (`debt_installments`), Guias Fiscais (`tax_obligations`),
                  categorias <span className="font-mono">8.0/8.1/8.2</span>, funções SQL{' '}
                  <span className="font-mono">get_dre_aggregation</span> /{' '}
                  <span className="font-mono">get_profitability_ranking</span> e RLS forçado.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => void handleCopySql('m4')}>
                {copiedSql === 'm4' ? (
                  <Check className="h-4 w-4 text-[#059669]" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                <span>{copiedSql === 'm4' ? 'Copiado' : 'Copiar SQL'}</span>
              </Button>
            </CardHeader>
            <CardContent>
              <pre className="max-h-96 overflow-auto rounded-[4px] border border-[#1E293B] bg-[#002130] p-4 font-mono text-[12px] text-[#EAF1FF]">
                {sqlMigrationModule4Raw}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle>Migração SQL · CFO virtual e MCP</CardTitle>
                <CardDescription>
                  Recomendações do CFO Virtual (<span className="font-mono">ai_insights</span>),
                  chaves SHA-256 e escopos do Servidor MCP (<span className="font-mono">mcp_access_tokens</span>,{' '}
                  <span className="font-mono">mcp_call_logs</span>) com RLS forçado.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => void handleCopySql('m5')}>
                {copiedSql === 'm5' ? (
                  <Check className="h-4 w-4 text-[#059669]" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                <span>{copiedSql === 'm5' ? 'Copiado' : 'Copiar SQL'}</span>
              </Button>
            </CardHeader>
            <CardContent>
              <pre className="max-h-96 overflow-auto rounded-[4px] border border-[#1E293B] bg-[#002130] p-4 font-mono text-[12px] text-[#EAF1FF]">
                {sqlMigrationModule5Raw}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
        )}
      </Tabs>
    </div>
  );
};
