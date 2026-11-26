/** Harness mínimo de testes (mesmo formato de resultado dos testes existentes do projeto). */
export interface TestCaseResult {
  name: string;
  passed: boolean;
  details: string;
}

export type TestCase = [name: string, fn: () => void | Promise<void>];

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} (esperado: ${String(expected)}, obtido: ${String(actual)})`);
  }
}

export function assertClose(actual: number, expected: number, message: string, tolerance = 0.005): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message} (esperado: ${expected}, obtido: ${actual})`);
  }
}

export async function assertRejects(fn: () => unknown | Promise<unknown>, pattern: RegExp, message: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (!pattern.test(text)) throw new Error(`${message}: erro inesperado "${text}"`);
    return;
  }
  throw new Error(`${message}: era esperado um erro`);
}

export async function runCases(cases: readonly TestCase[]): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  for (const [name, fn] of cases) {
    try {
      await fn();
      results.push({ name, passed: true, details: 'ok' });
    } catch (err) {
      results.push({ name, passed: false, details: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
