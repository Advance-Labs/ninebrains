# Brand

Ninebrains is black and white. The mark carries no colour of its own, the app's accent is a
monochrome ramp, and the docs follow both. Colour in the product means something: a gate failed,
a test is red, a diff added a line. Brand colour would compete with that.

## The mark

Nine squares in a 3×3 grid, the centre one larger and solid: one central brain plus eight arm
brains, the octopus the name comes from. It is drawn as hard-edged geometry with no gradient, so
it still reads at a 16 px favicon.

`tooling/brand/glyph.mjs` is the single source of truth for the geometry.
`apps/emdash-desktop/src/core/primitives/app-identity/browser/emdash-logo.tsx` draws the same grid
in React for in-app use, including the wordmark lockup. **Change both together.**

## Regenerating the assets

```bash
pnpm brand          # rewrite every generated asset
pnpm brand --check  # fail if a generated SVG is out of date (CI-friendly)
```

`pnpm brand` writes:

| Asset | What it is |
|---|---|
| `docs/brand/ninebrains-mark.svg` | The mark on its black tile. Used by the README header. |
| `docs/brand/ninebrains-glyph.svg` | The glyph alone, `currentColor`, for embedding. |
| `apps/docs/public/favicon.svg` | The docs site logo and favicon (one file serves both). |
| `…/images/emdash/emdash.png`, `.icns` | The packaged app icon: white glyph on a black tile. |
| `…/images/emdash/emdash-canary.png`, `.icns` | Canary: the same tile wearing a ring. |
| `…/images/emdash/emdash-dev.png` | Dev: inverted, so the build you are working on is obvious. |
| `…/images/emdash/icon-light.png` | The welcome screen's icon, flattened (no alpha). |
| `…/images/emdash/trayTemplate*.png` | macOS menu-bar template images: black glyph plus alpha. |
| `apps/emdash-desktop/build/dmg-background.tiff` | The installer window's arrow, 1x and 2x in one TIFF. |

Rasterising needs Chromium, which comes with the repo's Playwright. `.icns` and the DMG TIFF need
macOS (`iconutil`, `tiffutil`); on other platforms those steps are skipped and the committed files
stand.

`apps/emdash-desktop/src/assets/images/ytbanner.webp` is not generated. It is the welcome screen's
backdrop, desaturated once from the colour original (`grayscale(1) contrast(1.08)`), and it sits at
40% opacity behind a gradient mask.

## Colour

The palette is the app's own neutral ramp; there is no separate brand palette.

| Use | Light | Dark |
|---|---|---|
| Tile / primary button | `#171717` | `#fafafa` |
| Text on it | `#ffffff` | `#000000` |
| Focused lane border (`accent.8`) | `#737373` | `#8a8a8a` |
| Selected row (`accent.3`) | `#f0f0f0` | `#1c1c1c` |

These live in `packages/theme/src/themes/{light,dark}.theme.ts` as an explicit `scales.accent`
ramp rather than a generated hue, because the accent is no longer a hue. The theme's APCA test
guards them: `accent.7` is in the text zone and has to clear 15 Lc against the background, which
is why the dark border step is `#555555` and not something quieter.

The other bundled themes (Solarized, and anything a user adds) keep their own colour. Only the
default light and dark themes are monochrome.

## Rules

- Never add a brand colour. If something needs to stand out, use weight, size or the neutral ramp.
- Colour is reserved for state: pass/fail, diff add/remove, syntax highlighting.
- The mark is never stretched, rotated, or redrawn by hand. Regenerate it.
- On a photo or busy backdrop, put the mark on its tile rather than knocking it out.
