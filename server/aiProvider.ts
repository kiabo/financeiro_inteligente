import { GoogleGenAI, Type } from '@google/genai';

export type AiProviderKind = 'gemini' | 'openai';

export interface AiInsightDraft {
  category:
    | 'margin_drop'
    | 'budget_deviation'
    | 'cash_risk_45d'
    | 'capital_reallocation'
    | 'debt_optimization'
    | 'tax_alert'
    | 'project_viability';
  severity: 'critical' | 'warning' | 'opportunity' | 'info';
  title_tokenized: string;
  summary_tokenized: string;
  recommendation_tokenized: string;
  related_tokens: string[];
  estimated_financial_impact: number;
  impact_horizon_days: number;
  confidence_pct: number;
}

export interface AiAnalysisResponse {
  provider: AiProviderKind;
  model: string;
  insights: AiInsightDraft[];
}

export interface AiChatResponse {
  provider: AiProviderKind;
  model: string;
  answer_tokenized: string;
  referenced_tokens: string[];
  suggested_followup: string;
}

const FORBIDDEN_IDENTITY_KEYS = new Set([
  'legal_name',
  'trade_name',
  'cnpj',
  'institution_name',
  'counterparty_name',
  'creditor_name',
  'contract_code',
  'tax_name',
  'guide_reference',
]);

const RAW_CNPJ_PATTERN = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/;
const RAW_CPF_PATTERN = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/;
const RAW_EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

function scanForForbiddenKeys(value: unknown, hits: string[]): void {
  if (value === null || value === undefined || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) scanForForbiddenKeys(item, hits);
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_IDENTITY_KEYS.has(k.toLowerCase()) && v !== null && v !== undefined && v !== '') {
      hits.push(`campo:${k}`);
    }
    if (typeof v === 'object' && v !== null) {
      scanForForbiddenKeys(v, hits);
    }
  }
}

export function assertServerPayloadZeroLeak(payload: unknown): void {
  const hits: string[] = [];
  scanForForbiddenKeys(payload, hits);

  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload) ?? '';
  if (RAW_CNPJ_PATTERN.test(serialized)) hits.push('CNPJ');
  if (RAW_CPF_PATTERN.test(serialized)) hits.push('CPF');
  if (RAW_EMAIL_PATTERN.test(serialized)) hits.push('EMAIL');

  if (hits.length > 0) {
    throw new Error(
      `Bloqueio Zero-Leak no servidor: dados identificáveis detectados (${Array.from(new Set(hits)).join(', ')}).`
    );
  }
}

export function getAiProviderConfig(): {
  provider: AiProviderKind;
  model: string;
  configured: boolean;
} {
  const rawProvider = (process.env.AI_PROVIDER ?? 'gemini').trim().toLowerCase();
  const provider: AiProviderKind = rawProvider === 'openai' ? 'openai' : 'gemini';

  if (provider === 'openai') {
    const model = (process.env.OPENAI_MODEL || process.env.AI_MODEL || 'gpt-4o-mini').trim();
    const configured = Boolean(process.env.OPENAI_API_KEY?.trim());
    return { provider, model, configured };
  }

  const model = (process.env.AI_MODEL || 'gemini-4-hydrogen').trim();
  const configured = Boolean(process.env.GEMINI_API_KEY?.trim());
  return { provider, model, configured };
}

