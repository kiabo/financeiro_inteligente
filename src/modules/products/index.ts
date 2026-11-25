/**
 * Módulo Futuro 3: Precificação & Margem de Produtos / Serviços
 * Reservado para implementação modular posterior ao Módulo 1.
 */
export interface ProductMarginContract {
  readonly moduleId: 'products';
  readonly status: 'reserved';
  readonly dependsOn: readonly ['core', 'vault'];
}
