import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-[4px] text-[14px] font-medium tracking-[0.01em] whitespace-nowrap shrink-0 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F374A]/20 focus-visible:border-[#0F374A] disabled:pointer-events-none disabled:opacity-50 dark:focus-visible:ring-[#A7CBE3]/25 cursor-pointer',
  {
    variants: {
      variant: {
        default:
          'bg-[#0F374A] text-white border border-transparent hover:bg-[#164E63] active:bg-[#0B2735] dark:bg-[#0F374A] dark:hover:bg-[#164E63]',
        primary:
          'bg-[#0F374A] text-white border border-transparent hover:bg-[#164E63] active:bg-[#0B2735] dark:bg-[#0F374A] dark:hover:bg-[#164E63]',
        outline:
          'bg-white border border-[#CBD5E1] text-[#0F172A] hover:bg-[#F8FAFC] dark:border-[#2A3B4C] dark:bg-[#0F1E2B] dark:text-[#EAF1FF] dark:hover:bg-[#162838]',
        ghost:
          'text-[#42484C] hover:bg-[#F1F5F9] hover:text-[#0F172A] dark:text-[#9DB0C2] dark:hover:bg-[#162838] dark:hover:text-[#EAF1FF]',
        destructive:
          'bg-white border border-[#FCA5A5] text-[#DC2626] hover:bg-[#FEF2F2] dark:bg-[#0F1E2B] dark:border-[#7F1D1D] dark:text-[#FCA5A5] dark:hover:bg-[#3B1219]',
      },
      size: {
        default: 'h-9 px-4 py-1.5',
        sm: 'h-8 px-3 text-[12px]',
        lg: 'h-10 px-5 text-[14px]',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
