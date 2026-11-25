import { CheckCircle2, Eye, EyeOff, FlaskConical, ShieldCheck, XCircle } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { formatCNPJ } from '../../lib/utils';
import { InfoTooltip } from '../core/components/InfoTooltip';
import { recordSecurityEvent } from '../core/repository';
import type { AuthSessionState, BusinessGroup, Company, FinancialAccount, VaultEntry } from '../core/types';
import { runAnonymizerUnitTests, type UnitTestCaseResult } from './__tests__/anonymizer.test';
import { rehydrateFromAI, sanitizeForAI } from './anonymizer';

interface PrivacyVaultViewProps {
  session: AuthSessionState;
  groups: BusinessGroup[];
  companies: Company[];
  accounts: FinancialAccount[];
  vault: VaultEntry[];
  onRefresh: () => Promise<void>;
}

const ENTITY_TYPE_LABELS: Record<VaultEntry['entity_type'], string> = {
  group: 'Grupo',
  company: 'Empresa',
  account: 'Conta',
};

export const PrivacyVaultView: React.FC<PrivacyVaultViewProps> = ({
  session,
  groups,
  companies,
  accounts,
  vault,
  onRefresh,
}) => {
  const [revealSensitive, setRevealSensitive] = useState(true);
  const [testResults, setTestResults] = useState<UnitTestCaseResult[] | null>(null);

  const defaultPayloadText = useMemo(() => {
    const firstGroup = groups[0];
    const firstCompany = companies[0];
    const firstAccount = accounts[0];

    if (!firstCompany) {
      return JSON.stringify(
        {
          consulta: 'Simulação de payload sem entidades cadastradas ainda.',
          cnpjExemplo: '11.222.333/0001-81',
        },
        null,
        2
      );
    }

    return JSON.stringify(
      {
        contexto: firstGroup
          ? `Consolidação do grupo ${firstGroup.name}`
          : `Operação independente de ${firstCompany.trade_name ?? firstCompany.legal_name}`,
        empresa: {
          razaoSocial: firstCompany.legal_name,
          nomeFantasia: firstCompany.trade_name ?? firstCompany.legal_name,
          cnpjFormatado: formatCNPJ(firstCompany.cnpj),
          cnpjLimpo: firstCompany.cnpj,
        },
        contaAnalisada: firstAccount
          ? {
              nome: firstAccount.name,
              instituicao: firstAccount.institution_name ?? 'Banco Comercial',
              referencia: firstAccount.last_four ? `cartão final ${firstAccount.last_four}` : 'N/A',
            }
          : null,
      },
      null,
      2
    );
  }, [groups, companies, accounts]);

  const [rawInput, setRawInput] = useState<string>('');
  const activePayloadText = rawInput || defaultPayloadText;

  const [sanitizedOutput, setSanitizedOutput] = useState<string>('');
  const [rehydratedOutput, setRehydratedOutput] = useState<string>('');
  const [sanitizationReport, setSanitizationReport] = useState<{
    redactionsCount: number;
    tokensApplied: string[];
    zeroLeakageVerified: boolean;
    leakedTerms: string[];
  } | null>(null);

  const handleRunSanitize = async () => {
    let parsed: unknown = activePayloadText;
    try {
      parsed = JSON.parse(activePayloadText);
    } catch {
      // mantém texto bruto caso usuário digite prosa em vez de JSON
    }

    const result = sanitizeForAI(parsed, vault);
    setSanitizedOutput(
      typeof result.sanitized === 'string'
        ? result.sanitized
        : JSON.stringify(result.sanitized, null, 2)
    );
    setSanitizationReport(result.report);
    setRehydratedOutput('');

    await recordSecurityEvent(
      session.userId,
      session.email,
      'vault.sanitization_verified',
      'anonymization_vault',
      result.report.tokensApplied[0] ?? null,
      {
        redactions_count: result.report.redactionsCount,
        zero_leakage: result.report.zeroLeakageVerified,
      }
    );
    await onRefresh();
  };

  const handleRunRehydrate = () => {
    if (!sanitizedOutput) return;
    let parsed: unknown = sanitizedOutput;
    try {
      parsed = JSON.parse(sanitizedOutput);
    } catch {
      // texto simples
    }

    const restored = rehydrateFromAI(parsed, vault, {
      isAuthenticatedClient: session.mfaVerified,
      includeFormattedCnpj: true,
    });

    setRehydratedOutput(
      typeof restored === 'string' ? restored : JSON.stringify(restored, null, 2)
    );
  };

  const handleRunUnitTests = () => {
    setTestResults(runAnonymizerUnitTests());
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Cofre de Anonimização (Privacy Vault)
            </h1>
            <InfoTooltip glossaryKey="token_analitico" />
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Mapeamento isolado por tenant. Tokens são atribuídos na criação e nunca reutilizados,
            garantindo que nenhuma razão social ou CNPJ chegue a módulos externos.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setRevealSensitive((prev) => !prev)}
        >
          {revealSensitive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          <span>{revealSensitive ? 'Ocultar Rótulos Reais' : 'Revelar Rótulos Reais'}</span>
        </Button>
      </div>

      {/* Tabela do Cofre */}
      <Card>
        <CardHeader>
          <CardTitle>Tabela de Tokens Analíticos Imutáveis</CardTitle>
          <CardDescription>
            {vault.length} {vault.length === 1 ? 'registro mapeado' : 'registros mapeados'} (incluindo
            histórico arquivado para impedir reuso de tokens).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {vault.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-slate-500 dark:text-slate-400">
              Cadastre um Grupo, Empresa ou Conta para gerar automaticamente os tokens no Cofre.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-y border-slate-200 bg-slate-50/70 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                  <tr>
                    <th className="px-6 py-3 font-medium">Token</th>
                    <th className="px-6 py-3 font-medium">Entidade</th>
                    <th className="px-6 py-3 font-medium">Rótulo Real (Cofre Local)</th>
                    <th className="px-6 py-3 font-medium">Identificador Sensível</th>
                    <th className="px-6 py-3 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {vault.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                      <td className="px-6 py-3.5">
                        <code className="rounded bg-slate-100 px-2 py-1 font-mono text-xs font-semibold text-teal-800 dark:bg-slate-800 dark:text-teal-300">
                          {entry.analytical_token}
                        </code>
                      </td>
                      <td className="px-6 py-3.5 text-xs text-slate-600 dark:text-slate-300">
                        {ENTITY_TYPE_LABELS[entry.entity_type]}
                      </td>
                      <td className="px-6 py-3.5 font-medium text-slate-900 dark:text-slate-100">
                        {revealSensitive ? entry.real_label : '••••••••••••••••'}
                        {revealSensitive && entry.secondary_aliases.length > 0 && (
                          <p className="text-xs font-normal text-slate-500 dark:text-slate-400">
                            Aliases: {entry.secondary_aliases.join(' · ')}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-3.5 font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
                        {!entry.sensitive_identifier
                          ? '—'
                          : revealSensitive
                            ? entry.entity_type === 'company'
                              ? formatCNPJ(entry.sensitive_identifier)
                              : `final ${entry.sensitive_identifier}`
                            : '••••••••••••'}
                      </td>
                      <td className="px-6 py-3.5 text-xs text-slate-500 dark:text-slate-400">
                        {entry.is_archived ? 'Arquivado (token bloqueado)' : 'Ativo'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Simulador Bidirecional anonymizer.ts */}
      <Card>
        <CardHeader>
          <CardTitle>Simulador Bidirecional (`anonymizer.ts`)</CardTitle>
          <CardDescription>
            Teste a função <span className="font-mono">sanitizeForAI()</span> e sua inversa{' '}
            <span className="font-mono">rehydrateFromAI()</span> antes de qualquer integração futura.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="raw-payload"
                  className="text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Payload Original (com dados reais sensíveis)
                </label>
                <button
                  type="button"
                  onClick={() => setRawInput(defaultPayloadText)}
                  className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400 cursor-pointer"
                >
                  Restaurar exemplo atual
                </button>
              </div>
              <textarea
                id="raw-payload"
                rows={10}
                value={activePayloadText}
                onChange={(e) => setRawInput(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Payload Sanitizado (seguro para trânsito externo)
              </p>
              <pre className="h-[222px] overflow-auto rounded-xl border border-slate-200 bg-slate-900 p-3 font-mono text-xs text-emerald-300 dark:border-slate-800">
                {sanitizedOutput || 'Clique em "Sanitizar Payload" para gerar a versão anônima.'}
              </pre>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => void handleRunSanitize()}>
              <ShieldCheck className="h-4 w-4" />
              <span>Executar sanitizeForAI()</span>
            </Button>
            <Button
              variant="outline"
              disabled={!sanitizedOutput}
              onClick={handleRunRehydrate}
            >
              <span>Executar rehydrateFromAI() (Cliente Autenticado)</span>
            </Button>
          </div>

          {sanitizationReport && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs dark:border-slate-800 dark:bg-slate-950">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  Verificação Zero-Leak:{' '}
                  {sanitizationReport.zeroLeakageVerified
                    ? 'Aprovado (0 vazamentos)'
                    : `Falha (${sanitizationReport.leakedTerms.join(', ')})`}
                </span>
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                  Substituições: {sanitizationReport.redactionsCount}
                </span>
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                <span className="font-mono text-slate-600 dark:text-slate-300">
                  Tokens: {sanitizationReport.tokensApplied.join(', ') || 'nenhum'}
                </span>
              </div>
            </div>
          )}

          {rehydratedOutput && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Saída Re-hidratada (executada apenas após validação de sessão no cliente)
              </p>
              <pre className="max-h-56 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                {rehydratedOutput}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Executor de Testes Unitários em Tela */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Testes Unitários do Cofre (`anonymizer.test.ts`)</CardTitle>
              <CardDescription>
                Valida em tempo real que nomes reais, CNPJs formatados/brutos e aliases nunca vazam.
              </CardDescription>
            </div>
            <Button variant="outline" onClick={handleRunUnitTests}>
              <FlaskConical className="h-4 w-4 text-teal-700 dark:text-teal-400" />
              <span>Executar Testes (5 asserções)</span>
            </Button>
          </div>
        </CardHeader>
        {testResults && (
          <CardContent className="divide-y divide-slate-100 pt-0 dark:divide-slate-800">
            {testResults.map((res) => (
              <div key={res.name} className="flex items-start gap-3 py-3 text-xs">
                {res.passed ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                )}
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">{res.name}</p>
                  <p className="text-slate-500 dark:text-slate-400">{res.details}</p>
                </div>
              </div>
            ))}
          </CardContent>
        )}
      </Card>
    </div>
  );
};
