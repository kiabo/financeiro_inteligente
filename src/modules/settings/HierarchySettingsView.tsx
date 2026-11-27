import { Building2, Layers, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import React, { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
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
import {
  formatCNPJ,
  formatCurrencyBRL,
  formatDateBR,
  getTodayISO,
  isValidCNPJ,
  normalizeCNPJ,
  parseMoneyInput,
} from '../../lib/utils';
import { InfoTooltip } from '../core/components/InfoTooltip';
import {
  computeAccountBalances,
  createBusinessGroup,
  createCompany,
  createFinancialAccount,
  deleteBusinessGroup,
  deleteCompany,
  deleteFinancialAccount,
  transactionCashDate,
  updateCompanyGroup,
  updateFinancialAccount,
} from '../core/repository';
import type {
  AccountType,
  AuthSessionState,
  BusinessGroup,
  Company,
  FinancialAccount,
  Transaction,
} from '../core/types';

interface HierarchySettingsViewProps {
  session: AuthSessionState;
  groups: BusinessGroup[];
  companies: Company[];
  accounts: FinancialAccount[];
  /** Usado para avisar ao alterar o saldo inicial de uma conta que já tem lançamentos. */
  transactions: Transaction[];
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
  transactions,
  onRefresh,
}) => {
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  /** Executa uma exclusão e mostra o motivo na tela quando ela é recusada (antes o clique falhava em silêncio). */
  const runDelete = async (action: () => Promise<void>) => {
    setFeedback(null);
    try {
      await action();
      await onRefresh();
    } catch (err) {
      setFeedback({ type: 'error', text: err instanceof Error ? err.message : 'Não foi possível excluir.' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      document.querySelector('main')?.scrollTo?.({ top: 0, behavior: 'smooth' });
    }
  };
  const [submitting, setSubmitting] = useState(false);

  const [legalName, setLegalName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [taxRegime, setTaxRegime] = useState('Lucro Presumido');
  const [companyGroupId, setCompanyGroupId] = useState<string>(NO_GROUP_VALUE);

  const [accountCompanyId, setAccountCompanyId] = useState<string>(companies[0]?.id ?? '');
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('checking');
  const [institutionName, setInstitutionName] = useState('');
  const [lastFour, setLastFour] = useState('');
  const [accountOpening, setAccountOpening] = useState('');
  const [accountOpeningDate, setAccountOpeningDate] = useState(getTodayISO());

  // Edição de conta (Dialog) com confirmação ao alterar o saldo inicial de conta que já tem lançamentos
  const [editing, setEditing] = useState<FinancialAccount | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    type: 'checking' as AccountType,
    institution: '',
    lastFour: '',
    opening: '',
    date: getTodayISO(),
    active: true,
  });
  const [confirmingBalance, setConfirmingBalance] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');

  const effectiveAccountCompanyId =
    companies.some((c) => c.id === accountCompanyId) ? accountCompanyId : (companies[0]?.id ?? '');

  const openEdit = (acc: FinancialAccount) => {
    // Sem data de saldo ainda: usa o lançamento mais antigo da conta (assim o histórico continua contando);
    // conta sem lançamentos usa hoje.
    const cashDates = transactions
      .filter((t) => t.account_id === acc.id || t.destination_account_id === acc.id)
      .map((t) => transactionCashDate(t))
      .sort();
    const defaultDate = acc.opening_balance_date ?? cashDates[0] ?? getTodayISO();
    setEditing(acc);
    setEditForm({
      name: acc.name,
      type: acc.account_type,
      institution: acc.institution_name ?? '',
      lastFour: acc.last_four ?? '',
      opening: acc.opening_balance ? String(acc.opening_balance).replace('.', ',') : '',
      date: defaultDate,
      active: acc.is_active,
    });
    setConfirmingBalance(false);
    setEditError(null);
  };

  const closeEdit = () => {
    setEditing(null);
    setConfirmingBalance(false);
    setEditError(null);
  };

  const editOpening = parseMoneyInput(editForm.opening);
  const editHasMovements = editing
    ? transactions.some((t) => t.account_id === editing.id || t.destination_account_id === editing.id)
    : false;
  const editBalanceChanged =
    editing !== null &&
    editOpening !== null &&
    (editOpening !== (editing.opening_balance ?? 0) ||
      (editOpening !== 0 && editForm.date !== (editing.opening_balance_date ?? '')));

  // Saldo atual da conta antes e depois da alteração (mostrado no aviso de confirmação)
  const editPreview = (() => {
    if (!editing || editOpening === null) return null;
    const scope = { scope: 'account', accountId: editing.id } as const;
    const next: FinancialAccount = {
      ...editing,
      opening_balance: editOpening,
      opening_balance_date: editOpening === 0 ? null : editForm.date || getTodayISO(),
    };
    const before = computeAccountBalances([editing], transactions, companies, scope)[0];
    const after = computeAccountBalances([next], transactions, companies, scope)[0];
    return before && after ? { before: before.current_balance, after: after.current_balance } : null;
  })();

  const submitEdit = async (confirmed: boolean) => {
    if (!editing) return;
    setEditError(null);
    if (editOpening === null) {
      setEditError('Saldo inicial inválido. Use números, ex.: 1.500,00 ou -300,00.');
      return;
    }
    if (editBalanceChanged && editHasMovements && !confirmed) {
      setConfirmingBalance(true);
      return;
    }
    setSavingEdit(true);
    try {
      await updateFinancialAccount(session.userId, session.email, editing.id, {
        name: editForm.name,
        account_type: editForm.type,
        institution_name: editForm.institution,
        last_four: editForm.lastFour,
        opening_balance: editOpening,
        opening_balance_date: editOpening === 0 ? null : editForm.date,
        is_active: editForm.active,
      });
      const savedName = editForm.name.trim();
      closeEdit();
      await onRefresh();
      setFeedback({ type: 'success', text: `Conta "${savedName}" atualizada.` });
    } catch (err) {
      setConfirmingBalance(false);
      setEditError(err instanceof Error ? err.message : 'Erro ao atualizar a conta.');
    } finally {
      setSavingEdit(false);
    }
  };

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

    const opening = parseMoneyInput(accountOpening);
    if (opening === null) {
      setFeedback({ type: 'error', text: 'Saldo inicial inválido. Use números, ex.: 1.500,00 ou -300,00.' });
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
        opening_balance: opening,
        opening_balance_date: opening === 0 ? undefined : accountOpeningDate,
      });
      setAccountName('');
      setInstitutionName('');
      setLastFour('');
      setAccountOpening('');
      setAccountOpeningDate(getTodayISO());
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
        <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
          Configurações Estruturais
        </span>
        <div className="flex items-center gap-2">
          <h1 className="font-display text-[24px] font-semibold leading-8 tracking-[-0.02em] text-[#0F172A] dark:text-[#EAF1FF]">
            Cadastros &amp; Hierarquia Flexível
          </h1>
          <InfoTooltip glossaryKey="consolidacao_grupo" />
        </div>
        <p className="text-[14px] leading-5 text-[#42484C] dark:text-[#9DB0C2]">
          Gerencie Empresas (CNPJs), Contas Financeiras e Grupos Empresariais opcionais. Todo item
          recebe um Token Analítico imutável no Cofre de Anonimização.
        </p>
      </div>

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={
            feedback.type === 'error'
              ? 'rounded-[4px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-2.5 text-[13px] font-medium text-[#991B1B] dark:border-[#7F1D1D] dark:bg-[#3B1219] dark:text-[#FCA5A5]'
              : 'rounded-[4px] border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-2.5 text-[13px] font-medium text-[#065F46] dark:border-[#005137] dark:bg-[#003C28]/70 dark:text-[#68DBA9]'
          }
        >
          {feedback.text}
        </div>
      )}

      <Tabs defaultValue="companies">
        <TabsList>
          <TabsTrigger value="companies" className="gap-1.5 tabular-nums">
            <Building2 className="h-3.5 w-3.5" />
            <span>Empresas ({companies.length})</span>
          </TabsTrigger>
          <TabsTrigger value="accounts" className="gap-1.5 tabular-nums">
            <Wallet className="h-3.5 w-3.5" />
            <span>Contas ({accounts.length})</span>
          </TabsTrigger>
          <TabsTrigger value="groups" className="gap-1.5 tabular-nums">
            <Layers className="h-3.5 w-3.5" />
            <span>Grupos Opcionais ({groups.length})</span>
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: EMPRESAS */}
        <TabsContent value="companies" className="space-y-6">
          <Card>
            <CardHeader>
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
                Novo Registro
              </span>
              <CardTitle>Nova Empresa (CNPJ)</CardTitle>
              <CardDescription>
                O vínculo com um Grupo Empresarial é totalmente opcional. Sem grupo, a empresa opera
                de maneira independente.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateCompany} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="comp-legal">Razão Social *</Label>
                  <Input
                    id="comp-legal"
                    required
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    placeholder="Ex.: Alpha Engenharia Ltda"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="comp-trade">Nome Fantasia</Label>
                  <Input
                    id="comp-trade"
                    value={tradeName}
                    onChange={(e) => setTradeName(e.target.value)}
                    placeholder="Ex.: Alpha Engenharia"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="comp-cnpj">CNPJ (14 dígitos) *</Label>
                  <Input
                    id="comp-cnpj"
                    required
                    inputMode="numeric"
                    value={cnpj}
                    onChange={(e) => setCnpj(formatCNPJ(e.target.value))}
                    placeholder="00.000.000/0001-00"
                    className="tabular-nums"
                  />
                </div>

                <div className="space-y-1.5">
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

                <div className="space-y-1.5">
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
                <p className="px-6 pb-6 text-[13px] text-[#42484C] dark:text-[#9DB0C2]">
                  Nenhuma empresa cadastrada ainda.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[13px]">
                    <thead className="border-y border-[#CBD5E1] bg-[#F8FAFC] text-[12px] font-medium tracking-[0.02em] text-[#64748B] dark:border-[#2A3B4C] dark:bg-[#08131D] dark:text-[#9DB0C2]">
                      <tr>
                        <th className="px-6 py-2.5">Token Anônimo</th>
                        <th className="px-6 py-2.5">Empresa</th>
                        <th className="px-6 py-2.5">CNPJ</th>
                        <th className="px-6 py-2.5">Vínculo de Grupo</th>
                        <th className="px-6 py-2.5 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F1F5F9] dark:divide-[#1E2F3F]">
                      {companies.map((c) => (
                        <tr key={c.id} className="hover:bg-[#F1F5F9] dark:hover:bg-[#162838]/50">
                          <td className="px-6 py-2.5">
                            <StatusChip variant="primary">{c.analytical_token}</StatusChip>
                          </td>
                          <td className="px-6 py-2.5">
                            <p className="font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                              {c.trade_name ?? c.legal_name}
                            </p>
                            <p className="text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
                              {c.legal_name}
                            </p>
                          </td>
                          <td className="px-6 py-2.5 text-[12px] tabular-nums text-[#334155] dark:text-[#B9CADB]">
                            {formatCNPJ(c.cnpj)}
                          </td>
                          <td className="px-6 py-2.5 min-w-[220px]">
                            <Select
                              value={c.group_id ?? NO_GROUP_VALUE}
                              onValueChange={(val) => void handleLinkGroupChange(c.id, val)}
                            >
                              <SelectTrigger className="h-8 text-[12px]">
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
                          <td className="px-6 py-2.5 text-right">
                            <Button
                              variant="destructive"
                              size="sm"
                              aria-label={`Remover ${c.legal_name}`}
                              onClick={() => void runDelete(() => deleteCompany(session.userId, session.email, c.id))}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
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
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
                Novo Registro
              </span>
              <CardTitle>Nova Conta Bancária, Caixa ou Cartão</CardTitle>
              <CardDescription>
                Vincule contas reais a uma empresa para geração automática do token analítico{' '}
                <span className="font-mono">CTA_XX</span>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateAccount} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5">
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

                <div className="space-y-1.5">
                  <Label htmlFor="acc-name">Nome da Conta *</Label>
                  <Input
                    id="acc-name"
                    required
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    placeholder="Ex.: Conta Corrente Principal"
                  />
                </div>

                <div className="space-y-1.5">
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

                <div className="space-y-1.5">
                  <Label htmlFor="acc-bank">Instituição / Banco</Label>
                  <Input
                    id="acc-bank"
                    value={institutionName}
                    onChange={(e) => setInstitutionName(e.target.value)}
                    placeholder="Ex.: Itaú, BTG, Caixa Interno"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="acc-last4">4 Últimos Dígitos (Opcional)</Label>
                  <Input
                    id="acc-last4"
                    inputMode="numeric"
                    maxLength={4}
                    value={lastFour}
                    onChange={(e) => setLastFour(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="4419"
                    className="tabular-nums"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="acc-opening">Saldo inicial (Opcional)</Label>
                  <Input
                    id="acc-opening"
                    inputMode="decimal"
                    value={accountOpening}
                    onChange={(e) => setAccountOpening(e.target.value)}
                    placeholder="Ex.: 1.500,00 ou -300,00"
                    className="tabular-nums"
                  />
                  <p className="text-[11px] text-[#72787D]">
                    Saldo que a conta já tinha na abertura. Use valor negativo para saldo devedor.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="acc-opening-date">Data do saldo</Label>
                  <Input
                    id="acc-opening-date"
                    type="date"
                    max={getTodayISO()}
                    value={accountOpeningDate}
                    onChange={(e) => setAccountOpeningDate(e.target.value)}
                    disabled={accountOpening.trim() === ''}
                    className="tabular-nums"
                  />
                  <p className="text-[11px] text-[#72787D]">
                    Movimentos anteriores a esta data não entram no saldo.
                  </p>
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
                <p className="px-6 pb-6 text-[13px] text-[#42484C] dark:text-[#9DB0C2]">
                  Nenhuma conta financeira cadastrada ainda.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[13px]">
                    <thead className="border-y border-[#CBD5E1] bg-[#F8FAFC] text-[12px] font-medium tracking-[0.02em] text-[#64748B] dark:border-[#2A3B4C] dark:bg-[#08131D] dark:text-[#9DB0C2]">
                      <tr>
                        <th className="px-6 py-2.5">Token Anônimo</th>
                        <th className="px-6 py-2.5">Conta</th>
                        <th className="px-6 py-2.5">Empresa</th>
                        <th className="px-6 py-2.5">Tipo / Instituição</th>
                        <th className="px-6 py-2.5 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F1F5F9] dark:divide-[#1E2F3F]">
                      {accounts.map((acc) => {
                        const comp = companies.find((c) => c.id === acc.company_id);
                        return (
                          <tr key={acc.id} className="hover:bg-[#F1F5F9] dark:hover:bg-[#162838]/50">
                            <td className="px-6 py-2.5">
                              <StatusChip variant="primary">{acc.analytical_token}</StatusChip>
                            </td>
                            <td className="px-6 py-2.5 font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                              {acc.name}
                              {acc.last_four && (
                                <span className="ml-2 text-[12px] tabular-nums text-[#72787D]">
                                  •••• {acc.last_four}
                                </span>
                              )}
                              {(acc.opening_balance ?? 0) !== 0 && (
                                <p className="mt-0.5 text-[11px] font-normal tabular-nums text-[#72787D]">
                                  Saldo inicial {formatCurrencyBRL(acc.opening_balance)} em{' '}
                                  {formatDateBR(acc.opening_balance_date)}
                                </p>
                              )}
                            </td>
                            <td className="px-6 py-2.5 text-[12px] text-[#334155] dark:text-[#B9CADB]">
                              {comp
                                ? `${comp.trade_name ?? comp.legal_name} (${comp.analytical_token})`
                                : '—'}
                            </td>
                            <td className="px-6 py-2.5 text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
                              {ACCOUNT_TYPE_LABELS[acc.account_type]}
                              {acc.institution_name ? ` · ${acc.institution_name}` : ''}
                            </td>
                            <td className="px-6 py-2.5 text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                className="mr-2"
                                aria-label={`Editar ${acc.name}`}
                                onClick={() => openEdit(acc)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                aria-label={`Remover ${acc.name}`}
                                onClick={() => void runDelete(() => deleteFinancialAccount(session.userId, session.email, acc.id))}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
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
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
                Consolidação Opcional
              </span>
              <CardTitle>Novo Grupo Empresarial (Opcional)</CardTitle>
              <CardDescription>
                Crie um grupo apenas se desejar consolidar múltiplas empresas. Ao excluir um grupo,
                as empresas permanecem ativas em operação independente.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateGroup} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="grp-name">Nome do Grupo / Holding *</Label>
                  <Input
                    id="grp-name"
                    required
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="Ex.: Horizonte Participações"
                  />
                </div>
                <div className="space-y-1.5">
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
                <p className="px-6 pb-6 text-[13px] text-[#42484C] dark:text-[#9DB0C2]">
                  Nenhum grupo criado. Todas as empresas operam de forma independente.
                </p>
              ) : (
                <div className="divide-y divide-[#F1F5F9] dark:divide-[#1E2F3F]">
                  {groups.map((grp) => {
                    const count = companies.filter((c) => c.group_id === grp.id).length;
                    return (
                      <div
                        key={grp.id}
                        className="flex items-center justify-between gap-4 px-6 py-3 hover:bg-[#F1F5F9] dark:hover:bg-[#162838]/50"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                              {grp.name}
                            </span>
                            <StatusChip variant="primary">{grp.analytical_token}</StatusChip>
                          </div>
                          <p className="text-[12px] tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                            {count} {count === 1 ? 'empresa vinculada' : 'empresas vinculadas'}
                            {grp.description ? ` · ${grp.description}` : ''}
                          </p>
                        </div>
                        <Button
                          variant="destructive"
                          size="sm"
                          aria-label={`Excluir grupo ${grp.name}`}
                          onClick={() => void runDelete(() => deleteBusinessGroup(session.userId, session.email, grp.id))}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
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

      <Dialog open={editing !== null} onOpenChange={(open) => (open ? undefined : closeEdit())}>
        <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
          {editing && !confirmingBalance && (
            <>
              <DialogHeader>
                <DialogTitle>Editar conta</DialogTitle>
                <DialogDescription>
                  Token analítico <span className="font-mono">{editing.analytical_token}</span> não muda.
                </DialogDescription>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitEdit(false);
                }}
                className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              >
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="edit-acc-name">Nome da Conta *</Label>
                  <Input
                    id="edit-acc-name"
                    required
                    value={editForm.name}
                    onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-acc-type">Tipo de Conta</Label>
                  <Select
                    value={editForm.type}
                    onValueChange={(v) => setEditForm((f) => ({ ...f, type: v as AccountType }))}
                  >
                    <SelectTrigger id="edit-acc-type">
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
                <div className="space-y-1.5">
                  <Label htmlFor="edit-acc-bank">Instituição / Banco</Label>
                  <Input
                    id="edit-acc-bank"
                    value={editForm.institution}
                    onChange={(e) => setEditForm((f) => ({ ...f, institution: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-acc-last4">4 Últimos Dígitos</Label>
                  <Input
                    id="edit-acc-last4"
                    inputMode="numeric"
                    maxLength={4}
                    value={editForm.lastFour}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, lastFour: e.target.value.replace(/\D/g, '').slice(0, 4) }))
                    }
                    className="tabular-nums"
                  />
                </div>
                <div className="flex items-end gap-2 pb-2">
                  <input
                    id="edit-acc-active"
                    type="checkbox"
                    checked={editForm.active}
                    onChange={(e) => setEditForm((f) => ({ ...f, active: e.target.checked }))}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="edit-acc-active">Conta ativa</Label>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-acc-opening">Saldo inicial</Label>
                  <Input
                    id="edit-acc-opening"
                    inputMode="decimal"
                    value={editForm.opening}
                    onChange={(e) => setEditForm((f) => ({ ...f, opening: e.target.value }))}
                    placeholder="Ex.: 1.500,00 ou -300,00"
                    className="tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-acc-opening-date">Data do saldo</Label>
                  <Input
                    id="edit-acc-opening-date"
                    type="date"
                    max={getTodayISO()}
                    value={editForm.date}
                    onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
                    disabled={editForm.opening.trim() === ''}
                    className="tabular-nums"
                  />
                </div>
                {editError && (
                  <p role="alert" className="text-[12px] text-[#DC2626] dark:text-[#FCA5A5] sm:col-span-2">
                    {editError}
                  </p>
                )}
                <div className="flex justify-end gap-2 pt-2 sm:col-span-2">
                  <Button type="button" variant="outline" onClick={closeEdit}>
                    Cancelar
                  </Button>
                  <Button type="submit" variant="primary" disabled={savingEdit}>
                    Salvar
                  </Button>
                </div>
              </form>
            </>
          )}

          {editing && confirmingBalance && (
            <>
              <DialogHeader>
                <DialogTitle>Alterar o saldo inicial?</DialogTitle>
                <DialogDescription>
                  A conta <strong>{editing.name}</strong> já tem lançamentos. Mudar o saldo inicial altera o saldo
                  atual e o previsto em todas as telas (Visão Geral, Fluxo & Lançamentos, Saúde Financeira) e nos
                  consolidados.
                </DialogDescription>
              </DialogHeader>
              {editPreview && (
                <p className="rounded-[8px] border border-[#E2E8F0] px-3 py-2 text-[13px] tabular-nums dark:border-[#1E2F3F]">
                  Saldo atual: {formatCurrencyBRL(editPreview.before)} → <strong>{formatCurrencyBRL(editPreview.after)}</strong>
                </p>
              )}
              {editError && (
                <p role="alert" className="text-[12px] text-[#DC2626] dark:text-[#FCA5A5]">
                  {editError}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setConfirmingBalance(false)}>
                  Voltar
                </Button>
                <Button type="button" variant="primary" disabled={savingEdit} onClick={() => void submitEdit(true)}>
                  Confirmar alteração
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
