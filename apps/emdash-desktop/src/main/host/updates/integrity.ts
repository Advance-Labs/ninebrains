import { createPublicKey, verify } from 'node:crypto';
import { UPDATE_SIGNING_PUBLIC_KEY } from '@core/primitives/app-identity/api/update-signing-key';
import type { ChecksumFile } from './types';
import { isValidVersion } from './version';

export const DIGEST_FILE = 'SHA256SUMS.json';
export const DIGEST_SIGNATURE_FILE = `${DIGEST_FILE}.sig`;

/** The signed digest schema written by scripts/release/checksums.mjs. */
export type SignedChecksums = {
  version: 1;
  algorithm: 'sha256';
  files: ChecksumFile[];
};

/**
 * Verifies an Ed25519 signature over the raw SHA256SUMS.json bytes. This is the identity anchor
 * for unsigned installers (docs/SIGNING.md, "Our own update signature"): nothing in a release is
 * trusted until this returns true.
 */
export function verifyChecksumsSignature(
  digestBytes: Buffer | Uint8Array,
  signatureBase64: string
): boolean {
  try {
    const key = createPublicKey(UPDATE_SIGNING_PUBLIC_KEY);
    return verify(null, digestBytes, key, Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}

const SHA256_RE = /^[0-9a-f]{64}$/;

export const SHA256_RE_HEX = SHA256_RE;

/** Parses and validates the signed SHA256SUMS.json frames, refusing malformed or duplicate names. */
export function parseSignedChecksums(text: string): SignedChecksums {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${DIGEST_FILE} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object') throw new Error(`${DIGEST_FILE} has no content`);

  const { version, algorithm, files } = parsed as Partial<SignedChecksums> & { files?: unknown };
  if (version !== 1) throw new Error(`${DIGEST_FILE} has unsupported version`);
  if (algorithm !== 'sha256') throw new Error(`${DIGEST_FILE} uses an unsupported algorithm`);

  if (!Array.isArray(files) || files.length === 0) {
    throw new Error(`${DIGEST_FILE} lists no files`);
  }

  const seen = new Set<string>();
  for (const entry of files) {
    if (!entry || typeof entry !== 'object')
      throw new Error(`${DIGEST_FILE} has a malformed entry`);
    const { name, sha256, size } = entry as Partial<ChecksumFile>;
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`${DIGEST_FILE} has an entry without a name`);
    }
    if (seen.has(name)) throw new Error(`${DIGEST_FILE} lists ${name} twice`);
    if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) {
      throw new Error(`${DIGEST_FILE} has a malformed sha256 for ${name}`);
    }
    if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
      throw new Error(`${DIGEST_FILE} has a malformed size for ${name}`);
    }
    seen.add(name);
  }
  return { version: 1, algorithm: 'sha256', files: files as ChecksumFile[] };
}

/** True when a version carries an alpha build suffix; the feed never promotes partial builds. */
export function isUsableUpdateVersion(version: string): boolean {
  return isValidVersion(version);
}
