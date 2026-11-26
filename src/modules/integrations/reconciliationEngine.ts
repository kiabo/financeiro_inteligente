import type { Transaction } from '../core/types';

/**
 * Motor de Conciliação Bancária Inteligente (funções puras, roda no navegador).
 * O extrato é lido e cruzado LOCALMENTE: o arquivo nunca é enviado ao servidor nem à IA.
 *
 *  - Parsers: OFX (SGML 1.x e XML 2.x), CSV (delimitador/colunas detectados) e texto de PDF
 *  - Matching 1:1 guloso por pontuação: valor (exato ou diferença explicada por taxa),
 *    data (±3 dias) e similaridade de descrição
 *  - Classificação: exact_match · partial_match · unmatched
 */

export type StatementFormat = 'ofx' | 'csv' | 'pdf';

export interface StatementLine {
  index: number;
  date: string; // YYYY-MM-DD
  amount: number; // positivo = crédito (entrada), negativo = débito (saída)
  description: string;
  fitId: string | null;
}

export interface ParsedStatement {
  format: StatementFormat;
  lines: StatementLine[];
  periodStart: string | null;
  periodEnd: string | null;
  warnings: string[];
}

export type MatchStatus = 'exact_match' | 'partial_match' | 'unmatched';

export interface LineMatchResult {
  lineIndex: number;
  status: MatchStatus;
  transactionId: string | null;
  score: number;
  dateDiffDays: number | null;
  amountDiff: number | null;
  reasons: string[];
}

export interface MatchOptions {
  dateToleranceDays?: number;
  /** Diferença máxima explicável por taxa (proporção do valor). Padrão 6% */
  feeTolerancePct?: number;
  /** Diferença máxima explicável por taxa em valor absoluto. Padrão R$ 15 */
  feeToleranceAbs?: number;
  /** IDs de lançamentos já conciliados em importações anteriores */
  alreadyReconciledIds?: ReadonlySet<string>;
}

// ----------------------------------------------------------------------------
// Utilidades
// ----------------------------------------------------------------------------
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function parseStatementAmount(raw: string): number | null {
  let s = raw.trim().replace(/R\$\s*/i, '').replace(/\s+/g, '');
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (/[dD]$/.test(s)) {
    sign = -1;
    s = s.slice(0, -1);
  } else if (/[cC]$/.test(s)) {
    s = s.slice(0, -1);
  }
  if (s.endsWith('-')) {
    sign = -sign;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    sign = -sign;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  let normalized: string;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^\d+,\d+$/.test(s)) {
    normalized = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    normalized = s.replace(/,/g, '');
  } else {
    normalized = s;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? round2(n * sign) : null;
}

export function parseStatementDate(raw: string, fallbackYear?: number): string | null {
  const s = raw.trim();
  let m = /^(\d{4})(\d{2})(\d{2})/.exec(s); // OFX: YYYYMMDD[HHMMSS[.xxx]][TZ]
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return validDate(y, Number(m[2]), Number(m[1]));
  }
  m = /^(\d{1,2})[/.-](\d{1,2})$/.exec(s);
  if (m && fallbackYear) return validDate(fallbackYear, Number(m[2]), Number(m[1]));
  return null;
}

function validDate(y: number, mo: number, d: number): string | null {
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function daysBetween(a: string, b: string): number {
  const da = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)));
  const db = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)));
  return Math.round(Math.abs(da - db) / 86_400_000);
}

function periodOf(lines: StatementLine[]): { periodStart: string | null; periodEnd: string | null } {
  if (lines.length === 0) return { periodStart: null, periodEnd: null };
  const dates = lines.map((l) => l.date).sort();
  return { periodStart: dates[0] ?? null, periodEnd: dates[dates.length - 1] ?? null };
}

/** Decodifica o arquivo respeitando o charset declarado (OFX de bancos BR costuma ser windows-1252). */
export function decodeStatementBytes(bytes: Uint8Array): string {
  const head = new TextDecoder('ascii').decode(bytes.subarray(0, 600));
  const declares1252 = /CHARSET\s*:\s*(1252|windows-1252|ISO-8859-1|8859-1)/i.test(head) || /encoding="(windows-1252|iso-8859-1)"/i.test(head);
  if (declares1252) return new TextDecoder('windows-1252').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

// ----------------------------------------------------------------------------
// OFX
// ----------------------------------------------------------------------------
function ofxTag(block: string, tag: string): string | null {
  // SGML (sem fechamento) e XML (<TAG>valor</TAG>)
  const re = new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, 'i');
  const m = re.exec(block);
  return m?.[1]?.trim() ? m[1].trim() : null;
}

