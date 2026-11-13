/**
 * The /compare/ pages name competitors, so the claims rules in
 * docs/strategy/workstreams/W9-positioning-and-content.md are enforced here, not left to review:
 * every competitor claim cites that competitor's own site, the pages stay findable, and the
 * structured data only describes what the page visibly shows.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validate } from '../compare.mjs';

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = mkdtempSync(join(tmpdir(), 'site-compare-'));
execFileSync('node', [join(APP, 'build.mjs')], {
  stdio: 'ignore',
  env: { ...process.env, SITE_DIST: DIST },
});

const data = readdirSync(join(APP, 'compare'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(APP, 'compare', f), 'utf8')));
const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');

test('every comparison builds a findable page', () => {
  assert.ok(data.length >= 4);
  for (const c of data) {
    const path = `/compare/${c.slug}/`;
    const html = readFileSync(join(DIST, path, 'index.html'), 'utf8');
    assert.ok(html.includes(`<link rel="canonical" href="https://ninebrains.dev${path}" />`), path);
    assert.ok(
      sitemap.includes(`<loc>https://ninebrains.dev${path}</loc>`),
      `${path} not in sitemap`
    );
    assert.equal((html.match(/<h1>/g) ?? []).length, 1, `${path}: one h1`);
    assert.ok(html.includes('href="/compare/"'), `${path}: links back to the index`);
    // "Choose them" comes before "Choose Ninebrains": the page is not a rigged grid.
    assert.ok(html.indexOf('id="choose-ninebrains"') > html.indexOf(`id="choose-${c.slug}"`), path);
    assert.ok(html.includes('id="limitations"'), `${path}: limitations section`);
  }
  const index = readFileSync(join(DIST, 'compare', 'index.html'), 'utf8');
  for (const c of data)
    assert.ok(index.includes(`href="/compare/${c.slug}/"`), `index misses ${c.slug}`);
});

test('structured data parses and only claims what the page shows', () => {
  for (const c of data) {
    const html = readFileSync(join(DIST, 'compare', c.slug, 'index.html'), 'utf8');
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    const types = blocks.map((b) => JSON.parse(b[1])['@type']);
    assert.ok(types.includes('Article') && types.includes('BreadcrumbList'), c.slug);
    assert.equal(
      types.includes('FAQPage'),
      html.includes('id="faq"'),
      `${c.slug}: FAQ schema without FAQ`
    );
  }
});

const base = {
  slug: 'x',
  name: 'X',
  url: 'https://x.dev',
  hosts: ['x.dev', 'github.com/xorg'],
  checked: '2026-11-13',
  published: '2026-11-13',
  title: 't',
  description: 'd',
  answer: Array(45).fill('word').join(' '),
  chooseUs: ['a'],
  chooseThem: [{ text: 't', source: 'https://x.dev/docs' }],
  cells: { what: { text: 'w', source: 'https://github.com/xorg/x' } },
};

test('the validator accepts sources on the competitor’s own site and repos', () => {
  assert.doesNotThrow(() => validate(structuredClone(base)));
});

test('the validator refuses a claim sourced anywhere else', () => {
  const blog = structuredClone(base);
  blog.cells.what.source = 'https://someblog.com/x-review';
  assert.throws(() => validate(blog), /not their own docs/);
  // A shared host is not a loophole: another owner's repo on github.com is not their docs.
  const other = structuredClone(base);
  other.cells.what.source = 'https://github.com/someoneelse/x';
  assert.throws(() => validate(other), /not their own docs/);
  const unsourced = structuredClone(base);
  delete unsourced.chooseThem[0].source;
  assert.throws(() => validate(unsourced), /no source/);
});

test('the validator refuses banned claims and an answer outside 40-70 words', () => {
  const banned = structuredClone(base);
  banned.chooseUs = ['Ninebrains proves the code is correct.'];
  assert.throws(() => validate(banned), /banned claim/);
  const short = structuredClone(base);
  short.answer = 'Too short.';
  assert.throws(() => validate(short), /needs 40-70/);
});
