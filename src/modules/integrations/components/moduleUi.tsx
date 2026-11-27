import React from 'react';
import { cn } from '../../../lib/utils';
import { InfoTooltip } from '../../core/components/InfoTooltip';
import type { GlossaryKey } from '../../core/glossary';

export const ModuleHeader: React.FC<{
  eyebrow: string;
  title: string;
  description: React.ReactNode;
  glossaryKey?: GlossaryKey;
  actions?: React.ReactNode;
}> = ({ eyebrow, title, description, glossaryKey, actions }) => (
  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
    <div className="space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">{eyebrow}</span>
      <div className="flex items-center gap-2">
        <h1 className="font-display text-[22px] font-semibold leading-8 tracking-[-0.02em] text-[#0F172A] sm:text-[24px] dark:text-[#EAF1FF]">
          {title}
        </h1>
        {glossaryKey && <InfoTooltip glossaryKey={glossaryKey} />}
      </div>
      <p className="max-w-3xl text-[14px] leading-5 text-[#42484C] dark:text-[#9DB0C2]">{description}</p>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

export const Notice: React.FC<{ tone: 'success' | 'error' | 'info' | 'warning'; children: React.ReactNode; className?: string }> = ({
  tone,
  children,
  className,
}) => (
  <div
    role={tone === 'error' ? 'alert' : 'status'}
    className={cn(
      'rounded-[6px] border px-4 py-2.5 text-[13px] leading-5',
      tone === 'success' && 'border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46] dark:border-[#005137] dark:bg-[#003C28]/60 dark:text-[#68DBA9]',
      tone === 'error' && 'border-[#FECACA] bg-[#FEF2F2] text-[#991B1B] dark:border-[#7F1D1D] dark:bg-[#3B1219] dark:text-[#FCA5A5]',
      tone === 'info' && 'border-[#C2C7CC] bg-[#EFF4FF] text-[#0F374A] dark:border-[#264B5F] dark:bg-[#0F374A]/40 dark:text-[#C4E7FF]',
      tone === 'warning' && 'border-[#FDE68A] bg-[#FFFBEB] text-[#92400E] dark:border-[#78350F] dark:bg-[#3A2A0A] dark:text-[#FCD34D]',
      className
    )}
  >
    {children}
  </div>
);

export const Toggle: React.FC<{
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  id?: string;
}> = ({ checked, onChange, label, description, disabled, id }) => (
  <label
    htmlFor={id}
    className={cn('flex items-start justify-between gap-4 py-2', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}
  >
    <span className="space-y-0.5">
      <span className="block text-[13px] font-medium text-[#0F172A] dark:text-[#EAF1FF]">{label}</span>
      {description && <span className="block text-[12px] leading-4 text-[#42484C] dark:text-[#9DB0C2]">{description}</span>}
    </span>
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F374A]/30',
        checked ? 'border-[#0F374A] bg-[#0F374A]' : 'border-[#CBD5E1] bg-[#E2E8F0] dark:border-[#2A3B4C] dark:bg-[#162838]'
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[17px]' : 'translate-x-[1px]'
        )}
      />
    </button>
  </label>
);

export const NativeSelect: React.FC<
  React.SelectHTMLAttributes<HTMLSelectElement> & { options: Array<{ value: string; label: string }>; placeholder?: string }
> = ({ options, placeholder, className, ...props }) => (
  <select
    {...props}
    className={cn(
      'flex h-9 w-full rounded-[4px] border border-[#CBD5E1] bg-white px-2.5 text-[14px] text-[#0F172A] focus:border-[#0F374A] focus:outline-none focus:ring-2 focus:ring-[#0F374A]/12 disabled:opacity-50 dark:border-[#2A3B4C] dark:bg-[#08131D] dark:text-[#EAF1FF]',
      className
    )}
  >
    {placeholder !== undefined && <option value="">{placeholder}</option>}
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);

export const StatPill: React.FC<{ label: string; value: React.ReactNode; tone?: 'neutral' | 'positive' | 'alert' | 'warning' }> = ({
  label,
  value,
  tone = 'neutral',
}) => (
  <div
    className={cn(
      'rounded-[6px] border px-3 py-2',
      tone === 'neutral' && 'border-[#E2E8F0] bg-white dark:border-[#1E2F3F] dark:bg-[#0D1A26]',
      tone === 'positive' && 'border-[#A7F3D0] bg-[#ECFDF5] dark:border-[#005137] dark:bg-[#003C28]/50',
      tone === 'alert' && 'border-[#FECACA] bg-[#FEF2F2] dark:border-[#7F1D1D] dark:bg-[#3B1219]/70',
      tone === 'warning' && 'border-[#FDE68A] bg-[#FFFBEB] dark:border-[#78350F] dark:bg-[#3A2A0A]'
    )}
  >
    <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">{label}</p>
    <p className="mt-0.5 text-[18px] font-semibold tabular-nums text-[#0F172A] dark:text-[#EAF1FF]">{value}</p>
  </div>
);

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

export function formatDateBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

export const SandboxGate: React.FC<{ children: React.ReactNode; isSandbox: boolean }> = ({ children, isSandbox }) =>
  isSandbox ? (
    <Notice tone="warning">
      Este recurso precisa do Supabase configurado (webhooks, conciliação persistente, comprovantes no Storage, alertas e
      backup rodam no servidor com RLS). Configure <span className="font-mono">VITE_SUPABASE_URL</span> e as chaves no{' '}
      <span className="font-mono">.env</span> para habilitar.
    </Notice>
  ) : (
    <>{children}</>
  );
