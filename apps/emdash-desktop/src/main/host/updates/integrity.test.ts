import { describe, expect, it, vi } from 'vitest';
import * as updateSigningKey from '@core/primitives/app-identity/api/update-signing-key';

vi.mock('@core/primitives/app-identity/api/update-signing-key', async () => {
  const { generateKeyPairSync, sign } = await import('node:crypto');
  const key = generateKeyPairSync('ed25519');
  const __testSign = (bytes: Buffer, useOtherKey = false): string => {
    const signer = useOtherKey ? generateKeyPairSync('ed25519').privateKey : key.privateKey;
    return sign(null, bytes, signer).toString('base64');
  };
  return {
    UPDATE_SIGNING_PUBLIC_KEY: key.publicKey.export({ type: 'spki', format: 'pem' }),
    __testSign,
  };
});

const __testSign = (
  updateSigningKey as unknown as {
    __testSign: (bytes: Buffer, useOtherKey?: boolean) => string;
  }
).__testSign;

import { parseSignedChecksums, verifyChecksumsSignature } from './integrity';

const DIGEST = Buffer.from(JSON.stringify({ version: 1, algorithm: 'sha256', files: [] }));

describe('verifyChecksumsSignature', () => {
  it('accepts a genuine Ed25519 signature from the matching key', () => {
    expect(verifyChecksumsSignature(DIGEST, __testSign(DIGEST))).toBe(true);
  });

  it('rejects a tampered digest', () => {
    const tampered = Buffer.from(`${DIGEST.toString('utf8')}x`);
    expect(verifyChecksumsSignature(tampered, __testSign(DIGEST))).toBe(false);
  });

  it('rejects a signature from a different key and garbage input', () => {
    expect(verifyChecksumsSignature(DIGEST, __testSign(DIGEST, true))).toBe(false);
    expect(verifyChecksumsSignature(DIGEST, 'not base64 !!!')).toBe(false);
    expect(verifyChecksumsSignature(DIGEST, '')).toBe(false);
  });
});

describe('parseSignedChecksums', () => {
  const good = {
    version: 1,
    algorithm: 'sha256',
    files: [
      { name: 'Ninebrains-0.2.2-mac-arm64.zip', sha256: 'a'.repeat(64), size: 12 },
      { name: 'Ninebrains-0.2.2-win-x64.exe', sha256: 'b'.repeat(64), size: 13 },
    ],
  };

  it('parses a valid digest frame', () => {
    expect(parseSignedChecksums(JSON.stringify(good))).toEqual(good);
  });

  it.each([
    ['not JSON', 'nope'],
    ['empty object', '{}'],
    ['unsupported version', JSON.stringify({ ...good, version: 2 })],
    ['unsupported algorithm', JSON.stringify({ ...good, algorithm: 'md5' })],
    ['no files', JSON.stringify({ ...good, files: [] })],
    ['malformed entry', JSON.stringify({ ...good, files: [null] })],
    [
      'entry without name',
      JSON.stringify({ ...good, files: [{ sha256: 'a'.repeat(64), size: 1 }] }),
    ],
    [
      'malformed hash',
      JSON.stringify({ ...good, files: [{ name: 'x.zip', sha256: 'z'.repeat(64), size: 1 }] }),
    ],
    [
      'negative size',
      JSON.stringify({ ...good, files: [{ name: 'x.zip', sha256: 'a'.repeat(64), size: -1 }] }),
    ],
    [
      'duplicate name',
      JSON.stringify({
        ...good,
        files: [
          { name: 'x.zip', sha256: 'a'.repeat(64), size: 1 },
          { name: 'x.zip', sha256: 'b'.repeat(64), size: 2 },
        ],
      }),
    ],
  ])('rejects %s', (_label, input) => {
    expect(() => parseSignedChecksums(input)).toThrow(/SHA256SUMS\.json/);
  });
});
