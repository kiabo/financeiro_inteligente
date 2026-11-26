import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const metaEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
const supabaseUrl = metaEnv?.VITE_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey =
  metaEnv?.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  metaEnv?.VITE_SUPABASE_ANON_KEY?.trim() ||
  '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl.startsWith('https://') &&
    !supabaseUrl.includes('MY_SUPABASE')
);

let clientInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (!clientInstance) {
    clientInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return clientInstance;
}
