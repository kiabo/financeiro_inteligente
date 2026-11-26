import * as React from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'flex h-9 w-full rounded-[4px] border border-[#CBD5E1] bg-white px-3 py-1.5 text-[14px] text-[#0F172A] placeholder:text-[#72787D] focus:border-[#0F374A] focus:outline-none focus:ring-2 focus:ring-[#0F374A]/12 disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#2A3B4C] dark:bg-[#08131D] dark:text-[#EAF1FF] dark:placeholder:text-[#6B7E91] dark:focus:border-[#A7CBE3] dark:focus:ring-[#A7CBE3]/20',
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>): React.JSX.Element {
  return (
    <label
      className={cn(
        'text-[12px] font-medium leading-4 tracking-[0.02em] text-[#334155] dark:text-[#B9CADB]',
        className
      )}
      {...props}
    />
  );
}
