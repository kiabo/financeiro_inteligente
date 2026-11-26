import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as React from 'react';
import { cn } from '../../lib/utils';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
  className,
  align = 'center',
  sideOffset = 8,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>): React.JSX.Element {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(
          'z-50 w-80 max-w-[calc(100vw-24px)] rounded-[8px] border border-[#CBD5E1] bg-white p-4 text-[#0F172A] shadow-[0_4px_6px_-1px_rgba(15,23,42,0.07),0_2px_4px_-2px_rgba(15,23,42,0.05)] outline-none dark:border-[#2A3B4C] dark:bg-[#0D1A26] dark:text-[#EAF1FF]',
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
