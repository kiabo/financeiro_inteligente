/**
 * Regras do período da importação de histórico por API (spec 004).
 * Funções puras, sem dependência de servidor ou de navegador: o cliente valida antes de enviar
 * e o servidor decide com a mesma regra. Datas sempre `YYYY-MM-DD` (fuso de São Paulo, como o resto do app).
 */

export type HistoryProvider = 'asaas' | 'mercadopago';

/** Máximo de meses de histórico por execução. */
export const HISTORY_MAX_MONTHS = 12;

export interface HistoryWindow {
  /** Primeiro dia (inclusive), YYYY-MM-DD */
  start: string;
  /** Último dia (inclusive), YYYY-MM-DD */
  end: string;
}

export type PeriodValidation =
  | { ok: true; start: string; end: string }
  | { ok: false; message: string };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseISO(value: string): { y: number; m: number; d: number } | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const pad = (n: number, size = 2) => String(n).padStart(size, '0');
const toISO = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

/** Soma meses mantendo o dia; se o mês de destino for mais curto, usa o último dia dele (31/01 + 1 mês = 28/02). */
export function addMonthsISO(iso: string, months: number): string {
  const p = parseISO(iso);
  if (!p) throw new Error(`Data inválida: ${iso}`);
  const index = p.y * 12 + (p.m - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12 + 12) % 12 + 1;
  return toISO(y, m, Math.min(p.d, daysInMonth(y, m)));
}

export function addDaysISO(iso: string, days: number): string {
  const p = parseISO(iso);
  if (!p) throw new Error(`Data inválida: ${iso}`);
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

const formatBR = (iso: string) => iso.split('-').reverse().join('/');

/**
 * Valida o período pedido.
 * - datas válidas, `fim >= início`, `fim <= hoje`;
 * - no máximo 12 meses (`fim < início + 12 meses`; 12 meses exatos passam, +1 dia não);
 * - Mercado Pago: a busca só alcança os últimos 12 meses a partir de hoje, então o início não pode ser anterior a isso.
 */
export function validateHistoryPeriod(input: {
  start: string;
  end: string;
  today: string;
  provider?: HistoryProvider;
}): PeriodValidation {
  const { start, end, today, provider } = input;
  if (!parseISO(start) || !parseISO(end)) {
    return { ok: false, message: 'Informe as datas de início e fim do período.' };
  }
  if (end < start) {
    return { ok: false, message: 'A data final não pode ser anterior à data inicial.' };
  }
  if (end > today) {
    return { ok: false, message: 'A data final não pode estar no futuro.' };
  }
  if (end >= addMonthsISO(start, HISTORY_MAX_MONTHS)) {
    return { ok: false, message: `O período pode ter no máximo ${HISTORY_MAX_MONTHS} meses por importação.` };
  }
  if (provider === 'mercadopago') {
    const earliest = addMonthsISO(today, -HISTORY_MAX_MONTHS);
    if (start < earliest) {
      return {
        ok: false,
        message: `O Mercado Pago só permite consultar os últimos ${HISTORY_MAX_MONTHS} meses. Use uma data inicial a partir de ${formatBR(earliest)}.`,
      };
    }
  }
  return { ok: true, start, end };
}

/** Divide o período em janelas por mês-calendário, contíguas e sem sobreposição (cada consulta fica pequena). */
export function buildMonthlyWindows(start: string, end: string): HistoryWindow[] {
  const s = parseISO(start);
  const e = parseISO(end);
  if (!s || !e || end < start) return [];
  const windows: HistoryWindow[] = [];
  let cursor = start;
  while (cursor <= end) {
    const c = parseISO(cursor)!;
    const monthEnd = toISO(c.y, c.m, daysInMonth(c.y, c.m));
    const windowEnd = monthEnd < end ? monthEnd : end;
    windows.push({ start: cursor, end: windowEnd });
    cursor = addDaysISO(windowEnd, 1);
  }
  return windows;
}

/** Atalho "Últimos N meses": termina hoje e começa no dia seguinte a (hoje − N meses), para caber no limite de 12 meses. */
export function presetPeriod(months: number, today: string): { start: string; end: string } {
  return { start: addDaysISO(addMonthsISO(today, -months), 1), end: today };
}
