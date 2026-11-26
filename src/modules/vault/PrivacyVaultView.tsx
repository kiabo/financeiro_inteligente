import { CheckCircle2, Eye, EyeOff, FlaskConical, ShieldCheck, XCircle } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { StatusChip } from '../../components/ui/status-chip';
import { formatCNPJ } from '../../lib/utils';
import { InfoTooltip } from '../core/components/InfoTooltip';
import { recordSecurityEvent } from '../core/repository';
import type {
  AuthSessionState,
  BusinessGroup,
  Company,
  FinancialAccount,
  ProductService,
  Transaction,
  VaultEntry,
} from '../core/types';
import {
  runAiContextBuilderTests,
  type AiContextTestResult,
} from '../ai-cfo/__tests__/aiContextBuilder.test';
import { runAnonymizerUnitTests, type UnitTestCaseResult } from './__tests__/anonymizer.test';
import { rehydrateFromAI, sanitizeForAI } from './anonymizer';

interface PrivacyVaultViewProps {
  session: AuthSessionState;
  groups: BusinessGroup[];
  companies: Company[];
  accounts: FinancialAccount[];
  productsServices?: ProductService[];
  transactions?: Transaction[];
  vault: VaultEntry[];
  onRefresh: () => Promise<void>;
}

const ENTITY_TYPE_LABELS: Record<VaultEntry['entity_type'], string> = {
  group: 'Grupo',
  company: 'Empresa',
  account: 'Conta',
  product: 'Produto',
  service: 'Serviço',
  project: 'Projeto',
  creditor: 'Credor',
};