function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY não configurada no ambiente do servidor. Configure-a em Settings > Secrets para ativar o CFO Virtual.'
    );
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function callOpenAiCompatibleJson<T>(params: {
  systemInstruction: string;
  userPrompt: string;
  model: string;
}): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY não configurada no ambiente do servidor para o provedor compatível OpenAI-style.'
    );
  }

  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: params.systemInstruction },
        { role: 'user', content: params.userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Erro na API OpenAI-style (${response.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Resposta vazia recebida do provedor OpenAI-style.');
  }
  return JSON.parse(content) as T;
}

const CFO_ANALYSIS_SYSTEM_INSTRUCTION = `Você é o CFO Virtual da plataforma Vértice.
REGRAS INVIOLÁVEIS DE PRIVACIDADE E PRECISÃO MATEMÁTICA:
1. Todos os dados recebidos são 100% ANONIMIZADOS por tokens do Cofre (GRP_XX, EMP_XX, CTA_XX, PRD_XX, SRV_XX, PRJ_XX, CRD_XX).
2. NUNCA tente adivinhar nomes reais, cidades ou CNPJs. Cite EXCLUSIVAMENTE os tokens exatos presentes no JSON (ex.: "EMP_01", "PRD_02", "PRJ_01").
3. Baseie toda recomendação exclusivamente nos números fornecidos no JSON. Nunca invente valores ou percentuais.
4. Responda em português do Brasil, de forma objetiva, executiva e acionável.
5. Priorize recomendações concretas nas categorias:
   - margin_drop (Alerta de Queda de Margem em Produto/Serviço, analisando marginDeltaPP e unitContributionMarginPct)
   - budget_deviation (Desvio de Orçamento em Projeto, analisando realizedVsPlannedVariancePct e cashExposureAlert)
   - cash_risk_45d (Risco de Caixa nos Próximos 45 Dias, analisando cashRisk45d.projectedCash45d, debtService45d e taxOutflows45d)
   - capital_reallocation (Sugestão de Realocação de Capital entre produtos/projetos/empresas geradores vs drenos de caixa)
   - debt_optimization / tax_alert / project_viability quando relevante.
6. Para cada insight, estime o impacto financeiro realista em BRL (estimated_financial_impact: positivo para ganho/economia projetada, negativo para risco/perda) e o horizonte em dias.`;

export async function generateCfoStrategicInsights(
  anonymizedContext: unknown
): Promise<AiAnalysisResponse> {
  assertServerPayloadZeroLeak(anonymizedContext);
  const config = getAiProviderConfig();

  const userPrompt = `Analise o seguinte contexto financeiro 100% anonimizado e gere de 3 a 5 diagnósticos e recomendações estratégicas prioritárias em JSON:\n\n${JSON.stringify(
    anonymizedContext
  )}`;

  if (config.provider === 'openai') {
    const parsed = await callOpenAiCompatibleJson<{ insights?: AiInsightDraft[] }>({
      systemInstruction:
        CFO_ANALYSIS_SYSTEM_INSTRUCTION +
        '\nRetorne JSON no formato {"insights": [{category, severity, title_tokenized, summary_tokenized, recommendation_tokenized, related_tokens, estimated_financial_impact, impact_horizon_days, confidence_pct}]}.',
      userPrompt,
      model: config.model,
    });
    return {
      provider: 'openai',
      model: config.model,
      insights: Array.isArray(parsed.insights) ? parsed.insights : [],
    };
  }

  const ai = createGeminiClient();
  const response = await ai.models.generateContent({
    model: config.model,
    contents: userPrompt,
    config: {
      systemInstruction: CFO_ANALYSIS_SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          insights: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                category: {
                  type: Type.STRING,
                  enum: [
                    'margin_drop',
                    'budget_deviation',
                    'cash_risk_45d',
                    'capital_reallocation',
                    'debt_optimization',
                    'tax_alert',
                    'project_viability',
                  ],
                },
                severity: {
                  type: Type.STRING,
                  enum: ['critical', 'warning', 'opportunity', 'info'],
                },
                title_tokenized: { type: Type.STRING },
                summary_tokenized: { type: Type.STRING },
                recommendation_tokenized: { type: Type.STRING },
                related_tokens: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                estimated_financial_impact: { type: Type.NUMBER },
                impact_horizon_days: { type: Type.INTEGER },
                confidence_pct: { type: Type.NUMBER },
              },
              required: [
                'category',
                'severity',
                'title_tokenized',
                'summary_tokenized',
                'recommendation_tokenized',
                'related_tokens',
                'estimated_financial_impact',
                'impact_horizon_days',
                'confidence_pct',
              ],
            },
          },
        },
        required: ['insights'],
      },
    },
  });

  const text = (response.text ?? '{}').trim();
  const parsed = JSON.parse(text) as { insights?: AiInsightDraft[] };

  return {
    provider: 'gemini',
    model: config.model,
    insights: Array.isArray(parsed.insights) ? parsed.insights : [],
  };
}

