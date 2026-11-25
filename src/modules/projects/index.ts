/**
 * Módulo Futuro 2: Viabilidade de Projetos (Capex, Payback, TIR, VPL)
 * Reservado para implementação modular posterior ao Módulo 1.
 */
export interface ProjectFeasibilityContract {
  readonly moduleId: 'projects';
  readonly status: 'reserved';
  readonly dependsOn: readonly ['core', 'vault'];
}
