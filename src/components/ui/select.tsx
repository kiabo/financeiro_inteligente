import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import * as React from 'react';
import { cn } from '../../lib/utils';

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>): React.JSX.Element {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'flex h-9 w-full items-center justify-between gap-2 rounded-[4px] border border-[#CBD5E1] bg-white px-3 py-1.5 text-[14px] text-[#0F172A] focus:border-[#0F374A] focus:outline-none focus:ring-2 focus:ring-[#0F374A]/12 disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#2A3B4C] dark:bg-[#08131D] dark:text-[#EAF1FF] cursor-pointer',
        className
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#72787D]" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>): React.JSX.Element {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position="popper"
        sideOffset={4}
        className={cn(
          'z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[8px] border border-[#CBD5E1] bg-white p-1 text-[#0F172A] shadow-[0_4px_6px_-1px_rgba(15,23,42,0.07),0_2px_4px_-2px_rgba(15,23,42,0.05)] dark:border-[#2A3B4C] dark:bg-[#0D1A26] dark:text-[#EAF1FF]',
          className
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-0.5">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>): React.JSX.Element {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex w-full cursor-pointer select-none items-center rounded-[4px] py-1.5 pl-8 pr-3 text-[13px] outline-none data-[highlighted]:bg-[#F1F5F9] data-[highlighted]:text-[#0F172A] dark:data-[highlighted]:bg-[#162838] dark:data-[highlighted]:text-[#EAF1FF]',
        className
      )}
      {...props}
    >
      <span className="absolute left-2.5 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-3.5 w-3.5 text-[#0F374A] dark:text-[#68DBA9]" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
