import { formatCNPJ, normalizeCNPJ } from '../../lib/utils';
import type { VaultEntry } from '../core/types';

export interface ReplacementRule {
  pattern: RegExp;
  replacement: string;
  rawTerm: string;
  token: string;
  priorityLength: number;
}

export interface SanitizationReport {
  redactionsCount: number;
  tokensApplied: string[];
  zeroLeakageVerified: boolean;
  leakedTerms: string[];
}

export interface SanitizationResult<T> {
  sanitized: T;
  report: SanitizationReport;
}

export interface RehydrateOptions {
  isAuthenticatedClient: boolean;
  includeFormattedCnpj?: boolean;
}

const GENERIC_CNPJ_PATTERN = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFlexibleCnpjRegex(digits: string): RegExp {
  const clean = normalizeCNPJ(digits);
  const pattern = `${clean.slice(0, 2)}[.\\s]?${clean.slice(2, 5)}[.\\s]?${clean.slice(5, 8)}[\\/\\s]?${clean.slice(8, 12)}[-\\s]?${clean.slice(12, 14)}`;
  return new RegExp(pattern, 'g');
}

function buildTextReplacementRegex(term: string): RegExp {
  const trimmed = term.trim();
  const escaped = escapeRegex(trimmed).replace(/\s+/g, '\\s+');
  // Use unicode-aware boundaries so accented letters and punctuation around names match reliably
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
}

export function buildReplacementRules(vaultEntries: readonly VaultEntry[]): ReplacementRule[] {
  const rules: ReplacementRule[] = [];

  for (const entry of vaultEntries) {
    if (!entry.analytical_token) continue;

    // 1. Sensitive identifier (CNPJ 14 digits or account last 4)
    if (entry.sensitive_identifier) {
      const digits = normalizeCNPJ(entry.sensitive_identifier);
      if (entry.entity_type === 'company' && digits.length === 14) {
        rules.push({
          pattern: buildFlexibleCnpjRegex(digits),
          replacement: `[CNPJ:${entry.analytical_token}]`,
          rawTerm: digits,
          token: entry.analytical_token,
          priorityLength: 1000 + digits.length,
        });
      } else if (entry.entity_type === 'account' && /^\d{4}$/.test(entry.sensitive_identifier.trim())) {
        const last4 = entry.sensitive_identifier.trim();
        rules.push({
          pattern: new RegExp(
            `(?:final\\s*|cart[aã]o\\s*|conta\\s*|\\*{2,4}\\s*)${escapeRegex(last4)}\\b`,
            'giu'
          ),
          replacement: `[FINAL:${entry.analytical_token}]`,
          rawTerm: last4,
          token: entry.analytical_token,
          priorityLength: 500 + last4.length,
        });
      }
    }

    // 2. Primary label + secondary aliases (longest-match-first)
    const candidateNames = [entry.real_label, ...entry.secondary_aliases]
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);

    const uniqueNames = Array.from(new Set(candidateNames));
    for (const name of uniqueNames) {
      rules.push({
        pattern: buildTextReplacementRegex(name),
        replacement: entry.analytical_token,
        rawTerm: name,
        token: entry.analytical_token,
        priorityLength: name.length,
      });
    }
  }

  return rules.sort((a, b) => b.priorityLength - a.priorityLength);
}

function sanitizeString(
  input: string,
  rules: readonly ReplacementRule[],
  appliedTokens: Set<string>,
  counter: { count: number }
): string {
  let output = input;

  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(output)) {
      rule.pattern.lastIndex = 0;
      output = output.replace(rule.pattern, () => {
        counter.count += 1;
        appliedTokens.add(rule.token);
        return rule.replacement;
      });
    }
  }

  // Defense-in-depth: redact any unmapped CNPJ-shaped sequence
  GENERIC_CNPJ_PATTERN.lastIndex = 0;
  output = output.replace(GENERIC_CNPJ_PATTERN, () => {
    counter.count += 1;
    return '[CNPJ_REDIGIDO]';
  });

  return output;
}

function sanitizeRecursive(
  value: unknown,
  rules: readonly ReplacementRule[],
  appliedTokens: Set<string>,
  counter: { count: number }
): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return sanitizeString(value, rules, appliedTokens, counter);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRecursive(item, rules, appliedTokens, counter));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const sanitizedKey = sanitizeString(key, rules, appliedTokens, counter);
      result[sanitizedKey] = sanitizeRecursive(val, rules, appliedTokens, counter);
    }
    return result;
  }

  return value;
}

