/**
 * Builds the landing page: copy `src/` to `dist/`, then pull in the assets it shares with the
 * repo (the brand card, the favicon, the screenshots) so the page ships everything it renders.
 *
 *   node build.mjs           # build once
 *   node build.mjs --watch   # rebuild on change, for `pnpm dev`
 *
 * No bundler and no framework: the page is one HTML file, one stylesheet and two scripts, and the
 * 3D intro is hand-written WebGL. `public/` (the install scripts) is copied to the site root as-is.
 * The whole build is a file copy on purpose.
 */
import { cpSync, existsSync, mkdirSync, rmSync, watch } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../..');
const SRC = join(HERE, 'src');
/** Files served as-is at the site root, like the installers at `/install` and `/install.ps1`. */
const PUBLIC = join(HERE, 'public');
/** `SITE_DIST` lets a test build into its own folder without racing the other build test. */
const DIST = process.env.SITE_DIST ? resolve(process.env.SITE_DIST) : join(HERE, 'dist');

/** Repo assets the page renders, copied to `dist/assets/<name>`. */
const SHARED = {
  'ninebrains-banner.png': 'docs/brand/ninebrains-banner.png',
  'favicon.svg': 'apps/docs/public/favicon.svg',
  'lanes-grid.png': 'docs/screenshots/lanes-grid-1440.png',
  'brain-drawer.png': 'docs/screenshots/brain-drawer-plan-1440.png',
  'gates-verification.png': 'docs/screenshots/gates-verification-1440.png',
  'planner.png': 'docs/screenshots/planner-1440.png',
};

function build() {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(join(DIST, 'assets'), { recursive: true });
  cpSync(SRC, DIST, { recursive: true });
  if (existsSync(PUBLIC)) cpSync(PUBLIC, DIST, { recursive: true });

  for (const [name, from] of Object.entries(SHARED)) {
    const source = join(REPO, from);
    if (!existsSync(source)) throw new Error(`site: missing asset ${from}`);
    cpSync(source, join(DIST, 'assets', name));
  }
  console.log(`site: built ${DIST}`);
}

build();

if (process.argv.includes('--watch')) {
  let queued = null;
  const rebuild = () => {
    clearTimeout(queued);
    queued = setTimeout(() => {
      try {
        build();
      } catch (error) {
        console.error(`site: ${error.message}`);
      }
    }, 80);
  };
  watch(SRC, { recursive: true }, rebuild);
  if (existsSync(PUBLIC)) watch(PUBLIC, { recursive: true }, rebuild);
  console.log('site: watching src/ and public/');
}
