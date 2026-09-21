/**
 * The page is hand-written, so these guard the things that are easy to break silently: the
 * assets it renders, and the head tags that decide how it looks in search and when shared.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(APP, 'dist');

execFileSync('node', [join(APP, 'build.mjs')], { stdio: 'ignore' });
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
/** The formatter wraps long tags across lines, so match against a flattened copy. */
const flat = html.replace(/\s+/g, ' ');

test('ships every asset the page references', () => {
  for (const match of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
    const path = match[1];
    if (path.startsWith('//')) continue;
    assert.doesNotThrow(
      () => readFileSync(join(DIST, path.slice(1))),
      `referenced but not built: ${path}`
    );
  }
});

test('carries the head tags search and social cards need', () => {
  assert.match(flat, /<title>Ninebrains[^<]*Claude Code[^<]*<\/title>/);
  assert.match(flat, /<meta name="description" content="[^"]{80,300}"/);
  assert.match(
    flat,
    /<meta property="og:image" content="https:\/\/[^"]+\/assets\/ninebrains-banner\.png"/
  );
  assert.match(flat, /<link rel="canonical" href="https:\/\/[^"]+"/);
  assert.match(flat, /<meta name="twitter:card" content="summary_large_image"/);
  assert.match(flat, /"@type": "SoftwareApplication"/);
});

test('every image has alt text', () => {
  for (const tag of flat.match(/<img[^>]*>/g) ?? []) {
    assert.match(tag, /alt="[^"]+"/, `image without alt text: ${tag}`);
  }
});

test('offers the release, and says plainly that builds are unsigned', () => {
  // v0.1.0 shipped, so "pre-release, being built" became false. Unsigned is still true and is
  // the part a downloader needs before they open the app.
  assert.match(flat, /href="https:\/\/github\.com\/Advance-Labs\/ninebrains\/releases\/latest"/);
  assert.match(flat, /not yet code-signed/);
  assert.match(flat, /"softwareVersion": "0\.1\.0"/);
});