export function verifyZeroLeakage(
  sanitizedPayload: unknown,
  vaultEntries: readonly VaultEntry[]
): { clean: boolean; leakedTerms: string[] } {
  const serialized =
    typeof sanitizedPayload === 'string'
      ? sanitizedPayload
      : JSON.stringify(sanitizedPayload) ?? '';
  const serializedLower = serialized.toLowerCase();
  const serializedDigitsOnly = serialized.replace(/\D/g, '');
  const leaked = new Set<string>();

  for (const entry of vaultEntries) {
    const termsToCheck = [entry.real_label, ...entry.secondary_aliases]
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);

    for (const term of termsToCheck) {
      if (serializedLower.includes(term.toLowerCase())) {
        // Confirm word-level match to avoid false positives inside unrelated words
        const regex = buildTextReplacementRegex(term);
        if (regex.test(serialized)) {
          leaked.add(term);
        }
      }
    }

    if (entry.entity_type === 'company' && entry.sensitive_identifier) {
      const cnpjDigits = normalizeCNPJ(entry.sensitive_identifier);
      if (cnpjDigits.length === 14 && serializedDigitsOnly.includes(cnpjDigits)) {
        leaked.add(formatCNPJ(cnpjDigits));
      }
    }
  }

  return {
    clean: leaked.size === 0,
    leakedTerms: Array.from(leaked),
  };
}

/**
 * Sanitiza recursivamente qualquer payload (string, objeto ou array) antes de envio
 * para módulos externos (IA CFO, OCR ou MCP), substituindo nomes reais, CNPJs e
 * identificadores sensíveis pelos Tokens Analíticos Imutáveis do Cofre.
 */
export function sanitizeForAI<T>(
  payload: T,
  vaultEntries: readonly VaultEntry[]
): SanitizationResult<T> {
  const rules = buildReplacementRules(vaultEntries);
  const appliedTokens = new Set<string>();
  const counter = { count: 0 };

  const sanitized = sanitizeRecursive(payload, rules, appliedTokens, counter) as T;
  const verification = verifyZeroLeakage(sanitized, vaultEntries);

  return {
    sanitized,
    report: {
      redactionsCount: counter.count,
      tokensApplied: Array.from(appliedTokens).sort(),
      zeroLeakageVerified: verification.clean,
      leakedTerms: verification.leakedTerms,
    },
  };
}

function rehydrateString(
  input: string,
  tokenMap: ReadonlyMap<string, VaultEntry>,
  includeFormattedCnpj: boolean
): string {
  let output = input;

  // Restore [CNPJ:EMP_01] first
  output = output.replace(/\[CNPJ:([A-Z]{3}_\d{2,})\]/g, (full, token: string) => {
    const entry = tokenMap.get(token);
    if (!entry?.sensitive_identifier) return full;
    return includeFormattedCnpj
      ? formatCNPJ(entry.sensitive_identifier)
      : entry.real_label;
  });

  // Restore [FINAL:CTA_01]
  output = output.replace(/\[FINAL:([A-Z]{3}_\d{2,})\]/g, (full, token: string) => {
    const entry = tokenMap.get(token);
    if (!entry?.sensitive_identifier) return full;
    return `final ${entry.sensitive_identifier}`;
  });

  // Restore standalone tokens (GRP_01, EMP_01, CTA_01)
  output = output.replace(/\b((?:GRP|EMP|CTA)_\d{2,})\b/g, (full, token: string) => {
    const entry = tokenMap.get(token);
    return entry ? entry.real_label : full;
  });

  return output;
}

function rehydrateRecursive(
  value: unknown,
  tokenMap: ReadonlyMap<string, VaultEntry>,
  includeFormattedCnpj: boolean
): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return rehydrateString(value, tokenMap, includeFormattedCnpj);
  }

  if (Array.isArray(value)) {
    return value.map((item) => rehydrateRecursive(item, tokenMap, includeFormattedCnpj));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const rehydratedKey = rehydrateString(key, tokenMap, includeFormattedCnpj);
      result[rehydratedKey] = rehydrateRecursive(val, tokenMap, includeFormattedCnpj);
    }
    return result;
  }

  return value;
}

/**
 * Função inversa executada EXCLUSIVAMENTE no ambiente autenticado do cliente
 * para re-hidratar tokens analíticos com os rótulos reais para exibição autorizada.
 */
export function rehydrateFromAI<T>(
  response: T,
  vaultEntries: readonly VaultEntry[],
  options: RehydrateOptions = { isAuthenticatedClient: true, includeFormattedCnpj: true }
): T {
  if (!options.isAuthenticatedClient) {
    throw new Error('Operação bloqueada: rehydrateFromAI só pode executar em sessão autenticada.');
  }

  const tokenMap = new Map<string, VaultEntry>();
  for (const entry of vaultEntries) {
    tokenMap.set(entry.analytical_token, entry);
  }

  return rehydrateRecursive(
    response,
    tokenMap,
    options.includeFormattedCnpj ?? true
  ) as T;
}
