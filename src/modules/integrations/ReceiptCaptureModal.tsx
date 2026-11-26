import { Camera, Eye, FileImage, PencilLine, ShieldCheck, Sparkles, Upload } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input, Label } from '../../components/ui/input';
import { StatusChip } from '../../components/ui/status-chip';
import { getTodayISO } from '../../lib/utils';
import { InfoTooltip } from '../core/components/InfoTooltip';
import { isSupabaseConfigured } from '../core/supabase';
import type { AuthSessionState, Category, Company, FinancialAccount, ProductService, Project, VaultEntry } from '../core/types';
import { NativeSelect, Notice, Toggle } from './components/moduleUi';
import {
  classifyReceiptText,
  confirmReceiptDraft,
  createReceiptDraft,
  discardReceiptDraft,
  fetchPendingReceiptDrafts,
  getReceiptSignedUrl,
  uploadReceiptFile,
} from './integrationsApi';
import { prepareReceiptForAI, runLocalOcr, type OcrProgress, type SanitizedReceipt } from './ocrReceiptParser';
import type { OcrClassification, ReceiptDraft } from './types';

interface ReceiptCaptureModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: AuthSessionState;
  companies: Company[];
  accounts: FinancialAccount[];
  categories: Category[];
  productsServices: ProductService[];
  projects: Project[];
  vault: VaultEntry[];
  defaultCompanyId: string | null;
  onCreated: () => Promise<void>;
  onOpenManual: () => void;
}

type Step = 'pick' | 'processing' | 'review' | 'done';

