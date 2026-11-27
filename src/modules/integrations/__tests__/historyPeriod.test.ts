import { assert, assertEqual, runCases, type TestCase, type TestCaseResult } from '../../../../scripts/testHarness.ts';
import { addMonthsISO, buildMonthlyWindows, validateHistoryPeriod } from '../historyPeriod.ts';

const TODAY = '2026-11-27';

const cases: TestCase[] = [
  ['período: 12 meses exatos são aceitos (CA8)', () => {
    const r = validateHistoryPeriod({ start: '2025-01-01', end: '2025-12-31', today: TODAY });
    assert(r.ok, 'esperado ok');
  }],
  ['período: 12 meses + 1 dia é recusado com mensagem legível (CA8)', () => {
    const r = validateHistoryPeriod({ start: '2025-01-01', end: '2026-01-01', today: TODAY });
    assert(!r.ok, 'esperado recusa');
    if (!r.ok) assert(/12 meses/.test(r.message), `mensagem: ${r.message}`);
  }],
  ['período: 13 meses é recusado (CA8)', () => {
    const r = validateHistoryPeriod({ start: '2025-10-01', end: '2026-11-01', today: TODAY });
    assert(!r.ok, 'esperado recusa');
  }],
  ['período: ano bissexto — 29/02/2024 + 12 meses = 28/02/2025', () => {
    assertEqual(addMonthsISO('2024-02-29', 12), '2025-02-28', 'soma de meses');
    assert(validateHistoryPeriod({ start: '2024-02-29', end: '2025-02-27', today: TODAY }).ok, '27/02/2025 cabe');
    assert(!validateHistoryPeriod({ start: '2024-02-29', end: '2025-02-28', today: TODAY }).ok, '28/02/2025 já passa de 12 meses');
  }],
  ['período: addMonthsISO limita ao último dia do mês e aceita negativos', () => {
    assertEqual(addMonthsISO('2025-01-31', 1), '2025-02-28', '31/01 + 1');
    assertEqual(addMonthsISO('2026-11-27', -12), '2025-11-27', 'hoje - 12 meses');
    assertEqual(addMonthsISO('2026-01-15', -2), '2025-11-15', 'virada de ano');
  }],
  ['período: fim no futuro é recusado; fim igual a hoje é aceito', () => {
    assert(!validateHistoryPeriod({ start: '2026-11-01', end: '2026-11-28', today: TODAY }).ok, 'amanhã');
    assert(validateHistoryPeriod({ start: '2026-11-01', end: TODAY, today: TODAY }).ok, 'hoje');
  }],
  ['período: fim antes do início e datas inválidas são recusados', () => {
    assert(!validateHistoryPeriod({ start: '2026-03-10', end: '2026-03-09', today: TODAY }).ok, 'invertido');
    assert(!validateHistoryPeriod({ start: '', end: '2026-03-09', today: TODAY }).ok, 'vazio');
    assert(!validateHistoryPeriod({ start: '2026-02-30', end: '2026-03-09', today: TODAY }).ok, '30/02');
    assert(!validateHistoryPeriod({ start: '10/03/2026', end: '2026-03-09', today: TODAY }).ok, 'formato BR');
  }],
  ['período: um único dia é aceito', () => {
    assert(validateHistoryPeriod({ start: '2026-05-10', end: '2026-05-10', today: TODAY }).ok, 'um dia');
  }],
  ['período: Mercado Pago só alcança os últimos 12 meses a partir de hoje', () => {
    const tooOld = validateHistoryPeriod({ start: '2025-11-26', end: '2026-02-01', today: TODAY, provider: 'mercadopago' });
    assert(!tooOld.ok, 'início anterior a hoje - 12 meses');
    if (!tooOld.ok) assert(/Mercado Pago/.test(tooOld.message) && /27\/11\/2025/.test(tooOld.message), `mensagem: ${tooOld.message}`);
    assert(
      validateHistoryPeriod({ start: '2025-11-27', end: '2026-02-01', today: TODAY, provider: 'mercadopago' }).ok,
      'exatamente hoje - 12 meses é aceito'
    );
  }],
  ['período: a mesma data antiga é aceita no Asaas (sem a restrição do Mercado Pago)', () => {
    assert(validateHistoryPeriod({ start: '2024-01-01', end: '2024-06-30', today: TODAY, provider: 'asaas' }).ok, 'Asaas');
    assert(!validateHistoryPeriod({ start: '2024-01-01', end: '2024-06-30', today: TODAY, provider: 'mercadopago' }).ok, 'MP');
  }],
  ['janelas: cobrem o período em meses-calendário, contíguas e sem sobreposição', () => {
    const w = buildMonthlyWindows('2026-01-15', '2026-03-10');
    assertEqual(JSON.stringify(w), JSON.stringify([
      { start: '2026-01-15', end: '2026-01-31' },
      { start: '2026-02-01', end: '2026-02-28' },
      { start: '2026-03-01', end: '2026-03-10' },
    ]), 'janelas');
  }],
  ['janelas: 12 meses geram 12 janelas e nenhuma passa de 31 dias', () => {
    const w = buildMonthlyWindows('2025-01-01', '2025-12-31');
    assertEqual(w.length, 12, 'quantidade');
    assertEqual(w[0]!.start, '2025-01-01', 'primeira');
    assertEqual(w[11]!.end, '2025-12-31', 'última');
    for (let i = 1; i < w.length; i++) {
      const prevEnd = new Date(`${w[i - 1]!.end}T00:00:00Z`).getTime();
      const start = new Date(`${w[i]!.start}T00:00:00Z`).getTime();
      assertEqual(start - prevEnd, 24 * 3600 * 1000, `janela ${i} começa no dia seguinte`);
    }
  }],
  ['janelas: um dia e fevereiro bissexto', () => {
    assertEqual(JSON.stringify(buildMonthlyWindows('2026-05-10', '2026-05-10')), JSON.stringify([{ start: '2026-05-10', end: '2026-05-10' }]), 'um dia');
    assertEqual(buildMonthlyWindows('2024-02-01', '2024-02-29')[0]!.end, '2024-02-29', 'bissexto');
  }],
  ['janelas: intervalo inválido devolve lista vazia', () => {
    assertEqual(buildMonthlyWindows('2026-03-10', '2026-03-09').length, 0, 'invertido');
    assertEqual(buildMonthlyWindows('x', '2026-03-09').length, 0, 'inválido');
  }],
];

export async function runHistoryPeriodTests(): Promise<TestCaseResult[]> {
  return runCases(cases);
}
