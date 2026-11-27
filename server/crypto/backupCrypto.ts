import crypto from 'crypto';
import zlib from 'zlib';

/**
 * Formato do pacote de backup Vértice (.vtxbak):
 *
 *   MAGIC "VTXBAK01" (8 bytes)
 *   uint32 BE  = tamanho do cabeçalho JSON
 *   cabeçalho JSON (UTF-8): { v, kdf, N, r, p, salt, iv, createdAt, compression, tenantRef }
 *   ciphertext  = AES-256-GCM( gzip( JSON do dump ) )
 *   authTag     = 16 bytes
 *
 * O cabeçalho inteiro (MAGIC + tamanho + JSON) é usado como AAD: qualquer alteração
 * nele (ex.: trocar o salt ou o tenantRef) invalida a autenticação na restauração.
 * A chave é derivada de BACKUP_ENCRYPTION_KEY via scrypt com salt aleatório por arquivo.
 */

const MAGIC = Buffer.from('VTXBAK01', 'ascii');
const TAG_BYTES = 16;
const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;

export interface BackupHeader {
  v: 1;
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
  iv: string;
  createdAt: string;
  compression: 'gzip';
  /** Referência opaca ao tenant (hash), nunca o e-mail ou nome */
  tenantRef: string;
}

export function resolveBackupPassphrase(raw = process.env.BACKUP_ENCRYPTION_KEY ?? ''): string {
  const value = raw.trim();
  if (value.length < 24) {
    throw new Error(
      'BACKUP_ENCRYPTION_KEY ausente ou curta demais (mínimo 24 caracteres). Guarde-a fora do servidor: sem ela o backup não pode ser restaurado.'
    );
  }
  return value;
}

export function isBackupKeyConfigured(): boolean {
  try {
    resolveBackupPassphrase();
    return true;
  } catch {
    return false;
  }
}

function deriveKey(passphrase: string, salt: Buffer, N: number, r: number, p: number): Buffer {
  return crypto.scryptSync(passphrase, salt, 32, { N, r, p, maxmem: SCRYPT_MAXMEM });
}

export function encryptBackupPayload(
  /** JSON em texto (backup lógico) ou bytes (dump binário do banco, spec 006). O formato do arquivo é o mesmo. */
  plain: string | Buffer,
  passphrase: string,
  tenantRef: string,
  now: Date = new Date()
): Buffer {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const header: BackupHeader = {
    v: 1,
    kdf: 'scrypt',
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    createdAt: now.toISOString(),
    compression: 'gzip',
    tenantRef,
  };
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  const lenBytes = Buffer.alloc(4);
  lenBytes.writeUInt32BE(headerBytes.length, 0);
  const aad = Buffer.concat([MAGIC, lenBytes, headerBytes]);

  const key = deriveKey(passphrase, salt, header.N, header.r, header.p);
  const compressed = zlib.gzipSync(typeof plain === 'string' ? Buffer.from(plain, 'utf8') : plain, { level: 9 });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  key.fill(0);

  return Buffer.concat([aad, ciphertext, tag]);
}

export function readBackupHeader(pkg: Buffer): { header: BackupHeader; aadLength: number } {
  if (pkg.length < MAGIC.length + 4 + TAG_BYTES || !pkg.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Arquivo não é um backup Vértice válido (assinatura VTXBAK01 ausente).');
  }
  const headerLen = pkg.readUInt32BE(MAGIC.length);
  const headerStart = MAGIC.length + 4;
  if (headerLen <= 0 || headerLen > 4096 || headerStart + headerLen + TAG_BYTES > pkg.length) {
    throw new Error('Cabeçalho do backup corrompido.');
  }
  const header = JSON.parse(pkg.subarray(headerStart, headerStart + headerLen).toString('utf8')) as BackupHeader;
  if (header.v !== 1 || header.kdf !== 'scrypt' || header.compression !== 'gzip') {
    throw new Error('Versão de backup não suportada.');
  }
  return { header, aadLength: headerStart + headerLen };
}

export function decryptBackupPayload(pkg: Buffer, passphrase: string): { header: BackupHeader; json: string } {
  const { header, data } = decryptBackupBytes(pkg, passphrase);
  return { header, json: data.toString('utf8') };
}

/** Decifra para bytes (dump binário do banco); `decryptBackupPayload` é a mesma operação lida como texto. */
export function decryptBackupBytes(pkg: Buffer, passphrase: string): { header: BackupHeader; data: Buffer } {
  const { header, aadLength } = readBackupHeader(pkg);
  // Limita parâmetros do KDF lidos do arquivo para evitar DoS por cabeçalho adulterado
  if (header.N > 2 ** 20 || header.r > 16 || header.p > 4) {
    throw new Error('Parâmetros de derivação de chave fora do limite aceito.');
  }
  const aad = pkg.subarray(0, aadLength);
  const ciphertext = pkg.subarray(aadLength, pkg.length - TAG_BYTES);
  const tag = pkg.subarray(pkg.length - TAG_BYTES);

  const key = deriveKey(passphrase, Buffer.from(header.salt, 'base64'), header.N, header.r, header.p);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'base64'));
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  let compressed: Buffer;
  try {
    compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error('Falha na autenticação do backup: chave incorreta ou arquivo adulterado.');
  } finally {
    key.fill(0);
  }
  return { header, data: zlib.gunzipSync(compressed) };
}
