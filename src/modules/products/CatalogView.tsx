import { Boxes, Edit3, Package, Plus, Search, ShieldCheck, Trash2, Wrench } from 'lucide-react';
import React, { useMemo, useState } from 'react';
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
import { cn, formatCurrencyBRL } from '../../lib/utils';
import { InfoTooltip } from '../core/components/InfoTooltip';
import {
  calculateUnitContribution,
  createProductService,
  deleteProductService,
  getScopedIds,
  updateProductService,
} from '../core/repository';
import type {
  ActiveContext,
  AuthSessionState,
  BusinessGroup,
  Company,
  FinancialAccount,
  OfferKind,
  ProductService,
} from '../core/types';

interface CatalogViewProps {
  session: AuthSessionState;
  groups: BusinessGroup[];
  companies: Company[];
  accounts: FinancialAccount[];
  productsServices: ProductService[];
  activeContext: ActiveContext;
  onRefresh: () => Promise<void>;
  onNavigateHierarchy: () => void;
}

const OFFER_KIND_LABELS: Record<OfferKind, string> = {
  physical_product: 'Produto Físico',
  digital_product: 'Produto Digital',
  service: 'Serviço',
};

type OfferFilter = 'all' | OfferKind;

export const CatalogView: React.FC<CatalogViewProps> = ({
  session,
  groups,
  companies,
  accounts,
  productsServices,
  activeContext,
  onRefresh,
  onNavigateHierarchy,
}) => {
  const [search, setSearch] = useState('');
  const [offerFilter, setOfferFilter] = useState<OfferFilter>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ProductService | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form state
  const [scopeKind, setScopeKind] = useState<'company' | 'group'>('company');
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [name, setName] = useState('');
  const [offerKind, setOfferKind] = useState<OfferKind>('service');
  const [skuCode, setSkuCode] = useState('');
  const [basePrice, setBasePrice] = useState('0');
  const [directCost, setDirectCost] = useState('0');
  const [paymentFeePct, setPaymentFeePct] = useState('2.5');
  const [estimatedTaxPct, setEstimatedTaxPct] = useState('6.0');
  const [description, setDescription] = useState('');

  const { companyIds, groupId: activeGroupId } = useMemo(
    () => getScopedIds(companies, accounts, activeContext),
    [companies, accounts, activeContext]
  );

  const scopedProducts = useMemo(() => {
    return productsServices.filter((item) => {
      if (activeContext.scope === 'all_independent') return true;
      if (activeContext.scope === 'group') {
        return (
          item.group_id === activeContext.groupId ||
          (item.company_id !== null && companyIds.has(item.company_id))
        );
      }
      if (item.company_id && companyIds.has(item.company_id)) return true;
      if (item.group_id && activeGroupId && item.group_id === activeGroupId) return true;
      return false;
    });
  }, [productsServices, activeContext, companyIds, activeGroupId]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopedProducts.filter((item) => {
      if (offerFilter !== 'all' && item.offer_kind !== offerFilter) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.analytical_token.toLowerCase().includes(q) ||
        (item.sku_code?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [scopedProducts, offerFilter, search]);

  const summaryStats = useMemo(() => {
    const total = scopedProducts.length;
    const productsCount = scopedProducts.filter((p) => p.item_type === 'product').length;
    const servicesCount = scopedProducts.filter((p) => p.item_type === 'service').length;
    const avgMarginPct =
      total > 0
        ? scopedProducts.reduce(
            (acc, item) => acc + calculateUnitContribution(item).contributionMarginPct,
            0
          ) / total
        : 0;

    return { total, productsCount, servicesCount, avgMarginPct };
  }, [scopedProducts]);

  const previewContribution = useMemo(() => {
    return calculateUnitContribution({
      base_price: Number(basePrice) || 0,
      estimated_direct_cost: Number(directCost) || 0,
      payment_fee_pct: Number(paymentFeePct) || 0,
      estimated_tax_pct: Number(estimatedTaxPct) || 0,
    });
  }, [basePrice, directCost, paymentFeePct, estimatedTaxPct]);

  const openCreateModal = () => {
    setEditingItem(null);
    setFormError(null);
    const defaultCompId =
      activeContext.scope === 'company'
        ? activeContext.companyId
        : companies[0]?.id ?? '';
    const defaultGrpId =
      activeContext.scope === 'group' ? activeContext.groupId : groups[0]?.id ?? '';

    if (activeContext.scope === 'group' && groups.length > 0) {
      setScopeKind('group');
      setSelectedGroupId(defaultGrpId);
      setSelectedCompanyId(defaultCompId);
    } else {
      setScopeKind('company');
      setSelectedCompanyId(defaultCompId);
      setSelectedGroupId(defaultGrpId);
    }

    setName('');
    setOfferKind('service');
    setSkuCode('');
    setBasePrice('1500');
    setDirectCost('350');
    setPaymentFeePct('2.5');
    setEstimatedTaxPct('6.0');
    setDescription('');
    setModalOpen(true);
  };

  const openEditModal = (item: ProductService) => {
    setEditingItem(item);
    setFormError(null);
    if (item.group_id && !item.company_id) {
      setScopeKind('group');
      setSelectedGroupId(item.group_id);
      setSelectedCompanyId(companies[0]?.id ?? '');
    } else {
      setScopeKind('company');
      setSelectedCompanyId(item.company_id ?? companies[0]?.id ?? '');
      setSelectedGroupId(item.group_id ?? groups[0]?.id ?? '');
    }
    setName(item.name);
    setOfferKind(item.offer_kind);
    setSkuCode(item.sku_code ?? '');
    setBasePrice(String(item.base_price));
    setDirectCost(String(item.estimated_direct_cost));
    setPaymentFeePct(String(item.payment_fee_pct));
    setEstimatedTaxPct(String(item.estimated_tax_pct));
    setDescription(item.description ?? '');
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const payload = {
        company_id: scopeKind === 'company' ? selectedCompanyId || null : null,
        group_id: scopeKind === 'group' ? selectedGroupId || null : null,
        name,
        offer_kind: offerKind,
        sku_code: skuCode,
        base_price: Number(basePrice) || 0,
        estimated_direct_cost: Number(directCost) || 0,
        payment_fee_pct: Number(paymentFeePct) || 0,
        estimated_tax_pct: Number(estimatedTaxPct) || 0,
        description,
      };

      if (editingItem) {
        await updateProductService(session.userId, session.email, editingItem.id, payload);
      } else {
        await createProductService(session.userId, session.email, payload);
      }
      setModalOpen(false);
      await onRefresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao salvar item do catálogo.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (item: ProductService) => {
    await deleteProductService(session.userId, session.email, item.id);
    await onRefresh();
  };

  const resolveScopeLabel = (item: ProductService): string => {
    if (item.company_id) {
      const comp = companies.find((c) => c.id === item.company_id);
      return comp ? `${comp.trade_name ?? comp.legal_name} (${comp.analytical_token})` : 'Empresa';
    }
    if (item.group_id) {
      const grp = groups.find((g) => g.id === item.group_id);
      return grp ? `Compartilhado · ${grp.name} (${grp.analytical_token})` : 'Grupo';
    }
    return '—';
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
            Produtos &amp; Serviços
          </span>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-[24px] font-semibold leading-8 tracking-[-0.02em] text-[#0F172A] dark:text-[#EAF1FF]">
              Catálogo de Produtos &amp; Serviços
            </h1>
            <InfoTooltip glossaryKey="margem_contribuicao_unitaria" />
          </div>
          <p className="text-[14px] leading-5 text-[#42484C] dark:text-[#9DB0C2]">
            Cadastre ofertas com custo direto, taxa de pagamento e imposto para acompanhar a margem
            unitária. Cada item recebe um token anônimo (<span className="font-mono">PRD_XX</span> /{' '}
            <span className="font-mono">SRV_XX</span>) no Cofre.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={openCreateModal}
          disabled={companies.length === 0 && groups.length === 0}
          className="min-h-[40px]"
        >
          <Plus className="h-4 w-4" />
          <span>Novo Produto / Serviço</span>
        </Button>
      </div>

      {/* KPIs do Catálogo */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6">
        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Itens no Escopo
              </span>
              <Boxes className="h-4 w-4 text-[#72787D]" />
            </div>
            <p className="mt-2 font-display text-[28px] font-semibold leading-9 tracking-[-0.02em] tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
              {summaryStats.total}
            </p>
            <p className="mt-1 text-[12px] leading-4 text-[#42484C] tabular-nums dark:text-[#9DB0C2]">
              {summaryStats.productsCount} produtos · {summaryStats.servicesCount} serviços
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Margem Média Unit.
                <InfoTooltip glossaryKey="margem_contribuicao_unitaria" />
              </span>
              <Package className="h-4 w-4 text-[#059669] dark:text-[#68DBA9]" />
            </div>
            <p className="mt-2 font-display text-[28px] font-semibold leading-9 tracking-[-0.02em] tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
              {summaryStats.avgMarginPct.toFixed(1)}%
            </p>
            <p className="mt-1 text-[12px] leading-4 text-[#065F46] dark:text-[#68DBA9]">
              Após custo direto, taxa e imposto
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Tokens de Oferta
              </span>
              <ShieldCheck className="h-4 w-4 text-[#0F374A] dark:text-[#A7CBE3]" />
            </div>
            <p className="mt-2 font-display text-[28px] font-semibold leading-9 tracking-[-0.02em] tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
              {summaryStats.total}
            </p>
            <p className="mt-1 text-[12px] leading-4 text-[#42484C] dark:text-[#9DB0C2]">
              Sanitizados em <span className="font-mono">anonymizer.ts</span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#42484C] dark:text-[#9DB0C2]">
                Serviços vs Produtos
              </span>
              <Wrench className="h-4 w-4 text-[#72787D]" />
            </div>
            <p className="mt-2 font-display text-[28px] font-semibold leading-9 tracking-[-0.02em] tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
              {summaryStats.servicesCount}/{summaryStats.productsCount}
            </p>
            <p className="mt-1 text-[12px] leading-4 text-[#42484C] dark:text-[#9DB0C2]">
              Físicos, digitais e consultivos
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Estado sem empresa cadastrada */}
      {companies.length === 0 && groups.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Cadastre uma empresa antes de criar ofertas</CardTitle>
            <CardDescription>
              Produtos e serviços precisam estar vinculados a uma empresa (ou compartilhados em um
              grupo empresarial).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="primary" onClick={onNavigateHierarchy}>
              Ir para Empresas &amp; Contas
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="border-b border-[#E2E8F0] dark:border-[#1E2F3F]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle>Portfólio &amp; Margem de Contribuição Unitária</CardTitle>
                <CardDescription>
                  Passe ou clique no ícone informativo ao lado da margem para revisar a composição.
                </CardDescription>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                {/* Filtro segmentado de tipo */}
                <div className="inline-flex items-center gap-1 overflow-x-auto rounded-[6px] border border-[#E2E8F0] bg-[#F1F5F9] p-1 dark:border-[#1E2F3F] dark:bg-[#08131D]">
                  {(
                    [
                      { id: 'all', label: 'Todos' },
                      { id: 'physical_product', label: 'Físicos' },
                      { id: 'digital_product', label: 'Digitais' },
                      { id: 'service', label: 'Serviços' },
                    ] as Array<{ id: OfferFilter; label: string }>
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setOfferFilter(tab.id)}
                      className={cn(
                        'whitespace-nowrap shrink-0 rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-colors cursor-pointer',
                        offerFilter === tab.id
                          ? 'bg-white text-[#0F374A] shadow-sm dark:bg-[#162838] dark:text-[#EAF1FF]'
                          : 'text-[#42484C] hover:text-[#0F172A] dark:text-[#9DB0C2] dark:hover:text-[#EAF1FF]'
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Busca */}
                <div className="relative min-w-[200px]">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[#72787D]" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar nome, SKU ou token..."
                    className="pl-8"
                  />
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {filteredItems.length === 0 ? (
              <div className="flex flex-col items-start gap-3 p-6">
                <p className="text-[14px] font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                  {scopedProducts.length === 0
                    ? 'Nenhum produto ou serviço cadastrado neste contexto ainda.'
                    : 'Nenhum item encontrado com os filtros aplicados.'}
                </p>
                <p className="text-[13px] text-[#42484C] dark:text-[#9DB0C2]">
                  Cadastre seus produtos físicos, digitais ou serviços para vincular receitas e custos
                  diretos nos lançamentos financeiros.
                </p>
                <Button variant="primary" size="sm" onClick={openCreateModal}>
                  <Plus className="h-4 w-4" />
                  <span>Cadastrar Primeiro Item</span>
                </Button>
              </div>
            ) : (
              <>
                {/* Tabela Desktop */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-[13px]">
                    <thead className="border-b border-[#CBD5E1] bg-[#F8FAFC] text-[12px] font-medium tracking-[0.02em] text-[#64748B] dark:border-[#2A3B4C] dark:bg-[#08131D] dark:text-[#9DB0C2]">
                      <tr>
                        <th className="px-5 py-2.5">Token</th>
                        <th className="px-4 py-2.5">Produto / Serviço</th>
                        <th className="px-4 py-2.5 text-right">Preço Base</th>
                        <th className="px-4 py-2.5 text-right">Custo Direto</th>
                        <th className="px-4 py-2.5 text-right">Taxa + Imposto</th>
                        <th className="px-4 py-2.5 text-right">
                          <span className="inline-flex items-center justify-end gap-1">
                            Margem Unitária
                            <InfoTooltip glossaryKey="margem_contribuicao_unitaria" align="end" />
                          </span>
                        </th>
                        <th className="px-5 py-2.5 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F1F5F9] dark:divide-[#1E2F3F]">
                      {filteredItems.map((item) => {
                        const calc = calculateUnitContribution(item);
                        const isHealthy = calc.contributionMargin > 0;
                        return (
                          <tr
                            key={item.id}
                            className="hover:bg-[#F1F5F9]/70 dark:hover:bg-[#162838]/50"
                          >
                            <td className="px-5 py-3">
                              <StatusChip variant="primary">{item.analytical_token}</StatusChip>
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                                {item.name}
                              </p>
                              <p className="text-[11px] text-[#42484C] dark:text-[#9DB0C2]">
                                {OFFER_KIND_LABELS[item.offer_kind]}
                                {item.sku_code ? ` · SKU ${item.sku_code}` : ''} ·{' '}
                                {resolveScopeLabel(item)}
                              </p>
                            </td>
                            <td className="px-4 py-3 text-right font-medium tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">
                              {formatCurrencyBRL(item.base_price)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                              {formatCurrencyBRL(item.estimated_direct_cost)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                              {(item.payment_fee_pct + item.estimated_tax_pct).toFixed(2)}%
                              <span className="block text-[11px] text-[#72787D]">
                                ({formatCurrencyBRL(calc.paymentFeeValue + calc.taxValue)})
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              <div className="inline-flex flex-col items-end gap-0.5">
                                <span
                                  className={cn(
                                    'font-semibold',
                                    isHealthy
                                      ? 'text-[#059669] dark:text-[#68DBA9]'
                                      : 'text-[#DC2626] dark:text-[#FCA5A5]'
                                  )}
                                >
                                  {formatCurrencyBRL(calc.contributionMargin)}
                                </span>
                                <StatusChip variant={isHealthy ? 'positive' : 'alert'}>
                                  {calc.contributionMarginPct.toFixed(1)}%
                                </StatusChip>
                              </div>
                            </td>
                            <td className="px-5 py-3 text-right">
                              <div className="inline-flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openEditModal(item)}
                                  aria-label={`Editar ${item.name}`}
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => void handleDelete(item)}
                                  aria-label={`Excluir ${item.name}`}
                                  className="text-[#DC2626] hover:bg-[#FEF2F2] hover:text-[#991B1B] dark:text-[#FCA5A5] dark:hover:bg-[#3B1219]"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Cards Mobile */}
                <div className="divide-y divide-[#E2E8F0] md:hidden dark:divide-[#1E2F3F]">
                  {filteredItems.map((item) => {
                    const calc = calculateUnitContribution(item);
                    const isHealthy = calc.contributionMargin > 0;
                    return (
                      <div key={item.id} className="space-y-3 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusChip variant="primary">{item.analytical_token}</StatusChip>
                              <span className="text-[11px] font-medium text-[#42484C] dark:text-[#9DB0C2]">
                                {OFFER_KIND_LABELS[item.offer_kind]}
                              </span>
                            </div>
                            <p className="font-display text-[15px] font-semibold text-[#0F172A] dark:text-[#EAF1FF]">
                              {item.name}
                            </p>
                            <p className="text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
                              {resolveScopeLabel(item)}
                            </p>
                          </div>
                          <StatusChip variant={isHealthy ? 'positive' : 'alert'}>
                            {calc.contributionMarginPct.toFixed(1)}%
                          </StatusChip>
                        </div>

                        <div className="grid grid-cols-3 gap-2 rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 text-[12px] tabular-nums dark:border-[#1E2F3F] dark:bg-[#08131D]">
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.04em] text-[#72787D]">
                              Preço
                            </p>
                            <p className="font-semibold text-[#0F172A] dark:text-[#EAF1FF]">
                              {formatCurrencyBRL(item.base_price)}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.04em] text-[#72787D]">
                              Deduções
                            </p>
                            <p className="font-medium text-[#42484C] dark:text-[#9DB0C2]">
                              {formatCurrencyBRL(calc.totalDeductions)}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.04em] text-[#72787D]">
                              Margem
                            </p>
                            <p
                              className={cn(
                                'font-semibold',
                                isHealthy
                                  ? 'text-[#059669] dark:text-[#68DBA9]'
                                  : 'text-[#DC2626] dark:text-[#FCA5A5]'
                              )}
                            >
                              {formatCurrencyBRL(calc.contributionMargin)}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditModal(item)}
                            className="min-h-[40px]"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            <span>Editar</span>
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => void handleDelete(item)}
                            className="min-h-[40px]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Excluir</span>
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Modal Criar / Editar Produto ou Serviço */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editingItem
                ? `Editar ${editingItem.analytical_token}`
                : 'Novo Produto ou Serviço'}
            </DialogTitle>
            <DialogDescription>
              Ao salvar, o Cofre de Anonimização gera ou atualiza o token anônimo imutável (
              <span className="font-mono">PRD_XX</span> ou <span className="font-mono">SRV_XX</span>
              ).
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            {formError && (
              <div className="rounded-[4px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12px] font-medium text-[#991B1B] dark:border-[#7F1D1D] dark:bg-[#3B1219] dark:text-[#FCA5A5]">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="prod-kind">Tipo de Oferta *</Label>
                <Select
                  value={offerKind}
                  onValueChange={(v) => setOfferKind(v as OfferKind)}
                  disabled={Boolean(editingItem)}
                >
                  <SelectTrigger id="prod-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="physical_product">Produto Físico (PRD)</SelectItem>
                    <SelectItem value="digital_product">Produto Digital (PRD)</SelectItem>
                    <SelectItem value="service">Serviço (SRV)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="prod-scope-type">Vínculo Organizacional *</Label>
                <Select
                  value={scopeKind}
                  onValueChange={(v) => setScopeKind(v as 'company' | 'group')}
                >
                  <SelectTrigger id="prod-scope-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="company" disabled={companies.length === 0}>
                      Empresa Específica
                    </SelectItem>
                    <SelectItem value="group" disabled={groups.length === 0}>
                      Compartilhado no Grupo
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {scopeKind === 'company' ? (
              <div className="space-y-1.5">
                <Label htmlFor="prod-company">Empresa Vinculada *</Label>
                <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                  <SelectTrigger id="prod-company">
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
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="prod-group">Grupo Empresarial Compartilhado *</Label>
                <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                  <SelectTrigger id="prod-group">
                    <SelectValue placeholder="Selecione o grupo" />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name} ({g.analytical_token})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="prod-name">Nome da Oferta *</Label>
                <Input
                  id="prod-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Consultoria Fiscal / Kit Automação"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prod-sku">Código / SKU (Opcional)</Label>
                <Input
                  id="prod-sku"
                  value={skuCode}
                  onChange={(e) => setSkuCode(e.target.value)}
                  placeholder="Ex.: SKU-01"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="prod-price">Preço Base (R$) *</Label>
                <Input
                  id="prod-price"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={basePrice}
                  onChange={(e) => setBasePrice(e.target.value)}
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prod-cost">Custo Direto (R$)</Label>
                <Input
                  id="prod-cost"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={directCost}
                  onChange={(e) => setDirectCost(e.target.value)}
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prod-fee">Taxa Pgto (%)</Label>
                <Input
                  id="prod-fee"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  required
                  value={paymentFeePct}
                  onChange={(e) => setPaymentFeePct(e.target.value)}
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prod-tax">Imposto Est. (%)</Label>
                <Input
                  id="prod-tax"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  required
                  value={estimatedTaxPct}
                  onChange={(e) => setEstimatedTaxPct(e.target.value)}
                  className="tabular-nums"
                />
              </div>
            </div>

            {/* Prévia da Margem de Contribuição Unitária */}
            <div className="rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 dark:border-[#1E2F3F] dark:bg-[#08131D]">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1 text-[12px] font-medium text-[#334155] dark:text-[#B9CADB]">
                  Margem de Contribuição Unitária Estimada
                  <InfoTooltip glossaryKey="margem_contribuicao_unitaria" />
                </span>
                <StatusChip
                  variant={previewContribution.contributionMargin > 0 ? 'positive' : 'alert'}
                >
                  {previewContribution.contributionMarginPct.toFixed(1)}%
                </StatusChip>
              </div>
              <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 tabular-nums">
                <span
                  className={cn(
                    'font-display text-[20px] font-semibold',
                    previewContribution.contributionMargin > 0
                      ? 'text-[#059669] dark:text-[#68DBA9]'
                      : 'text-[#DC2626] dark:text-[#FCA5A5]'
                  )}
                >
                  {formatCurrencyBRL(previewContribution.contributionMargin)} / unidade
                </span>
                <span className="text-[11px] text-[#42484C] dark:text-[#9DB0C2]">
                  Taxa: {formatCurrencyBRL(previewContribution.paymentFeeValue)} · Imposto:{' '}
                  {formatCurrencyBRL(previewContribution.taxValue)}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prod-desc">Observações / Escopo (Opcional)</Label>
              <Input
                id="prod-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Breve detalhamento operacional do produto ou serviço"
              />
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-[#E2E8F0] pt-4 sm:flex-row sm:justify-end dark:border-[#1E2F3F]">
              <Button
                type="button"
                variant="outline"
                onClick={() => setModalOpen(false)}
                className="min-h-[40px]"
              >
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={submitting} className="min-h-[40px]">
                {submitting ? 'Salvando...' : editingItem ? 'Salvar Alterações' : 'Cadastrar Oferta'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
