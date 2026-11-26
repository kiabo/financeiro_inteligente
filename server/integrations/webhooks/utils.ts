import crypto from 'crypto';
import { timingSafeEqualStr } from '../../crypto/secretBox.ts';

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Converte data/epoch para YYYY-MM-DD no fuso de São Paulo (datas contábeis brasileiras). */
export function toISODateBR(value: unknown, fallback: Date = new Date()): string {
  let date: Date | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Epoch em segundos (Stripe) ou milissegundos
    date = new Date(value < 1e12 ? value * 1000 : value);
  } else if (typeof value === 'string' && value.trim()) {
    const s = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }
  const d = date ?? fallback;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return parts; // en-CA => YYYY-MM-DD
}

/** Lê caminho no estilo "data.object.amount" ou "items[0].value". */
export function getByPath(obj: unknown, path: string | undefined): unknown {
  if (!path) return undefined;
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean);
  let cur: unknown = obj;
  for (const seg of segments) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const cleaned = value.trim();
    // Aceita "1.234,56" (BR) e "1234.56"
    const normalized = /,\d{1,2}$/.test(cleaned)
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function toStringOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function hmacSha256(secret: string, data: string | Buffer, encoding: 'hex' | 'base64' = 'hex'): string {
  return crypto.createHmac('sha256', secret).update(data).digest(encoding);
}

/** Lê pares "chave=valor" separados por vírgula (cabeçalhos Stripe e Mercado Pago). */
export function parseSignatureHeader(header: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key || !value) continue;
    map.set(key, [...(map.get(key) ?? []), value]);
  }
  return map;
}

export function safeEqualHex(a: string, b: string): boolean {
  return timingSafeEqualStr(a.toLowerCase(), b.toLowerCase());
}
