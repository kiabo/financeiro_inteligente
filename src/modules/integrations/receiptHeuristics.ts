/**
 * Heurísticas puras para comprovantes/notas fiscais (compartilhadas entre navegador e servidor).
 * - extractReceiptFields: data, valor total e CNPJ do emissor a partir do texto OCR BRUTO (local)
 * - redactReceiptPII: remove CPF/CNPJ/e-mail/telefone/chaves de acesso/endereços/nomes de pessoa
 *   ANTES de qualquer envio à IA (complementa o sanitizeForAI do Cofre)
 * - classifyReceiptHeuristically: sugestão de categoria sem IA (fallback determinístico)
 */

export interface ExtractedReceiptFields {
  amount: number | null;
  amountCandidates: number[];
  date: string | null;
  issuerCnpj: string | null;
  paymentMethod: 'pix' | 'credit_card' | 'debit_card' | 'cash' | 'boleto' | null;
  documentKind: 'nfce' | 'nfe' | 'nfse' | 'receipt' | 'boleto' | 'unknown';
}

const MONEY_RE = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2})(?!\d)/g;
const TOTAL_LINE_RE =
  /(valor\s+total|total\s+a\s+pagar|valor\s+a\s+pagar|total\s+geral|valor\s+pago|total\s+r\$|^\s*total\b|valor\s+do\s+documento|valor\s+cobrado)/i;
const DATE_RE = /\b(\d{2})[/.-](\d{2})[/.-](\d{2,4})\b/g;
const ISO_DATE_RE = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
const CNPJ_RE = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;