export function parseOFX(text: string): ParsedStatement {
  const warnings: string[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0] ?? b);
  const lines: StatementLine[] = [];
  blocks.forEach((block, i) => {
    const date = parseStatementDate(ofxTag(block, 'DTPOSTED') ?? ofxTag(block, 'DTUSER') ?? '');
    const amountRaw = ofxTag(block, 'TRNAMT');
    // OFX usa ponto decimal; alguns bancos BR exportam vírgula — nunca há separador de milhar
    const ofxNumber = amountRaw ? Number(amountRaw.replace(/\s+/g, '').replace(',', '.')) : NaN;
    const amount = Number.isFinite(ofxNumber) ? round2(ofxNumber) : null;
    if (!date || amount === null || amount === 0) {
      warnings.push(`Transação OFX #${i + 1} ignorada (data ou valor inválido).`);
      return;
    }
    const memo = ofxTag(block, 'MEMO') ?? '';
    const name = ofxTag(block, 'NAME') ?? '';
    const description = [name, memo].filter(Boolean).join(' · ') || (ofxTag(block, 'TRNTYPE') ?? 'Lançamento');
    lines.push({ index: lines.length, date, amount, description: description.slice(0, 240), fitId: ofxTag(block, 'FITID') });
  });
  if (blocks.length === 0) warnings.push('Nenhuma transação <STMTTRN> encontrada no arquivo OFX.');
  return { format: 'ofx', lines, ...periodOf(lines), warnings };
}

// ----------------------------------------------------------------------------
// CSV
// ----------------------------------------------------------------------------
function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === delimiter && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

export function parseCSV(text: string): ParsedStatement {
  const warnings: string[] = [];
  const rawLines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (rawLines.length === 0) return { format: 'csv', lines: [], periodStart: null, periodEnd: null, warnings: ['Arquivo CSV vazio.'] };

  const sample = rawLines.slice(0, 10).join('\n');
  const delimiter = [';', '\t', ',', '|'].map((d) => ({ d, n: sample.split(d).length })).sort((a, b) => b.n - a.n)[0]?.d ?? ';';

  // Procura a linha de cabeçalho nas primeiras 15 linhas (bancos colocam metadados antes)
  let headerIdx = -1;
  let cols = { date: -1, desc: -1, amount: -1, debit: -1, credit: -1, id: -1, dc: -1 };
  for (let i = 0; i < Math.min(15, rawLines.length); i++) {
    const cells = splitCsvLine(rawLines[i] ?? '', delimiter).map(norm);
    const find = (...names: string[]) => cells.findIndex((c) => names.some((n) => c === n || c.startsWith(n)));
    const date = find('data', 'date', 'dt ', 'data lancamento', 'data do lancamento', 'data movimento');
    const amount = find('valor', 'amount', 'value', 'montante', 'quantia');
    const debit = find('debito', 'saida', 'debit');
    const credit = find('credito', 'entrada', 'credit');
    if (date >= 0 && (amount >= 0 || debit >= 0 || credit >= 0)) {
      headerIdx = i;
      cols = {
        date,
        desc: find('descricao', 'historico', 'lancamento', 'description', 'memo', 'detalhe', 'estabelecimento', 'titulo'),
        amount,
        debit,
        credit,
        id: find('id', 'documento', 'doc', 'identificador', 'fitid', 'n doc'),
        dc: cells.findIndex((c) => c === 'd/c' || c === 'tipo' || c === 'natureza'),
      };
      break;
    }
  }
  if (headerIdx < 0) {
    return { format: 'csv', lines: [], periodStart: null, periodEnd: null, warnings: ['Cabeçalho não reconhecido. O CSV precisa de colunas de Data e Valor (ou Débito/Crédito).'] };
  }

  const lines: StatementLine[] = [];
  for (let i = headerIdx + 1; i < rawLines.length; i++) {
    const cells = splitCsvLine(rawLines[i] ?? '', delimiter);
    const date = parseStatementDate(cells[cols.date] ?? '');
    if (!date) continue; // linhas de saldo/rodapé
    let amount: number | null = null;
    if (cols.amount >= 0) {
      amount = parseStatementAmount(cells[cols.amount] ?? '');
      const dc = cols.dc >= 0 ? norm(cells[cols.dc] ?? '') : '';
      if (amount !== null && (dc === 'd' || dc.startsWith('deb')) && amount > 0) amount = -amount;
    } else {
      const deb = parseStatementAmount(cells[cols.debit] ?? '') ?? 0;
      const cred = parseStatementAmount(cells[cols.credit] ?? '') ?? 0;
      amount = round2(Math.abs(cred) - Math.abs(deb));
    }
    if (amount === null || amount === 0) continue;
    const description = cols.desc >= 0 ? cells[cols.desc] ?? '' : '';
    if (/^saldo\b/i.test(description.trim())) continue;
    lines.push({
      index: lines.length,
      date,
      amount,
      description: (description || 'Lançamento').slice(0, 240),
      fitId: cols.id >= 0 && cells[cols.id] ? `csv:${cells[cols.id]}:${date}:${amount}` : null,
    });
  }
  if (lines.length === 0) warnings.push('Nenhuma linha com data e valor válidos foi encontrada.');
  return { format: 'csv', lines, ...periodOf(lines), warnings };
}

