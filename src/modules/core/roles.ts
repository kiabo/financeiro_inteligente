import type { AppRole } from './types';

const KNOWN_ROLES: readonly AppRole[] = ['owner', 'admin', 'analyst'];

/** Qualquer valor desconhecido ou ausente vira o papel de menor privilégio. */
export function normalizeRole(value: unknown): AppRole {
  return typeof value === 'string' && (KNOWN_ROLES as readonly string[]).includes(value)
    ? (value as AppRole)
    : 'analyst';
}

/** Apenas owner e admin enxergam o SQL das migrations. */
export function canSeeSql(role: AppRole): boolean {
  return role === 'owner' || role === 'admin';
}

/** Painel "Banco e backups" e (spec 005) a marca do sistema: só `owner` e `admin`. A trava real está no servidor. */
export function canManageInstance(role: AppRole): boolean {
  return role === 'owner' || role === 'admin';
}
