/**
 * Módulo Futuro 4: AI CFO (Consome exclusivamente payloads sanitizados via anonymizer.ts)
 * Nenhuma chamada LLM ativa nesta etapa (Módulo 1).
 */
export interface AiCfoContract {
  readonly moduleId: 'ai-cfo';
  readonly status: 'reserved';
  readonly requiresSanitization: true;
  readonly dependsOn: readonly ['core', 'vault'];
}