// ----------------------------------------------------------------------------
// PDF (texto já extraído no navegador via pdf.js)
// ----------------------------------------------------------------------------
const PDF_LINE_RE =
  /^(\d{2}[/.]\d{2}(?:[/.]\d{2,4})?)\s+(.+?)\s+(-?\(?R?\$?\s?-?\d{1,3}(?:\.\d{3})*,\d{2}\)?\s?[DdCc-]?)(?:\s+-?R?\$?\s?\d{1,3}(?:\.\d{3})*,\d{2}\s?[DdCc]?)?\s*$/;

export function parsePdfStatementText(text: string, referenceYear?: number): ParsedStatement {
  const warnings: string[] = [];
  const yearMatch = /\b(20\d{2})\b/.exec(text);
  const fallbackYear = referenceYear ?? (yearMatch ? Number(yearMatch[1]) : new Date().getFullYear());
  const lines: StatementLine[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    const m = PDF_LINE_RE.exec(line);
    if (!m) continue;
    const date = parseStatementDate(m[1] ?? '', fallbackYear);
    const amount = parseStatementAmount(m[3] ?? '');
    const description = (m[2] ?? '').trim();
    if (!date || amount === null || amount === 0) continue;
    if (/^(saldo|sdo|total)\b/i.test(description)) continue;
    lines.push({ index: lines.length, date, amount, description: description.slice(0, 240), fitId: null });
  }
  if (lines.length === 0) {
    warnings.push('Nenhuma movimentação reconhecida no PDF. Prefira OFX ou CSV exportados pelo banco.');
  } else {
    warnings.push('Extrato em PDF é lido por heurística: confira sinais (débito/crédito) e datas antes de confirmar.');
  }
  return { format: 'pdf', lines, ...periodOf(lines), warnings };
}

export function detectStatementFormat(fileName: string, text: string): StatementFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.ofx') || lower.endsWith('.qfx') || /<OFX>|OFXHEADER/i.test(text.slice(0, 2000))) return 'ofx';
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) return 'csv';
  if (lower.endsWith('.pdf')) return 'pdf';
  return null;
}

// ----------------------------------------------------------------------------
// Matching
// ----------------------------------------------------------------------------
const STOPWORDS = new Set(['pix', 'ted', 'doc', 'pagto', 'pagamento', 'compra', 'debito', 'credito', 'transf', 'transferencia', 'enviada', 'recebida', 'para', 'com', 'cartao', 'boleto', 'ltda', 'tarifa']);

function wordSet(text: string): Set<string> {
  return new Set(
    norm(text)
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
  );
}

