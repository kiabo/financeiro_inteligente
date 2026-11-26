import { callAiStructuredJson, getAiProviderConfig, GeminiSchemaType } from '../aiProvider.ts';
import { getSupabaseAdmin } from '../supabaseAdmin.ts';
import { verifyZeroLeakage } from '../../src/modules/vault/anonymizer.ts';
import type { Category, ProductService, Project, VaultEntry } from '../../src/modules/core/types.ts';
import {
  classifyReceiptHeuristically,
  findVaultTokensInText,
  redactReceiptPII,
} from '../../src/modules/integrations/receiptHeuristics.ts';

/**
 * Classificação de comprovante (OCR) com IA anonimizada.
 * Barreiras no servidor, ANTES de chamar a IA:
 *   1. Redação de PII (CPF/CNPJ/telefone/endereço/razão social) mesmo que o cliente já tenha feito
 *   2. verifyZeroLeakage contra o COFRE REAL do tenant (nomes de empresas, contas, produtos, projetos)
 *   3. assertServerPayloadZeroLeak (dentro de callAiStructuredJson)
 * A IA recebe apenas: texto sanitizado, valor/data, códigos/nomes genéricos do plano de contas
 * e tokens (PRD_XX/SRV_XX/PRJ_XX) — nunca nomes de produtos/projetos.
 */

export interface OcrClassificationInput {
  tenantId: string;
  companyId: string;
  sanitizedText: string;
  amount: number | null;
  date: string | null;
}

export interface OcrClassificationResult {
  source: 'ai' | 'heuristic';
  provider: string | null;
  transactionType: 'expense' | 'income';
  categoryId: string | null;
  categoryCode: string | null;
  productServiceId: string | null;
  offerToken: string | null;
  projectId: string | null;
  projectToken: string | null;
  confidence: number;
  rationale: string;
  /** O que exatamente saiu do servidor para a IA (Inspetor de Privacidade) */
  aiPayload: Record<string, unknown> | null;
}

const SYSTEM_INSTRUCTION = `Você classifica comprovantes fiscais brasileiros para lançamento financeiro.
REGRAS:
1. O texto está ANONIMIZADO: tokens como PRD_01, SRV_02, PRJ_03 representam produtos/serviços/projetos reais. Nunca tente adivinhar nomes.
2. Escolha category_code EXCLUSIVAMENTE da lista "categories" recebida (campo code).
3. offer_token e project_token só podem ser tokens presentes nas listas recebidas, ou null.
4. transaction_type: "expense" para compras/pagamentos feitos pela empresa; "income" apenas se o documento comprova um recebimento.
5. confidence entre 0 e 1. rationale curto (até 160 caracteres), em português, sem dados pessoais.`;

