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

test('the demo windows and cube slots are decoration only, hidden from assistive tech', () => {
  const fits = [...flat.matchAll(/<div class="win-fit[^"]*"[^>]*>/g)].map((m) => m[0]);
  assert.equal(fits.length, 7, 'one demo window per scene');
  for (const tag of fits) assert.match(tag, /aria-hidden="true"/, `not hidden: ${tag}`);
  const slots = [...flat.matchAll(/<div class="cube-slot"[^>]*>/g)].map((m) => m[0]);
  assert.equal(slots.length, 7, 'one cube slot per scene');
  for (const tag of slots) assert.match(tag, /aria-hidden="true"/);
});

test('the page is one screen: the root never scrolls', () => {
  const css = readFileSync(join(DIST, 'styles.css'), 'utf8').replace(/\s+/g, ' ');
  assert.match(css, /html, body \{[^}]*height: 100dvh;[^}]*overflow: hidden;/);
  // The two height tiers that drop the lede, then the works-with row.
  assert.match(css, /@media \(max-height: 760px\)/);
  assert.match(css, /@media \(max-height: 640px\)/);
});

test('each rail tab carries an icon, a caption and a scene length for auto-advance', () => {
  const tabs = [...flat.matchAll(/<button[^>]*role="tab"[^>]*id="tab-\d\d"[\s\S]*?<\/button>/g)];
  assert.equal(tabs.length, 7);
  for (const [tab] of tabs) {
    assert.match(tab, /<svg class="rail-icon"/);
    assert.match(tab, /class="rail-caption">[^<]+</);
    const seconds = Number(tab.match(/data-duration="(\d+)"/)?.[1]);
    assert.ok(seconds >= 8 && seconds <= 14, `scene length out of range: ${seconds}`);
  }
});

test('every timeline mark in a demo lands inside its scene', () => {
  const lengths = Object.fromEntries(
    [...flat.matchAll(/id="tab-(\d\d)"[^>]*data-duration="(\d+)"/g)].map((m) => [m[1], +m[2]])
  );
  assert.equal(Object.keys(lengths).length, 7);
  for (const [num, length] of Object.entries(lengths)) {
    const panel = html.match(new RegExp(`id="panel-${num}"[\\s\\S]*?(?=id="panel-|</main>)`));
    assert.ok(panel, `panel-${num} not found`);
    for (const m of panel[0].matchAll(/data-(?:at|off|swap-at)="([^"]+)"/g)) {
      const t = Number(m[1]);
      assert.ok(Number.isFinite(t) && t >= 0 && t < length, `panel-${num}: mark ${m[1]}`);
    }
  }
});

test('the verify sheet is a real dialog with the checks spelled out', () => {
  assert.match(flat, /data-open="verify"/);
  const sheet = flat.match(/<dialog[^>]*id="verify"[\s\S]*?<\/dialog>/)?.[0] ?? '';
  assert.ok(sheet, 'no verify dialog');
  assert.match(sheet, /aria-labelledby="verify-title"/);
  assert.match(sheet, /gh attestation verify/);
  assert.match(sheet, /Gatekeeper/);
  assert.match(sheet, /SmartScreen/);
  assert.match(sheet, /verify-download/);
});

test('ships the stage script and keeps it dependency-free', () => {
  const stage = readFileSync(join(DIST, 'stage.js'), 'utf8');
  assert.match(stage, /getContext\('webgl2'/);
  assert.doesNotMatch(stage, /^import /m, 'the stage must not import anything');
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
  const body = html.match(/<body>[\s\S]*<\/body>/)?.[0] ?? '';
  assert.ok(body.length > 0, 'no body found');
  assert.ok(!body.includes('—'), 'an em dash slipped into the page copy');
});

test('every scene opens on a populated entry frame inside its run', () => {
  const tabs = [
    ...flat.matchAll(/id="tab-(\d\d)"[^>]*data-entry="([^"]+)"[^>]*data-duration="(\d+)"/g),
  ];
  assert.equal(tabs.length, 7, 'every rail tab needs data-entry before data-duration');
  for (const [, num, entry, duration] of tabs) {
    const t = Number(entry);
    assert.ok(t > 0 && t < Number(duration) / 3, `tab-${num}: entry ${entry} out of range`);
  }
});

test('phones read a short version of each feature, four lines at most', () => {
  const shorts = [...flat.matchAll(/<span class="copy-short" ?>([^<]+)<\/span/g)].map((m) => m[1]);
  assert.equal(shorts.length, 6, 'one short copy per feature');
  for (const text of shorts) assert.ok(text.length <= 140, `too long for four lines: ${text}`);
  assert.equal([...flat.matchAll(/<span class="copy-full" ?>/g)].length, 6);
});

test('the cubes are framed into a measured safe area, and the audit hook stays opt-in', () => {
  const site = readFileSync(join(DIST, 'site.js'), 'utf8');
  const layout = readFileSync(join(DIST, 'layout.js'), 'utf8');
  assert.match(site, /import \{ safeRect \} from '\.\/layout\.js'/);
  assert.match(layout, /export function safeRect/);
  // window.__dbg exists only with ?debug=bounds, for test/overlap-audit.mjs.
  assert.match(site, /get\('debug'\) === 'bounds'/);
  assert.match(site, /if \(!debug\) return;\s+window\.__dbg =/);
});

test('the loading mark paints before any script and can never strand the page', () => {
  const head = html.slice(0, html.indexOf('</head>'));
  const style = head.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  assert.ok(style.includes('#intro'), 'no inline critical style for the loading mark');
  assert.ok(style.replace(/\s+/g, ' ').length < 2048, 'inline critical CSS over 2 KB');
  // The failsafe: an animation that hides it by 3.5s, and nothing at all without JS.
  const failsafe = style
    .replace(/\s+/g, ' ')
    .match(/animation: intro-out ([\d.]+)s ([\d.]+)s forwards/);
  assert.ok(failsafe, 'no CSS failsafe on the loading mark');
  assert.ok(Number(failsafe[1]) + Number(failsafe[2]) <= 3.5);
  assert.match(head, /<noscript\s*><style>\s*#intro \{\s*display: none;/);
  // The first thing in the body, drawn inline (the <symbol> sprite comes too late in the page).
  const body = html.slice(html.indexOf('<body>'));
  assert.match(body, /^<body>\s*<div id="intro" aria-hidden="true">\s*<svg viewBox="0 0 70 70"/);
  const mark = body.match(/<div id="intro"[\s\S]*?<\/div>/)[0];
  assert.equal((mark.match(/<rect /g) ?? []).length, 9);
  // The overlap audit's page never shows it.
  const site = readFileSync(join(DIST, 'site.js'), 'utf8');
  assert.match(site, /if \(!introEl \|\| debug \|\|/);
});
