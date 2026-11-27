import { Check, Copy, Download, FlaskConical, KeyRound, Pause, Play, Plug, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input, Label } from '../../components/ui/input';
import { StatusChip } from '../../components/ui/status-chip';
import { formatCurrencyBRL, formatDateTimeBR } from '../../lib/utils';
import type { AuthSessionState, Category, Company, FinancialAccount, ProductService } from '../core/types';
import { isSupabaseConfigured } from '../core/supabase';
import { HistoryImportModal } from './components/HistoryImportModal';
import { ModuleHeader, NativeSelect, Notice, SandboxGate, Toggle } from './components/moduleUi';
import {
  createConnection,
  deleteConnection,
  fetchConnections,
  fetchWebhookEvents,
  reprocessEvent,
  sendTestEvent,
  updateConnection,
} from './integrationsApi';
import {
  PROVIDER_LABELS,
  PROVIDER_SECRET_HELP,
  type CustomFieldMappingConfig,
  type IntegrationConnection,
  type IntegrationProvider,
  type WebhookEventRow,
} from './types';

interface IntegrationsHubViewProps {
  session: AuthSessionState;
  companies: Company[];
  accounts: FinancialAccount[];
  categories: Category[];
  productsServices: ProductService[];
  onRefresh: () => Promise<void>;
}

const PROVIDERS: IntegrationProvider[] = ['stripe', 'mercadopago', 'asaas', 'openfinance_generic', 'custom_json_mapping'];

const MAPPING_FIELDS: Array<{ key: keyof CustomFieldMappingConfig; label: string; placeholder: string }> = [
  { key: 'event_id_path', label: 'ID do evento', placeholder: 'id' },
  { key: 'payment_ref_path', label: 'ID do pagamento', placeholder: 'payment.id' },
  { key: 'amount_path', label: 'Valor bruto', placeholder: 'payment.amount' },
  { key: 'fee_path', label: 'Taxa', placeholder: 'payment.fee' },
  { key: 'net_path', label: 'Valor líquido', placeholder: 'payment.net_amount' },
  { key: 'date_path', label: 'Data do fato', placeholder: 'payment.created_at' },
  { key: 'settlement_date_path', label: 'Data de liquidação', placeholder: 'payment.paid_at' },
  { key: 'description_path', label: 'Descrição', placeholder: 'payment.description' },
  { key: 'status_path', label: 'Status', placeholder: 'payment.status' },
  { key: 'signature_header', label: 'Cabeçalho da assinatura', placeholder: 'x-signature' },
];

/** Provedores com consulta por API (chave de API e importação de histórico). */
const supportsApiKey = (p: IntegrationProvider) => p === 'asaas' || p === 'mercadopago';

const statusChip = (s: WebhookEventRow['status']) =>
  s === 'processed' ? 'positive' : s === 'failed' ? 'alert' : s === 'ignored' ? 'neutral' : 'primary';

