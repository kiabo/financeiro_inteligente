import { Building2, Layers, Plus, Trash2, Wallet } from 'lucide-react';
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
import { formatCNPJ, isValidCNPJ, normalizeCNPJ } from '../../lib/utils';
import { InfoTooltip } from '../core/components/InfoTooltip';
import {
  createBusinessGroup,
  createCompany,
  createFinancialAccount,
  deleteBusinessGroup,
  deleteCompany,
  deleteFinancialAccount,
  updateCompanyGroup,
} from '../core/repository';
import type {
  AccountType,
  AuthSessionState,
  BusinessGroup,
  Company,
  FinancialAccount,
} from '../core/types';

interface HierarchySettingsViewProps {
  session: AuthSessionState;
  groups: BusinessGroup[];
  companies: Company[];
  accounts: FinancialAccount[];
  onRefresh: () => Promise<void>;
}

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Conta Corrente',
  cash: 'Caixa Físico',
  credit_card: 'Cartão Corporativo',
  wallet: 'Carteira Digital',
  investment: 'Conta Investimento',
};

const NO_GROUP_VALUE = '__INDEPENDENT__';

export const HierarchySettingsView: React.FC<HierarchySettingsViewProps> = ({
  session,
  groups,
  companies,
  accounts,
  onRefresh,
}) => {
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form Empresa
  const [legalName, setLegalName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [taxRegime, setTaxRegime] = useState('Lucro Presumido');
  const [companyGroupId, setCompanyGroupId] = useState<string>(NO_GROUP_VALUE);

  // Form Conta
  const [accountCompanyId, setAccountCompanyId] = useState<string>(companies[0]?.id ?? '');
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('checking');
  const [institutionName, setInstitutionName] = useState('');
  const [lastFour, setLastFour] = useState('');

  // Form Grupo
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');

  const effectiveAccountCompanyId =
    companies.some((c) => c.id === accountCompanyId) ? accountCompanyId : (companies[0]?.id ?? '');

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const digits = normalizeCNPJ(cnpj);
    if (!isValidCNPJ(digits)) {
      setFeedback({
        type: 'error',
        text: 'CNPJ inválido. Verifique os 14 dígitos e dígitos verificadores.',
      });
      return;
    }

    setSubmitting(true);
    try {
      const created = await createCompany(session.userId, session.email, {
        legal_name: legalName,
        trade_name: tradeName || undefined,
        cnpj: digits,
        tax_regime: taxRegime || undefined,
        group_id: companyGroupId === NO_GROUP_VALUE ? null : companyGroupId,
      });
      setLegalName('');
      setTradeName('');
      setCnpj('');
      setCompanyGroupId(NO_GROUP_VALUE);
      await onRefresh();
      setFeedback({
        type: 'success',
        text: `Empresa cadastrada com Token Analítico imutável ${created.analytical_token}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erro ao cadastrar empresa.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!effectiveAccountCompanyId) {
      setFeedback({ type: 'error', text: 'Cadastre uma empresa antes de adicionar contas.' });
      return;
    }

    setSubmitting(true);
    try {
      const created = await createFinancialAccount(session.userId, session.email, {
        company_id: effectiveAccountCompanyId,
        name: accountName,
        account_type: accountType,
        institution_name: institutionName || undefined,
        currency: 'BRL',
        last_four: lastFour || undefined,
      });
      setAccountName('');
      setInstitutionName('');
      setLastFour('');
      await onRefresh();
      setFeedback({
        type: 'success',
        text: `Conta cadastrada com Token Analítico imutável ${created.analytical_token}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erro ao cadastrar conta.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSubmitting(true);
    try {
      const created = await createBusinessGroup(session.userId, session.email, {
        name: groupName,
        description: groupDescription || undefined,
      });
      setGroupName('');
      setGroupDescription('');
      await onRefresh();
      setFeedback({
        type: 'success',
        text: `Grupo empresarial criado com Token Analítico ${created.analytical_token}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erro ao criar grupo.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleLinkGroupChange = async (companyId: string, nextValue: string) => {
    setFeedback(null);
    try {
      await updateCompanyGroup(
        session.userId,
        session.email,
        companyId,
        nextValue === NO_GROUP_VALUE ? null : nextValue
      );
      await onRefresh();
      setFeedback({
        type: 'success',
        text:
          nextValue === NO_GROUP_VALUE
            ? 'Empresa desvinculada. Operando de forma independente.'
            : 'Vínculo com grupo atualizado. Visão consolidada habilitada.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erro ao atualizar vínculo.',
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Cadastros &amp; Hierarquia Flexível
          </h1>
          <InfoTooltip glossaryKey="consolidacao_grupo" />
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Gerencie Empresas (CNPJs), Contas Financeiras e Grupos Empresariais opcionais. Todo item
          recebe um Token Analítico imutável no Cofre de Anonimização.
        </p>
      </div>

      {feedback && (
        <div
          role="status"
          className={
            feedback.type === 'error'
              ? 'rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-200'
              : 'rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900 dark:border-teal-900 dark:bg-teal-950/60 dark:text-teal-200'
          }
        >
          {feedback.text}
        </div>
      )}

      <Tabs defaultValue="companies">
        <TabsList>
          <TabsTrigger value="companies" className="gap-1.5">
            <Building2 className="h-3.5 w-3.5" />
            <span>Empresas ({companies.length})</span>
          </TabsTrigger>
          <TabsTrigger value="accounts" className="gap-1.5">
            <Wallet className="h-3.5 w-3.5" />
            <span>Contas ({accounts.length})</span>
          </TabsTrigger>
          <TabsTrigger value="groups" className="gap-1.5">
            <Layers className="h-3.5 w-3.5" />
            <span>Grupos Opcionais ({groups.length})</span>
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: EMPRESAS */}
        <TabsContent value="companies" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Nova Empresa (CNPJ)</CardTitle>
              <CardDescription>
                O vínculo com um Grupo Empresarial é totalmente opcional. Sem grupo, a empresa opera
                de maneira independente.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateCompany} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="comp-legal">Razão Social *</Label>
                  <Input
                    id="comp-legal"
                    required
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    placeholder="Ex.: Alpha Engenharia Ltda"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="comp-trade">Nome Fantasia</Label>
                  <Input
                    id="comp-trade"
                    value={tradeName}
                    onChange={(e) => setTradeName(e.target.value)}
                    placeholder="Ex.: Alpha Engenharia"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="comp-cnpj">CNPJ (14 dígitos) *</Label>
                  <Input
                    id="comp-cnpj"
                    required
                    inputMode="numeric"
                    value={cnpj}
                    onChange={(e) => setCnpj(formatCNPJ(e.target.value))}
                    placeholder="00.000.000/0001-00"
                    className="font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="comp-regime">Regime Tributário</Label>
                  <Select value={taxRegime} onValueChange={setTaxRegime}>
                    <SelectTrigger id="comp-regime">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Simples Nacional">Simples Nacional</SelectItem>
                      <SelectItem value="Lucro Presumido">Lucro Presumido</SelectItem>
                      <SelectItem value="Lucro Real">Lucro Real</SelectItem>
                      <SelectItem value="MEI">MEI</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="comp-group">Grupo Empresarial (Opcional)</Label>
                  <Select value={companyGroupId} onValueChange={setCompanyGroupId}>
                    <SelectTrigger id="comp-group">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_GROUP_VALUE}>
                        Sem grupo (Operação Independente)
                      </SelectItem>
                      {groups.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name} ({g.analytical_token})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-end">
                  <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
                    <Plus className="h-4 w-4" />
                    <span>Cadastrar Empresa</span>
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Empresas Cadastradas &amp; Tokens Atribuídos</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {companies.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-slate-500 dark:text-slate-400">
                  Nenhuma empresa cadastrada ainda.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-y border-slate-200 bg-slate-50/70 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                      <tr>
                        <th className="px-6 py-3 font-medium">Token Anônimo</th>
                        <th className="px-6 py-3 font-medium">Empresa</th>
                        <th className="px-6 py-3 font-medium">CNPJ</th>
                        <th className="px-6 py-3 font-medium">Vínculo de Grupo</th>
                        <th className="px-6 py-3 text-right font-medium">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {companies.map((c) => (
                        <tr key={c.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                          <td className="px-6 py-3.5">
                            <code className="rounded bg-slate-100 px-2 py-1 font-mono text-xs font-semibold text-teal-800 dark:bg-slate-800 dark:text-teal-300">
                              {c.analytical_token}
                            </code>
                          </td>
                          <td className="px-6 py-3.5">
                            <p className="font-medium text-slate-900 dark:text-slate-100">
                              {c.trade_name ?? c.legal_name}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {c.legal_name}
                            </p>
                          </td>
                          <td className="px-6 py-3.5 font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
                            {formatCNPJ(c.cnpj)}
                          </td>
                          <td className="px-6 py-3.5 min-w-[210px]">
                            <Select
                              value={c.group_id ?? NO_GROUP_VALUE}
                              onValueChange={(val) => void handleLinkGroupChange(c.id, val)}
                            >
                              <SelectTrigger className="h-9 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NO_GROUP_VALUE}>
                                  Operação Independente
                                </SelectItem>
                                {groups.map((g) => (
                                  <SelectItem key={g.id} value={g.id}>
                                    {g.name} ({g.analytical_token})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-6 py-3.5 text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Remover ${c.legal_name}`}
                              onClick={async () => {
                                await deleteCompany(session.userId, session.email, c.id);
                                await onRefresh();
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-slate-400 hover:text-rose-600" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: CONTAS FINANCEIRAS */}
        <TabsContent value="accounts" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Nova Conta Bancária, Caixa ou Cartão</CardTitle>
              <CardDescription>
                Vincule contas reais a uma empresa para geração automática do token analítico{' '}
                <span className="font-mono">CTA_XX</span>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateAccount} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="acc-company">Empresa Titular *</Label>
                  <Select
                    value={effectiveAccountCompanyId}
                    onValueChange={setAccountCompanyId}
                    disabled={companies.length === 0}
                  >
                    <SelectTrigger id="acc-company">
                      <SelectValue placeholder="Selecione a empresa" />
                    </SelectTrigger>
                    <SelectContent>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.trade_name ?? c.legal_name} ({c.analytical_token})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="acc-name">Nome da Conta *</Label>
                  <Input
                    id="acc-name"
                    required
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    placeholder="Ex.: Conta Corrente Principal"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="acc-type">Tipo de Conta *</Label>
                  <Select
                    value={accountType}
                    onValueChange={(v) => setAccountType(v as AccountType)}
                  >
                    <SelectTrigger id="acc-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ACCOUNT_TYPE_LABELS).map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="acc-bank">Instituição / Banco</Label>
                  <Input
                    id="acc-bank"
                    value={institutionName}
                    onChange={(e) => setInstitutionName(e.target.value)}
                    placeholder="Ex.: Itaú, BTG, Caixa Interno"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="acc-last4">4 Últimos Dígitos (Opcional)</Label>
                  <Input
                    id="acc-last4"
                    inputMode="numeric"
                    maxLength={4}
                    value={lastFour}
                    onChange={(e) => setLastFour(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="4419"
                    className="font-mono"
                  />
                </div>

                <div className="flex items-end">
                  <Button
                    type="submit"
                    variant="primary"
                    className="w-full"
                    disabled={submitting || companies.length === 0}
                  >
                    <Plus className="h-4 w-4" />
                    <span>Adicionar Conta</span>
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contas Financeiras Cadastradas</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {accounts.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-slate-500 dark:text-slate-400">
                  Nenhuma conta financeira cadastrada ainda.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-y border-slate-200 bg-slate-50/70 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                      <tr>
                        <th className="px-6 py-3 font-medium">Token Anônimo</th>
                        <th className="px-6 py-3 font-medium">Conta</th>
                        <th className="px-6 py-3 font-medium">Empresa</th>
                        <th className="px-6 py-3 font-medium">Tipo / Instituição</th>
                        <th className="px-6 py-3 text-right font-medium">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {accounts.map((acc) => {
                        const comp = companies.find((c) => c.id === acc.company_id);
                        return (
                          <tr key={acc.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                            <td className="px-6 py-3.5">
                              <code className="rounded bg-slate-100 px-2 py-1 font-mono text-xs font-semibold text-teal-800 dark:bg-slate-800 dark:text-teal-300">
                                {acc.analytical_token}
                              </code>
                            </td>
                            <td className="px-6 py-3.5 font-medium text-slate-900 dark:text-slate-100">
                              {acc.name}
                              {acc.last_four && (
                                <span className="ml-2 font-mono text-xs text-slate-400">
                                  •••• {acc.last_four}
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-3.5 text-xs text-slate-600 dark:text-slate-300">
                              {comp ? `${comp.trade_name ?? comp.legal_name} (${comp.analytical_token})` : '—'}
                            </td>
                            <td className="px-6 py-3.5 text-xs text-slate-500 dark:text-slate-400">
                              {ACCOUNT_TYPE_LABELS[acc.account_type]}
                              {acc.institution_name ? ` · ${acc.institution_name}` : ''}
                            </td>
                            <td className="px-6 py-3.5 text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Remover ${acc.name}`}
                                onClick={async () => {
                                  await deleteFinancialAccount(session.userId, session.email, acc.id);
                                  await onRefresh();
                                }}
                              >
                                <Trash2 className="h-4 w-4 text-slate-400 hover:text-rose-600" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: GRUPOS OPCIONAIS */}
        <TabsContent value="groups" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Novo Grupo Empresarial (Opcional)</CardTitle>
              <CardDescription>
                Crie um grupo apenas se desejar consolidar múltiplas empresas. Ao excluir um grupo,
                as empresas permanecem ativas em operação independente.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateGroup} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="grp-name">Nome do Grupo / Holding *</Label>
                  <Input
                    id="grp-name"
                    required
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="Ex.: Horizonte Participações"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="grp-desc">Descrição (Opcional)</Label>
                  <Input
                    id="grp-desc"
                    value={groupDescription}
                    onChange={(e) => setGroupDescription(e.target.value)}
                    placeholder="Ex.: Consolidação operacional Sudeste"
                  />
                </div>
                <div className="flex items-end">
                  <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
                    <Plus className="h-4 w-4" />
                    <span>Criar Grupo</span>
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Grupos Empresariais Cadastrados</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {groups.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-slate-500 dark:text-slate-400">
                  Nenhum grupo criado. Todas as empresas operam de forma independente.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {groups.map((grp) => {
                    const count = companies.filter((c) => c.group_id === grp.id).length;
                    return (
                      <div
                        key={grp.id}
                        className="flex items-center justify-between gap-4 px-6 py-4"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-900 dark:text-slate-100">
                              {grp.name}
                            </span>
                            <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-teal-800 dark:bg-slate-800 dark:text-teal-300">
                              {grp.analytical_token}
                            </code>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {count} {count === 1 ? 'empresa vinculada' : 'empresas vinculadas'}
                            {grp.description ? ` · ${grp.description}` : ''}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Excluir grupo ${grp.name}`}
                          onClick={async () => {
                            await deleteBusinessGroup(session.userId, session.email, grp.id);
                            await onRefresh();
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-slate-400 hover:text-rose-600" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
