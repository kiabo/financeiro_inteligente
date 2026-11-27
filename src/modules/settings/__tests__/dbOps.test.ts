import { assert, assertEqual, runCases, type TestCase, type TestCaseResult } from '../../../../scripts/testHarness.ts';
import { backupHourLabel, formatBytes, formatPct, usageBarClass, usageBarWidth } from '../dbOpsFormat.ts';

const cases: TestCase[] = [
  ['bytes legíveis: B, KB, MB, GB com vírgula decimal (CA4)', () => {
    assertEqual(formatBytes(0), '0 B', 'zero');
    assertEqual(formatBytes(512), '512 B', 'bytes');
    assertEqual(formatBytes(14784179), '14,1 MB', 'banco atual');
    assertEqual(formatBytes(500 * 1024 * 1024), '500,0 MB', 'limite do banco');
    assertEqual(formatBytes(1024 * 1024 * 1024), '1,0 GB', 'limite do Storage');
    assertEqual(formatBytes(-1), '—', 'inválido');
  }],
  ['porcentagem e barra: 70% muda de cor, 90% fica vermelho, a barra nunca passa de 100% (CA5)', () => {
    assertEqual(formatPct(2.9), '2,9%', 'decimal');
    assertEqual(formatPct(70), '70%', 'inteiro');
    assertEqual(usageBarClass('ok'), 'bg-[#0F7A5C]', 'ok');
    assert(usageBarClass('warn') !== usageBarClass('ok') && usageBarClass('critical') !== usageBarClass('warn'), 'cores distintas');
    assertEqual(usageBarWidth(150), '100%', 'limita a 100%');
    assertEqual(usageBarWidth(0), '0%', 'zero');
    assertEqual(usageBarWidth(0.1), '1.5%', 'uso pequeno ainda aparece');
    assertEqual(usageBarWidth(50), '50%', 'meio');
  }],
  ['hora do backup: 3 vira 03:00', () => {
    assertEqual(backupHourLabel(3), '03:00', 'padrão');
    assertEqual(backupHourLabel(15), '15:00', 'tarde');
  }],
];

export async function runDbOpsFormatTests(): Promise<TestCaseResult[]> {
  return runCases(cases);
}
