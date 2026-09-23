// Run: node --test scripts/release/*.test.mjs   (no install needed)
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  DIGEST_FILE,
  SIGNATURE_FILE,
  signChecksums,
  signDigestFile,
  verifyChecksumsSignature,
  verifyDigestSignature,
} from './sign-update-digest.mjs';

let dir;
let key = generateKeyPairSync('ed25519');
let restore;

beforeEach(() => {
  key = generateKeyPairSync('ed25519');
  process.env.NINEBRAINS_UPDATE_SIGNING_KEY = key.privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  });
  dir = mkdtempSync(join(tmpdir(), 'nb-sig-'));
  restore = process.env.NINEBRAINS_UPDATE_SIGNING_KEY_FILE;
  delete process.env.NINEBRAINS_UPDATE_SIGNING_KEY_FILE;
});
afterEach(() => {
  delete process.env.NINEBRAINS_UPDATE_SIGNING_KEY;
  if (restore === undefined) delete process.env.NINEBRAINS_UPDATE_SIGNING_KEY_FILE;
  else process.env.NINEBRAINS_UPDATE_SIGNING_KEY_FILE = restore;
  rmSync(dir, { recursive: true, force: true });
});

describe('update signature (scripts/release/sign-update-digest.mjs)', () => {
  it('signs SHA256SUMS.json into SHA256SUMS.json.sig and verifies round-trips', async () => {
    writeFileSync(join(dir, DIGEST_FILE), JSON.stringify({ version: 1, algorithm: 'sha256' }));
    const signature = signChecksums(dir);
    assert.ok(signature.length >= 80);
    assert.ok(readFileSync(join(dir, SIGNATURE_FILE), 'utf8').trim().length > 0);
    assert.equal(
      await verifyChecksumsSignature(dir, key.publicKey.export({ type: 'spki', format: 'pem' })),
      true
    );
    assert.equal(
      verifyDigestSignature(
        readFileSync(join(dir, DIGEST_FILE)),
        signature,
        key.publicKey.export({ type: 'spki', format: 'pem' })
      ),
      true
    );
  });

  it('rejects a tampered digest', async () => {
    writeFileSync(join(dir, DIGEST_FILE), '{"version":1,"algorithm":"sha256","files":[]}');
    const signature = signChecksums(dir);
    writeFileSync(join(dir, DIGEST_FILE), '{"version":1,"algorithm":"sha256","files":["evil"]}');
    await assert.rejects(
      verifyChecksumsSignature(dir, key.publicKey.export({ type: 'spki', format: 'pem' })),
      /does not verify/
    );
    assert.equal(
      verifyDigestSignature(
        readFileSync(join(dir, DIGEST_FILE)),
        signature,
        key.publicKey.export({ type: 'spki', format: 'pem' })
      ),
      false
    );
  });

  it('signs with the private key from NINEBRAINS_UPDATE_SIGNING_KEY', () => {
    const publicPem = key.publicKey.export({ type: 'spki', format: 'pem' });
    const signed = signDigestFile(Buffer.from('bytes'));
    assert.equal(verifyDigestSignature(Buffer.from('bytes'), signed, publicPem), true);
    assert.equal(verifyDigestSignature(Buffer.from('other'), signed, publicPem), false);
  });
});
