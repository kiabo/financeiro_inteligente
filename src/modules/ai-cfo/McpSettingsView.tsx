import {
  Check,
  Copy,
  Eye,
  FolderKanban,
  KeyRound,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
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
import { formatDateTimeBR } from '../../lib/utils';
import { InfoTooltip } from '../core/components/InfoTooltip';
import { createMcpAccessToken, revokeMcpAccessToken } from '../core/repository';
import type {
  ActiveContext,
  AppSection,
  AuthSessionState,
  McpAccessToken,
  McpCallLog,
  McpTokenScope,
} from '../core/types';
import { buildAnonymizedCfoContext, collectAllSensitiveTerms } from './aiContextBuilder';
import {
  pullAndPersistMcpUpdates,
  syncMcpContextBridge,
  type WorkspaceCfoSource,
} from './cfoAgent';
import { PrivacyInspectorModal } from './PrivacyInspectorModal';

interface McpSettingsViewProps {
  session: AuthSessionState;
  workspace: WorkspaceCfoSource;
  mcpTokens: McpAccessToken[];
  mcpCallLogs: McpCallLog[];
  activeContext: ActiveContext;
  onRefresh: () => Promise<void>;
  onNavigate: (section: AppSection) => void;
}

type TestToolName =
  | 'get_financial_health_summary'
  | 'analyze_project_viability'
  | 'get_winners_and_losers'
  | 'simulate_new_project_idea';

export const McpSettingsView: React.FC<McpSettingsViewProps> = ({
  session,
  workspace,
  mcpTokens,
  mcpCallLogs,
  activeContext,
  onRefresh,
  onNavigate,
}) => {
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState<McpTokenScope>('read_only');
  const [expiresDays, setExpiresDays] = useState<string>('90');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [createdSecretOnce, setCreatedSecretOnce] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<'secret' | 'snippet' | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  // Interactive MCP Tester
  const [testerBearer, setTesterBearer] = useState('');
  const [testerTool, setTesterTool] = useState<TestToolName>('get_financial_health_summary');
  const [testerIdea, setTesterIdea] = useState(
    'Simule um projeto com investimento de R$ 25.000, receita mensal de R$ 9.000 por 6 meses usando PRD_01'
  );
  const [testerProjectToken, setTesterProjectToken] = useState('');
  const [testing, setTesting] = useState(false);
  const [testerResult, setTesterResult] = useState<string>('');
  const [testerError, setTesterError] = useState<string | null>(null);

  const [inspectorOpen, setInspectorOpen] = useState(false);

  const originUrl =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const mcpEndpointUrl = `${originUrl}/api/mcp`;

  const clientSnippet = useMemo(() => {
    const tokenPlaceholder = createdSecretOnce ?? 'COLE_SUA_CHAVE_VRT_MCP_AQUI';
    return JSON.stringify(
      {
        mcpServers: {
          'vertice-financeiro-privado': {
            transport: 'streamable-http',
            url: mcpEndpointUrl,
            headers: {
              Authorization: `Bearer ${tokenPlaceholder}`,
            },
          },
        },
      },
      null,
      2
    );
  }, [createdSecretOnce, mcpEndpointUrl]);

  const sensitiveTerms = useMemo(
    () =>
      collectAllSensitiveTerms({
        groups: workspace.groups,
        companies: workspace.companies,
        accounts: workspace.accounts,
        productsServices: workspace.productsServices,
        projects: workspace.projects,
        transactions: workspace.transactions,
        debts: workspace.debts,
        taxObligations: workspace.taxObligations,
        vault: workspace.vault,
      }),
    [workspace]
  );

  const liveAnonymized = useMemo(() => {
    try {
      return buildAnonymizedCfoContext({
        ...workspace,
        activeContext,
        regime: 'cash',
      });
    } catch {
      return null;
    }
  }, [workspace, activeContext]);

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setCreating(true);
    try {
      const exp = expiresDays === 'never' ? null : Number(expiresDays);
      const { tokenRecord, plaintextSecretOnce } = await createMcpAccessToken(
        session.userId,
        session.email,
        {
          label,
          scope,
          expiresInDays: exp,
        }
      );

      setCreatedSecretOnce(plaintextSecretOnce);
      setTesterBearer(plaintextSecretOnce);
      setLabel('');

      // Sync immediately so the new token hash is live on /api/mcp
      const nextTokens = [tokenRecord, ...mcpTokens];
      await syncMcpContextBridge({
        tenantId: session.userId,
        workspace,
        activeContext,
        tokens: nextTokens,
      });

      await onRefresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao criar chave MCP.');
    } finally {
      setCreating(false);
    }
  };

  const handleRevokeToken = async (tokenId: string) => {
    await revokeMcpAccessToken(session.userId, session.email, tokenId);
    const updatedTokens = mcpTokens.map((t) =>
      t.id === tokenId ? { ...t, is_active: false, revoked_at: new Date().toISOString() } : t
    );
    await syncMcpContextBridge({
      tenantId: session.userId,
      workspace,
      activeContext,
      tokens: updatedTokens,
    }).catch(() => undefined);
    await onRefresh();
  };

  const handleManualSync = async () => {
    setSyncing(true);
    setSyncFeedback(null);
    try {
      const bridgeRes = await syncMcpContextBridge({
        tenantId: session.userId,
        workspace,
        activeContext,
        tokens: mcpTokens,
      });
      const imported = await pullAndPersistMcpUpdates({
        tenantId: session.userId,
        userEmail: session.email,
        companies: workspace.companies,
        productsServices: workspace.productsServices,
      });
      await onRefresh();
      setSyncFeedback(
        `Contexto Zero-Leak sincronizado (${bridgeRes.syncedTokens} chave(s) ativa(s))${
          imported > 0 ? ` · ${imported} simulação(ões) MCP importada(s) para Projetos` : ''
        }.`
      );
    } catch (err) {
      setSyncFeedback(err instanceof Error ? err.message : 'Falha na sincronização MCP.');
    } finally {
      setSyncing(false);
    }
  };

  const handleCopy = async (kind: 'secret' | 'snippet', text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(kind);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleTestMcpTool = async () => {
    const bearer = testerBearer.trim();
    if (!bearer) {
      setTesterError('Informe ou gere uma chave MCP Bearer para executar o teste.');
      return;
    }

    setTesting(true);
    setTesterError(null);
    setTesterResult('');

    try {
      // Ensure bridge has latest context & token hashes before calling
      await syncMcpContextBridge({
        tenantId: session.userId,
        workspace,
        activeContext,
        tokens: mcpTokens,
      });

      const args: Record<string, unknown> = {};
      if (testerTool === 'analyze_project_viability' && testerProjectToken.trim()) {
        args.project_token = testerProjectToken.trim().toUpperCase();
      } else if (testerTool === 'simulate_new_project_idea') {
        args.idea_description = testerIdea;
      }

      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name: testerTool,
            arguments: args,
          },
        }),
      });

      const json = await res.json();
      setTesterResult(JSON.stringify(json, null, 2));

      // Pull logs & any simulated project drafts into client store
      await pullAndPersistMcpUpdates({
        tenantId: session.userId,
        userEmail: session.email,
        companies: workspace.companies,
        productsServices: workspace.productsServices,
      });
      await onRefresh();
    } catch (err) {
      setTesterError(err instanceof Error ? err.message : 'Erro ao invocar /api/mcp.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
              Servidor MCP &amp; Chaves
            </span>
            <StatusChip variant="positive">Zero-Leak Verified</StatusChip>
          </div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-[24px] font-semibold leading-8 tracking-[-0.02em] text-[#0F172A] dark:text-[#EAF1FF]">
              Servidor MCP &amp; Chaves de Acesso
            </h1>
            <InfoTooltip glossaryKey="mcp_protocol" />
          </div>
          <p className="text-[14px] leading-5 text-[#42484C] dark:text-[#9DB0C2]">
            Exponha indicadores financeiros e simulações de projeto via Model Context Protocol (
            <span className="font-mono">/api/mcp</span>) usando somente tokens do Cofre.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={!liveAnonymized}
            onClick={() => setInspectorOpen(true)}
          >
            <Eye className="h-4 w-4" />
            <span>Ver Payload MCP Anonimizado</span>
          </Button>
          <Button variant="outline" disabled={syncing} onClick={() => void handleManualSync()}>
            <RefreshCw className={syncing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            <span>Sincronizar Contexto &amp; Rascunhos</span>
          </Button>
          <Button variant="ghost" onClick={() => onNavigate('projects')}>
            <FolderKanban className="h-4 w-4" />
            <span>Ver Projetos Simulados</span>
          </Button>
        </div>
      </div>

      {syncFeedback && (
        <div className="rounded-[6px] border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-2.5 text-[13px] font-medium text-[#065F46] dark:border-[#005137] dark:bg-[#003C28]/60 dark:text-[#68DBA9]">
          {syncFeedback}
        </div>
      )}

      {/* Gerador de Chave MCP + Snippet Pronto */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Gerar Nova Chave de Acesso MCP</CardTitle>
            <CardDescription>
              A chave é exibida apenas uma vez na criação; somente o hash SHA-256 é armazenado no
              banco (<span className="font-mono">mcp_access_tokens</span>).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {formError && (
              <div className="rounded-[4px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#991B1B] dark:border-[#7F1D1D] dark:bg-[#3B1219] dark:text-[#FCA5A5]">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateToken} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="mcp-label">Identificação do Cliente MCP *</Label>
                <Input
                  id="mcp-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Ex.: Claude Desktop Executivo / Cursor Workspace"
                  required
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-scope">Permissão (Escopo)</Label>
                  <Select value={scope} onValueChange={(v) => setScope(v as McpTokenScope)}>
                    <SelectTrigger id="mcp-scope">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="read_only">Somente Leitura (read_only)</SelectItem>
                      <SelectItem value="simulate_drafts">
                        Leitura + Simular Rascunhos (simulate_drafts)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="mcp-exp">Expiração</Label>
                  <Select value={expiresDays} onValueChange={setExpiresDays}>
                    <SelectTrigger id="mcp-exp">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">30 dias</SelectItem>
                      <SelectItem value="90">90 dias</SelectItem>
                      <SelectItem value="180">180 dias</SelectItem>
                      <SelectItem value="never">Sem expiração</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-[12px] text-[#42484C] dark:border-[#1E2F3F] dark:bg-[#08131D] dark:text-[#9DB0C2]">
                {scope === 'read_only' ? (
                  <p>
                    <strong>Somente Leitura:</strong> permite consultar saúde financeira,
                    viabilidade de projetos existentes e ranking Winners &amp; Losers. Bloqueia{' '}
                    <span className="font-mono">simulate_new_project_idea</span>.
                  </p>
                ) : (
                  <p>
                    <strong>Simular Rascunhos:</strong> além da leitura anonimizada, autoriza a
                    criação de rascunhos de projetos (<span className="font-mono">idea_simulation</span>)
                    via chat externo.
                  </p>
                )}
              </div>

              <Button type="submit" variant="primary" disabled={creating} className="w-full">
                <Plus className="h-4 w-4" />
                <span>{creating ? 'Gerando chave...' : 'Gerar Chave MCP'}</span>
              </Button>
            </form>

            {createdSecretOnce && (
              <div className="space-y-2 rounded-[6px] border border-[#A7F3D0] bg-[#ECFDF5] p-3.5 dark:border-[#005137] dark:bg-[#003C28]/60">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-[#065F46] dark:text-[#68DBA9]">
                    Copie sua chave agora (não será exibida novamente)
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleCopy('secret', createdSecretOnce)}
                  >
                    {copiedKey === 'secret' ? (
                      <Check className="h-3.5 w-3.5 text-[#059669]" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    <span>{copiedKey === 'secret' ? 'Copiada' : 'Copiar'}</span>
                  </Button>
                </div>
                <pre className="overflow-x-auto rounded-[4px] bg-[#002130] px-3 py-2 font-mono text-[11.5px] text-[#85F8C4]">
                  {createdSecretOnce}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Snippet de Configuração para Cliente MCP */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Configuração para Cliente MCP</CardTitle>
              <CardDescription>
                Cole este bloco no arquivo de configuração MCP (Streamable HTTP + Bearer Token).
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleCopy('snippet', clientSnippet)}
            >
              {copiedKey === 'snippet' ? (
                <Check className="h-3.5 w-3.5 text-[#059669]" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{copiedKey === 'snippet' ? 'Copiado' : 'Copiar Snippet'}</span>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <pre className="max-h-56 overflow-auto rounded-[6px] border border-[#1E293B] bg-[#002130] p-4 font-mono text-[11.5px] text-[#EAF1FF]">
              {clientSnippet}
            </pre>

            <div className="space-y-1.5 text-[12px]">
              <p className="font-semibold text-[#0F172A] dark:text-[#EAF1FF]">
                Tools MCP expostas (100% Zero-Leak):
              </p>
              <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 text-[#42484C] dark:text-[#9DB0C2]">
                <li className="rounded-[4px] border border-[#E2E8F0] px-2.5 py-1.5 dark:border-[#1E2F3F]">
                  <span className="font-mono font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                    get_financial_health_summary
                  </span>
                </li>
                <li className="rounded-[4px] border border-[#E2E8F0] px-2.5 py-1.5 dark:border-[#1E2F3F]">
                  <span className="font-mono font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                    analyze_project_viability
                  </span>
                </li>
                <li className="rounded-[4px] border border-[#E2E8F0] px-2.5 py-1.5 dark:border-[#1E2F3F]">
                  <span className="font-mono font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                    get_winners_and_losers
                  </span>
                </li>
                <li className="rounded-[4px] border border-[#E2E8F0] px-2.5 py-1.5 dark:border-[#1E2F3F]">
                  <span className="font-mono font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                    simulate_new_project_idea
                  </span>
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Chaves Emitidas & Revogação */}
      <Card>
        <CardHeader>
          <CardTitle>Chaves MCP Emitidas ({mcpTokens.length})</CardTitle>
          <CardDescription>
            Revogue imediatamente qualquer chave comprometida. Chaves revogadas retornam HTTP 401
            no endpoint <span className="font-mono">/api/mcp</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {mcpTokens.length === 0 ? (
            <p className="px-6 pb-6 text-[13px] text-[#72787D]">
              Nenhuma chave MCP gerada ainda. Crie sua primeira chave acima.
            </p>
          ) : (
            <div className="divide-y divide-[#F1F5F9] dark:divide-[#1E2F3F]">
              {mcpTokens.map((tok) => (
                <div
                  key={tok.id}
                  className="flex flex-col gap-3 px-6 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <KeyRound className="h-3.5 w-3.5 text-[#72787D]" />
                      <span className="font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                        {tok.label}
                      </span>
                      <StatusChip variant={tok.is_active ? 'positive' : 'alert'}>
                        {tok.is_active ? 'Ativa' : 'Revogada'}
                      </StatusChip>
                      <StatusChip variant={tok.scope === 'simulate_drafts' ? 'primary' : 'neutral'}>
                        {tok.scope === 'simulate_drafts'
                          ? 'Leitura + Simulação'
                          : 'Somente Leitura'}
                      </StatusChip>
                    </div>
                    <p className="text-[12px] tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                      Prefixo <span className="font-mono">{tok.token_prefix}...</span> ·{' '}
                      {tok.call_count} chamada(s) ·{' '}
                      {tok.last_used_at
                        ? `Último uso ${formatDateTimeBR(tok.last_used_at)}`
                        : 'Nunca utilizada'}
                    </p>
                  </div>

                  {tok.is_active && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => void handleRevokeToken(tok.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Revogar</span>
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Console de Teste ao Vivo do Servidor MCP */}
      <Card>
        <CardHeader>
          <CardTitle>Simulador / Console de Teste do Endpoint `/api/mcp`</CardTitle>
          <CardDescription>
            Execute chamadas JSON-RPC reais autenticadas com sua chave Bearer para validar o
            escopo e a saída Zero-Leak (incluindo criação de rascunhos{' '}
            <span className="font-mono">idea_simulation</span>).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="mcp-tester-token">Chave Bearer MCP (`vrt_mcp_...`)</Label>
              <Input
                id="mcp-tester-token"
                type="password"
                value={testerBearer}
                onChange={(e) => setTesterBearer(e.target.value)}
                placeholder="Cole a chave gerada acima"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mcp-tester-tool">Tool MCP</Label>
              <Select
                value={testerTool}
                onValueChange={(v) => setTesterTool(v as TestToolName)}
              >
                <SelectTrigger id="mcp-tester-tool">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="get_financial_health_summary">
                    get_financial_health_summary
                  </SelectItem>
                  <SelectItem value="analyze_project_viability">
                    analyze_project_viability
                  </SelectItem>
                  <SelectItem value="get_winners_and_losers">get_winners_and_losers</SelectItem>
                  <SelectItem value="simulate_new_project_idea">
                    simulate_new_project_idea
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <Button
                variant="primary"
                className="w-full"
                disabled={testing}
                onClick={() => void handleTestMcpTool()}
              >
                <Play className="h-4 w-4" />
                <span>{testing ? 'Executando RPC...' : 'Executar Tool MCP'}</span>
              </Button>
            </div>
          </div>

          {testerTool === 'analyze_project_viability' && (
            <div className="space-y-1.5">
              <Label htmlFor="mcp-prj-tok">Token do Projeto (opcional, ex.: PRJ_01)</Label>
              <Input
                id="mcp-prj-tok"
                value={testerProjectToken}
                onChange={(e) => setTesterProjectToken(e.target.value)}
                placeholder="Deixe vazio para analisar todos os projetos no escopo"
              />
            </div>
          )}

          {testerTool === 'simulate_new_project_idea' && (
            <div className="space-y-1.5">
              <Label htmlFor="mcp-idea">Ideia de Projeto (exclusivamente com tokens PRD_XX / EMP_XX)</Label>
              <Input
                id="mcp-idea"
                value={testerIdea}
                onChange={(e) => setTesterIdea(e.target.value)}
              />
            </div>
          )}

          {testerError && (
            <div className="rounded-[4px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#991B1B] dark:border-[#7F1D1D] dark:bg-[#3B1219] dark:text-[#FCA5A5]">
              {testerError}
            </div>
          )}

          {testerResult && (
            <pre className="max-h-72 overflow-auto rounded-[6px] border border-[#1E293B] bg-[#002130] p-4 font-mono text-[11.5px] text-[#85F8C4]">
              {testerResult}
            </pre>
          )}
        </CardContent>
      </Card>

      {/* Log de Chamadas MCP */}
      <Card>
        <CardHeader>
          <CardTitle>Auditoria de Chamadas MCP (`mcp_call_logs`)</CardTitle>
          <CardDescription>
            Registro de todas as ferramentas invocadas por clientes externos com verificação
            Zero-Leak.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {mcpCallLogs.length === 0 ? (
            <p className="px-6 pb-6 text-[13px] text-[#72787D]">
              Nenhuma chamada registrada ao Servidor MCP ainda.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="border-y border-[#CBD5E1] bg-[#F8FAFC] font-medium text-[#64748B] dark:border-[#2A3B4C] dark:bg-[#08131D] dark:text-[#9DB0C2]">
                  <tr>
                    <th className="px-6 py-2.5">Data / Hora</th>
                    <th className="px-6 py-2.5">Tool</th>
                    <th className="px-6 py-2.5">Escopo</th>
                    <th className="px-6 py-2.5">Status</th>
                    <th className="px-6 py-2.5">Privacidade</th>
                    <th className="px-6 py-2.5">Resumo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9] dark:divide-[#1E2F3F]">
                  {mcpCallLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-[#F1F5F9] dark:hover:bg-[#162838]/50">
                      <td className="whitespace-nowrap px-6 py-2.5 tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                        {formatDateTimeBR(log.created_at)}
                      </td>
                      <td className="px-6 py-2.5 font-mono font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                        {log.tool_name}
                      </td>
                      <td className="px-6 py-2.5 font-mono">{log.scope_used}</td>
                      <td className="px-6 py-2.5">
                        <StatusChip
                          variant={
                            log.status === 'success'
                              ? 'positive'
                              : log.status === 'denied'
                                ? 'neutral'
                                : 'alert'
                          }
                        >
                          {log.status}
                        </StatusChip>
                      </td>
                      <td className="px-6 py-2.5">
                        <StatusChip variant={log.zero_leak_verified ? 'positive' : 'alert'}>
                          <ShieldCheck className="h-3 w-3" />
                          <span>{log.zero_leak_verified ? 'Zero-Leak' : 'Bloqueado'}</span>
                        </StatusChip>
                      </td>
                      <td className="px-6 py-2.5 text-[#334155] dark:text-[#B9CADB]">
                        {log.response_summary ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <PrivacyInspectorModal
        open={inspectorOpen}
        onOpenChange={setInspectorOpen}
        payload={liveAnonymized?.context ?? {}}
        vault={workspace.vault}
        sensitiveTerms={sensitiveTerms}
        title="Payload Anonimizado Servido pelo Endpoint MCP"
      />
    </div>
  );
};
