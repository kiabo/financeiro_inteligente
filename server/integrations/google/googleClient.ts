import crypto from 'crypto';
import { decryptSecret, encryptSecret, resolveCredentialsKey, timingSafeEqualStr } from '../../crypto/secretBox.ts';
import { getSupabaseAdmin } from '../../supabaseAdmin.ts';

/**
 * Integração Google (OAuth 2.0 + Drive + Calendar) via REST, sem SDK.
 * Escopos mínimos:
 *   - drive.file       → o app só enxerga os arquivos que ele mesmo criou (pasta de backups)
 *   - calendar.events  → cria/edita eventos de vencimentos e marcos
 *   - userinfo.email   → mostra qual conta Google está conectada
 * O refresh token fica cifrado (AES-256-GCM, AAD = tenant_id) em integration_connections.
 */

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
];

interface GoogleCredentials {
  refresh_token: string;
  email: string | null;
  scope: string;
  connected_at: string;
}

export interface GoogleConnectionInfo {
  connected: boolean;
  email: string | null;
  scopes: string[];
  connectedAt: string | null;
  configured: boolean;
}

const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export function resolveGoogleRedirectUri(fallbackBaseUrl: string): string {
  const explicit = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const base = (process.env.APP_URL?.trim() || fallbackBaseUrl).replace(/\/+$/, '');
  return `${base}/api/google/oauth/callback`;
}

// ----------------------------------------------------------------------------
// state assinado (HMAC) — evita CSRF e amarra o callback ao tenant que iniciou o fluxo
// ----------------------------------------------------------------------------
function stateKey(): Buffer {
  return crypto.createHmac('sha256', resolveCredentialsKey()).update('google-oauth-state-v1').digest();
}

export function createOAuthState(tenantId: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ t: tenantId, e: now + 10 * 60 * 1000, n: crypto.randomBytes(8).toString('hex') })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', stateKey()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyOAuthState(state: string, now = Date.now()): string {
  const [payload, sig] = state.split('.');
  if (!payload || !sig) throw new Error('state OAuth inválido.');
  const expected = crypto.createHmac('sha256', stateKey()).update(payload).digest('base64url');
  if (!timingSafeEqualStr(sig, expected)) throw new Error('state OAuth adulterado.');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { t: string; e: number };
  if (!data.t || typeof data.e !== 'number' || data.e < now) throw new Error('state OAuth expirado. Inicie a conexão novamente.');
  return data.t;
}

export function buildGoogleAuthUrl(tenantId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID?.trim() ?? '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: createOAuthState(tenantId),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function googleTokenRequest(body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID?.trim() ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? '',
      ...body,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const desc = typeof json.error_description === 'string' ? json.error_description : String(json.error ?? res.status);
    throw new Error(`Google OAuth: ${desc}`);
  }
  return json;
}

async function findGoogleConnectionRow(tenantId: string): Promise<{ id: string; credentials_encrypted: string | null } | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('integration_connections')
    .select('id, credentials_encrypted')
    .eq('tenant_id', tenantId)
    .eq('provider', 'google')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; credentials_encrypted: string | null } | null;
}

