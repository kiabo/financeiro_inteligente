import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';
import { cn } from '../../lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>): React.JSX.Element {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#0F172A]/40 backdrop-blur-[1px]" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[12px] border border-[#CBD5E1] bg-white p-6 shadow-[0_20px_25px_-5px_rgba(15,23,42,0.1),0_8px_10px_-6px_rgba(15,23,42,0.06)] focus:outline-none dark:border-[#2A3B4C] dark:bg-[#0D1A26] max-h-[90vh] overflow-y-auto',
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label="Fechar"
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-[4px] text-[#42484C] hover:bg-[#F1F5F9] hover:text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F374A]/20 dark:text-[#9DB0C2] dark:hover:bg-[#162838] dark:hover:text-[#EAF1FF] cursor-pointer"
        >
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('flex flex-col gap-1 pr-8 text-left', className)} {...props} />;
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>): React.JSX.Element {
  return (
    <DialogPrimitive.Title
      className={cn(
        'font-display text-[18px] font-semibold leading-6 tracking-[-0.01em] text-[#0F172A] dark:text-[#EAF1FF]',
        className
      )}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>): React.JSX.Element {
  return (
    <DialogPrimitive.Description
      className={cn('text-[14px] leading-5 text-[#42484C] dark:text-[#9DB0C2]', className)}
      {...props}
    />
  );
}