export function parseBrazilianMoney(raw: string): number | null {
  const s = raw.replace(/R\$\s*/i, '').trim();
  let n: number;
  if (/^\d{1,3}(\.\d{3})*,\d{2}$/.test(s) || /^\d+,\d{2}$/.test(s)) {
    n = Number(s.replace(/\./g, '').replace(',', '.'));
  } else if (/^\d+\.\d{2}$/.test(s)) {
    n = Number(s);
  } else {
    return null;
  }
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function isPlausibleDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  if (y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function extractReceiptFields(text: string, todayISO?: string): ExtractedReceiptFields {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Valor: prioriza linhas de "TOTAL"; senão, o maior valor monetário do documento
  const totalCandidates: number[] = [];
  const allCandidates: number[] = [];
  for (const line of lines) {
    const values = [...line.matchAll(MONEY_RE)].map((m) => parseBrazilianMoney(m[1] ?? '')).filter((v): v is number => v !== null);
    allCandidates.push(...values);
    if (TOTAL_LINE_RE.test(line) && !/troco|desconto|tributos|impostos\s+aprox/i.test(line) && values.length > 0) {
      totalCandidates.push(values[values.length - 1] as number);
    }
  }
  const uniqueAll = Array.from(new Set(allCandidates)).sort((a, b) => b - a);
  const amount = totalCandidates.length > 0 ? Math.max(...totalCandidates) : uniqueAll[0] ?? null;

  // Data: primeira data plausível não futura (emissão costuma vir antes do vencimento)
  const limit = todayISO ?? '2100-12-31';
  const dates: string[] = [];
  for (const m of text.matchAll(DATE_RE)) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    if (isPlausibleDate(y, mo, d)) dates.push(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  for (const m of text.matchAll(ISO_DATE_RE)) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (isPlausibleDate(y, mo, d)) dates.push(`${m[1]}-${m[2]}-${m[3]}`);
  }
  const date = dates.find((d) => d <= limit) ?? dates[0] ?? null;

  const cnpjMatch = text.match(CNPJ_RE);
  const issuerCnpj = cnpjMatch?.[0] ? cnpjMatch[0].replace(/\D/g, '') : null;

  const lower = text.toLowerCase();
  const paymentMethod: ExtractedReceiptFields['paymentMethod'] = /\bpix\b/.test(lower)
    ? 'pix'
    : /cr[eé]dito/.test(lower)
      ? 'credit_card'
      : /d[eé]bito/.test(lower)
        ? 'debit_card'
        : /dinheiro|esp[eé]cie/.test(lower)
          ? 'cash'
          : /boleto|linha\s+digit[aá]vel/.test(lower)
            ? 'boleto'
            : null;

  const documentKind: ExtractedReceiptFields['documentKind'] = /nfc-?e|nota fiscal de consumidor/i.test(text)
    ? 'nfce'
    : /nfs-?e|nota fiscal de servi[cç]o/i.test(text)
      ? 'nfse'
      : /danfe|nf-?e\b/i.test(text)
        ? 'nfe'
        : /linha\s+digit[aá]vel|benefici[aá]rio/i.test(text)
          ? 'boleto'
          : /recibo|comprovante/i.test(text)
            ? 'receipt'
            : 'unknown';

  return {
    amount: amount ?? null,
    amountCandidates: uniqueAll.slice(0, 8),
    date,
    issuerCnpj: issuerCnpj && issuerCnpj.length === 14 ? issuerCnpj : null,
    paymentMethod,
    documentKind,
  };
}

/**
 * Remove identificadores pessoais e de terceiros do texto OCR.
 * Mantém termos genéricos úteis para classificar (ex.: "combustível", "hospedagem", "aluguel").
 */
export function redactReceiptPII(text: string): { text: string; redactions: number } {
  let redactions = 0;
  const count = () => {
    redactions += 1;
  };
  let out = text;

  const replace = (re: RegExp, token: string) => {
    out = out.replace(re, () => {
      count();
      return token;
    });
  };

  // Chaves de acesso NF-e/NFC-e (44 dígitos, com ou sem espaços) e linhas digitáveis de boleto
  replace(/\b(?:\d{4}\s?){11}\b/g, '[CHAVE_ACESSO]');
  replace(/\b\d{5}\.?\d{5}\s?\d{5}\.?\d{6}\s?\d{5}\.?\d{6}\s?\d\s?\d{14}\b/g, '[LINHA_DIGITAVEL]');
  replace(CNPJ_RE, '[CNPJ_REDIGIDO]');
  replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF_REDIGIDO]');
  replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL_REDIGIDO]');
  replace(/(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '[TELEFONE]');
  // Números de cartão (13–19 dígitos) e finais "**** 1234"
  replace(/\b(?:\d[ -]?){13,19}\b/g, '[NUMERO_REDIGIDO]');
  replace(/(?:\*{2,}|x{2,})\s?\d{4}\b/gi, '[FINAL_CARTAO]');
  replace(/\b(?:inscri[cç][aã]o\s+(?:estadual|municipal)|ie|im)\s*[:.]?\s*[\d./-]{5,}/gi, '[INSCRICAO]');

  // Linhas com dados de pessoa/endereço/razão social são substituídas inteiras
  const lines = out.split(/\r?\n/).map((line) => {
    if (/\b(cpf|consumidor|cliente|nome|destinat[aá]rio|tomador|sacado|pagador)\b/i.test(line) && !/total|valor/i.test(line)) {
      count();
      return '[DADOS_PESSOA_REDIGIDOS]';
    }
    if (/\b(rua|r\.|av\.|avenida|travessa|rodovia|estrada|alameda|pra[cç]a|cep|bairro|n[ºo°]\s*\d+)\b/i.test(line) && !/total|valor/i.test(line)) {
      count();
      return '[ENDERECO_REDIGIDO]';
    }
    if (/\b(ltda|eireli|s\/?a\b|s\.a\.|me\b|epp\b|mei\b|microempreendedor)\b/i.test(line)) {
      count();
      return '[RAZAO_SOCIAL_REDIGIDA]';
    }
    return line;
  });
  out = lines.join('\n');

  return { text: out, redactions };
}

export interface HeuristicCategorySuggestion {
  transactionType: 'expense' | 'income';
  categoryCode: string;
  confidence: number;
  rationale: string;
}

const KEYWORD_RULES: Array<{ re: RegExp; code: string; label: string }> = [
  { re: /\b(das|simples\s+nacional|darf|iss(qn)?|icms|pis|cofins|guia|gps|fgts|inss)\b/i, code: '2.1', label: 'tributo/guia' },
  { re: /\b(taxa\s+de\s+(cart[aã]o|maquininha|intermedia[cç][aã]o)|mdr|gateway|stone|cielo|getnet|pagseguro|sumup)\b/i, code: '2.2', label: 'taxa de meio de pagamento' },
  { re: /\b(mercadoria|insumo|mat[eé]ria[- ]prima|embalage|estoque|atacad)/i, code: '3.1', label: 'insumos/mercadorias' },
  { re: /\b(aws|azure|google\s+cloud|gcp|hospedagem|servidor|dom[ií]nio|cloud|vps)\b/i, code: '3.2', label: 'infraestrutura cloud' },
  { re: /\b(comiss[aã]o|freelan|terceiriz|subcontrat)/i, code: '3.3', label: 'terceirização/comissão' },
  { re: /\b(sal[aá]rio|folha|pr[oó]-?labore|f[eé]rias|13[ºo°]|vale[- ]transporte|vale[- ]refei)/i, code: '4.1', label: 'folha/pró-labore' },
  { re: /\b(aluguel|condom[ií]nio|iptu|energia|luz|enel|cemig|copel|light|[aá]gua|sabesp|saneamento|internet|telefone|vivo|claro|tim\b|oi\b)/i, code: '4.2', label: 'ocupação/utilidades' },
  { re: /\b(software|assinatura|licen[cç]a|saas|contabilidade|contador|escrit[oó]rio\s+cont)/i, code: '4.3', label: 'software/contabilidade' },
  { re: /\b(an[uú]ncio|google\s+ads|meta\s+ads|facebook\s+ads|instagram|m[ií]dia|publicidade|marketing|impulsionamento)/i, code: '5.1', label: 'marketing/mídia' },
  { re: /\b(combust[ií]vel|gasolina|etanol|diesel|posto|uber|99\s?(pop|taxi)?|t[aá]xi|frete|correios|transportadora|ped[aá]gio|estacionamento|passagem\s+a[eé]rea|hotel|a[eé]reo|latam)/i, code: '5.2', label: 'logística/viagens' },
  { re: /\b(notebook|computador|impressora|monitor|equipamento|m[aá]quina|ferramenta|m[oó]vel|cadeira|mesa)\b/i, code: '6.1', label: 'equipamentos (CAPEX)' },
  { re: /\b(juros|multa|iof|tarifa\s+banc[aá]ria|encargo)/i, code: '8.2', label: 'encargos financeiros' },
];

export function classifyReceiptHeuristically(sanitizedText: string): HeuristicCategorySuggestion {
  const isIncome = /\b(recebemos\s+de|recibo\s+de\s+pagamento\s+recebido|nota\s+fiscal\s+de\s+servi[cç]o\s+prestado|venda\s+realizada)\b/i.test(sanitizedText);
  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(sanitizedText)) {
      return {
        transactionType: 'expense',
        categoryCode: rule.code,
        confidence: 0.55,
        rationale: `Palavra-chave de ${rule.label} encontrada no comprovante.`,
      };
    }
  }
  if (isIncome) {
    return { transactionType: 'income', categoryCode: '1.2', confidence: 0.4, rationale: 'Comprovante indica recebimento.' };
  }
  return { transactionType: 'expense', categoryCode: '5.2', confidence: 0.2, rationale: 'Sem palavra-chave conhecida; revise a categoria.' };
}

const TOKEN_RE = /\b((?:PRD|SRV|PRJ|EMP|CTA)_\d{2,})\b/g;

/** Tokens do cofre que o sanitizador inseriu no texto (ex.: nome de produto → PRD_02). */
export function findVaultTokensInText(text: string): string[] {
  return Array.from(new Set([...text.matchAll(TOKEN_RE)].map((m) => m[1] as string)));
}
