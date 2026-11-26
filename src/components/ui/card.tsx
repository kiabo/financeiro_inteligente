import * as React from 'react';
import { cn } from '../../lib/utils';

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn(
        'rounded-[8px] border border-[#E2E8F0] bg-white text-[#0F172A] shadow-[0_1px_2px_0_rgba(15,23,42,0.04)] dark:border-[#1E2F3F] dark:bg-[#0D1A26] dark:text-[#EAF1FF]',
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('flex flex-col gap-1 p-4 sm:p-6', className)} {...props} />;
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>): React.JSX.Element {
  return (
    <h3
      className={cn(
        'font-display text-[16px] font-medium leading-6 tracking-[-0.01em] text-[#0F172A] dark:text-[#EAF1FF]',
        className
      )}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>): React.JSX.Element {
  return (
    <p className={cn('text-[14px] leading-5 text-[#42484C] dark:text-[#9DB0C2]', className)} {...props} />
  );
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('px-4 pb-4 sm:px-6 sm:pb-6', className)} {...props} />;
}
