import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineCollection } from 'astro:content';
import type { Loader, LoaderContext } from 'astro/loaders';
import { glob } from 'astro/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { PUBLISHED_PATTERNS, routeFor } from './routes.mjs';

/**
 * Source the site from the repo's own `docs/` directory, not a copy under `src/content/docs`.
 * A duplicated docs tree is how documentation drifts: GitHub reads these files raw, Starlight
 * publishes the same files. Starlight's `docsLoader()` hardcodes its base, so this uses Astro's
 * `glob()` loader with `docsSchema()` (the pattern in systems/14-documentation-sites.md).
 */
const guideLoader = glob({
  base: '../../docs',
  pattern: PUBLISHED_PATTERNS,
  generateId: ({ entry }) => routeFor(entry) ?? entry,
});

/**
 * `SECURITY.md` and `THREAT-MODEL.md` are written for GitHub and carry no frontmatter, and
 * Starlight will not build a page without a `title`. Rather than edit files other people own,
 * take the title from the file's first `# heading` when frontmatter has none. The heading itself
 * is dropped from the rendered body by `remarkDropLeadingH1` in astro.config.mjs.
 */
/**
 * Site titles for the top-level docs. Their GitHub headings carry working notes (the threat model's
 * reads "… (plan task 6.4, done early)"), which do not belong in a page title or search snippet.
 */
const FIXED_TITLES: Record<string, string> = {
  'security-policy': 'Security policy',
  'threat-model': 'Threat model',
};

function withHeadingTitles(inner: Loader): Loader {
  return {
    name: 'ninebrains-docs',
    load: (context: LoaderContext) => {
      const root = fileURLToPath(context.config.root);
      const parseData: LoaderContext['parseData'] = (props) => {
        if (props.filePath && typeof props.data.title !== 'string') {
          const text = readFileSync(resolve(root, props.filePath), 'utf8');
          const heading = FIXED_TITLES[props.id] ?? /^#\s+(.+?)\s*$/m.exec(text)?.[1];
          if (heading) props = { ...props, data: { ...props.data, title: heading } };
        }
        return context.parseData(props);
      };
      return inner.load(
        new Proxy(context, {
          get: (target, key, receiver) =>
            key === 'parseData' ? parseData : Reflect.get(target, key, receiver),
        })
      );
    },
  };
}

export const collections = {
  docs: defineCollection({ loader: withHeadingTitles(guideLoader), schema: docsSchema() }),
};
