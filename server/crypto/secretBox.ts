import crypto from 'crypto';

/**
 * Cofre de credenciais do servidor (AES-256-GCM).
 * Usado para cifrar segredos de webhook e refresh tokens OAuth antes de gravar no banco.
 *
 * Formato: "v1:" + base64( iv[12] | authTag[16] | ciphertext )
 * AAD (dados associados autenticados): normalmente o tenant_id — impede que um segredo
 * cifrado de um tenant seja copiado para a linha de outro e decifrado com sucesso.
 */

const VERSION_PREFIX = 'v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: Buffer | null = null;
let cachedKeySource = '';

export function resolveCredentialsKey(raw = process.env.CREDENTIALS_ENCRYPTION_KEY ?? ''): Buffer {
  const value = raw.trim();
  if (!value) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY não configurada. Gere uma com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  if (cachedKey && cachedKeySource === value) return cachedKey;

  let key: Buffer;
  if (/^[a-f0-9]{64}$/i.test(value)) {
    key = Buffer.from(value, 'hex');
  } else if (/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    key = Buffer.from(value, 'base64');
  } else {
    if (value.length < 32) {
      throw new Error('CREDENTIALS_ENCRYPTION_KEY muito curta (mínimo 32 caracteres ou 64 hex).');
    }
    // Frase-senha longa: deriva 32 bytes de forma determinística
    key = crypto.scryptSync(value, 'vertice-credentials-v1', 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  }

  if (key.length !== 32) throw new Error('CREDENTIALS_ENCRYPTION_KEY inválida (precisa resultar em 32 bytes).');
  cachedKey = key;
  cachedKeySource = value;
  return key;
}

export function isCredentialsKeyConfigured(): boolean {
  try {
    resolveCredentialsKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string, aad: string, key: Buffer = resolveCredentialsKey()): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return VERSION_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptSecret(sealed: string, aad: string, key: Buffer = resolveCredentialsKey()): string {
  if (!sealed.startsWith(VERSION_PREFIX)) {
    throw new Error('Formato de segredo cifrado desconhecido.');
  }
  const raw = Buffer.from(sealed.slice(VERSION_PREFIX.length), 'base64');
  if (raw.length < IV_BYTES + TAG_BYTES) throw new Error('Segredo cifrado corrompido.');
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Comparação em tempo constante para strings (tokens, assinaturas hex). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) {
    // Compara mesmo assim para não vazar o tamanho por tempo de resposta
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

export function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}
