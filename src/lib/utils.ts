import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function normalizeCNPJ(value: string): string {
  return value.replace(/\D/g, '').slice(0, 14);
}

export function formatCNPJ(value: string): string {
  const digits = normalizeCNPJ(value);
  if (digits.length !== 14) return value;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
}

export function maskCNPJForDisplay(value: string): string {
  const digits = normalizeCNPJ(value);
  if (digits.length !== 14) return value;
  return `${digits.slice(0, 2)}.***.***/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
}

export function isValidCNPJ(cnpj: string): boolean {
  const digits = normalizeCNPJ(cnpj);
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const calcDigit = (base: string, weights: number[]): number => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
      sum += Number(base[i]) * (weights[i] ?? 0);
    }
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calcDigit(digits.slice(0, 12), w1);
  const d2 = calcDigit(digits.slice(0, 13), w2);

  return d1 === Number(digits[12]) && d2 === Number(digits[13]);
}

export function formatDateTimeBR(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

export function formatCurrencyBRL(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

/**
 * Converte o texto digitado em reais (pt-BR) em número: aceita "1.500,50", "-300", "R$ 1.234,56" e "1234.56".
 * Vazio vira 0; texto inválido devolve `null`.
 */
export function parseMoneyInput(text: string): number | null {
  const cleaned = text.replace(/R\$/gi, '').replace(/\s+/g, '');
  if (cleaned === '' || cleaned === '-') return cleaned === '' ? 0 : null;
  if (!/^-?[\d.,]+$/.test(cleaned)) return null;
  const negative = cleaned.startsWith('-');
  const body = negative ? cleaned.slice(1) : cleaned;
  let normalized: string;
  if (body.includes(',')) {
    // vírgula decimal: pontos são separadores de milhar
    if ((body.match(/,/g) ?? []).length > 1) return null;
    normalized = body.replace(/\./g, '').replace(',', '.');
  } else if ((body.match(/\./g) ?? []).length > 1) {
    normalized = body.replace(/\./g, ''); // 1.234.567
  } else {
    normalized = body; // "1234.56" ou "1500"
  }
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

export function formatDateBR(dateISO: string | null | undefined): string {
  if (!dateISO) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateISO);
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`;
  }
  const date = new Date(dateISO);
  if (Number.isNaN(date.getTime())) return dateISO;
  return new Intl.DateTimeFormat('pt-BR').format(date);
}

export function getTodayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getMonthKey(dateISO: string): string {
  return dateISO.slice(0, 7);
}

export function getMonthRangeISO(monthKey: string): { start: string; end: string } {
  const [yStr, mStr] = monthKey.split('-');
  const year = Number(yStr) || new Date().getFullYear();
  const month = Number(mStr) || new Date().getMonth() + 1;
  const lastDay = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function addMonthsISO(dateISO: string, monthsToAdd: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!match) return dateISO;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);

  const targetMonthTotal = monthIndex + monthsToAdd;
  const targetYear = year + Math.floor(targetMonthTotal / 12);
  const targetMonth = ((targetMonthTotal % 12) + 12) % 12;
  const maxDayInTarget = new Date(targetYear, targetMonth + 1, 0).getDate();
  const clampedDay = Math.min(day, maxDayInTarget);

  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

export function formatMonthLabelPT(monthKey: string): string {
  const [yStr, mStr] = monthKey.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  if (!year || !month) return monthKey;
  const date = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date);
}
