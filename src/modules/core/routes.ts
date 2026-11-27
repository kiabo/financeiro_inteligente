import type { AppSection } from './types';

/**
 * Mapa seção ↔ caminho da URL (spec 002). `Record<AppSection, …>` faz o `tsc` falhar
 * se uma seção nova for criada sem caminho ou sem título.
 */
export const SECTION_PATHS: Record<AppSection, string> = {
  overview: '/visao-geral',
  health: '/saude-financeira',
  ai_cfo: '/cfo-virtual',
  dre: '/dre',
  transactions: '/lancamentos',
  debts_taxes: '/dividas-impostos',
  projects: '/projetos',
  catalog: '/produtos-servicos',
  reconciliation: '/conciliacao',
  hierarchy: '/empresas-contas',
  vault: '/cofre-privacidade',
  integrations: '/integracoes',
  automation: '/alertas-agenda-backup',
  mcp_settings: '/servidor-mcp',
  security: '/seguranca',
};

/** Nome da tela: usado no menu e no título da aba. */
export const SECTION_TITLES: Record<AppSection, string> = {
  overview: 'Visão Geral',
  health: 'Saúde Financeira',
  ai_cfo: 'CFO Virtual (IA)',
  dre: 'DRE Gerencial',
  transactions: 'Fluxo & Lançamentos',
  debts_taxes: 'Dívidas & Impostos',
  projects: 'Projetos & Viabilidade',
  catalog: 'Produtos & Serviços',
  reconciliation: 'Conciliação Bancária',
  hierarchy: 'Empresas & Contas',
  vault: 'Cofre de Privacidade',
  integrations: 'Integrações & Webhooks',
  automation: 'Alertas, Agenda & Backup',
  mcp_settings: 'Servidor MCP & Chaves',
  security: 'Segurança & SQL',
};

export const DEFAULT_SECTION: AppSection = 'overview';

export function pathFromSection(section: AppSection): string {
  return SECTION_PATHS[section];
}

/** Ignora barra final e caixa. Devolve `null` para `/` ou caminho desconhecido. */
export function sectionFromPath(pathname: string): AppSection | null {
  const normalized = pathname.trim().toLowerCase().replace(/\/+$/, '');
  if (!normalized) return null;
  const hit = (Object.entries(SECTION_PATHS) as Array<[AppSection, string]>).find(([, path]) => path === normalized);
  return hit ? hit[0] : null;
}
