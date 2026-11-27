import type { UsageLevel } from './dbOpsApi';

/** 14784179 → "14,1 MB". Usa base 1024, como o painel do Supabase. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const text = i === 0 ? String(Math.round(value)) : value.toFixed(1).replace('.', ',');
  return `${text} ${units[i]}`;
}

export const formatPct = (pct: number) => `${pct.toFixed(1).replace('.', ',')}%`.replace(',0%', '%');

/** Cor da barra por nível: verde até 70%, âmbar a partir de 70%, vermelho a partir de 90%. */
export const usageBarClass = (level: UsageLevel): string =>
  level === 'critical' ? 'bg-[#DC2626]' : level === 'warn' ? 'bg-[#D97706]' : 'bg-[#0F7A5C]';

/** A barra nunca passa de 100% nem some quando o uso é pequeno. */
export const usageBarWidth = (pct: number): string => `${Math.min(100, Math.max(pct > 0 ? 1.5 : 0, pct))}%`;

export const backupHourLabel = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;
