// Implementação RFC 6238 (TOTP / HMAC-SHA1) via WebCrypto para fluxo MFA em ambiente Sandbox

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateBase32Secret(length = 20): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let secret = '';
  for (let i = 0; i < bytes.length; i++) {
    secret += BASE32_ALPHABET[(bytes[i] ?? 0) % BASE32_ALPHABET.length];
  }
  return secret;
}

function base32ToBytes(base32: string): Uint8Array {
  const cleaned = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return bytes;
}

export async function generateTOTPCode(
  base32Secret: string,
  timeStepSeconds = 30,
  offsetSteps = 0
): Promise<string> {
  const counter = Math.floor(Date.now() / 1000 / timeStepSeconds) + offsetSteps;
  const counterBuffer = new ArrayBuffer(8);
  const view = new DataView(counterBuffer);
  view.setUint32(0, Math.floor(counter / 0x100000000), false);
  view.setUint32(4, counter >>> 0, false);

  const keyBytes = base32ToBytes(base32Secret);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );

  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counterBuffer));
  const offset = (signature[signature.length - 1] ?? 0) & 0x0f;
  const binary =
    (((signature[offset] ?? 0) & 0x7f) << 24) |
    (((signature[offset + 1] ?? 0) & 0xff) << 16) |
    (((signature[offset + 2] ?? 0) & 0xff) << 8) |
    ((signature[offset + 3] ?? 0) & 0xff);

  return (binary % 1_000_000).toString().padStart(6, '0');
}

export async function verifyTOTPCode(base32Secret: string, code: string): Promise<boolean> {
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;

  for (const step of [-1, 0, 1]) {
    const candidate = await generateTOTPCode(base32Secret, 30, step);
    if (candidate === normalized) return true;
  }
  return false;
}

export function buildOtpAuthUri(email: string, secret: string, issuer = 'VerticeFinance'): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const encodedIssuer = encodeURIComponent(issuer);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}
