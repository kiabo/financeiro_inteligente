import type { AppSection } from '../types';
import { DEFAULT_SECTION, SECTION_PATHS, SECTION_TITLES, pathFromSection, sectionFromPath } from '../routes';

export interface RoutesTestResult {
  name: string;
  passed: boolean;
  details: string;
}

export function runRoutesTests(): RoutesTestResult[] {
  const results: RoutesTestResult[] = [];
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
  const sections = Object.keys(SECTION_PATHS) as AppSection[];

  record('existem 15 seções, cada uma com caminho e título', () => {
    assert(sections.length === 15, `esperado 15 seções, obtido ${sections.length}`);
    for (const s of sections) assert(Boolean(SECTION_TITLES[s]), `sem título: ${s}`);
  });

  record('caminhos únicos, minúsculos, sem acento e começando por "/"', () => {
    const seen = new Set<string>();
    for (const s of sections) {
      const p = SECTION_PATHS[s];
      assert(/^\/[a-z0-9-]+$/.test(p), `caminho inválido para ${s}: ${p}`);
      assert(!seen.has(p), `caminho repetido: ${p}`);
      seen.add(p);
    }
  });

  record('ida e volta: sectionFromPath(pathFromSection(s)) === s', () => {
    for (const s of sections) assert(sectionFromPath(pathFromSection(s)) === s, `falhou em ${s}`);
  });

  record('tolera barra final e maiúsculas', () => {
    assert(sectionFromPath('/dre/') === 'dre', 'barra final');
    assert(sectionFromPath('/DRE') === 'dre', 'maiúsculas');
    assert(sectionFromPath('/Integracoes///') === 'integrations', 'várias barras');
  });

  record('"/" e caminhos desconhecidos devolvem null', () => {
    for (const p of ['/', '', '/qualquer-coisa', '/dre/extra', '/api/google/oauth/callback', '/integrations']) {
      assert(sectionFromPath(p) === null, `esperado null para "${p}"`);
    }
  });

  record('a seção padrão é a Visão Geral', () => {
    assert(DEFAULT_SECTION === 'overview' && pathFromSection(DEFAULT_SECTION) === '/visao-geral', 'padrão');
  });

  return results;
}
