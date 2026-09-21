/**
 * The overlap audit: nothing on the landing page may collide.
 *
 *   pnpm --filter @ninebrains/site audit:overlap                 # every viewport, dark and light
 *   pnpm --filter @ninebrains/site audit:overlap -- --only 1440x900,390x844 --themes dark
 *   pnpm --filter @ninebrains/site audit:overlap -- --shots /tmp/shots   # plus a screenshot per scene
 *   pnpm --filter @ninebrains/site audit:overlap -- --fps                # frame rate at 1440x900
 *
 * Builds the site into a temp folder, serves it, and opens it in the workspace's Playwright
 * Chromium with `?debug=bounds`. At every viewport and theme it walks each scene (its entry frame
 * and four points through the run), each loop back to the entry frame, and each scene change
 * (sampled through the dissolve), and fails on:
 *   - any two things on screen overlapping by 1px or more, other than the allowed ones: the
 *     background field and dust, and what sits inside the demo window;
 *   - a cube, wire set or floor the framing let run past its safe rectangle (the scissor would
 *     cut it), or anything past the viewport edge;
 *   - clipped text: a label wider than its box, a clamped paragraph, the install command not
 *     whole at 1280px and wider;
 *   - page scroll (the page is one screen at every size);
 *   - a scene whose entry frame shows an empty pane, or a desktop scene with no cubes at all.
 *
 * Playwright is not a dependency of this package: the workspace hoists it (node-linker=hoisted)
 * for apps/emdash-desktop, and this script reuses that copy and its Chromium.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = dirname(HERE);

const VIEWPORTS = [
  '3440x1440',
  '2560x1440',
  '1920x1080',
  '1728x1117',
  '1600x600',
  '1512x982',
  '1440x900',
  '1366x768',
  '1280x720',
  '1181x820',
  '1180x820',
  '1024x768',
  '900x1000',
  '899x700',
  '768x1024',
  '481x900',
  '390x844',
  '360x640',
];
const SCENES = [
  '00 Overview',
  '01 Lanes',
  '02 The Brain',
  '03 Gates',
  '04 Planner',
  '05 Packs',
  '06 Freebuff',
];

function args() {
  const argv = process.argv.slice(2);
  const value = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? null : argv[i + 1];
  };
  return {
    only: value('only')?.split(',') ?? null,
    themes: value('themes')?.split(',') ?? ['dark', 'light'],
    shots: value('shots'),
    json: value('json'),
    fps: argv.includes('--fps'),
    concurrency: Number(value('concurrency') ?? 3),
  };
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function serve(root) {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(
      /^([/\\])+/,
      ''
    );
    let file = join(root, path || 'index.html');
    try {
      if (!file.startsWith(root)) throw new Error('outside the site');
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function openPage(browser, base, theme, vp) {
  const [width, height] = vp.split('x').map(Number);
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: theme,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  // No network beyond the local server: the Download tab's GitHub call is not under test.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await page.goto(`${base}/?debug=bounds`);
  await page.waitForFunction(() => window.__dbg && document.fonts.status === 'loaded');
  await page.waitForTimeout(1800); // the opening burst
  await page.addScriptTag({ content: readFileSync(join(HERE, 'overlap-probe.js'), 'utf8') });
  return { context, page, errors };
}

async function auditOne(browser, base, theme, vp, opts) {
  const { context, page, errors } = await openPage(browser, base, theme, vp);
  const webgl = await page.evaluate(() => Boolean(window.__dbg.stage()));
  const samples = await page.evaluate(() => window.__audit.run());
  if (opts.shots) {
    mkdirSync(opts.shots, { recursive: true });
    const durations = await page.evaluate(() => window.__dbg.durations);
    for (let s = 0; s < durations.length; s++) {
      await page.evaluate(
        ([i, t]) => {
          window.__dbg.seek(i, t);
          return window.__audit.settle();
        },
        [s, +(durations[s] * 0.6).toFixed(2)]
      );
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(opts.shots, `${theme}-${vp}-s0${s}.png`) });
    }
  }
  await context.close();
  return { theme, vp, webgl, samples, errors };
}

/** One finding per (theme, viewport, scene, what, with what, steady or moving). */
function findings(results) {
  const groups = new Map();
  const add = (r, sample, kind, a, b, detail) => {
    const moving = /loop|change/.test(sample.label) ? 'moving' : 'steady';
    const key = [r.theme, r.vp, sample.s, kind, a, b, moving].join('|');
    const g = groups.get(key) ?? {
      theme: r.theme,
      vp: r.vp,
      scene: SCENES[sample.s],
      kind,
      a,
      b,
      moving,
      at: [],
      detail,
    };
    if (g.at.length < 4) g.at.push(sample.label);
    groups.set(key, g);
  };
  for (const r of results) {
    const desktop = Number(r.vp.split('x')[0]) >= 900;
    if (!r.webgl) add(r, { s: 0, label: 'load' }, 'no-webgl', 'stage', '', 'WebGL2 unavailable');
    for (const e of r.errors) add(r, { s: 0, label: 'load' }, 'page-error', e.slice(0, 80), '', e);
    for (const sample of r.samples) {
      for (const p of sample.pairs) {
        const [a, b] = [p.a, p.b].sort();
        const kind =
          /^(cube|spark|wires|floor)/.test(a) || /^(cube|spark|wires|floor)/.test(b)
            ? 'overlap'
            : 'overlap-dom';
        add(r, sample, kind, a.replace(/\d+$/, ''), b.replace(/\d+$/, ''), `${p.w}x${p.h}px`);
      }
      for (const c of sample.cut)
        add(r, sample, 'framing-cut', c.name.replace(/\d+$/, ''), '', `${c.px}px`);
      for (const o of sample.offscreen)
        add(r, sample, 'offscreen', o.name, '', `${o.outX},${o.outY}px`);
      for (const o of sample.overflow)
        add(r, sample, 'clipped-text', o.el, o.text, `${o.ox}x${o.oy}px`);
      if (sample.scroll) add(r, sample, 'page-scroll', 'document', '', '');
      for (const e of sample.empty ?? []) add(r, sample, 'empty-entry', e, '', '');
      if (desktop && r.webgl && sample.cubes === 0 && !/change|loop/.test(sample.label)) {
        add(r, sample, 'no-cubes', 'stage', '', 'no safe rectangle');
      }
    }
  }
  return [...groups.values()];
}

