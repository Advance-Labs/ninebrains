#!/usr/bin/env node
// Ninebrains update-signature (THREAT-MODEL SEC-36, "our own update signature").
//
//   node scripts/release/sign-update-digest.mjs <dir>                   sign SHA256SUMS.json
//   node scripts/release/sign-update-digest.mjs --verify <dir>          verify SHA256SUMS.json.sig
//   node scripts/release/sign-update-digest.mjs --help
//
// The updater in the app downloads a release's SHA256SUMS.json and its sibling SHA256SUMS.json.sig,
// verifies the signature against the embedded public key (update-signing-key.ts), and only then
// trusts the artifact hashes listed inside. This is the identity anchor for unsigned installers:
// it replaces what Apple's Developer ID and Microsoft's Authenticode would otherwise provide.
//
// The signing key is read from NINEBRAINS_UPDATE_SIGNING_KEY (PEM text, a GitHub Actions secret)
// or NINEBRAINS_UPDATE_SIGNING_KEY_FILE (a path). Base64 .sig output keeps line wrapping away.
// Plain JavaScript on purpose, like checksums.mjs: it runs on a bare runner with no install step.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DIGEST_FILE = 'SHA256SUMS.json';
export const SIGNATURE_FILE = `${DIGEST_FILE}.sig`;
// Ed25519 takes no digest: node:crypto's sign/verify take the algorithm as `null`.
const ED25519 = null;

export function sha256Digest(file) {
  return createHash('sha256').update(file).digest('base64');
}

function readSecret() {
  const pem = process.env.NINEBRAINS_UPDATE_SIGNING_KEY || '';
  if (pem.trim()) return pem;
  const file = process.env.NINEBRAINS_UPDATE_SIGNING_KEY_FILE;
  if (!file)
    throw new Error(
      'Set NINEBRAINS_UPDATE_SIGNING_KEY (PEM) or NINEBRAINS_UPDATE_SIGNING_KEY_FILE'
    );
  return readFileSync(file, 'utf8');
}

export function signDigestFile(bytes) {
  const key = createPrivateKey(readSecret());
  return sign(ED25519, bytes, key).toString('base64');
}

/** True when `signatureBase64` is a valid Ed25519 signature of `bytes` under `publicKeyPem`. */
export function verifyDigestSignature(bytes, signatureBase64, publicKeyPem) {
  try {
    const key = createPublicKey(publicKeyPem);
    return verify(ED25519, bytes, key, Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}

/** The public key embedded in the app source, so `--verify` checks the real shipped key. */
export async function embeddedPublicKey() {
  const { UPDATE_SIGNING_PUBLIC_KEY } =
    await import('../../src/core/primitives/app-identity/api/update-signing-key.ts');
  return UPDATE_SIGNING_PUBLIC_KEY;
}

export function signChecksums(dir) {
  const digestPath = join(dir, DIGEST_FILE);
  const bytes = readFileSync(digestPath);
  const signature = signDigestFile(bytes);
  writeFileSync(join(dir, SIGNATURE_FILE), signature, { mode: 0o644 });
  return signature;
}

export async function verifyChecksumsSignature(dir, publicKeyPem) {
  const bytes = readFileSync(join(dir, DIGEST_FILE));
  const signature = readFileSync(join(dir, SIGNATURE_FILE), 'utf8').trim();
  const keyPem = publicKeyPem ?? (await embeddedPublicKey());
  if (!verifyDigestSignature(bytes, signature, keyPem)) {
    throw new Error(`${SIGNATURE_FILE} does not verify against the embedded Ninebrains public key`);
  }
  return true;
}

async function main(argv) {
  if (argv[0] === '--help' || argv[0] === '-h') {
    console.log('Usage: sign-update-digest.mjs <dir> | --verify <dir>');
    process.exit(0);
  }
  const verifyMode = argv[0] === '--verify';
  const dir = verifyMode ? argv[1] : argv[0];
  if (!dir || argv.length > (verifyMode ? 2 : 1)) {
    console.error('Usage: sign-update-digest.mjs <dir> | --verify <dir>');
    process.exit(2);
  }
  if (verifyMode) {
    const verified = await verifyChecksumsSignature(dir);
    console.log(`OK: ${SIGNATURE_FILE} verifies against the embedded update-signing key`);
    process.exit(verified ? 0 : 1);
  }
  const signature = signChecksums(dir);
  console.log(
    `Signed ${DIGEST_FILE} -> ${SIGNATURE_FILE} (${sha256Digest(Buffer.from(signature))} sha256 of signature)`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