export const IntegrationsHubView: React.FC<IntegrationsHubViewProps> = ({
  session,
  companies,
  accounts,
  categories,
  productsServices,
  onRefresh,
}) => {
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [events, setEvents] = useState<WebhookEventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Formulário de nova conexão
  const [dialogOpen, setDialogOpen] = useState(false);
  const [provider, setProvider] = useState<IntegrationProvider>('stripe');
  const [label, setLabel] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [signingSecret, setSigningSecret] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [feePct, setFeePct] = useState('');
  const [feeFixed, setFeeFixed] = useState('');
  const [productId, setProductId] = useState('');
  const [recordFee, setRecordFee] = useState(true);
  const [amountInCents, setAmountInCents] = useState(false);
  const [mapping, setMapping] = useState<Partial<CustomFieldMappingConfig>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Chave de API de uma conexão existente (a chave nunca volta do servidor)
  const [historyConn, setHistoryConn] = useState<IntegrationConnection | null>(null);
  const [sourceFilter, setSourceFilter] = useState<'' | 'api' | 'webhook'>('');
  const [keyDialog, setKeyDialog] = useState<IntegrationConnection | null>(null);
  const [keyValue, setKeyValue] = useState('');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keySaving, setKeySaving] = useState(false);

  const companyAccounts = useMemo(() => accounts.filter((a) => a.company_id === companyId), [accounts, companyId]);
  const companyProducts = useMemo(
    () => productsServices.filter((p) => p.is_active && (p.company_id === companyId || p.company_id === null)),
    [productsServices, companyId]
  );
  const accountName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? '—';
  const companyName = (id: string | null) => {
    const c = companies.find((x) => x.id === id);
    return c ? c.trade_name || c.legal_name : '—';
  };
  void categories;

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    try {
      const [conn, ev] = await Promise.all([fetchConnections(), fetchWebhookEvents(undefined, sourceFilter || undefined)]);
      setConnections(conn.connections);
      setEvents(ev);
    } catch (err) {
      setFeedback({ tone: 'error', text: err instanceof Error ? err.message : 'Falha ao carregar integrações.' });
    } finally {
      setLoading(false);
    }
  }, [sourceFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setProvider('stripe');
    setLabel('');
    setCompanyId(companies[0]?.id ?? '');
    setAccountId('');
    setSigningSecret('');
    setApiToken('');
    setFeePct('');
    setFeeFixed('');
    setProductId('');
    setRecordFee(true);
    setAmountInCents(false);
    setMapping({});
    setFormError(null);
  };

  const handleCopy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      const usesMapping = provider === 'custom_json_mapping' || provider === 'openfinance_generic';
      const conn = await createConnection({
        provider,
        label: label.trim() || PROVIDER_LABELS[provider],
        company_id: companyId,
        account_id: accountId,
        signing_secret: signingSecret,
        api_access_token: apiToken || undefined,
        config: {
          fee_pct: feePct ? Number(feePct.replace(',', '.')) : undefined,
          fee_fixed: feeFixed ? Number(feeFixed.replace(',', '.')) : undefined,
          default_product_service_id: productId || null,
          record_fee_as_expense: recordFee,
          mapping: usesMapping ? ({ ...mapping, amount_in_cents: amountInCents } as CustomFieldMappingConfig) : undefined,
        },
      });
      setDialogOpen(false);
      setFeedback({
        tone: 'success',
        text: `Conexão "${conn.label}" criada. Copie a URL do webhook e cadastre no painel do provedor. O segredo foi cifrado e não será exibido novamente.`,
      });
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Falha ao criar conexão.');
    } finally {
      setSaving(false);
    }
  };

  const openKeyDialog = (c: IntegrationConnection) => {
    setKeyDialog(c);
    setKeyValue('');
    setKeyError(null);
  };

  const handleSaveKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyDialog) return;
    setKeyError(null);
    setKeySaving(true);
    try {
      await updateConnection(keyDialog.id, { api_access_token: keyValue.trim() });
      setKeyDialog(null);
      setKeyValue('');
      setFeedback({ tone: 'success', text: `Chave de API da conexão "${keyDialog.label}" salva. Ela foi cifrada e não será exibida novamente.` });
      await load();
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Falha ao salvar a chave de API.');
    } finally {
      setKeySaving(false);
    }
  };

  const withBusy = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    setFeedback(null);
    try {
      await fn();
    } catch (err) {
      setFeedback({ tone: 'error', text: err instanceof Error ? err.message : 'Operação falhou.' });
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleStatus = (c: IntegrationConnection) =>
    withBusy(c.id, async () => {
      await updateConnection(c.id, { status: c.status === 'paused' ? 'active' : 'paused' });
      await load();
    });

  const handleRotateUrl = (c: IntegrationConnection) =>
    withBusy(c.id, async () => {
      if (!window.confirm('Gerar nova URL? A URL atual deixa de funcionar imediatamente e precisa ser trocada no painel do provedor.')) return;
      await updateConnection(c.id, { rotate_url: true });
      setFeedback({ tone: 'info', text: 'Nova URL gerada. Atualize o endereço no painel do provedor.' });
      await load();
    });

  const handleDelete = (c: IntegrationConnection) =>
    withBusy(c.id, async () => {
      if (!window.confirm(`Remover a conexão "${c.label}"? O histórico de eventos dela também será apagado. Lançamentos já gerados permanecem.`)) return;
      await deleteConnection(c.id);
      await load();
    });

  const handleTest = (c: IntegrationConnection) =>
    withBusy(c.id, async () => {
      const r = await sendTestEvent(c.id);
      setFeedback({
        tone: r.processed ? 'success' : 'info',
        text: r.duplicate
          ? 'Evento de teste já registrado (idempotência funcionando).'
          : r.processed
            ? `Evento de teste assinado, validado e processado: ${String(r.transactions ?? 0)} lançamento(s) criado(s) na conta de destino. Exclua-os no Fluxo de Caixa se não quiser mantê-los.`
            : 'Evento de teste recebido, mas não gerou lançamentos (veja o log).',
      });
      await Promise.all([load(), onRefresh()]);
    });

  const handleReprocess = (ev: WebhookEventRow) =>
    withBusy(ev.id, async () => {
      const r = await reprocessEvent(ev.id);
      setFeedback({ tone: r.ok ? 'success' : 'error', text: r.ok ? `Reprocessado: ${r.transactions} lançamento(s).` : `Falhou de novo: ${r.error ?? ''}` });
      await Promise.all([load(), onRefresh()]);
    });

  const filteredEvents = eventFilter ? events.filter((e) => e.connection_id === eventFilter) : events;
  const usesMapping = provider === 'custom_json_mapping' || provider === 'openfinance_generic';

  return (
    <div className="space-y-6">
      <ModuleHeader
        eyebrow="Integrações & Webhooks"
        title="Central de Integrações & Webhooks"
        glossaryKey="webhook_idempotencia"
        description={
          <>
            Cada gateway tem sua própria URL e segredo de assinatura. Eventos válidos viram lançamentos com a receita bruta e a taxa
            separadas, sem duplicar reenvios.
          </>
        }
        actions={
          <>
            <Button variant="outline" disabled={loading} onClick={() => void load()}>
              <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              <span>Atualizar</span>
            </Button>
            <Button
              disabled={!isSupabaseConfigured || companies.length === 0}
              onClick={() => {
                resetForm();
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              <span>Nova Conexão</span>
            </Button>
          </>
        }
      />

      <SandboxGate isSandbox={!isSupabaseConfigured}>
        {feedback && <Notice tone={feedback.tone}>{feedback.text}</Notice>}
        {companies.length === 0 && <Notice tone="info">Cadastre uma empresa e uma conta antes de conectar gateways.</Notice>}

        {/* Conexões */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {connections.length === 0 && !loading && (
            <Card className="lg:col-span-2">
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <Plug className="h-6 w-6 text-[#72787D]" />
                <p className="text-[14px] font-medium">Nenhum gateway conectado</p>
                <p className="max-w-md text-[13px] text-[#42484C] dark:text-[#9DB0C2]">
                  Conecte Stripe, Mercado Pago, Asaas, um agregador Open Finance ou qualquer sistema que envie JSON assinado.
                </p>
              </CardContent>
            </Card>
          )}
          {connections.map((c) => (
            <Card key={c.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate">{c.label}</CardTitle>
                    <CardDescription>
                      {PROVIDER_LABELS[c.provider]} · {companyName(c.company_id)} → {accountName(c.account_id)}
                    </CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusChip variant={c.status === 'active' ? 'positive' : c.status === 'paused' ? 'neutral' : 'alert'}>
                      {c.status === 'active' ? 'Ativa' : c.status === 'paused' ? 'Pausada' : 'Com erro'}
                    </StatusChip>
                    {supportsApiKey(c.provider) && (
                      <StatusChip variant={c.api_key_configured ? 'positive' : 'neutral'}>
                        {c.api_key_configured ? 'Chave configurada' : 'Sem chave de API'}
                      </StatusChip>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="space-y-1">
                  <Label>URL do webhook</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={c.webhook_url ?? ''} className="font-mono text-[12px]" onFocus={(e) => e.currentTarget.select()} />
                    <Button variant="outline" size="icon" aria-label="Copiar URL" onClick={() => void handleCopy(c.id, c.webhook_url ?? '')}>
                      {copied === c.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  {c.webhook_url?.includes('localhost') && (
                    <p className="text-[11px] text-[#92400E] dark:text-[#FCD34D]">
                      Gateways não alcançam localhost. Defina APP_URL com um domínio público (ou um túnel como cloudflared/ngrok).
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
                  <span>Último evento: {c.last_event_at ? formatDateTimeBR(c.last_event_at) : 'nenhum'}</span>
                  <span>
                    Taxa padrão: {c.config.fee_pct ?? 0}% + {formatCurrencyBRL(c.config.fee_fixed ?? 0)}
                  </span>
                </div>
                {c.last_error && <Notice tone="error" className="text-[12px]">{c.last_error}</Notice>}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={busyId === c.id || c.provider === 'mercadopago'} onClick={() => void handleTest(c)} title={c.provider === 'mercadopago' ? 'Use “Simular notificação” no painel do Mercado Pago' : 'Envia um evento assinado com o segredo real'}>
                    <FlaskConical className="h-3.5 w-3.5" />
                    Testar
                  </Button>
                  {supportsApiKey(c.provider) && (
                    <Button size="sm" variant="outline" disabled={busyId === c.id} onClick={() => openKeyDialog(c)}>
                      <KeyRound className="h-3.5 w-3.5" />
                      {c.api_key_configured ? 'Trocar chave de API' : 'Chave de API'}
                    </Button>
                  )}
                  {supportsApiKey(c.provider) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === c.id || !c.api_key_configured}
                      title={c.api_key_configured ? 'Traz do provedor o histórico de cobranças de um período' : 'Configure a chave de API para importar o histórico'}
                      onClick={() => setHistoryConn(c)}
                    >
                      <Download className="h-3.5 w-3.5" />
                      Importar histórico
                    </Button>
                  )}
                  <Button size="sm" variant="outline" disabled={busyId === c.id} onClick={() => void handleToggleStatus(c)}>
                    {c.status === 'paused' ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                    {c.status === 'paused' ? 'Reativar' : 'Pausar'}
                  </Button>
                  <Button size="sm" variant="outline" disabled={busyId === c.id} onClick={() => void handleRotateUrl(c)}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Nova URL
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busyId === c.id} onClick={() => setEventFilter(c.id)}>
                    Ver eventos
                  </Button>
                  <Button size="sm" variant="destructive" disabled={busyId === c.id} onClick={() => void handleDelete(c)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Log de eventos */}
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <CardTitle>Log de eventos recebidos</CardTitle>
                <CardDescription>Fila com idempotência: reenvios do provedor aparecem uma única vez. Falhas podem ser reprocessadas.</CardDescription>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <NativeSelect
                  aria-label="Filtrar por origem"
                  className="sm:w-44"
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value as '' | 'api' | 'webhook')}
                  placeholder="Todas as origens"
                  options={[
                    { value: 'webhook', label: 'Webhook' },
                    { value: 'api', label: 'Importação por API' },
                  ]}
                />
                <NativeSelect
                  className="sm:w-64"
                  aria-label="Filtrar por conexão"
                  value={eventFilter}
                  onChange={(e) => setEventFilter(e.target.value)}
                  placeholder="Todas as conexões"
                  options={connections.map((c) => ({ value: c.id, label: c.label }))}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {filteredEvents.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-[#72787D]">Nenhum evento recebido ainda.</p>
            ) : (
              <div className="-mx-4 overflow-x-auto sm:mx-0">
                <table className="w-full min-w-[720px] text-left text-[12px]">
                  <thead className="border-b border-[#E2E8F0] text-[11px] uppercase tracking-[0.04em] text-[#72787D] dark:border-[#1E2F3F]">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Recebido</th>
                      <th className="px-3 py-2 font-semibold">Evento</th>
                      <th className="px-3 py-2 font-semibold">Tipo</th>
                      <th className="px-3 py-2 text-right font-semibold">Bruto</th>
                      <th className="px-3 py-2 text-right font-semibold">Taxa</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEvents.map((ev) => (
                      <tr key={ev.id} className="border-b border-[#F1F5F9] align-top dark:border-[#162838]">
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatDateTimeBR(ev.received_at)}</td>
                        <td className="px-3 py-2">
                          <p className="font-mono text-[11px]">{ev.external_event_id}</p>
                          <p className="flex items-center gap-1.5 text-[#72787D]">
                            {ev.event_type}
                            {ev.source === 'api' && <StatusChip variant="primary">API</StatusChip>}
                          </p>
                        </td>
                        <td className="px-3 py-2">{ev.normalized?.kind ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{ev.normalized ? formatCurrencyBRL(ev.normalized.grossAmount) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {ev.normalized?.feeAmount !== null && ev.normalized?.feeAmount !== undefined ? formatCurrencyBRL(ev.normalized.feeAmount) : 'config.'}
                        </td>
                        <td className="px-3 py-2">
                          <StatusChip variant={statusChip(ev.status)}>{ev.status}</StatusChip>
                          {ev.error_message && <p className="mt-1 max-w-[220px] text-[11px] text-[#72787D]">{ev.error_message}</p>}
                          {ev.transaction_ids.length > 0 && <p className="mt-1 text-[11px] text-[#72787D]">{ev.transaction_ids.length} lançamento(s)</p>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {ev.status === 'failed' && (
                            <Button size="sm" variant="outline" disabled={busyId === ev.id} onClick={() => void handleReprocess(ev)}>
                              Reprocessar
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </SandboxGate>

      {/* Dialog de nova conexão */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nova conexão de gateway / banco</DialogTitle>
            <DialogDescription>O segredo é cifrado no servidor (AES-256-GCM) e nunca volta para o navegador.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleCreate(e)} className="mt-4 space-y-4">
            {formError && <Notice tone="error">{formError}</Notice>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="int-provider">Provedor</Label>
                <NativeSelect
                  id="int-provider"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as IntegrationProvider)}
                  options={PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABELS[p] }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="int-label">Nome da conexão</Label>
                <Input id="int-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={PROVIDER_LABELS[provider]} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="int-company">Empresa destino *</Label>
                <NativeSelect
                  id="int-company"
                  required
                  value={companyId}
                  onChange={(e) => {
                    setCompanyId(e.target.value);
                    setAccountId('');
                  }}
                  placeholder="Selecione"
                  options={companies.map((c) => ({ value: c.id, label: c.trade_name || c.legal_name }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="int-account">Conta onde o dinheiro cai *</Label>
                <NativeSelect
                  id="int-account"
                  required
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  placeholder="Selecione"
                  options={companyAccounts.map((a) => ({ value: a.id, label: a.name }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="int-secret">Segredo de assinatura *</Label>
              <Input id="int-secret" type="password" autoComplete="off" required value={signingSecret} onChange={(e) => setSigningSecret(e.target.value)} />
              <p className="text-[11px] text-[#72787D]">{PROVIDER_SECRET_HELP[provider]}</p>
            </div>

            {provider === 'mercadopago' && (
              <div className="space-y-1.5">
                <Label htmlFor="int-token">Chave de API (Access Token de produção) *</Label>
                <Input id="int-token" type="password" autoComplete="off" required value={apiToken} onChange={(e) => setApiToken(e.target.value)} placeholder="APP_USR-..." />
                <p className="text-[11px] text-[#72787D]">
                  A assinatura do Mercado Pago não cobre o corpo da notificação; o servidor consulta o pagamento na API para obter valor,
                  taxa e datas reais. A mesma chave permite importar o histórico. Ela fica cifrada e não é exibida novamente.
                </p>
              </div>
            )}

            {provider === 'asaas' && (
              <div className="space-y-1.5">
                <Label htmlFor="int-token">Chave de API (opcional)</Label>
                <Input id="int-token" type="password" autoComplete="off" value={apiToken} onChange={(e) => setApiToken(e.target.value)} placeholder="$aact_..." />
                <p className="text-[11px] text-[#72787D]">
                  Necessária só para importar o histórico de cobranças. O sistema apenas lê dados do Asaas. A chave fica cifrada e não é exibida novamente.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="int-fee-pct">Taxa padrão (%)</Label>
                <Input id="int-fee-pct" inputMode="decimal" value={feePct} onChange={(e) => setFeePct(e.target.value)} placeholder="ex.: 3,99" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="int-fee-fixed">Taxa fixa (R$)</Label>
                <Input id="int-fee-fixed" inputMode="decimal" value={feeFixed} onChange={(e) => setFeeFixed(e.target.value)} placeholder="ex.: 0,39" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="int-product">Produto/serviço padrão</Label>
                <NativeSelect
                  id="int-product"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  placeholder="Nenhum"
                  options={companyProducts.map((p) => ({ value: p.id, label: `${p.name} (${p.analytical_token})` }))}
                />
              </div>
            </div>
            <p className="-mt-2 text-[11px] text-[#72787D]">
              A taxa padrão só é usada quando o provedor não informa a taxa no evento. Metadado <span className="font-mono">vertice_product</span>{' '}
              (token PRD_XX ou SKU) no pagamento vincula o produto automaticamente.
            </p>

            <Toggle id="int-record-fee" checked={recordFee} onChange={setRecordFee} label="Lançar a taxa do gateway como despesa separada" description="Recomendado: mantém a receita bruta e a margem de contribuição corretas." />

            {usesMapping && (
              <div className="space-y-3 rounded-[6px] border border-[#E2E8F0] p-3 dark:border-[#1E2F3F]">
                <p className="text-[12px] font-semibold">Mapeamento de campos (caminhos no JSON, ex.: data.amount)</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {MAPPING_FIELDS.map((f) => (
                    <div key={f.key} className="space-y-1">
                      <Label htmlFor={`map-${f.key}`}>{f.label}</Label>
                      <Input
                        id={`map-${f.key}`}
                        className="font-mono text-[12px]"
                        placeholder={provider === 'openfinance_generic' && f.key === 'amount_path' ? 'data.amount' : f.placeholder}
                        value={String(mapping[f.key] ?? '')}
                        onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
                <Toggle checked={amountInCents} onChange={setAmountInCents} label="Valores em centavos" />
                <p className="text-[11px] text-[#72787D]">Campos vazios usam o padrão mostrado. Assinatura: HMAC-SHA256 do corpo bruto (aceita prefixo sha256=).</p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving || !companyId || !accountId || signingSecret.length < 8}>
                {saving ? 'Salvando…' : 'Criar conexão'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <HistoryImportModal
        connection={historyConn}
        accounts={historyConn ? accounts.filter((a) => a.company_id === historyConn.company_id) : []}
        onClose={() => setHistoryConn(null)}
        onFinished={() => void Promise.all([load(), onRefresh()])}
      />

      {/* Dialog da chave de API de uma conexão existente */}
      <Dialog open={keyDialog !== null} onOpenChange={(open) => !open && setKeyDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Chave de API — {keyDialog?.label}</DialogTitle>
            <DialogDescription>
              Usada para consultar o {keyDialog ? PROVIDER_LABELS[keyDialog.provider] : 'provedor'} ao importar o histórico. O sistema apenas lê dados; a chave
              fica cifrada no servidor e não é exibida novamente.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleSaveKey(e)} className="mt-4 space-y-4">
            {keyError && <Notice tone="error">{keyError}</Notice>}
            <div className="space-y-1.5">
              <Label htmlFor="int-key-edit">{keyDialog?.api_key_configured ? 'Nova chave de API' : 'Chave de API'}</Label>
              <Input
                id="int-key-edit"
                type="password"
                autoComplete="off"
                required
                value={keyValue}
                onChange={(e) => setKeyValue(e.target.value)}
                placeholder={keyDialog?.provider === 'asaas' ? '$aact_...' : 'APP_USR-...'}
              />
              {keyDialog?.api_key_configured && <p className="text-[11px] text-[#72787D]">Já existe uma chave configurada; ao salvar, ela é substituída.</p>}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setKeyDialog(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={keySaving || keyValue.trim().length < 8}>
                {keySaving ? 'Salvando…' : 'Salvar chave'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