const CFO_CHAT_SYSTEM_INSTRUCTION = `Você é o CFO Virtual analítico e privado do sistema Vértice.
Responda perguntas financeiras estratégicas em português do Brasil usando EXCLUSIVAMENTE os dados numéricos e os tokens analíticos (GRP_XX, EMP_XX, CTA_XX, PRD_XX, SRV_XX, PRJ_XX, CRD_XX) contidos no contexto anonimizado.
REGRAS:
- Sempre referencie as entidades pelos seus tokens exatos (ex.: EMP_01, PRD_02, PRJ_01) para que a camada local do cliente traduza para o usuário autenticado.
- Nunca invente números que não estejam no JSON. Se um dado não existir no contexto, informe claramente que não há lançamentos/registros no escopo.
- Formate valores em R$ no padrão brasileiro quando citar cifras.`;

export async function answerCfoChatQuestion(params: {
  question: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  anonymizedContext: unknown;
}): Promise<AiChatResponse> {
  assertServerPayloadZeroLeak({
    question: params.question,
    history: params.history,
    anonymizedContext: params.anonymizedContext,
  });

  const config = getAiProviderConfig();
  const historyBlock =
    params.history.length > 0
      ? `Histórico recente (anonimizado):\n${params.history
          .slice(-6)
          .map((h) => `${h.role === 'user' ? 'Usuário' : 'CFO'}: ${h.content}`)
          .join('\n')}\n\n`
      : '';

  const prompt = `${historyBlock}Contexto financeiro anonimizado:\n${JSON.stringify(
    params.anonymizedContext
  )}\n\nPergunta atual do usuário (anonimizada): ${params.question}`;

  if (config.provider === 'openai') {
    const parsed = await callOpenAiCompatibleJson<{
      answer_tokenized?: string;
      referenced_tokens?: string[];
      suggested_followup?: string;
    }>({
      systemInstruction:
        CFO_CHAT_SYSTEM_INSTRUCTION +
        '\nRetorne JSON no formato {"answer_tokenized": string, "referenced_tokens": string[], "suggested_followup": string}.',
      userPrompt: prompt,
      model: config.model,
    });

    return {
      provider: 'openai',
      model: config.model,
      answer_tokenized: parsed.answer_tokenized ?? 'Não foi possível gerar resposta.',
      referenced_tokens: Array.isArray(parsed.referenced_tokens) ? parsed.referenced_tokens : [],
      suggested_followup: parsed.suggested_followup ?? '',
    };
  }

  const ai = createGeminiClient();
  const response = await ai.models.generateContent({
    model: config.model,
    contents: prompt,
    config: {
      systemInstruction: CFO_CHAT_SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          answer_tokenized: { type: Type.STRING },
          referenced_tokens: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          suggested_followup: { type: Type.STRING },
        },
        required: ['answer_tokenized', 'referenced_tokens', 'suggested_followup'],
      },
    },
  });

  const text = (response.text ?? '{}').trim();
  const parsed = JSON.parse(text) as {
    answer_tokenized?: string;
    referenced_tokens?: string[];
    suggested_followup?: string;
  };

  return {
    provider: 'gemini',
    model: config.model,
    answer_tokenized: parsed.answer_tokenized ?? 'Não foi possível gerar resposta.',
    referenced_tokens: Array.isArray(parsed.referenced_tokens) ? parsed.referenced_tokens : [],
    suggested_followup: parsed.suggested_followup ?? '',
  };
}
