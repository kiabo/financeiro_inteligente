import { HttpError } from '../authMiddleware.ts';
import { getSupabaseAdmin } from '../supabaseAdmin.ts';

/** Papéis que administram a instância (spec 005 e 006). `analyst` nunca. */
export const ADMIN_ROLES = ['owner', 'admin'] as const;

export function isAdminRole(role: unknown): boolean {
  return typeof role === 'string' && (ADMIN_ROLES as readonly string[]).includes(role);
}

export type RoleLoader = (userId: string) => Promise<string | null>;

const defaultRoleLoader: RoleLoader = async (userId) => {
  const { data, error } = await getSupabaseAdmin().from('user_profiles').select('role').eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { role?: string } | null)?.role ?? null;
};

/** Confere no servidor (nunca pelo que o navegador diz) que o usuário é `owner` ou `admin`; senão, 403. */
export async function requireAdminRole(userId: string, loader: RoleLoader = defaultRoleLoader): Promise<void> {
  const role = await loader(userId);
  if (!isAdminRole(role)) throw new HttpError(403, 'Apenas administradores podem fazer isto.');
}