export function descriptionSimilarity(a: string, b: string): number {
  const A = wordSet(a);
  const B = wordSet(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Valor com sinal que o lançamento produz NA CONTA conciliada. */
export function signedAmountForAccount(tx: Transaction, accountId: string): number | null {
  if (tx.status === 'canceled') return null;
  if (tx.transaction_type === 'income' && tx.account_id === accountId) return tx.amount;
  if (tx.transaction_type === 'expense' && tx.account_id === accountId) return -tx.amount;
  if (tx.transaction_type === 'transfer') {
    if (tx.account_id === accountId) return -tx.amount;
    if (tx.destination_account_id === accountId) return tx.amount;
  }
  return null;
}

function referenceDate(tx: Transaction): string {
  return tx.status === 'paid' && tx.payment_date ? tx.payment_date : tx.due_date;
}

interface Candidate {
  lineIndex: number;
  txId: string;
  status: MatchStatus;
  score: number;
  dateDiff: number;
  amountDiff: number;
  reasons: string[];
}

export function scoreCandidate(
  line: StatementLine,
  tx: Transaction,
  accountId: string,
  options: Required<Pick<MatchOptions, 'dateToleranceDays' | 'feeTolerancePct' | 'feeToleranceAbs'>>
): Candidate | null {
  const txSigned = signedAmountForAccount(tx, accountId);
  if (txSigned === null || Math.sign(txSigned) !== Math.sign(line.amount)) return null;

  const dateDiff = daysBetween(line.date, referenceDate(tx));
  if (dateDiff > 15) return null;

  const amountDiff = round2(Math.abs(line.amount) - Math.abs(txSigned)); // negativo = extrato menor que o previsto
  const absDiff = Math.abs(amountDiff);
  const exactAmount = absDiff < 0.01;
  const feeLimit = Math.max(options.feeToleranceAbs, Math.abs(txSigned) * options.feeTolerancePct);
  // Taxa explica a diferença quando o valor creditado é MENOR (entrada) ou o debitado é MAIOR (saída)
  const feeExplained = !exactAmount && absDiff <= feeLimit && ((line.amount > 0 && amountDiff < 0) || (line.amount < 0 && amountDiff > 0));
  const similarity = descriptionSimilarity(line.description, `${tx.description} ${tx.counterparty_name ?? ''}`);

  const reasons: string[] = [];
  let score = 0;
  if (exactAmount) {
    score += 60;
    reasons.push('valor idêntico');
  } else if (feeExplained) {
    score += 35;
    reasons.push(`diferença de R$ ${absDiff.toFixed(2).replace('.', ',')} compatível com taxa`);
  } else if (absDiff <= Math.abs(txSigned) * 0.2) {
    score += 15;
    reasons.push(`valor ${amountDiff > 0 ? 'maior' : 'menor'} em R$ ${absDiff.toFixed(2).replace('.', ',')}`);
  } else {
    return null;
  }

  if (dateDiff === 0) {
    score += 25;
    reasons.push('mesma data');
  } else if (dateDiff <= 1) {
    score += 20;
    reasons.push('data ±1 dia');
  } else if (dateDiff <= options.dateToleranceDays) {
    score += 12;
    reasons.push(`data ±${dateDiff} dias`);
  } else {
    reasons.push(`data distante (${dateDiff} dias)`);
  }

  if (similarity > 0) {
    score += Math.round(Math.min(1, similarity * 2) * 15);
    if (similarity >= 0.25) reasons.push('descrição semelhante');
  }

  let status: MatchStatus;
  if (exactAmount && dateDiff <= options.dateToleranceDays) status = 'exact_match';
  else if (
    (exactAmount && dateDiff <= 10) ||
    (feeExplained && dateDiff <= options.dateToleranceDays + 2) ||
    (similarity >= 0.34 && dateDiff <= options.dateToleranceDays + 2)
  )
    status = 'partial_match';
  else return null;

  return { lineIndex: line.index, txId: tx.id, status, score: Math.min(100, score), dateDiff, amountDiff, reasons };
}

export function matchStatementLines(
  lines: readonly StatementLine[],
  transactions: readonly Transaction[],
  accountId: string,
  options: MatchOptions = {}
): LineMatchResult[] {
  const opts = {
    dateToleranceDays: options.dateToleranceDays ?? 3,
    feeTolerancePct: options.feeTolerancePct ?? 0.06,
    feeToleranceAbs: options.feeToleranceAbs ?? 15,
  };
  const reconciled = options.alreadyReconciledIds ?? new Set<string>();
  const pool = transactions.filter(
    (t) => t.status !== 'canceled' && !reconciled.has(t.id) && signedAmountForAccount(t, accountId) !== null
  );

  const candidates: Candidate[] = [];
  for (const line of lines) {
    for (const tx of pool) {
      const c = scoreCandidate(line, tx, accountId, opts);
      if (c) candidates.push(c);
    }
  }

  // Atribuição 1:1 gulosa: exatos primeiro, depois maior pontuação, depois menor distância de data
  candidates.sort((a, b) => {
    const rank = (s: MatchStatus) => (s === 'exact_match' ? 0 : 1);
    return rank(a.status) - rank(b.status) || b.score - a.score || a.dateDiff - b.dateDiff;
  });

  const usedLines = new Map<number, Candidate>();
  const usedTx = new Set<string>();
  for (const c of candidates) {
    if (usedLines.has(c.lineIndex) || usedTx.has(c.txId)) continue;
    usedLines.set(c.lineIndex, c);
    usedTx.add(c.txId);
  }

  return lines.map((line) => {
    const c = usedLines.get(line.index);
    if (!c) {
      return { lineIndex: line.index, status: 'unmatched', transactionId: null, score: 0, dateDiffDays: null, amountDiff: null, reasons: ['nenhum lançamento compatível'] };
    }
    return { lineIndex: line.index, status: c.status, transactionId: c.txId, score: c.score, dateDiffDays: c.dateDiff, amountDiff: c.amountDiff, reasons: c.reasons };
  });
}

export function summarizeMatches(results: readonly LineMatchResult[]): { exact: number; partial: number; unmatched: number } {
  return {
    exact: results.filter((r) => r.status === 'exact_match').length,
    partial: results.filter((r) => r.status === 'partial_match').length,
    unmatched: results.filter((r) => r.status === 'unmatched').length,
  };
}