export const ReceiptCaptureModal: React.FC<ReceiptCaptureModalProps> = ({
  open,
  onOpenChange,
  session,
  companies,
  accounts,
  categories,
  productsServices,
  projects,
  vault,
  defaultCompanyId,
  onCreated,
  onOpenManual,
}) => {
  const [step, setStep] = useState<Step>('pick');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sanitized, setSanitized] = useState<SanitizedReceipt | null>(null);
  const [classification, setClassification] = useState<OcrClassification | null>(null);
  const [draft, setDraft] = useState<ReceiptDraft | null>(null);
  const [showInspector, setShowInspector] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingDrafts, setPendingDrafts] = useState<ReceiptDraft[]>([]);

  // Campos de revisão
  const [companyId, setCompanyId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [txType, setTxType] = useState<'expense' | 'income'>('expense');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(getTodayISO());
  const [paid, setPaid] = useState(true);
  const [categoryId, setCategoryId] = useState('');
  const [productId, setProductId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [installments, setInstallments] = useState('1');

  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep('pick');
    setFile(null);
    setPreviewUrl(null);
    setProgress(null);
    setError(null);
    setSanitized(null);
    setClassification(null);
    setDraft(null);
    setShowInspector(false);
    const comp = defaultCompanyId ?? companies[0]?.id ?? '';
    setCompanyId(comp);
    setAccountId(accounts.find((a) => a.company_id === comp)?.id ?? '');
    setTxType('expense');
    setDescription('');
    setAmount('');
    setDate(getTodayISO());
    setPaid(true);
    setCategoryId('');
    setProductId('');
    setProjectId('');
    setInstallments('1');
  };

  useEffect(() => {
    if (!open) return;
    reset();
    if (isSupabaseConfigured) {
      fetchPendingReceiptDrafts()
        .then(setPendingDrafts)
        .catch(() => setPendingDrafts([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fillReviewFields = (cls: OcrClassification, extracted: SanitizedReceipt['extracted'], comp: string) => {
    setTxType(cls.transactionType);
    setAmount(extracted.amount ? extracted.amount.toFixed(2).replace('.', ',') : '');
    setDate(extracted.date ?? getTodayISO());
    setPaid(extracted.paymentMethod !== 'boleto');
    setCategoryId(cls.categoryId ?? '');
    setProductId(cls.productServiceId ?? '');
    setProjectId(cls.projectId ?? '');
    const cat = categories.find((c) => c.id === cls.categoryId);
    setDescription(`Comprovante${cat ? ` · ${cat.name}` : ''}`);
    setCompanyId(comp);
    setAccountId(accounts.find((a) => a.company_id === comp)?.id ?? '');
  };

  /** Retoma um rascunho salvo anteriormente (fechado antes da confirmação). */
  const resumeDraft = async (d: ReceiptDraft) => {
    const ex = d.extracted as Record<string, unknown>;
    const extracted: SanitizedReceipt['extracted'] = {
      amount: typeof ex.amount === 'number' ? ex.amount : null,
      amountCandidates: Array.isArray(ex.amount_candidates) ? (ex.amount_candidates as number[]) : [],
      date: typeof ex.date === 'string' ? ex.date : null,
      issuerCnpj: null,
      paymentMethod: (ex.payment_method as SanitizedReceipt['extracted']['paymentMethod']) ?? null,
      documentKind: (ex.document_kind as SanitizedReceipt['extracted']['documentKind']) ?? 'unknown',
    };
    const cls = { ...(d.suggestion as unknown as OcrClassification), aiPayload: null };
    setDraft(d);
    setSanitized({ extracted, sanitizedText: d.ocr_text_sanitized, redactions: 0, zeroLeakVerified: true, leakedTerms: [] });
    setClassification(cls);
    fillReviewFields(cls, extracted, d.company_id ?? companyId);
    setFile(null);
    setPreviewUrl(d.storage_path && d.mime_type.startsWith('image/') ? await getReceiptSignedUrl(d.storage_path) : null);
    setStep('review');
  };

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const companyAccounts = useMemo(() => accounts.filter((a) => a.company_id === companyId), [accounts, companyId]);
  const leafCategories = useMemo(
    () =>
      categories.filter(
        (c) => c.company_id === companyId && c.parent_id !== null && c.is_active && (txType === 'income' ? c.direction !== 'outflow' : c.direction !== 'inflow')
      ),
    [categories, companyId, txType]
  );

  const sensitiveExtras = useMemo(
    () => [
      ...companies.flatMap((c) => [c.legal_name, c.trade_name ?? '']),
      ...accounts.flatMap((a) => [a.name, a.institution_name ?? '']),
    ].filter((t) => t.trim().length >= 3),
    [companies, accounts]
  );

  const processFile = async (picked: File) => {
    if (!isSupabaseConfigured) {
      setError('Lançamento por foto exige o Supabase configurado.');
      return;
    }
    if (picked.size > 10 * 1024 * 1024) {
      setError('Arquivo maior que 10 MB. Tire a foto com resolução menor ou recorte o comprovante.');
      return;
    }
    if (!companyId) {
      setError('Cadastre uma empresa antes de lançar comprovantes.');
      return;
    }
    setFile(picked);
    setError(null);
    setStep('processing');
    try {
      // 1. OCR local (nada sai do aparelho nesta etapa)
      const ocr = await runLocalOcr(picked, setProgress);
      if (ocr.rawText.trim().length < 5) throw new Error('Não consegui ler texto nesta imagem. Tente uma foto mais nítida, com boa luz e sem reflexo.');

      // 2. Extração local + sanitização em duas camadas
      const prepared = prepareReceiptForAI(ocr.rawText, vault, sensitiveExtras, getTodayISO());
      setSanitized(prepared);
      if (!prepared.zeroLeakVerified) {
        throw new Error(`Bloqueio Zero-Leak: o texto ainda contém ${prepared.leakedTerms.length} termo(s) protegido(s). Lance manualmente.`);
      }

      // 3. Classificação (servidor revalida contra o cofre antes da IA)
      setProgress({ stage: 'done', progress: 1, message: 'Pedindo sugestão de categoria (texto anonimizado)…' });
      const cls = await classifyReceiptText({
        company_id: companyId,
        sanitized_text: prepared.sanitizedText,
        amount: prepared.extracted.amount,
        date: prepared.extracted.date,
      });
      setClassification(cls);

      // 4. Comprovante no Storage privado + rascunho (nunca entra no saldo sem revisão)
      const storagePath = await uploadReceiptFile(session.userId, picked, picked.name);
      const created = await createReceiptDraft({
        tenant_id: session.userId,
        company_id: companyId,
        storage_path: storagePath,
        file_name: picked.name.slice(0, 120),
        mime_type: picked.type || 'image/jpeg',
        ocr_text_sanitized: prepared.sanitizedText,
        ocr_confidence: Math.round(ocr.confidence),
        extracted: {
          amount: prepared.extracted.amount,
          date: prepared.extracted.date,
          payment_method: prepared.extracted.paymentMethod,
          document_kind: prepared.extracted.documentKind,
          issuer_cnpj_present: Boolean(prepared.extracted.issuerCnpj),
          amount_candidates: prepared.extracted.amountCandidates,
        },
        suggestion: { ...cls, aiPayload: undefined },
      });
      setDraft(created);

      // Pré-preenche a revisão
      fillReviewFields(cls, prepared.extracted, companyId);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao processar o comprovante.');
      setStep('pick');
    }
  };

  const handleConfirm = async () => {
    if (!draft) return;
    const value = Number(amount.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      setError('Informe um valor válido.');
      return;
    }
    if (!accountId) {
      setError('Selecione a conta.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await confirmReceiptDraft({
        tenantId: session.userId,
        userEmail: session.email,
        draftId: draft.id,
        companyId,
        accountId,
        transactionType: txType,
        description: description.trim() || 'Comprovante',
        amount: value,
        date,
        paid,
        categoryId: categoryId || null,
        productServiceId: productId || null,
        projectId: projectId || null,
        installments: Math.min(60, Math.max(1, Number(installments) || 1)),
      });
      await onCreated();
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar o lançamento.');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = async () => {
    if (draft) await discardReceiptDraft(draft.id, draft.storage_path).catch(() => undefined);
    onOpenChange(false);
  };

  const pickInputs = (
    <>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void processFile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={uploadRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void processFile(f);
          e.target.value = '';
        }}
      />
    </>
  );

  return (
    // Fechar durante a revisão mantém o rascunho, que pode ser retomado na próxima abertura
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>Lançar por Foto</DialogTitle>
            <InfoTooltip glossaryKey="ocr_privacidade" />
          </div>
          <DialogDescription>O texto é lido no seu aparelho. Só uma versão anonimizada é usada para sugerir a categoria.</DialogDescription>
        </DialogHeader>
        {pickInputs}

        <div className="mt-4 space-y-4">
          {error && <Notice tone="error">{error}</Notice>}

          {step === 'pick' && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rc-company">Empresa</Label>
                  <NativeSelect
                    id="rc-company"
                    value={companyId}
                    onChange={(e) => {
                      setCompanyId(e.target.value);
                      setAccountId(accounts.find((a) => a.company_id === e.target.value)?.id ?? '');
                    }}
                    options={companies.map((c) => ({ value: c.id, label: c.trade_name || c.legal_name }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => cameraRef.current?.click()}
                  className="flex flex-col items-center gap-2 rounded-[8px] border-2 border-dashed border-[#CBD5E1] px-4 py-8 text-[13px] font-medium hover:border-[#0F374A] hover:bg-[#F8FAFC] dark:border-[#2A3B4C] dark:hover:bg-[#162838] cursor-pointer"
                >
                  <Camera className="h-7 w-7 text-[#0F374A] dark:text-[#A7CBE3]" />
                  Tirar foto
                  <span className="text-[11px] font-normal text-[#72787D]">câmera do celular</span>
                </button>
                <button
                  type="button"
                  onClick={() => uploadRef.current?.click()}
                  className="flex flex-col items-center gap-2 rounded-[8px] border-2 border-dashed border-[#CBD5E1] px-4 py-8 text-[13px] font-medium hover:border-[#0F374A] hover:bg-[#F8FAFC] dark:border-[#2A3B4C] dark:hover:bg-[#162838] cursor-pointer"
                >
                  <Upload className="h-7 w-7 text-[#0F374A] dark:text-[#A7CBE3]" />
                  Enviar imagem ou PDF
                  <span className="text-[11px] font-normal text-[#72787D]">nota, cupom, recibo</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    onOpenManual();
                  }}
                  className="flex flex-col items-center gap-2 rounded-[8px] border-2 border-dashed border-[#CBD5E1] px-4 py-8 text-[13px] font-medium hover:border-[#0F374A] hover:bg-[#F8FAFC] dark:border-[#2A3B4C] dark:hover:bg-[#162838] cursor-pointer"
                >
                  <PencilLine className="h-7 w-7 text-[#0F374A] dark:text-[#A7CBE3]" />
                  Lançar manualmente
                  <span className="text-[11px] font-normal text-[#72787D]">sem comprovante</span>
                </button>
              </div>
              <p className="text-[11px] text-[#72787D]">
                Na primeira leitura o app baixa o modelo de OCR em português (~10 MB). A imagem não é enviada para fazer o OCR.
              </p>
              {pendingDrafts.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[12px] font-semibold">Comprovantes aguardando revisão</p>
                  {pendingDrafts.slice(0, 5).map((d) => {
                    const ex = d.extracted as { amount?: number; date?: string };
                    return (
                      <div key={d.id} className="flex items-center justify-between gap-2 rounded-[6px] border border-[#E2E8F0] px-3 py-2 text-[12px] dark:border-[#1E2F3F]">
                        <span className="min-w-0 truncate">
                          {d.file_name} · {ex.date ?? '—'} · {typeof ex.amount === 'number' ? ex.amount.toFixed(2).replace('.', ',') : '—'}
                        </span>
                        <span className="flex shrink-0 gap-1">
                          <Button size="sm" variant="outline" onClick={() => void resumeDraft(d)}>
                            Retomar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              void discardReceiptDraft(d.id, d.storage_path).then(() => setPendingDrafts((list) => list.filter((x) => x.id !== d.id)))
                            }
                          >
                            Descartar
                          </Button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {step === 'processing' && (
            <div className="space-y-3 py-6 text-center">
              <Sparkles className="mx-auto h-7 w-7 animate-pulse text-[#0F374A] dark:text-[#A7CBE3]" />
              <p className="text-[14px] font-medium">{progress?.message ?? 'Processando…'}</p>
              <div className="mx-auto h-2 max-w-sm overflow-hidden rounded-full bg-[#E2E8F0] dark:bg-[#162838]">
                <div className="h-full bg-[#0F374A] transition-[width] duration-300 dark:bg-[#68DBA9]" style={{ width: `${Math.round((progress?.progress ?? 0.05) * 100)}%` }} />
              </div>
            </div>
          )}

          {step === 'review' && sanitized && classification && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_1fr]">
              {/* Miniatura do comprovante */}
              <div className="space-y-2">
                <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] dark:border-[#1E2F3F] dark:bg-[#08131D]">
                  {previewUrl ? (
                    <img src={previewUrl} alt="Comprovante enviado" className="h-full w-full object-contain" />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-[12px] text-[#72787D]">
                      <FileImage className="h-6 w-6" />
                      {file?.name}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <StatusChip variant="positive">
                    <ShieldCheck className="h-3 w-3" /> {sanitized.redactions} redações
                  </StatusChip>
                  <StatusChip variant={classification.source === 'ai' ? 'primary' : 'neutral'}>
                    {classification.source === 'ai' ? `IA · ${Math.round(classification.confidence * 100)}%` : 'Regra local'}
                  </StatusChip>
                </div>
                <p className="text-[11px] text-[#72787D]">{classification.rationale}</p>
                <Button size="sm" variant="outline" className="w-full" onClick={() => setShowInspector((v) => !v)}>
                  <Eye className="h-3.5 w-3.5" />
                  {showInspector ? 'Ocultar' : 'Ver'} o que foi enviado
                </Button>
              </div>

              {/* Campos */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Button variant={txType === 'expense' ? 'default' : 'outline'} onClick={() => setTxType('expense')}>
                    Despesa
                  </Button>
                  <Button variant={txType === 'income' ? 'default' : 'outline'} onClick={() => setTxType('income')}>
                    Receita
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="rc-desc">Descrição</Label>
                    <Input id="rc-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rc-amount">Valor (R$)</Label>
                    <Input id="rc-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                    {sanitized.extracted.amountCandidates.length > 1 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {sanitized.extracted.amountCandidates.slice(0, 4).map((v) => (
                          <button key={v} type="button" onClick={() => setAmount(v.toFixed(2).replace('.', ','))} className="rounded-[4px] border border-[#E2E8F0] px-1.5 py-0.5 text-[11px] tabular-nums hover:bg-[#F1F5F9] dark:border-[#2A3B4C] dark:hover:bg-[#162838] cursor-pointer">
                            {v.toFixed(2).replace('.', ',')}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rc-date">Data</Label>
                    <Input id="rc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rc-account">Conta</Label>
                    <NativeSelect id="rc-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="Selecione" options={companyAccounts.map((a) => ({ value: a.id, label: a.name }))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rc-cat">Categoria</Label>
                    <NativeSelect id="rc-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} placeholder="Sem categoria" options={leafCategories.map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rc-prod">Produto/serviço</Label>
                    <NativeSelect
                      id="rc-prod"
                      value={productId}
                      onChange={(e) => setProductId(e.target.value)}
                      placeholder="Nenhum"
                      options={productsServices.filter((p) => p.is_active && (p.company_id === companyId || p.company_id === null)).map((p) => ({ value: p.id, label: p.name }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rc-proj">Projeto</Label>
                    <NativeSelect
                      id="rc-proj"
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                      placeholder="Nenhum"
                      options={projects.filter((p) => p.company_id === companyId && p.status !== 'canceled').map((p) => ({ value: p.id, label: p.name }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rc-inst">Parcelas</Label>
                    <Input id="rc-inst" type="number" min={1} max={60} value={installments} onChange={(e) => setInstallments(e.target.value)} />
                  </div>
                </div>
                <Toggle checked={paid} onChange={setPaid} label="Já foi pago/recebido" description="Desligue para boletos e contas a vencer (entra como previsto)." />

                {showInspector && (
                  <div className="space-y-2 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] p-3 dark:border-[#1E2F3F] dark:bg-[#08131D]">
                    <p className="text-[12px] font-semibold">Inspetor de Privacidade · texto anonimizado</p>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[11px] leading-4">{sanitized.sanitizedText}</pre>
                    {classification.aiPayload ? (
                      <>
                        <p className="text-[12px] font-semibold">Payload exato enviado à IA</p>
                        <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[11px] leading-4">{JSON.stringify(classification.aiPayload, null, 2)}</pre>
                      </>
                    ) : (
                      <p className="text-[11px] text-[#72787D]">Nada foi enviado à IA: a sugestão veio de regras locais.</p>
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="ghost" onClick={() => void handleDiscard()}>
                    Descartar
                  </Button>
                  <Button disabled={saving} onClick={() => void handleConfirm()}>
                    {saving ? 'Lançando…' : 'Confirmar lançamento'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="space-y-3 py-6 text-center">
              <ShieldCheck className="mx-auto h-8 w-8 text-[#047857] dark:text-[#68DBA9]" />
              <p className="text-[14px] font-medium">Lançamento criado e comprovante arquivado com segurança.</p>
              <div className="flex justify-center gap-2">
                <Button variant="outline" onClick={() => reset()}>
                  Lançar outro
                </Button>
                <Button onClick={() => onOpenChange(false)}>Fechar</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
