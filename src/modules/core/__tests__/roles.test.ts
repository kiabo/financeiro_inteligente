import { canSeeSql, normalizeRole } from '../roles';

export interface RolesTestResult {
  name: string;
  passed: boolean;
  details: string;
}

export function runRolesTests(): RolesTestResult[] {
  const results: RolesTestResult[] = [];
  const record = (name: string, fn: () => void) => {
    try {
      fn();
      results.push({ name, passed: true, details: 'ok' });
    } catch (err) {
      results.push({ name, passed: false, details: err instanceof Error ? err.message : String(err) });
    }
  };
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
  };

  record('normalizeRole aceita os papéis conhecidos', () => {
    assert(normalizeRole('owner') === 'owner', 'owner');
    assert(normalizeRole('admin') === 'admin', 'admin');
    assert(normalizeRole('analyst') === 'analyst', 'analyst');
  });

  record('normalizeRole cai em analyst (menor privilégio) para valor desconhecido', () => {
    for (const v of [undefined, null, '', 'root', 'OWNER', 42, {}]) {
      assert(normalizeRole(v) === 'analyst', `esperado analyst para ${JSON.stringify(v)}`);
    }
  });

  record('canSeeSql: owner e admin sim, analyst não', () => {
    assert(canSeeSql('owner'), 'owner deve ver');
    assert(canSeeSql('admin'), 'admin deve ver');
    assert(!canSeeSql('analyst'), 'analyst não deve ver');
  });

  return results;
}
