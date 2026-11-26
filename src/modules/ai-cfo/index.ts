export { AiCfoView } from './AiCfoView';
export { McpSettingsView } from './McpSettingsView';
export { PrivacyInspectorModal } from './PrivacyInspectorModal';
export * from './aiContextBuilder';
export * from './cfoAgent';

export interface AiCfoContract {
  readonly moduleId: 'ai-cfo';
  readonly status: 'active';
  readonly requiresSanitization: true;
  readonly dependsOn: readonly ['core', 'vault', 'projects', 'health'];
}
