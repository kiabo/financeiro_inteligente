import type { NextFunction, Request, Response } from 'express';
import { getSupabaseAdmin, isServerSandboxMode } from './supabaseAdmin.ts';

export interface AuthenticatedUser {
  id: string;
  email: string;
  aal: 'aal1' | 'aal2';
  sandbox: boolean;
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthenticatedUser;
}

interface CachedAuth {
  user: AuthenticatedUser;
  expiresAt: number;
}

// Cache curto para não validar o mesmo JWT a cada requisição (máx. 60s ou até expirar o token)
const authCache = new Map<string, CachedAuth>();
const AUTH_CACHE_MS = 60_000;

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8'
    );
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export class HttpError extends Error {
  public readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Valida o JWT do Supabase enviado em `Authorization: Bearer <access_token>`.
 * Regras:
 *  1. Token válido segundo o Supabase Auth (assinatura + expiração verificadas pelo servidor de Auth).
 *  2. Usuário com fator TOTP verificado precisa estar em AAL2 (mesma regra do RLS `is_authorized_tenant`).
 *  3. E-mail precisa constar como convite ativo em `invited_users`.
 * O tenant_id é SEMPRE derivado do usuário autenticado — nunca do corpo da requisição.
 */
export async function authenticateRequest(req: Request): Promise<AuthenticatedUser> {
  if (isServerSandboxMode()) {
    const sandboxId =
      typeof req.headers['x-sandbox-tenant'] === 'string' ? req.headers['x-sandbox-tenant'] : '';
    return {
      id: sandboxId || 'sandbox-tenant',
      email: 'sandbox@local',
      aal: 'aal2',
      sandbox: true,
    };
  }

  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.toLowerCase().startsWith('bearer ')) {
    throw new HttpError(401, 'Sessão ausente. Envie Authorization: Bearer <access_token>.');
  }
  const jwt = header.slice(7).trim();
  if (!jwt) throw new HttpError(401, 'Token de sessão vazio.');

  const cached = authCache.get(jwt);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) {
    throw new HttpError(401, 'Sessão inválida ou expirada. Faça login novamente.');
  }

  const payload = decodeJwtPayload(jwt);
  const aal = payload?.aal === 'aal2' ? 'aal2' : 'aal1';
  const hasVerifiedTotp = (data.user.factors ?? []).some(
    (f) => f.factor_type === 'totp' && f.status === 'verified'
  );
  if (hasVerifiedTotp && aal !== 'aal2') {
    throw new HttpError(403, 'Verificação MFA (AAL2) obrigatória para acessar este recurso.');
  }

  const email = (data.user.email ?? '').toLowerCase();
  const { data: invite, error: inviteErr } = await admin
    .from('invited_users')
    .select('id, is_active, expires_at')
    .eq('email', email)
    .maybeSingle();
  if (inviteErr) {
    throw new HttpError(500, 'Falha ao validar convite do usuário.');
  }
  const inviteRow = invite as { is_active: boolean; expires_at: string | null } | null;
  if (
    !inviteRow ||
    !inviteRow.is_active ||
    (inviteRow.expires_at && new Date(inviteRow.expires_at).getTime() < Date.now())
  ) {
    throw new HttpError(403, 'Acesso restrito: usuário sem convite ativo.');
  }

  const user: AuthenticatedUser = { id: data.user.id, email, aal, sandbox: false };
  const exp = typeof payload?.exp === 'number' ? payload.exp * 1000 : Date.now() + AUTH_CACHE_MS;
  authCache.set(jwt, { user, expiresAt: Math.min(exp, Date.now() + AUTH_CACHE_MS) });

  if (authCache.size > 500) {
    const now = Date.now();
    for (const [key, entry] of authCache) {
      if (entry.expiresAt <= now) authCache.delete(key);
    }
  }

  return user;
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  authenticateRequest(req)
    .then((user) => {
      (req as AuthenticatedRequest).authUser = user;
      next();
    })
    .catch((err: unknown) => {
      const status = err instanceof HttpError ? err.status : 401;
      const message = err instanceof Error ? err.message : 'Não autenticado.';
      res.status(status).json({ error: message });
    });
}

export function getAuthUser(req: Request): AuthenticatedUser {
  const user = (req as AuthenticatedRequest).authUser;
  if (!user) throw new HttpError(401, 'Não autenticado.');
  return user;
}
