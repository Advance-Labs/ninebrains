/**
 * The page is hand-written, so these guard the things that are easy to break silently: the
 * assets it renders, the head tags that decide how it looks in search and when shared, and the
 * accessible structure of the two tablists (the feature rail and the install tabs).
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
  assert.match(flat, /"softwareVersion": "0\.1\.0"/);
});

test('every image has alt text', () => {
  for (const tag of flat.match(/<img[^>]*>/g) ?? []) {
    assert.match(tag, /alt="[^"]+"/, `image without alt text: ${tag}`);
  }
});

test('points at the install scripts and offers a direct download fallback', () => {
  assert.match(flat, /https:\/\/ninebrains\.runs-on\.dev\/install \| sh/);
  assert.match(flat, /https:\/\/ninebrains\.runs-on\.dev\/install\.ps1 \| iex/);
  assert.match(flat, /href="https:\/\/github\.com\/Advance-Labs\/ninebrains\/releases\/latest"/);
});

test('each copy button copies exactly the one-line command it sits next to', () => {
  // site.js copies the <code> text with whitespace collapsed, since the formatter may wrap it.
  const commands = [...html.matchAll(/<div class="cmd">[\s\S]*?<code[^>]*>([\s\S]*?)<\/code/g)].map(
    (m) => m[1].replace(/\s+/g, ' ').trim()
  );
  assert.deepEqual(commands, [
    "curl --proto '=https' --tlsv1.2 -fsSL https://ninebrains.runs-on.dev/install | sh",
    'irm https://ninebrains.runs-on.dev/install.ps1 | iex',
  ]);
});

test('the lanes visual is decoration only, hidden from assistive tech', () => {
  assert.match(flat, /<div class="lanes" aria-hidden="true">/);
});

test('says plainly that builds are unsigned, and how that is checked', () => {
  assert.match(flat, /not code-signed/);
  assert.match(flat, /SHA256SUMS/);
});

test('the feature rail is a real tablist: one tab per panel, one selected by default', () => {
  const railTabs = [...html.matchAll(/role="tab"[^>]*id="tab-(\d\d)"/g)].map((m) => m[1]);
  assert.deepEqual(railTabs, ['00', '01', '02', '03', '04', '05', '06']);
  for (const num of railTabs) {
    assert.match(flat, new RegExp(`id="panel-${num}"`), `missing panel-${num}`);
    assert.match(
      flat,
      new RegExp(`id="tab-${num}"[^>]*aria-controls="panel-${num}"`),
      `tab-${num} does not control panel-${num}`
    );
  }
  const selected = [...html.matchAll(/role="tab"[^>]*id="tab-(\d\d)"[^>]*aria-selected="true"/g)];
  assert.equal(selected.length, 1, 'exactly one rail tab should start selected');
  assert.equal(selected[0][1], '00');
});

test('every rail panel past the overview has a LIVE feature demo', () => {
  for (const num of ['01', '02', '03', '04', '05', '06']) {
    const panel = html.match(new RegExp(`id="panel-${num}"[\\s\\S]*?(?=id="panel-|</main>)`));
    assert.ok(panel, `panel-${num} not found`);
    assert.match(panel[0], /LIVE ·/, `panel-${num} is missing its LIVE kicker`);
    assert.match(panel[0], /data-demo/, `panel-${num} is missing its terminal demo`);
  }
});

test('the install tabs cover terminal, windows and download, with an anchor for #download', () => {
  assert.match(flat, /id="download"/);
  for (const kind of ['terminal', 'windows', 'download']) {
    assert.match(flat, new RegExp(`data-install="${kind}"`));
    assert.match(flat, new RegExp(`data-install-panel="${kind}"`));
  }
});

test('copy buttons sit next to a command, not floating free', () => {
  const blocks = [...flat.matchAll(/<div class="cmd">.*?<\/div>/g)];
  assert.ok(blocks.length > 0, 'no command blocks found');
  for (const match of blocks) {
    assert.match(match[0], /<code[\s>]/);
    assert.match(match[0], /data-copy/);
  }
});

test('no em dashes in site copy', () => {
  // The header/title's own separator ("Ninebrains — run ...") is the one place an em dash is
  // structural chrome, not copy; everything else in <main> must be free of them.
  const main = html.match(/<main>[\s\S]*<\/main>/)?.[0] ?? '';
  assert.ok(!main.includes('—'), 'an em dash slipped into the page copy');
});
