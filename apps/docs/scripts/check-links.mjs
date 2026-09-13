// @ts-check
/**
 * Link checker for the built docs site. No dependencies: it reads the HTML Astro wrote to `dist/`.
 *
 * For every `<a href>` on every page:
 * - a link that stays on this site (relative, root-absolute under the base path, or the site's own
 *   absolute URL) must point at a page or file that exists, and its `#fragment` at an element id
 *   on that page;
 * - a link into the GitHub repo's files (`/blob/` or `/tree/`) is an error. The repo is private,
 *   so readers get a 404. The markdown rewriter in astro.config.mjs produces these for any link to
 *   a file outside the published docs, so this is what catches such a link;
 * - other external links are not fetched: the build must not depend on the network.
 *
 * Usage: `node scripts/check-links.mjs [distDir]`. Exits 1 and lists every broken link.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directories Astro and Pagefind emit that hold no pages. */
const SKIP_DIRS = new Set(['_astro', 'pagefind']);

/** Starlight's "back to top" anchor targets the page itself, not an element. */
const PAGE_TOP = '_top';

export const PRIVATE_REPO_FILE = /^https?:\/\/github\.com\/Advance-Labs\/ninebrains\/(blob|tree)\//i;

/** @param {string} value */
function decodeEntities(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/** @param {string} value */
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** @param {string} html @returns {string[]} */
export function collectHrefs(html) {
  const hrefs = [];
  for (const match of html.matchAll(/<a\b[^>]*?\shref=(?:"([^"]*)"|'([^']*)')/gi)) {
    hrefs.push(decodeEntities(match[1] ?? match[2] ?? ''));
  }
  return hrefs;
}

/** @param {string} html @returns {Set<string>} */
export function collectIds(html) {
  const ids = new Set();
  for (const match of html.matchAll(/<[a-z][^>]*?\s(?:id|name)=(?:"([^"]*)"|'([^']*)')/gi)) {
    ids.add(decodeEntities(match[1] ?? match[2] ?? ''));
  }
  return ids;
}

/** @param {string} dir @returns {string[]} absolute paths of every .html file */
function htmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...htmlFiles(full));
    } else if (entry.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * @param {string} distDir
 * @param {{ base: string, site: string }} options base path such as `/ninebrains`; site origin
 * @returns {string[]} one message per broken link
 */
export function checkSite(distDir, { base, site }) {
  const root = path.resolve(distDir);
  const basePath = base.replace(/\/+$/, '');
  const siteOrigin = site.replace(/\/+$/, '');
  /** @type {Map<string, Set<string>>} */
  const idCache = new Map();
  const idsOf = (/** @type {string} */ file) => {
    let ids = idCache.get(file);
    if (!ids) {
      ids = collectIds(readFileSync(file, 'utf8'));
      idCache.set(file, ids);
    }
    return ids;
  };

  /** Maps a site path (without the base) to the file that serves it, or null. */
  const fileFor = (/** @type {string} */ sitePath) => {
    const rel = safeDecode(sitePath).replace(/^\/+/, '');
    const candidates = rel === '' || rel.endsWith('/')
      ? [path.join(root, rel, 'index.html')]
      : [path.join(root, rel), path.join(root, rel, 'index.html'), path.join(root, `${rel}.html`)];
    return candidates.find((c) => c.startsWith(root) && existsSync(c) && statSync(c).isFile()) ?? null;
  };

  const errors = [];
  for (const file of htmlFiles(root)) {
    const relFile = path.relative(root, file).split(path.sep).join('/');
    const pageDir = relFile.endsWith('index.html') ? relFile.slice(0, -'index.html'.length) : relFile;
    const pageUrl = `http://site.invalid${basePath}/${pageDir}`;
    const report = (/** @type {string} */ href, /** @type {string} */ reason) =>
      errors.push(`${relFile}: ${href} (${reason})`);

    for (const href of collectHrefs(readFileSync(file, 'utf8'))) {
      if (href === '' || href === '#') continue;
      let target = href;
      if (target.startsWith(`${siteOrigin}${basePath}/`) || target === `${siteOrigin}${basePath}`) {
        target = target.slice(siteOrigin.length);
      } else if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) {
        if (PRIVATE_REPO_FILE.test(target)) {
          report(href, 'links to a file in the private GitHub repo; link a site page instead');
        }
        continue;
      }

      const url = new URL(target, pageUrl);
      const fragment = safeDecode(url.hash.slice(1));
      if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
        report(href, `outside the site base ${basePath}/`);
        continue;
      }
      const targetFile = fileFor(url.pathname.slice(basePath.length));
      if (!targetFile) {
        report(href, 'no such page');
        continue;
      }
      if (fragment && fragment !== PAGE_TOP && targetFile.endsWith('.html')) {
        if (!idsOf(targetFile).has(fragment)) report(href, `no #${fragment} on that page`);
      }
    }
  }
  return errors;
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const distDir = process.argv[2] ?? path.join(here, '..', 'dist');
  if (!existsSync(distDir)) {
    console.error(`check-links: ${distDir} does not exist. Run astro build first.`);
    process.exit(1);
  }
  const errors = checkSite(distDir, {
    base: process.env.DOCS_BASE_PATH ?? '/ninebrains',
    site: process.env.DOCS_SITE_URL ?? 'https://docs.advancelabs.dev',
  });
  if (errors.length > 0) {
    console.error(`check-links: ${errors.length} broken link(s):`);
    for (const error of errors) console.error(`  ${error}`);
    process.exit(1);
  }
  console.log('check-links: all links resolve.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
