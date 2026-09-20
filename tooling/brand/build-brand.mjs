/**
 * Regenerates every shipped brand asset from `glyph.mjs`.
 *
 *   node tooling/brand/build-brand.mjs        # write the assets
 *   node tooling/brand/build-brand.mjs --check # fail if any asset is out of date (SVG only)
 *
 * Rasterising needs Chromium, which arrives with the repo's Playwright. The `.icns` step needs
 * macOS `iconutil`; on other platforms it is skipped with a note, and the committed file stands.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bannerSvg, glyphSvg, tileSvg } from './glyph.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ICONS = 'apps/emdash-desktop/src/assets/images/emdash';
const check = process.argv.includes('--check');

const BLACK = '#000000';
const WHITE = '#ffffff';

/** Every SVG we ship, and what it is for. */
const SVGS = {
  'docs/brand/ninebrains-mark.svg': tileSvg({ fill: WHITE, background: BLACK, size: 1024 }),
  'docs/brand/ninebrains-glyph.svg': glyphSvg({ fill: 'currentColor', size: 70 }),
  'apps/docs/public/favicon.svg': tileSvg({ fill: WHITE, background: BLACK, size: 1024 }),
  'docs/brand/ninebrains-banner.svg': bannerSvg(),
};

/** Rasters: [path, svg, size, opaque]. `opaque` flattens alpha for icons that need a solid tile. */
const PNGS = [
  [`${ICONS}/emdash.png`, tileSvg({ fill: WHITE, background: BLACK }), 1024, false],
  [`${ICONS}/icon-light.png`, tileSvg({ fill: WHITE, background: BLACK }), 1024, true],
  // Canary keeps the dark tile but wears a ring, so a canary build is obvious in the dock.
  [`${ICONS}/emdash-canary.png`, tileSvg({ fill: WHITE, background: BLACK, ring: true }), 1024, false],
  // Dev inverts, which is the fastest read of "this is the one I am building".
  [`${ICONS}/emdash-dev.png`, tileSvg({ fill: BLACK, background: WHITE }), 1024, false],
  // The README hero and social card, also used as the site's og:image.
  ['docs/brand/ninebrains-banner.png', bannerSvg(), 1280, 640, true],
  // macOS menu-bar template images: a black glyph plus alpha, recoloured by the OS.
  [`${ICONS}/trayTemplate.png`, glyphSvg({ fill: BLACK, size: 16 }), 16, false],
  [`${ICONS}/trayTemplate@2x.png`, glyphSvg({ fill: BLACK, size: 32 }), 32, false],
];

/** The two packaged macOS icons, built from the PNG tiles above. */
const ICNS = [
  [`${ICONS}/emdash.icns`, tileSvg({ fill: WHITE, background: BLACK })],
  [`${ICONS}/emdash-canary.icns`, tileSvg({ fill: WHITE, background: BLACK, ring: true })],
];

const ICNS_SIZES = [16, 32, 64, 128, 256, 512, 1024];

/**
 * The DMG window backdrop: the arrow between the app icon (x 132) and the Applications alias
 * (x 398) that electron-builder places at y 150. Flat neutral, no colour.
 */
