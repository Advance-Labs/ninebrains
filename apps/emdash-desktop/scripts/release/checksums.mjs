#!/usr/bin/env node
// Ninebrains release integrity (THREAT-MODEL SEC-37).
//
//   node scripts/release/checksums.mjs <dir>           write SHA256SUMS and SHA256SUMS.json
//   node scripts/release/checksums.mjs --verify <dir>  re-check every artifact against SHA256SUMS
//
// SHA256SUMS uses the `<hex>  <name>` layout, so `shasum -a 256 -c SHA256SUMS` (macOS) and
// `sha256sum -c SHA256SUMS` (Linux) verify it directly. Plain JavaScript on purpose: it runs on a
// bare runner with no install step.
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SUMS_FILE = 'SHA256SUMS';
export const SUMS_JSON_FILE = 'SHA256SUMS.json';

// Installers and archives only. electron-builder also leaves unpacked app dirs, blockmaps and
// debug YAML in its output dir; those are not release assets.
const ARTIFACT_PATTERN = /\.(?:dmg|zip|exe|msi|AppImage|deb|rpm|tar\.gz)$/;
// Names go into a line-oriented file, so anything that could forge or split a line is refused.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

export function isArtifact(name) {
  return ARTIFACT_PATTERN.test(name);
}

export function listArtifacts(dir) {
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isArtifact(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    if (!SAFE_NAME.test(name))
      throw new Error(`Refusing unsafe artifact name: ${JSON.stringify(name)}`);
  }
  return names;
}

export async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function writeChecksums(dir) {
  const names = listArtifacts(dir);
  if (names.length === 0) throw new Error(`No release artifacts found in ${dir}`);
  const files = [];
  for (const name of names) {
    const path = join(dir, name);
    files.push({ name, sha256: await sha256File(path), size: statSync(path).size });
  }
  writeFileSync(join(dir, SUMS_FILE), files.map((f) => `${f.sha256}  ${f.name}\n`).join(''));
  writeFileSync(
    join(dir, SUMS_JSON_FILE),
    `${JSON.stringify({ version: 1, algorithm: 'sha256', files }, null, 2)}\n`
  );
  return files;
}

export function parseSums(text) {
  const entries = new Map();
  for (const [index, line] of text.split('\n').entries()) {
    if (line === '') continue;
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (!match || !SAFE_NAME.test(match[2])) {
      throw new Error(`${SUMS_FILE} line ${index + 1} is malformed`);
    }
    if (entries.has(match[2])) throw new Error(`${SUMS_FILE} lists ${match[2]} twice`);
    entries.set(match[2], match[1]);
  }
  return entries;
}

/**
 * Fails unless every listed file exists with the listed hash AND every artifact in the directory
 * is listed. The second half is what makes this a check on the release, not just on the sums file:
 * an asset slipped in beside SHA256SUMS is caught.
 */
export async function verifyChecksums(dir) {
  const expected = parseSums(readFileSync(join(dir, SUMS_FILE), 'utf8'));
  if (expected.size === 0) throw new Error(`${SUMS_FILE} is empty`);
  const problems = [];
  const present = new Set(listArtifacts(dir));
  for (const name of present) {
    if (!expected.has(name)) problems.push(`${name}: not listed in ${SUMS_FILE}`);
  }
  for (const [name, hash] of expected) {
    if (!present.has(name)) {
      problems.push(`${name}: missing`);
    } else if ((await sha256File(join(dir, name))) !== hash) {
      problems.push(`${name}: checksum mismatch`);
    }
  }
  if (problems.length > 0)
    throw new Error(`Checksum verification failed:\n  ${problems.join('\n  ')}`);
  return [...expected.keys()];
}

async function main(argv) {
  const verify = argv[0] === '--verify';
  const dir = verify ? argv[1] : argv[0];
  if (!dir || argv.length > (verify ? 2 : 1)) {
    console.error('Usage: checksums.mjs [--verify] <dir>');
    process.exit(2);
  }
  if (verify) {
    const names = await verifyChecksums(dir);
    console.log(`OK: ${names.length} artifact(s) match ${SUMS_FILE}`);
  } else {
    const files = await writeChecksums(dir);
    for (const f of files) console.log(`${f.sha256}  ${f.name}  (${f.size} bytes)`);
    console.log(`Wrote ${SUMS_FILE} and ${SUMS_JSON_FILE} for ${files.length} artifact(s)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
