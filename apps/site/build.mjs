/**
 * Builds the landing page: copy `src/` to `dist/`, then pull in the assets it shares with the
 * repo (the brand card, the favicon, the screenshots) so the page ships everything it renders.
 *
 *   node build.mjs           # build once
 *   node build.mjs --watch   # rebuild on change, for `pnpm dev`
 *
 * No bundler and no framework: the page is one HTML file, one stylesheet and two scripts, and the
 * 3D intro is hand-written WebGL. The whole build is a file copy on purpose.
 */
import { cpSync, existsSync, mkdirSync, rmSync, watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../..');
const SRC = join(HERE, 'src');
const DIST = join(HERE, 'dist');

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
  watch(SRC, { recursive: true }, () => {
    clearTimeout(queued);
    queued = setTimeout(() => {
      try {
        build();
      } catch (error) {
        console.error(`site: ${error.message}`);
      }
    }, 80);
  });
  console.log('site: watching src/');
}
