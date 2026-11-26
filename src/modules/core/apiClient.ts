import { getSupabaseClient, isSupabaseConfigured } from './supabase';

/**
 * fetch() autenticado para as rotas /api do servidor Vértice.
 * Anexa o access_token (JWT AAL2) da sessão Supabase em `Authorization: Bearer`.
 * O servidor deriva o tenant_id exclusivamente desse token.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);

  if (isSupabaseConfigured) {
    const supabase = getSupabaseClient();
    const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
    const accessToken = data.session?.access_token;
    if (!accessToken) {
      throw new Error('Sessão expirada. Faça login novamente.');
    }
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(path, { ...init, headers });
}

/** Helper JSON: lança Error com a mensagem do servidor quando a resposta não é 2xx. */
export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `Erro ${res.status} em ${path}`;
    throw new Error(message);
  }
  return data as T;
}
