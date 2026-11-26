import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '../../lib/utils';

const statusChipVariants = cva(
  'inline-flex items-center gap-1 rounded-[4px] border px-2 py-0.5 text-[11px] font-semibold leading-[14px] tracking-[0.04em] whitespace-nowrap shrink-0 tabular-nums',
  {
    variants: {
      variant: {
        positive:
          'bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0] dark:bg-[#003C28]/70 dark:text-[#68DBA9] dark:border-[#005137]',
        alert:
          'bg-[#FEF2F2] text-[#991B1B] border-[#FECACA] dark:bg-[#3B1219]/80 dark:text-[#FCA5A5] dark:border-[#7F1D1D]',
        neutral:
          'bg-[#F1F5F9] text-[#334155] border-[#E2E8F0] dark:bg-[#162838] dark:text-[#BCC7DE] dark:border-[#2A3B4C]',
        primary:
          'bg-[#EFF4FF] text-[#0F374A] border-[#C2C7CC] dark:bg-[#0F374A]/60 dark:text-[#C4E7FF] dark:border-[#264B5F]',
      },
    },
    defaultVariants: {
      variant: 'neutral',
    },
  }
);

export interface StatusChipProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusChipVariants> {}

export const StatusChip: React.FC<StatusChipProps> = ({ className, variant, ...props }) => {
  return <span className={cn(statusChipVariants({ variant, className }))} {...props} />;
};
