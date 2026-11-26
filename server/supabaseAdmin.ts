import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente Supabase com SERVICE ROLE — uso EXCLUSIVO no servidor.
 * Ignora RLS: toda consulta feita com ele DEVE filtrar explicitamente por tenant_id.
 */

let adminClient: SupabaseClient | null = null;

function resolveSupabaseUrl(): string {
  return (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
}

function resolveServiceRoleKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
}

export function isServerSupabaseConfigured(): boolean {
  const url = resolveSupabaseUrl();
  return Boolean(url.startsWith('https://') && resolveServiceRoleKey());
}

export function getSupabaseAdmin(): SupabaseClient {
  if (!isServerSupabaseConfigured()) {
    throw new Error(
      'Supabase não configurado no servidor (defina VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY).'
    );
  }
  if (!adminClient) {
    adminClient = createClient(resolveSupabaseUrl(), resolveServiceRoleKey(), {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return adminClient;
}

/**
 * Modo sandbox do servidor: sem Supabase configurado e fora de produção.
 * Nesse modo os endpoints aceitam chamadas sem JWT (dados ficam no localStorage do navegador).
 */
export function isServerSandboxMode(): boolean {
  return !isServerSupabaseConfigured() && process.env.NODE_ENV !== 'production';
}
