# @ninebrains/site

The landing page at [ninebrains.dev](https://ninebrains.dev). One static page, no
framework, and a build that is a file copy.

```bash
pnpm --filter @ninebrains/site dev      # rebuild on change
pnpm --filter @ninebrains/site preview  # build, then serve dist on :4330
pnpm --filter @ninebrains/site test     # the head tags, the assets, the alt text
```

## What is here

| File | What it does |
|---|---|
| `src/index.html` | The page. The head carries the canonical URL, the og/twitter tags and the `SoftwareApplication` JSON-LD. |
| `src/styles.css` | Black and white, per `docs/brand/README.md`. No brand colour: colour in this product means state. |
| `src/intro.js` | The 3D intro: nine cubes assembling into the mark, in hand-written WebGL. No library. |
| `src/site.js` | Runs the intro, then reveals sections on scroll. |
| `build.mjs` | Copies `src/` to `dist/`, then pulls in the shared assets (brand card, favicon, screenshots) from the repo. |

## Two rules worth keeping

**The intro never gates the content.** Reduced motion, a missing WebGL context, or a thrown error
all land the reader on the page directly, and any click, key or scroll skips it. The reveals are
progressive enhancement: `site.js` adds `body.reveals` before it hides anything, so with no
JavaScript at all the page is simply there. A crawler sees the whole page either way.

**The screenshots are shared, not copied.** `build.mjs` reads them out of `docs/screenshots/`, so
they stay whatever the app actually renders. If a shot goes stale, regenerate it at the source
rather than editing a copy here — `build.mjs` fails loudly if one is missing.

## Deploying

Vercel project `ninebrains` (team `advancelabs`), Root Directory `apps/site`, connected to this
repository: a push to `main` deploys production, and a pull request gets a preview.

The canonical domain is `ninebrains.dev`, registered to Advance Labs Inc. through Cloudflare on
2026-09-25 and served from Cloudflare nameservers. Point it at this Vercel project with a
DNS-only (grey-cloud) record — proxying Cloudflare in front of Vercel breaks Vercel's
certificate issuance and gives you two CDNs in series for no benefit.

`/docs` and `/docs/*` are rewritten to the `ninebrains-docs` Vercel project
(`apps/docs`), so the documentation serves from this domain while staying its own deployment.
Astro emits `ninebrains.dev/docs/…` canonicals for it via `DOCS_SITE_URL` and `DOCS_BASE_PATH`.

`ninebrains.runs-on.dev` stays attached to the same Vercel project purely as a 301 redirect, so
the install URLs already published in release notes keep working. It is never a second live
surface: `vercel.json` redirects every request on that host, and the canonical tag on every page
points at `ninebrains.dev`. The subdomain remains claimed in the registry at
[zordhalo/runs-on.dev](https://github.com/zordhalo/runs-on.dev) so it cannot be taken over while
old links still point at it.