export async function classifyReceipt(input: OcrClassificationInput): Promise<OcrClassificationResult> {
  const admin = getSupabaseAdmin();
  const [catsRes, prodsRes, projsRes, vaultRes] = await Promise.all([
    admin.from('categories').select('*').eq('tenant_id', input.tenantId).eq('company_id', input.companyId).eq('is_active', true),
    admin.from('products_services').select('*').eq('tenant_id', input.tenantId).eq('is_active', true),
    admin.from('projects').select('*').eq('tenant_id', input.tenantId).eq('company_id', input.companyId).eq('is_active', true),
    admin.from('anonymization_vault').select('*').eq('tenant_id', input.tenantId),
  ]);
  for (const r of [catsRes, prodsRes, projsRes, vaultRes]) {
    if (r.error) throw new Error(r.error.message);
  }
  const categories = (catsRes.data ?? []) as Category[];
  const products = ((prodsRes.data ?? []) as ProductService[]).filter(
    (p) => p.company_id === input.companyId || p.company_id === null
  );
  const projects = ((projsRes.data ?? []) as Project[]).filter((p) => p.status !== 'canceled' && p.status !== 'completed');
  const vault = ((vaultRes.data ?? []) as VaultEntry[]).map((v) => ({
    ...v,
    secondary_aliases: Array.isArray(v.secondary_aliases) ? v.secondary_aliases : [],
  }));

  // Barreira 1: redação de PII no servidor (idempotente se o cliente já fez)
  const redacted = redactReceiptPII(input.sanitizedText.slice(0, 6000)).text;

  // Barreira 2: confere vazamento contra o cofre real do tenant
  const leak = verifyZeroLeakage(redacted, vault);
  if (!leak.clean) {
    throw new Error(
      `Bloqueio Zero-Leak no servidor: o texto ainda contém ${leak.leakedTerms.length} termo(s) do Cofre. Refaça a sanitização no app.`
    );
  }

  const leafCategories = categories.filter((c) => c.parent_id !== null);
  const tokensInText = findVaultTokensInText(redacted);
  const offerCandidates = products.map((p) => ({ token: p.analytical_token, kind: p.item_type, mentioned: tokensInText.includes(p.analytical_token) }));
  const projectCandidates = projects.map((p) => ({ token: p.analytical_token, status: p.status, mentioned: tokensInText.includes(p.analytical_token) }));

  const fromCode = (code: string | null) => (code ? leafCategories.find((c) => c.code === code) ?? null : null);
  const offerByToken = (t: string | null) => (t ? products.find((p) => p.analytical_token === t) ?? null : null);
  const projectByToken = (t: string | null) => (t ? projects.find((p) => p.analytical_token === t) ?? null : null);

  const heuristic = classifyReceiptHeuristically(redacted);
  const mentionedOffer = offerCandidates.find((o) => o.mentioned)?.token ?? null;
  const mentionedProject = projectCandidates.find((p) => p.mentioned)?.token ?? null;

  const heuristicResult = (): OcrClassificationResult => {
    const cat = fromCode(heuristic.categoryCode);
    const offer = offerByToken(mentionedOffer);
    const project = projectByToken(mentionedProject);
    return {
      source: 'heuristic',
      provider: null,
      transactionType: heuristic.transactionType,
      categoryId: cat?.id ?? null,
      categoryCode: cat?.code ?? null,
      productServiceId: offer?.id ?? null,
      offerToken: offer?.analytical_token ?? null,
      projectId: project?.id ?? null,
      projectToken: project?.analytical_token ?? null,
      confidence: heuristic.confidence,
      rationale: heuristic.rationale,
      aiPayload: null,
    };
  };

  if (!getAiProviderConfig().configured) return heuristicResult();

  const aiPayload = {
    receiptText: redacted,
    detected: { amount: input.amount, date: input.date, tokensInText },
    categories: leafCategories.map((c) => ({ code: c.code, name: c.name, direction: c.direction })),
    offers: offerCandidates,
    projects: projectCandidates,
  };

  // Nomes de categoria são editáveis pelo usuário: confere o payload inteiro contra o cofre
  const payloadLeak = verifyZeroLeakage(aiPayload, vault);
  if (!payloadLeak.clean) {
    return {
      ...heuristicResult(),
      rationale: 'Classificação local (o plano de contas contém nomes protegidos pelo Cofre; nada foi enviado à IA).',
    };
  }

  try {
    const { provider, data } = await callAiStructuredJson<{
      transaction_type?: string;
      category_code?: string | null;
      offer_token?: string | null;
      project_token?: string | null;
      confidence?: number;
      rationale?: string;
    }>({
      systemInstruction: SYSTEM_INSTRUCTION,
      userPromptPrefix: 'Classifique o comprovante anonimizado abaixo. Responda em JSON com transaction_type, category_code, offer_token, project_token, confidence e rationale.',
      userPayload: aiPayload,
      geminiSchema: {
        type: GeminiSchemaType.OBJECT,
        properties: {
          transaction_type: { type: GeminiSchemaType.STRING, enum: ['expense', 'income'] },
          category_code: { type: GeminiSchemaType.STRING, nullable: true },
          offer_token: { type: GeminiSchemaType.STRING, nullable: true },
          project_token: { type: GeminiSchemaType.STRING, nullable: true },
          confidence: { type: GeminiSchemaType.NUMBER },
          rationale: { type: GeminiSchemaType.STRING },
        },
        required: ['transaction_type', 'category_code', 'confidence', 'rationale'],
      },
    });

    // Validação estrita: a IA só pode devolver códigos e tokens que existem nas listas enviadas
    const cat = fromCode(typeof data.category_code === 'string' ? data.category_code : null) ?? fromCode(heuristic.categoryCode);
    const offer = offerByToken(typeof data.offer_token === 'string' ? data.offer_token.toUpperCase() : null) ?? offerByToken(mentionedOffer);
    const project = projectByToken(typeof data.project_token === 'string' ? data.project_token.toUpperCase() : null) ?? projectByToken(mentionedProject);
    const confidence = Math.min(1, Math.max(0, Number(data.confidence ?? 0.5)));

    return {
      source: 'ai',
      provider,
      transactionType: data.transaction_type === 'income' ? 'income' : 'expense',
      categoryId: cat?.id ?? null,
      categoryCode: cat?.code ?? null,
      productServiceId: offer?.id ?? null,
      offerToken: offer?.analytical_token ?? null,
      projectId: project?.id ?? null,
      projectToken: project?.analytical_token ?? null,
      confidence,
      rationale: String(data.rationale ?? '').slice(0, 200),
      aiPayload,
    };
  } catch (err) {
    const fallback = heuristicResult();
    return {
      ...fallback,
      rationale: `${fallback.rationale} (IA indisponível: ${err instanceof Error ? err.message.slice(0, 80) : 'erro'})`,
    };
  }
}