export const PrivacyVaultView: React.FC<PrivacyVaultViewProps> = ({
  session,
  groups,
  companies,
  accounts,
  productsServices = [],
  transactions = [],
  vault,
  onRefresh,
}) => {
  const [revealSensitive, setRevealSensitive] = useState(true);
  const [testResults, setTestResults] = useState<UnitTestCaseResult[] | null>(null);
  const [cfoTestResults, setCfoTestResults] = useState<AiContextTestResult[] | null>(null);

  const defaultPayloadText = useMemo(() => {
    const firstGroup = groups[0];
    const firstCompany = companies[0];
    const firstAccount = accounts[0];
    const firstProduct = productsServices[0];
    const firstTx = transactions[0];

    if (!firstCompany) {
      return JSON.stringify(
        {
          consulta: 'Simulação de payload sem entidades cadastradas ainda.',
          cnpjExemplo: '11.222.333/0001-81',
          fornecedor: 'Fornecedor Alpha Ltda',
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
        ofertaCatalogo: firstProduct
          ? {
              nome: firstProduct.name,
              sku: firstProduct.sku_code ?? null,
              precoBase: firstProduct.base_price,
            }
          : null,
        ultimoLancamento: firstTx
          ? {
              description: firstTx.description,
              counterparty_name: firstTx.counterparty_name ?? 'Cliente Confidencial Ltda',
              amount: firstTx.amount,
            }
          : null,
      },
      null,
      2
    );
  }, [groups, companies, accounts, productsServices, transactions]);

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
      // mantém texto bruto
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
    setCfoTestResults(runAiContextBuilderTests());
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
            Privacy-by-Design
          </span>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-[24px] font-semibold leading-8 tracking-[-0.02em] text-[#0F172A] dark:text-[#EAF1FF]">
              Cofre de Anonimização (Privacy Vault)
            </h1>
            <InfoTooltip glossaryKey="token_analitico" />
          </div>
          <p className="text-[14px] leading-5 text-[#42484C] dark:text-[#9DB0C2]">
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
            <p className="px-6 pb-6 text-[13px] text-[#42484C] dark:text-[#9DB0C2]">
              Cadastre um Grupo, Empresa ou Conta para gerar automaticamente os tokens no Cofre.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-y border-[#CBD5E1] bg-[#F8FAFC] text-[12px] font-medium tracking-[0.02em] text-[#64748B] dark:border-[#2A3B4C] dark:bg-[#08131D] dark:text-[#9DB0C2]">
                  <tr>
                    <th className="px-6 py-2.5">Token</th>
                    <th className="px-6 py-2.5">Entidade</th>
                    <th className="px-6 py-2.5">Rótulo Real (Cofre Local)</th>
                    <th className="px-6 py-2.5">Identificador Sensível</th>
                    <th className="px-6 py-2.5">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9] dark:divide-[#1E2F3F]">
                  {vault.map((entry) => (
                    <tr key={entry.id} className="hover:bg-[#F1F5F9] dark:hover:bg-[#162838]/50">
                      <td className="px-6 py-2.5">
                        <StatusChip variant="primary">{entry.analytical_token}</StatusChip>
                      </td>
                      <td className="px-6 py-2.5 text-[12px] text-[#334155] dark:text-[#B9CADB]">
                        {ENTITY_TYPE_LABELS[entry.entity_type]}
                      </td>
                      <td className="px-6 py-2.5 font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                        {revealSensitive ? entry.real_label : '••••••••••••••••'}
                        {revealSensitive && entry.secondary_aliases.length > 0 && (
                          <p className="text-[11px] font-normal text-[#42484C] dark:text-[#9DB0C2]">
                            Aliases: {entry.secondary_aliases.join(' · ')}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-2.5 text-[12px] tabular-nums text-[#334155] dark:text-[#B9CADB]">
                        {!entry.sensitive_identifier
                          ? '—'
                          : revealSensitive
                            ? entry.entity_type === 'company'
                              ? formatCNPJ(entry.sensitive_identifier)
                              : entry.entity_type === 'product' || entry.entity_type === 'service'
                                ? `SKU ${entry.sensitive_identifier}`
                                : entry.entity_type === 'creditor'
                                  ? `Contrato ${entry.sensitive_identifier}`
                                  : `final ${entry.sensitive_identifier}`
                            : '••••••••••••'}
                      </td>
                      <td className="px-6 py-2.5">
                        <StatusChip variant={entry.is_archived ? 'neutral' : 'positive'}>
                          {entry.is_archived ? 'Arquivado' : 'Ativo'}
                        </StatusChip>
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
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
            Motor de Sanitização
          </span>
          <CardTitle>Simulador Bidirecional (`anonymizer.ts`)</CardTitle>
          <CardDescription>
            Teste a função <span className="font-mono">sanitizeForAI()</span> e sua inversa{' '}
            <span className="font-mono">rehydrateFromAI()</span> antes de qualquer integração futura.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="raw-payload"
                  className="text-[12px] font-medium tracking-[0.02em] text-[#334155] dark:text-[#B9CADB]"
                >
                  Payload Original (com dados reais sensíveis)
                </label>
                <button
                  type="button"
                  onClick={() => setRawInput(defaultPayloadText)}
                  className="text-[12px] font-medium text-[#0F374A] hover:underline dark:text-[#A7CBE3] cursor-pointer"
                >
                  Restaurar exemplo atual
                </button>
              </div>
              <textarea
                id="raw-payload"
                rows={10}
                value={activePayloadText}
                onChange={(e) => setRawInput(e.target.value)}
                className="w-full rounded-[4px] border border-[#CBD5E1] bg-[#F8FAFC] p-3 font-mono text-[12px] text-[#0F172A] focus:border-[#0F374A] focus:outline-none focus:ring-2 focus:ring-[#0F374A]/12 dark:border-[#2A3B4C] dark:bg-[#08131D] dark:text-[#EAF1FF]"
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-[12px] font-medium tracking-[0.02em] text-[#334155] dark:text-[#B9CADB]">
                Payload Sanitizado (seguro para trânsito externo)
              </p>
              <pre className="h-[222px] overflow-auto rounded-[4px] border border-[#1E293B] bg-[#002130] p-3 font-mono text-[12px] text-[#85F8C4]">
                {sanitizedOutput || 'Clique em "Executar sanitizeForAI()" para gerar a versão anônima.'}
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
            <div className="flex flex-wrap items-center gap-3 rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2.5 text-[12px] dark:border-[#1E2F3F] dark:bg-[#08131D]">
              <StatusChip variant={sanitizationReport.zeroLeakageVerified ? 'positive' : 'alert'}>
                {sanitizationReport.zeroLeakageVerified
                  ? 'Zero-Leak Aprovado (0 vazamentos)'
                  : `Vazamento: ${sanitizationReport.leakedTerms.join(', ')}`}
              </StatusChip>
              <span className="tabular-nums text-[#334155] dark:text-[#B9CADB]">
                Substituições: <strong>{sanitizationReport.redactionsCount}</strong>
              </span>
              <span className="text-[#42484C] dark:text-[#9DB0C2]">
                Tokens: <span className="font-mono">{sanitizationReport.tokensApplied.join(', ') || 'nenhum'}</span>
              </span>
            </div>
          )}

          {rehydratedOutput && (
            <div className="space-y-1.5">
              <p className="text-[12px] font-medium tracking-[0.02em] text-[#334155] dark:text-[#B9CADB]">
                Saída Re-hidratada (executada apenas após validação de sessão no cliente)
              </p>
              <pre className="max-h-56 overflow-auto rounded-[4px] border border-[#CBD5E1] bg-[#F8FAFC] p-3 font-mono text-[12px] text-[#0F172A] dark:border-[#2A3B4C] dark:bg-[#08131D] dark:text-[#EAF1FF]">
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
              <FlaskConical className="h-4 w-4 text-[#0F374A] dark:text-[#A7CBE3]" />
              <span>Executar Testes Zero-Leak (13 asserções)</span>
            </Button>
          </div>
        </CardHeader>
        {(testResults || cfoTestResults) && (
          <CardContent className="divide-y divide-[#F1F5F9] pt-0 dark:divide-[#1E2F3F]">
            {[...(testResults ?? []), ...(cfoTestResults ?? [])].map((res) => (
              <div key={res.name} className="flex items-start gap-3 py-3 text-[12px]">
                {res.passed ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#059669]" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
                )}
                <div>
                  <p className="font-medium text-[#0F172A] dark:text-[#EAF1FF]">{res.name}</p>
                  <p className="text-[#42484C] dark:text-[#9DB0C2]">{res.details}</p>
                </div>
              </div>
            ))}
          </CardContent>
        )}
      </Card>
    </div>
  );
};
