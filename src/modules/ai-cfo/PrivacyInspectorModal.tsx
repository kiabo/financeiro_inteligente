import { Check, Copy, ShieldCheck, XCircle } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { StatusChip } from '../../components/ui/status-chip';
import type { VaultEntry } from '../core/types';
import { verifyZeroLeakage } from '../vault/anonymizer';

interface PrivacyInspectorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: unknown;
  vault: readonly VaultEntry[];
  sensitiveTerms?: readonly string[];
  title?: string;
  subtitle?: string;
}

export const PrivacyInspectorModal: React.FC<PrivacyInspectorModalProps> = ({
  open,
  onOpenChange,
  payload,
  vault,
  sensitiveTerms = [],
  title = 'Auditoria de Privacidade (Dados Enviados à IA)',
  subtitle = 'Este é o JSON exato que atravessou a Barreira Zero-Leak para o provedor de IA ou Servidor MCP. Nenhum nome real, CNPJ, conta bancária, produto, projeto ou cliente está presente.',
}) => {
  const [copied, setCopied] = useState(false);

  const inspection = useMemo(() => {
    const serialized = JSON.stringify(payload ?? {}, null, 2);
    const check = verifyZeroLeakage(payload ?? {}, vault, sensitiveTerms);
    const tokenMatches = serialized.match(/\b(?:GRP|EMP|CTA|PRD|SRV|PRJ|CRD)_\d{2,}\b/g);
    const tokensDetected = Array.from(new Set(tokenMatches ?? [])).sort();
    const byteSize = new TextEncoder().encode(serialized).length;
    return {
      serialized,
      clean: check.clean,
      leakedTerms: check.leakedTerms,
      tokensDetected,
      byteSize,
    };
  }, [payload, vault, sensitiveTerms]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(inspection.serialized);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#059669] dark:text-[#68DBA9]" />
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        <div className="mt-3 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] px-3.5 py-2.5 text-[12px] dark:border-[#1E2F3F] dark:bg-[#08131D]">
            <div className="flex flex-wrap items-center gap-2.5">
              {inspection.clean ? (
                <StatusChip variant="positive">Zero-Leak Aprovado · 0 vazamentos</StatusChip>
              ) : (
                <StatusChip variant="alert">
                  <XCircle className="h-3 w-3" />
                  <span>Exposição detectada: {inspection.leakedTerms.join(', ')}</span>
                </StatusChip>
              )}
              <span className="tabular-nums text-[#42484C] dark:text-[#9DB0C2]">
                Tokens ativos: <strong>{inspection.tokensDetected.length}</strong>
              </span>
              <span className="tabular-nums text-[#72787D]">
                {(inspection.byteSize / 1024).toFixed(1)} KB
              </span>
            </div>

            <Button variant="outline" size="sm" onClick={() => void handleCopy()}>
              {copied ? (
                <Check className="h-3.5 w-3.5 text-[#059669]" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{copied ? 'JSON Copiado' : 'Copiar JSON'}</span>
            </Button>
          </div>

          {inspection.tokensDetected.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="font-semibold uppercase tracking-[0.04em] text-[#72787D] mr-1">
                Tokens no payload:
              </span>
              {inspection.tokensDetected.map((tok) => (
                <StatusChip key={tok} variant="primary">
                  {tok}
                </StatusChip>
              ))}
            </div>
          )}

          <pre className="max-h-[420px] overflow-auto rounded-[6px] border border-[#1E293B] bg-[#002130] p-4 font-mono text-[11.5px] leading-relaxed text-[#85F8C4]">
            {inspection.serialized}
          </pre>

          <p className="text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
            A tradução dos tokens (<span className="font-mono">EMP_01</span>,{' '}
            <span className="font-mono">PRD_01</span>, <span className="font-mono">PRJ_01</span>)
            para os nomes reais acontece exclusivamente na sua sessão autenticada via{' '}
            <span className="font-mono">rehydrateFromAI()</span>.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
