import { encryptSecret, isCredentialsKeyConfigured, randomHex } from '../crypto/secretBox.ts';
import { hmacSha256 } from './webhooks/utils.ts';

export { encryptSecret, isCredentialsKeyConfigured, randomHex };

/** Assinatura usada apenas para montar eventos de teste internos. */
export function hmacSecretForTest(secret: string, body: string, encoding: 'hex' | 'base64' = 'hex'): string {
  return hmacSha256(secret, body, encoding);
}
