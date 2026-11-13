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
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderIndex, renderPage } from './compare.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../..');
const SRC = join(HERE, 'src');
/** Files served as-is at the site root, like the installers at `/install` and `/install.ps1`. */
const PUBLIC = join(HERE, 'public');
/**
 * `SITE_DIST` lets a test build into its own folder without racing the other build test. The build
 * starts by deleting DIST, so it must be inside the system temp folder or this app's folder.
 */
const DIST = resolveDist(process.env.SITE_DIST);

function resolveDist(requested) {
  if (!requested) return join(HERE, 'dist');
  const dist = resolve(requested);
  // Compare against the root as given and as resolved: macOS's temp folder sits behind a symlink.
  const inside = (root) =>
    [root, realpathSync(root)].some((base) => {
      const rel = relative(base, dist);
      return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
    });
  // Inside the app folder only a dist* folder, so src/ or public/ can never be the target.
  const inApp = inside(HERE) && relative(HERE, dist).split(/[\\/]/)[0].startsWith('dist');
  if (!inside(tmpdir()) && !inApp) {
    throw new Error(
      `site: SITE_DIST must be inside ${tmpdir()} or ${join(HERE, 'dist*')}, got ${dist}`
    );
  }
  return dist;
}

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

  // The structured data and the verify dialog name the release. Stamp it from the app's own
  // package.json so search engines and answer engines never quote a release we shipped months ago.
  const { version } = JSON.parse(
    readFileSync(join(REPO, 'apps/emdash-desktop/package.json'), 'utf8')
  );
  // It lands inside a JSON-LD script, so anything but plain semver fails the build.
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
    throw new Error(`site: refusing to stamp version ${JSON.stringify(version)}`);
  }
  const page = join(DIST, 'index.html');
  writeFileSync(
    page,
    readFileSync(page, 'utf8').replaceAll('__VERSION__', () => version)
  );
  buildCompare();
  console.log(`site: built ${DIST}`);
}

/** One page per `compare/*.json`, an index, and their sitemap entries. See compare.mjs. */
function buildCompare() {
  const dir = join(HERE, 'compare');
  const all = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const c of all) {
    mkdirSync(join(DIST, 'compare', c.slug), { recursive: true });
    writeFileSync(join(DIST, 'compare', c.slug, 'index.html'), renderPage(c));
  }
  writeFileSync(join(DIST, 'compare', 'index.html'), renderIndex(all));
  const urls = ['/compare/', ...all.map((c) => `/compare/${c.slug}/`)]
    .map((p) => `  <url><loc>https://ninebrains.dev${p}</loc></url>`)
    .join('\n');
  const sitemap = join(DIST, 'sitemap.xml');
  writeFileSync(sitemap, readFileSync(sitemap, 'utf8').replace('</urlset>', `${urls}\n</urlset>`));
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
  watch(join(HERE, 'compare'), { recursive: true }, rebuild);
  if (existsSync(PUBLIC)) watch(PUBLIC, { recursive: true }, rebuild);
  console.log('site: watching src/ and public/');
}
