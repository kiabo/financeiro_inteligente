/**
 * Teste-guarda (spec 001): a interface não pode citar fases de desenvolvimento ("Módulo 3", "Módulo 6"…).
 * Comentários de código são ignorados; qualquer outro texto de `src/` (literais, JSX) é verificado.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface GuardTestResult {
  name: string;
  passed: boolean;
  details: string;
}

const FORBIDDEN = /m[óo]dulo\s*\d/i;
const SRC_ROOT = join(process.cwd(), 'src');

/** Remove comentários `//` e `/* *\/` preservando o conteúdo de strings e templates. */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      out += ' ';
      continue;
    }
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    out += ch;
    i += 1;
  }
  return out;
}

function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      listSourceFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

export function findModuleLabelViolations(files: string[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
    lines.forEach((line, idx) => {
      if (FORBIDDEN.test(line)) {
        violations.push(`${relative(process.cwd(), file)}:${idx + 1} → ${line.trim().slice(0, 100)}`);
      }
    });
  }
  return violations;
}

export function runNoModuleLabelsTests(): GuardTestResult[] {
  const results: GuardTestResult[] = [];
  const record = (name: string, fn: () => void) => {
    try {
      fn();
      results.push({ name, passed: true, details: 'ok' });
    } catch (err) {
      results.push({ name, passed: false, details: err instanceof Error ? err.message : String(err) });
    }
  };

  record('stripComments ignora comentários mas mantém strings e URLs', () => {
    const src = [
      "const a = 'Módulo 3 · Projetos'; // Módulo 4",
      '/* Módulo 5 */ const b = "https://exemplo.com";',
      '{/* Módulo 6 */}',
    ].join('\n');
    const stripped = stripComments(src);
    if (!stripped.includes('Módulo 3')) throw new Error('perdeu o literal de string');
    if (stripped.includes('Módulo 4') || stripped.includes('Módulo 5') || stripped.includes('Módulo 6')) {
      throw new Error('não removeu comentários');
    }
    if (!stripped.includes('https://exemplo.com')) throw new Error('quebrou a URL dentro da string');
  });

  record('a interface não cita "Módulo N" (spec 001)', () => {
    const violations = findModuleLabelViolations(listSourceFiles(SRC_ROOT));
    if (violations.length > 0) {
      throw new Error(`${violations.length} ocorrência(s):\n        ${violations.join('\n        ')}`);
    }
  });

  return results;
}