export async function completeGoogleOAuth(params: { code: string; state: string; redirectUri: string }): Promise<string> {
  const tenantId = verifyOAuthState(params.state);
  const tokens = await googleTokenRequest({
    code: params.code,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
  });
  const refreshToken = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : '';
  const accessToken = typeof tokens.access_token === 'string' ? tokens.access_token : '';
  if (!refreshToken) {
    throw new Error('Google não devolveu refresh token. Remova o acesso do app em myaccount.google.com/permissions e conecte novamente.');
  }

  let email: string | null = null;
  try {
    const info = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (info.ok) {
      const j = (await info.json()) as { email?: string };
      email = j.email ?? null;
    }
  } catch {
    email = null;
  }

  const creds: GoogleCredentials = {
    refresh_token: refreshToken,
    email,
    scope: typeof tokens.scope === 'string' ? tokens.scope : GOOGLE_SCOPES.join(' '),
    connected_at: new Date().toISOString(),
  };
  const sealed = encryptSecret(JSON.stringify(creds), tenantId);
  const admin = getSupabaseAdmin();
  const existing = await findGoogleConnectionRow(tenantId);
  if (existing) {
    const { error } = await admin
      .from('integration_connections')
      .update({ credentials_encrypted: sealed, status: 'active', last_error: null, config: { email } })
      .eq('id', existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin.from('integration_connections').insert({
      tenant_id: tenantId,
      provider: 'google',
      label: 'Google (Drive + Calendar)',
      credentials_encrypted: sealed,
      config: { email },
      status: 'active',
    });
    if (error) throw new Error(error.message);
  }
  accessTokenCache.delete(tenantId);
  await admin.from('audit_logs').insert({
    tenant_id: tenantId,
    actor_id: tenantId,
    action: 'integration.connected',
    entity_type: 'integration_connection',
    metadata: { provider: 'google', scopes: creds.scope.split(' ').length },
  });
  return tenantId;
}

async function readGoogleCredentials(tenantId: string): Promise<GoogleCredentials | null> {
  const row = await findGoogleConnectionRow(tenantId);
  if (!row?.credentials_encrypted) return null;
  return JSON.parse(decryptSecret(row.credentials_encrypted, tenantId)) as GoogleCredentials;
}

export async function getGoogleConnectionInfo(tenantId: string): Promise<GoogleConnectionInfo> {
  const configured = isGoogleOAuthConfigured();
  try {
    const creds = await readGoogleCredentials(tenantId);
    if (!creds) return { connected: false, email: null, scopes: [], connectedAt: null, configured };
    return { connected: true, email: creds.email, scopes: creds.scope.split(' '), connectedAt: creds.connected_at, configured };
  } catch {
    return { connected: false, email: null, scopes: [], connectedAt: null, configured };
  }
}

export async function getGoogleAccessToken(tenantId: string): Promise<string> {
  const cached = accessTokenCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const creds = await readGoogleCredentials(tenantId);
  if (!creds) throw new Error('Conta Google não conectada.');
  try {
    const tokens = await googleTokenRequest({ refresh_token: creds.refresh_token, grant_type: 'refresh_token' });
    const token = String(tokens.access_token ?? '');
    const expiresIn = Number(tokens.expires_in ?? 3000);
    accessTokenCache.set(tenantId, { token, expiresAt: Date.now() + expiresIn * 1000 });
    return token;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'falha ao renovar token';
    await getSupabaseAdmin()
      .from('integration_connections')
      .update({ status: 'error', last_error: message.slice(0, 500) })
      .eq('tenant_id', tenantId)
      .eq('provider', 'google');
    throw err;
  }
}

export async function disconnectGoogle(tenantId: string): Promise<void> {
  try {
    const creds = await readGoogleCredentials(tenantId);
    if (creds) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(creds.refresh_token)}`, {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
    }
  } finally {
    accessTokenCache.delete(tenantId);
    await getSupabaseAdmin().from('integration_connections').delete().eq('tenant_id', tenantId).eq('provider', 'google');
  }
}

async function googleApi<T>(
  tenantId: string,
  url: string,
  init: RequestInit = {},
  expectJson = true
): Promise<T> {
  const token = await getGoogleAccessToken(tenantId);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(60_000) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      message = j.error?.message ?? message;
    } catch {
      /* mantém texto */
    }
    const err = new Error(`Google API ${res.status}: ${message}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  if (!expectJson || res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ----------------------------------------------------------------------------
// Google Drive
// ----------------------------------------------------------------------------
export interface DriveFile {
  id: string;
  name: string;
  size?: string;
  createdTime?: string;
  md5Checksum?: string;
}

export async function ensureDriveFolder(tenantId: string, knownFolderId: string | null, folderName: string): Promise<string> {
  if (knownFolderId) {
    try {
      const f = await googleApi<{ id: string; trashed?: boolean }>(
        tenantId,
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(knownFolderId)}?fields=id,trashed`
      );
      if (f.id && !f.trashed) return f.id;
    } catch {
      /* pasta removida: recria abaixo */
    }
  }
  const created = await googleApi<{ id: string }>(tenantId, 'https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      description: 'Backups criptografados (AES-256-GCM) da plataforma Vértice. Restauração exige a BACKUP_ENCRYPTION_KEY.',
    }),
  });
  return created.id;
}

/**
 * Acha uma pasta pelo nome (criada por este app) ou cria. Diferente de `ensureDriveFolder`, não depende de um id guardado
 * em outro lugar e não cria uma pasta nova a cada chamada (spec 006: pasta própria dos backups do banco).
 */
export async function findOrCreateDriveFolderByName(tenantId: string, folderName: string, description: string): Promise<string> {
  const q = encodeURIComponent(`name = '${folderName.replace(/['\\]/g, '')}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const found = await googleApi<{ files?: Array<{ id: string }> }>(
    tenantId,
    `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime&pageSize=5&fields=files(id)`
  );
  const existing = found.files?.[0]?.id;
  if (existing) return existing;
  const created = await googleApi<{ id: string }>(tenantId, 'https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder', description }),
  });
  return created.id;
}

