/**
 * Módulo Futuro 5: Integrações Bancárias, Open Finance, OCR & MCP
 * Nenhum webhook ou conector externo ativo nesta etapa (Módulo 1).
 */
export interface IntegrationsContract {
  readonly moduleId: 'integrations';
  readonly status: 'reserved';
  readonly dependsOn: readonly ['core', 'vault'];
}
