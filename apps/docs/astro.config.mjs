// @ts-check
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, passthroughImageService } from 'astro/config';
import starlight from '@astrojs/starlight';
import { visit } from 'unist-util-visit';
import { hrefFor, routeFor } from './src/routes.mjs';

const SITE = process.env.DOCS_SITE_URL ?? 'https://docs.advancelabs.dev';
const REPO = 'https://github.com/Advance-Labs/ninebrains';

/**
 * `docs.advancelabs.dev` is the umbrella docs domain for every Advance Labs project, so this site
 * is mounted at its own path. Astro prefixes the links it generates, but not the root-absolute
 * hrefs the rewriter below produces, so those apply BASE themselves.
 */
const BASE = process.env.DOCS_BASE_PATH ?? '/ninebrains';
const DOCS_ROOT = fileURLToPath(new URL('../../docs/', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * The docs are written to read correctly on GitHub first, so they link to each other with real
 * relative paths (`gates.md`, `../THREAT-MODEL.md`) and out to source (`../../packages/gates-core`).
 * Rewrite both at build time: a published doc becomes its site route (with the trailing slash
 * Astro emits), and anything else becomes the file on GitHub.
 *
 * Astro caches rendered entries, so editing this function alone does not change the output. The
 * build script clears `.astro` for that reason.
 */
function rehypeRepoAwareLinks() {
  return (/** @type {any} */ tree, /** @type {any} */ file) => {
    const currentAbs = file.history?.[0] ?? file.path;
    if (!currentAbs) return;

    visit(tree, 'element', (/** @type {any} */ node) => {
      if (node.tagName !== 'a') return;
      const href = node.properties?.href;
      if (typeof href !== 'string' || !href) return;
      // Leave absolute URLs, mailto:, protocol-relative, root-absolute and pure anchors alone.
      if (/^([a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(href)) return;

      const [rawPath, hash] = href.split('#');
      if (!rawPath) return;
      const suffix = hash ? `#${hash}` : '';

      const targetAbs = path.resolve(path.dirname(currentAbs), rawPath);
      const rel = path.relative(DOCS_ROOT, targetAbs).split(path.sep).join('/');
      const id = rel.startsWith('..') ? null : routeFor(rel);
      if (id !== null) {
        node.properties.href = `${hrefFor(id, BASE)}${suffix}`;
        return;
      }

      const repoRel = path.relative(REPO_ROOT, targetAbs).split(path.sep).join('/');
      const kind = /\.[a-z0-9]+$/i.test(repoRel) ? 'blob' : 'tree';
      node.properties.href = `${REPO}/${kind}/main/${repoRel}${suffix}`;
    });
  };
}

/** Pages written for GitHub open with a `# Title`; Starlight already renders the title. */
function remarkDropLeadingH1() {
  return (/** @type {any} */ tree) => {
    const first = tree.children.find((/** @type {any} */ n) => n.type !== 'html');
    if (first?.type === 'heading' && first.depth === 1) {
      tree.children.splice(tree.children.indexOf(first), 1);
    }
  };
}

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'always',
  // No image processing: the site has no local images to optimise, and the default service pulls
  // in sharp, whose libvips binaries are LGPL-3.0 and would fail the repo's licence gate.
  image: { service: passthroughImageService() },
  markdown: {
    remarkPlugins: [remarkDropLeadingH1],
    rehypePlugins: [rehypeRepoAwareLinks],
  },
  integrations: [
    starlight({
      title: 'Ninebrains',
      description:
        'Open-source desktop workbench that runs parallel Claude Code and Codex lanes, each in its own git worktree, with a central Brain and independent verification gates.',
      lastUpdated: true,
      // Starlight resolves each entry's filePath against this URL. The content lives outside the
      // app, so filePath starts `../../`, which consumes two segments: ending the base at
      // `apps/docs/` lands on `/edit/main/docs/<file>.md`.
      editLink: { baseUrl: `${REPO}/edit/main/apps/docs/` },
      // The octopus mark from the app icon (drawn from LogoShapes in the desktop app), used as
      // both the header logo and the favicon so there is one copy.
      logo: { src: './public/favicon.svg', alt: 'Ninebrains' },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: REPO }],
      head: [
        { tag: 'meta', attrs: { property: 'og:site_name', content: 'Ninebrains Docs' } },
        {
          tag: 'meta',
          attrs: { name: 'robots', content: 'index, follow, max-snippet:-1, max-image-preview:large' },
        },
      ],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Overview', slug: 'index' },
            { label: 'Getting started', slug: 'getting-started' },
          ],
        },
        {
          label: 'Using Ninebrains',
          items: [
            { label: 'Lanes', slug: 'lanes' },
            { label: 'Brain and jobs', slug: 'brain-and-jobs' },
            { label: 'Planner', slug: 'planner' },
            { label: 'Verification gates', slug: 'gates' },
            { label: 'Packs', slug: 'packs' },
            { label: 'Unattended runs', slug: 'unattended-runs' },
            { label: 'Accounts', slug: 'accounts' },
            { label: 'Troubleshooting', slug: 'troubleshooting' },
          ],
        },
        {
          label: 'Security',
          items: [
            { label: 'Security overview', slug: 'security' },
            { label: 'Security policy', slug: 'security-policy' },
            { label: 'Threat model', slug: 'threat-model' },
          ],
        },
        {
          label: 'Contributing',
          items: [{ label: 'Architecture', slug: 'architecture' }],
        },
      ],
    }),
  ],
});