export async function uploadDriveFile(
  tenantId: string,
  folderId: string,
  fileName: string,
  content: Buffer,
  description: string
): Promise<DriveFile> {
  const boundary = `vtx${crypto.randomBytes(12).toString('hex')}`;
  const metadata = JSON.stringify({ name: fileName, parents: [folderId], description, mimeType: 'application/octet-stream' });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  return googleApi<DriveFile>(
    tenantId,
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,createdTime,md5Checksum',
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
      signal: AbortSignal.timeout(300_000),
    }
  );
}

export async function listDriveFolder(tenantId: string, folderId: string): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${folderId.replace(/'/g, '')}' in parents and trashed = false`);
  const out: DriveFile[] = [];
  let pageToken = '';
  do {
    const res = await googleApi<{ files: DriveFile[]; nextPageToken?: string }>(
      tenantId,
      `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&pageSize=200&fields=nextPageToken,files(id,name,size,createdTime,md5Checksum)${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
    );
    out.push(...(res.files ?? []));
    pageToken = res.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

export async function deleteDriveFile(tenantId: string, fileId: string): Promise<void> {
  await googleApi<void>(tenantId, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }, false);
}

export async function downloadDriveFile(tenantId: string, fileId: string): Promise<Buffer> {
  const token = await getGoogleAccessToken(tenantId);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`Google Drive ${res.status} ao baixar backup.`);
  return Buffer.from(await res.arrayBuffer());
}

// ----------------------------------------------------------------------------
// Google Calendar
// ----------------------------------------------------------------------------
export interface CalendarEventInput {
  summary: string;
  description: string;
  date: string; // YYYY-MM-DD (evento de dia inteiro)
  colorId?: string;
  privateKey: string; // identifica o item de origem (extendedProperties.private)
}

function addOneDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function eventBody(input: CalendarEventInput): Record<string, unknown> {
  return {
    summary: input.summary.slice(0, 250),
    description: input.description.slice(0, 2000),
    start: { date: input.date },
    end: { date: addOneDay(input.date) },
    colorId: input.colorId,
    transparency: 'transparent',
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 9 * 60 }] },
    extendedProperties: { private: { vertice_source: input.privateKey } },
  };
}

export async function upsertCalendarEvent(
  tenantId: string,
  calendarId: string,
  existingEventId: string | null,
  input: CalendarEventInput
): Promise<string> {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  if (existingEventId) {
    try {
      const updated = await googleApi<{ id: string }>(tenantId, `${base}/${encodeURIComponent(existingEventId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...eventBody(input), status: 'confirmed' }),
      });
      return updated.id;
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 404 && status !== 410) throw err;
    }
  }
  const created = await googleApi<{ id: string }>(tenantId, base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(eventBody(input)),
  });
  return created.id;
}

export async function deleteCalendarEvent(tenantId: string, calendarId: string, eventId: string): Promise<void> {
  try {
    await googleApi<void>(
      tenantId,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE' },
      false
    );
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 404 && status !== 410) throw err;
  }
}
