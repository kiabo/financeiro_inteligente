/**
 * Executa todas as suítes de teste do projeto: `npm test`
 * (as suítes dos Módulos 1–5 mantêm seu formato original e também são exibidas na UI).
 */
import { runAccountBalancesTests } from '../src/modules/core/__tests__/accountBalances.test.ts';
import { runRoutesTests } from '../src/modules/core/__tests__/routes.test.ts';
import { runRolesTests } from '../src/modules/core/__tests__/roles.test.ts';
import { runNoModuleLabelsTests } from '../src/modules/core/__tests__/noModuleLabels.test.ts';
import { runAiContextBuilderTests } from '../src/modules/ai-cfo/__tests__/aiContextBuilder.test.ts';
import { runHealthEngineUnitTests } from '../src/modules/health/__tests__/healthEngine.test.ts';
import { runModule6ClientTests } from '../src/modules/integrations/__tests__/module6Client.test.ts';
import { runProjectCalculatorUnitTests } from '../src/modules/projects/__tests__/projectCalculator.test.ts';
import { runAnonymizerUnitTests } from '../src/modules/vault/__tests__/anonymizer.test.ts';
import { runHistoryPeriodTests } from '../src/modules/integrations/__tests__/historyPeriod.test.ts';
import { runHistoryTests } from '../server/__tests__/history.test.ts';
import { runHistoryUpsertTests } from '../server/__tests__/historyUpsert.test.ts';
import { runHistoryRunnerTests } from '../server/__tests__/historyRunner.test.ts';
import { runHistoryServiceTests } from '../server/__tests__/historyService.test.ts';
import { runModule6ServerTests } from '../server/__tests__/module6Server.test.ts';

interface Result {
  name: string;
  passed: boolean;
  details: string;
}

const suites: Array<[string, () => Result[] | Promise<Result[]>]> = [
  ['Cofre de Anonimização (M1/M2)', runAnonymizerUnitTests],
  ['Calculadora de Projetos (M3)', runProjectCalculatorUnitTests],
  ['Motor de Saúde Financeira (M4)', runHealthEngineUnitTests],
  ['Contexto Anonimizado da IA (M5)', runAiContextBuilderTests],
  ['Módulo 6 · Servidor (cripto, webhooks, alertas, backup)', runModule6ServerTests],
  ['Módulo 6 · Cliente (conciliação, OCR)', runModule6ClientTests],
  ['Interface sem referências a módulos (spec 001)', runNoModuleLabelsTests],
  ['Papéis e visibilidade do SQL (spec 001)', runRolesTests],
  ['Rotas por tela (spec 002)', runRoutesTests],
  ['Saldo inicial da conta (spec 003)', runAccountBalancesTests],
  ['Importação de histórico · período (spec 004)', runHistoryPeriodTests],
  ['Importação de histórico por API (spec 004)', runHistoryTests],
  ['Importação de histórico · idempotência (spec 004)', runHistoryUpsertTests],
  ['Importação de histórico · execução em lotes (spec 004)', runHistoryRunnerTests],
  ['Importação de histórico · serviço e chave de API (spec 004)', runHistoryServiceTests],
];

let failures = 0;
let total = 0;
for (const [title, run] of suites) {
  console.log(`\n▶ ${title}`);
  const results = await run();
  for (const r of results) {
    total += 1;
    if (!r.passed) failures += 1;
    console.log(`  ${r.passed ? '✔' : '✘'} ${r.name}${r.passed ? '' : `\n      → ${r.details}`}`);
  }
}

console.log(`\n${total - failures}/${total} testes passaram.`);
if (failures > 0) process.exit(1);
