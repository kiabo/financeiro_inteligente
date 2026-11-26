import { Info } from 'lucide-react';
import React, { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import { cn } from '../../../lib/utils';
import { FINANCIAL_GLOSSARY, type GlossaryKey } from '../glossary';

export interface InfoTooltipProps {
  glossaryKey?: GlossaryKey;
  term?: string;
  category?: string;
  summary?: string;
  example?: string;
  align?: 'start' | 'center' | 'end';
  className?: string;
}

export const InfoTooltip: React.FC<InfoTooltipProps> = ({
  glossaryKey,
  term,
  category,
  summary,
  example,
  align = 'center',
  className,
}) => {
  const [open, setOpen] = useState(false);
  const entry = glossaryKey ? FINANCIAL_GLOSSARY[glossaryKey] : undefined;

  const displayTerm = term ?? entry?.term ?? 'Conceito Financeiro';
  const displayCategory = category ?? entry?.category ?? 'Glossário';
  const displaySummary = summary ?? entry?.summary ?? '';
  const displayExample = example ?? entry?.example;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Explicação sobre ${displayTerm}`}
          className={cn(
            'inline-flex h-6 w-6 items-center justify-center rounded-[4px] text-[#72787D] transition-colors hover:bg-[#F1F5F9] hover:text-[#0F374A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F374A]/20 dark:text-[#9DB0C2] dark:hover:bg-[#162838] dark:hover:text-[#EAF1FF] cursor-pointer relative before:absolute before:-inset-2 before:content-[""]',
            open && 'bg-[#EFF4FF] text-[#0F374A] dark:bg-[#162838] dark:text-[#A7CBE3]',
            className
          )}
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-80">
        <div className="space-y-2">
          <div className="space-y-0.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#0F374A] dark:text-[#A7CBE3]">
              {displayCategory}
            </p>
            <h4 className="font-display text-[14px] font-semibold leading-5 tracking-[-0.01em] text-[#0F172A] dark:text-[#EAF1FF]">
              {displayTerm}
            </h4>
          </div>
          <p className="text-[12px] leading-[18px] text-[#334155] dark:text-[#B9CADB]">
            {displaySummary}
          </p>
          {displayExample && (
            <div className="border-t border-[#E2E8F0] pt-2 text-[12px] leading-[18px] text-[#42484C] dark:border-[#1E2F3F] dark:text-[#9DB0C2]">
              <span className="font-medium text-[#0F172A] dark:text-[#EAF1FF]">Exemplo: </span>
              {displayExample}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
