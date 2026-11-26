import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as React from 'react';
import { cn } from '../../lib/utils';

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>): React.JSX.Element {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex items-center gap-1 rounded-[6px] border border-[#E2E8F0] bg-[#F1F5F9] p-1 dark:border-[#1E2F3F] dark:bg-[#0D1A26] overflow-x-auto max-w-full',
        className
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>): React.JSX.Element {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap shrink-0 rounded-[4px] px-3 py-1.5 text-[12px] font-medium tracking-[0.01em] text-[#42484C] transition-colors hover:text-[#0F172A] data-[state=active]:bg-white data-[state=active]:text-[#0F374A] data-[state=active]:shadow-[0_1px_2px_0_rgba(15,23,42,0.06)] dark:text-[#9DB0C2] dark:hover:text-[#EAF1FF] dark:data-[state=active]:bg-[#162838] dark:data-[state=active]:text-[#EAF1FF] cursor-pointer',
        className
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>): React.JSX.Element {
  return <TabsPrimitive.Content className={cn('mt-5 focus:outline-none', className)} {...props} />;
}
