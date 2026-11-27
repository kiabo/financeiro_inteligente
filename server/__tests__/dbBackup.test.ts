import crypto from 'crypto';
import { assert, assertEqual, assertRejects, runCases, type TestCase, type TestCaseResult } from '../../scripts/testHarness.ts';
import { decryptBackupBytes, decryptBackupPayload, encryptBackupPayload, readBackupHeader } from '../crypto/backupCrypto.ts';

const NOW = new Date('2026-11-27T06:00:00Z');
const PASS = 'senha-muito-longa-para-backup-1234';

const cases: TestCase[] = [
  // ---------------------------------------------------------------- T03 · cifra de dump binário
  ['cifra do banco: bytes binários voltam idênticos e o conteúdo não fica em claro (CA3)', () => {
    const secretMarker = Buffer.from('CONTEUDO-CONHECIDO-DO-DUMP');
    const binary = Buffer.concat([Buffer.from([0, 1, 2, 255, 254, 128]), secretMarker, crypto.randomBytes(2048)]);
    const pkg = encryptBackupPayload(binary, PASS, 'instance', NOW);
    assert(pkg.indexOf(secretMarker) === -1, 'o conteúdo conhecido não pode aparecer no arquivo cifrado');
    const { data, header } = decryptBackupBytes(pkg, PASS);
    assert(data.equals(binary), 'os bytes têm que voltar idênticos');
    assertEqual(header.tenantRef, 'instance', 'referência no cabeçalho');
  }],
  ['cifra do banco: chave errada e adulteração são recusadas (CA3)', async () => {
    const pkg = encryptBackupPayload(Buffer.from('dump'), PASS, 'instance', NOW);
    await assertRejects(() => decryptBackupBytes(pkg, 'outra-senha-totalmente-diferente-99'), /chave incorreta|adulterado/, 'senha errada');
    const tampered = Buffer.from(pkg);
    tampered[tampered.length - 20] = (tampered[tampered.length - 20] ?? 0) ^ 0xff;
    await assertRejects(() => decryptBackupBytes(tampered, PASS), /chave incorreta|adulterado/, 'conteúdo adulterado');
  }],
  ['cifra do backup lógico continua igual: texto cifra, decifra e mantém o cabeçalho', () => {
    const json = JSON.stringify({ a: 'mundo', n: [1, 2, 3] });
    const pkg = encryptBackupPayload(json, PASS, 'ref', NOW);
    assertEqual(readBackupHeader(pkg).header.v, 1, 'versão do formato');
    assertEqual(decryptBackupPayload(pkg, PASS).json, json, 'roundtrip como texto');
  }],
];

export async function runDbBackupTests(): Promise<TestCaseResult[]> {
  return runCases(cases);
}