function dmgSvg({ width = 530, height = 319 } = {}) {
  const y = 150;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 530 319">
  <rect width="530" height="319" fill="#fafafa"/>
  <g stroke="#171717" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.85">
    <line x1="221" y1="${y}" x2="305" y2="${y}"/>
    <polyline points="292,${y - 11} 305,${y} 292,${y + 11}"/>
  </g>
</svg>`;
}


async function main() {
  let stale = 0;
  for (const [rel, svg] of Object.entries(SVGS)) {
    const path = join(ROOT, rel);
    const body = `${svg}\n`;
    if (check) {
      const current = safeRead(path);
      if (current !== body) {
        console.error(`stale: ${rel}`);
        stale += 1;
      }
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
    console.log(`wrote ${rel}`);
  }
  if (check) {
    // Rasters are binary and rebuilt on demand; --check only guards the text assets.
    if (stale > 0) process.exit(1);
    console.log('brand SVGs are up to date');
    return;
  }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    for (const [rel, svg, size, opaqueOrHeight, maybeOpaque] of PNGS) {
      const wide = typeof maybeOpaque === 'boolean';
      const height = wide ? opaqueOrHeight : size;
      const opaque = wide ? maybeOpaque : opaqueOrHeight;
      await (wide
        ? rasteriseBox(browser, svg, join(ROOT, rel), size, height)
        : rasterise(browser, svg, join(ROOT, rel), size, opaque));
      console.log(`wrote ${rel}`);
    }
    for (const [rel, svg] of ICNS) {
      await buildIcns(browser, svg, join(ROOT, rel));
    }
    await buildDmgBackground(browser);
  } finally {
    await browser.close();
  }
}

/** Screenshots one SVG at exactly `size` px. Transparent unless `opaque`. */
async function rasterise(browser, svg, outPath, size, opaque) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const encoded = Buffer.from(svg, 'utf8').toString('base64');
  await page.setContent(
    `<style>html,body{margin:0;padding:0;${opaque ? 'background:#fff;' : ''}}
     img{display:block;width:${size}px;height:${size}px}</style>
     <img src="data:image/svg+xml;base64,${encoded}">`
  );
  await page.waitForLoadState('networkidle');
  mkdirSync(dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath, omitBackground: !opaque });
  await page.close();
}

/** Builds an .icns through a temporary .iconset, the way macOS expects. */
async function buildIcns(browser, svg, outPath) {
  if (process.platform !== 'darwin') {
    console.log(`skipped ${rel(outPath)} (iconutil is macOS only)`);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'ninebrains-icns-'));
  const set = join(dir, 'icon.iconset');
  mkdirSync(set);
  try {
    for (const size of ICNS_SIZES) {
      await rasterise(browser, svg, join(set, `icon_${size}x${size}.png`), size, false);
      // Retina slots are the same pixels as the next size up, under the @2x name.
      if (size > 16) {
        await rasterise(browser, svg, join(set, `icon_${size / 2}x${size / 2}@2x.png`), size, false);
      }
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', outPath]);
    console.log(`wrote ${rel(outPath)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The DMG backdrop ships as one TIFF carrying both the 1x and 2x representations. */
async function buildDmgBackground(browser) {
  const out = join(ROOT, 'apps/emdash-desktop/build/dmg-background.tiff');
  if (process.platform !== 'darwin') {
    console.log(`skipped ${rel(out)} (tiffutil is macOS only)`);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'ninebrains-dmg-'));
  try {
    const one = join(dir, 'dmg.png');
    const two = join(dir, 'dmg@2x.png');
    await rasteriseBox(browser, dmgSvg(), one, 530, 319);
    await rasteriseBox(browser, dmgSvg(), two, 1060, 638);
    const oneTiff = join(dir, 'dmg.tiff');
    const twoTiff = join(dir, 'dmg@2x.tiff');
    execFileSync('sips', ['-s', 'format', 'tiff', one, '--out', oneTiff], { stdio: 'ignore' });
    execFileSync('sips', ['-s', 'format', 'tiff', two, '--out', twoTiff], { stdio: 'ignore' });
    execFileSync('tiffutil', ['-cathidpicheck', oneTiff, twoTiff, '-out', out]);
    console.log(`wrote ${rel(out)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Like `rasterise`, but for art that is not square. */
async function rasteriseBox(browser, svg, outPath, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const encoded = Buffer.from(svg, 'utf8').toString('base64');
  await page.setContent(
    `<style>html,body{margin:0;padding:0}img{display:block;width:${width}px;height:${height}px}</style>
     <img src="data:image/svg+xml;base64,${encoded}">`
  );
  await page.waitForLoadState('networkidle');
  mkdirSync(dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath });
  await page.close();
}

const rel = (path) => path.slice(ROOT.length);
const safeRead = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

await main();
