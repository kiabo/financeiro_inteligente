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
            'inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer relative before:absolute before:-inset-2 before:content-[""]',
            open && 'bg-slate-100 text-teal-700 dark:bg-slate-800 dark:text-teal-400',
            className
          )}
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-80">
        <div className="space-y-2">
          <div className="space-y-0.5">
            <p className="text-[11px] font-medium text-teal-700 dark:text-teal-400">
              {displayCategory}
            </p>
            <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              {displayTerm}
            </h4>
          </div>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            {displaySummary}
          </p>
          {displayExample && (
            <div className="border-t border-slate-100 pt-2 text-xs leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <span className="font-medium text-slate-700 dark:text-slate-200">Exemplo: </span>
              {displayExample}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
