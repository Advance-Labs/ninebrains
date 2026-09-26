import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { checkSite, collectHrefs, collectIds } from './check-links.mjs';

const OPTIONS = { base: '/docs', site: 'https://ninebrains.dev' };
const dirs = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** @param {Record<string, string>} files dist-relative path -> HTML body */
function site(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'check-links-'));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), `<html><body>${body}</body></html>`);
  }
  return dir;
}

test('collects hrefs and ids, decoding entities', () => {
  const html = '<a class="x" href="/a/?b=1&amp;c=2">x</a><h2 id="one">1</h2><a name="two"></a>';
  assert.deepEqual(collectHrefs(html), ['/a/?b=1&c=2']);
  assert.deepEqual([...collectIds(html)], ['one', 'two']);
});

test('passes when every internal link and fragment resolves', () => {
  const dir = site({
    'index.html': '<a href="/docs/gates/#rigor">g</a><a href="gates/">rel</a><a href="#_top">top</a>',
    'gates/index.html': '<h2 id="rigor">Rigor</h2><a href="../">home</a><a href="#rigor">self</a>',
    'favicon.svg': '<svg/>',
  });
  writeFileSync(path.join(dir, 'gates/index.html'), '<h2 id="rigor"></h2><a href="/docs/favicon.svg">i</a>', { flag: 'a' });
  assert.deepEqual(checkSite(dir, OPTIONS), []);
});

test('reports a missing page, a missing fragment and a link outside the base', () => {
  const dir = site({
    'index.html':
      '<a href="/docs/nope/">a</a><a href="/docs/gates/#missing">b</a><a href="/elsewhere/">c</a>',
    'gates/index.html': '<h2 id="rigor"></h2>',
  });
  const errors = checkSite(dir, OPTIONS);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /nope.*no such page/);
  assert.match(errors[1], /no #missing/);
  assert.match(errors[2], /outside the site base/);
});

test('reports links into private repo files, and checks the site own absolute URLs', () => {
  const dir = site({
    'index.html': [
      '<a href="https://github.com/Advance-Labs/ninebrains/blob/main/docs/RELEASING.md">r</a>',
      '<a href="https://github.com/Advance-Labs/ninebrains/tree/main/packages/brain-mcp">t</a>',
      '<a href="https://example.com/page">ok</a>',
      '<a href="https://ninebrains.dev/docs/missing/">self</a>',
    ].join(''),
  });
  const errors = checkSite(dir, OPTIONS);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /blob.*private GitHub repo/);
  assert.match(errors[1], /tree.*private GitHub repo/);
  assert.match(errors[2], /missing.*no such page/);
});
