// @ts-check
/**
 * One map from a file under the repo's `docs/` directory to its route on the docs site. Both the
 * content loader (`content.config.ts`) and the link rewriter (`astro.config.mjs`) use it, so a page
 * id and every link to that page can never disagree.
 *
 * Published: the user guide (`docs/guide/**`) at the site root, plus the two security documents.
 * Everything else under `docs/` (SEAMS, FORK, the spike notes, ADRs) stays on GitHub, and links to
 * it are rewritten to the file on GitHub.
 */

/** Glob patterns, relative to `docs/`, for the files the site publishes. */
export const PUBLISHED_PATTERNS = ['guide/**/[^_]*.md', 'SECURITY.md', 'THREAT-MODEL.md'];

/**
 * The two security docs live at the top of `docs/`. `SECURITY.md` would otherwise collide with the
 * guide's own `security.md` summary, so it gets a longer slug.
 */
const TOP_LEVEL = new Map([
  ['SECURITY', 'security-policy'],
  ['THREAT-MODEL', 'threat-model'],
]);

/**
 * @param {string} rel path relative to `docs/`, forward slashes, with its extension
 * @returns {string | null} the page id (`index` for the home page), or null if unpublished
 */
export function routeFor(rel) {
  if (!/\.mdx?$/i.test(rel)) return null;
  const noExt = rel.replace(/\.mdx?$/i, '');
  const top = TOP_LEVEL.get(noExt);
  if (top) return top;
  if (!noExt.startsWith('guide/')) return null;
  const inGuide = noExt.slice('guide/'.length);
  if (inGuide.split('/').some((part) => part.startsWith('_'))) return null;
  // guide/README.md is both GitHub's folder landing page and the site's home page.
  return inGuide.toLowerCase().replace(/(^|\/)readme$/, '$1index');
}

/**
 * @param {string} id a page id from routeFor
 * @param {string} base the site base path, e.g. `/ninebrains`
 */
export function hrefFor(id, base) {
  const slug = id.replace(/(^|\/)index$/, '');
  return slug === '' ? `${base}/` : `${base}/${slug}/`;
}
