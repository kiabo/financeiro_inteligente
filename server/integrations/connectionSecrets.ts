import { encryptSecret } from '../crypto/secretBox.ts';

/** Tamanho mínimo do segredo de assinatura do webhook (mesma regra da criação da conexão). */
export const MIN_SIGNING_SECRET_LENGTH = 8;

/**
 * Valida e cifra um novo segredo de assinatura do webhook (spec 007).
 * O valor só existe em claro aqui, dentro da requisição: o que sai é o texto cifrado (AAD = tenant),
 * que nunca volta em nenhuma resposta. `key` existe para os testes; em produção vem de CREDENTIALS_ENCRYPTION_KEY.
 */
export function prepareSigningSecretChange(raw: unknown, tenantId: string, key?: Buffer): { encrypted: string } {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.length < MIN_SIGNING_SECRET_LENGTH) {
    throw new Error(`Informe o segredo de assinatura do webhook (mínimo ${MIN_SIGNING_SECRET_LENGTH} caracteres).`);
  }
  return { encrypted: key ? encryptSecret(value, tenantId, key) : encryptSecret(value, tenantId) };
}

/** Nomes dos campos alterados para a auditoria: só os nomes, nunca valores (`signing_secret_encrypted` → `signing_secret`). */
export function auditFieldsFor(patch: Record<string, unknown>): string[] {
  return Object.keys(patch).map((k) => k.replace(/_encrypted$/, ''));
}