async function measureFps(browser, base) {
  const { context, page } = await openPage(browser, base, 'dark', '1440x900');
  const out = [];
  for (let s = 0; s < SCENES.length; s++) {
    const fps = await page.evaluate(async (i) => {
      window.__dbg.seek(i, window.__dbg.entries[i]);
      window.__dbg.play();
      await new Promise((r) => setTimeout(r, 400));
      let n = 0;
      const start = performance.now();
      await new Promise((resolve) => {
        const step = () => {
          n++;
          if (performance.now() - start < 2500) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
      return (n * 1000) / (performance.now() - start);
    }, s);
    out.push(`${SCENES[s]}: ${fps.toFixed(1)} fps`);
  }
  await context.close();
  return out;
}

async function main() {
  const opts = args();
  const { chromium } = await import('playwright');
  const dist = mkdtempSync(join(tmpdir(), 'ninebrains-site-audit-'));
  execFileSync('node', [join(APP, 'build.mjs')], {
    env: { ...process.env, SITE_DIST: dist },
    stdio: 'ignore',
  });
  const server = await serve(dist);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
  });
  try {
    if (opts.fps) {
      for (const line of await measureFps(browser, base)) console.log(line);
      return;
    }
    const jobs = [];
    for (const theme of opts.themes) {
      for (const vp of opts.only ?? VIEWPORTS) jobs.push([theme, vp]);
    }
    const results = [];
    const started = Date.now();
    const worker = async () => {
      for (let job = jobs.shift(); job; job = jobs.shift()) {
        const r = await auditOne(browser, base, job[0], job[1], opts);
        const n = r.samples.length;
        console.log(`  ${job[0]} ${job[1]}: ${n} samples`);
        results.push(r);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));
    const found = findings(results);
    const samples = results.reduce((sum, r) => sum + r.samples.length, 0);
    const byKind = {};
    for (const f of found) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
    console.log(
      `\noverlap audit: ${results.length} viewport/theme runs, ${samples} samples, ${((Date.now() - started) / 1000).toFixed(0)}s`
    );
    if (opts.json) writeFileSync(opts.json, JSON.stringify({ findings: found, results }, null, 1));
    if (found.length === 0) {
      console.log('0 unintended overlaps, 0 clipped text, no page scroll, no empty entry frames.');
      return;
    }
    console.log(`${found.length} findings: ${JSON.stringify(byKind)}`);
    for (const f of found.slice(0, 200)) {
      console.log(
        `  ${f.kind.padEnd(13)} ${f.theme} ${f.vp.padEnd(9)} ${f.scene.padEnd(12)} ${f.a} ${f.b ? `x ${f.b} ` : ''}${f.detail} [${f.moving}: ${f.at.join(', ')}]`
      );
    }
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
    rmSync(dist, { recursive: true, force: true });
  }
}

await main();
