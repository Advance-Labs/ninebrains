/**
 * The Ninebrains mark: nine squares in a 3x3 grid, the centre one larger and solid.
 *
 * One central brain plus eight arm brains, the same idea as the octopus the name comes from,
 * drawn as hard-edged geometry so it survives a 16px favicon. Everything is black and white:
 * the mark carries no colour of its own and inherits it from whatever it is drawn on.
 *
 * This file is the single source of truth for the geometry. `build-brand.mjs` renders every
 * shipped asset from it, and `emdash-logo.tsx` draws the same grid in React for in-app use.
 */

/** The glyph is drawn in a 70x70 box, centred on (35, 35), to match the logo's wordmark lockup. */
export const BOX = 70;
export const CENTRE = 35;

/** Grid metrics, in box units. */
export const GRID = {
  /** Centre-to-centre distance between neighbouring cells. */
  gap: 21,
  /** Side of each of the eight arm squares. */
  arm: 13,
  /** Side of the central square: larger, so the hierarchy reads as one brain plus eight. */
  core: 20,
  /** Corner rounding. Small enough to stay hard-edged, large enough to avoid sharp pixels. */
  radius: 2,
};

/** The nine cells, centre last so it paints over any overlap. */
export function cells({ gap, arm, core } = GRID) {
  const out = [];
  for (const dx of [-1, 0, 1]) {
    for (const dy of [-1, 0, 1]) {
      const isCore = dx === 0 && dy === 0;
      if (isCore) continue;
      const side = arm;
      out.push({ x: CENTRE + dx * gap - side / 2, y: CENTRE + dy * gap - side / 2, side });
    }
  }
  out.push({ x: CENTRE - core / 2, y: CENTRE - core / 2, side: core, core: true });
  return out;
}

/** The nine <rect>s as SVG markup, painted with `fill`. */
export function glyphShapes(fill = 'currentColor', metrics = GRID) {
  return cells(metrics)
    .map(
      ({ x, y, side }) =>
        `<rect x="${round(x)}" y="${round(y)}" width="${side}" height="${side}" rx="${metrics.radius}" fill="${fill}"/>`
    )
    .join('\n  ');
}

/** The glyph on its own, transparent, at `size` px. */
export function glyphSvg({ fill = '#000', size = 64 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${BOX} ${BOX}">
  ${glyphShapes(fill)}
</svg>`;
}

/**
 * The app-icon tile: the glyph centred on a flat rounded square. The 1024 canvas with an 824
 * tile and a 184 corner radius is the macOS icon grid the packaged icon already used.
 */
export function tileSvg({ fill = '#fff', background = '#000', size = 1024, ring = false } = {}) {
  const inset = 100;
  const side = 824;
  const scale = (side * 0.6) / BOX;
  const offset = inset + (side - BOX * scale) / 2;
  const outline = ring
    ? `\n  <rect x="${inset + 26}" y="${inset + 26}" width="${side - 52}" height="${side - 52}" rx="158" fill="none" stroke="${fill}" stroke-width="14"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <rect x="${inset}" y="${inset}" width="${side}" height="${side}" rx="184" fill="${background}"/>${outline}
  <g transform="translate(${round(offset)} ${round(offset)}) scale(${round(scale)})">
  ${glyphShapes(fill)}
  </g>
</svg>`;
}


/**
 * The social / README banner: 1280x640, the ratio GitHub, X and LinkedIn all crop to. Black
 * ground, the mark, the wordmark and one line of copy, with the nine-square motif tiled faintly
 * behind it so the card still reads as Ninebrains when it is scaled down in a timeline.
 */
export function bannerSvg({
  fill = '#ffffff',
  background = '#000000',
  tagline = 'Run a grid of coding agents. Nothing is done until a second agent proves it.',
  width = 1280,
  height = 640,
} = {}) {
  const glyph = 132;
  const scale = glyph / BOX;
  const left = 96;
  const markTop = height / 2 - 118;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <pattern id="motif" width="120" height="120" patternUnits="userSpaceOnUse">
      <g transform="scale(${round(56 / BOX)})" opacity="0.055">
        ${glyphShapes(fill)}
      </g>
    </pattern>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${background}" stop-opacity="1"/>
      <stop offset="1" stop-color="${background}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="${background}"/>
  <rect width="${width}" height="${height}" fill="url(#motif)"/>
  <rect width="${round(width * 0.72)}" height="${height}" fill="url(#fade)"/>
  <g transform="translate(${left} ${round(markTop)}) scale(${round(scale)})">
    ${glyphShapes(fill)}
  </g>
  <text x="${left}" y="${round(markTop + glyph + 96)}" fill="${fill}"
    font-family="'Inter Variable', Inter, -apple-system, system-ui, sans-serif"
    font-size="92" font-weight="600" letter-spacing="-2.5">ninebrains</text>
  <text x="${left}" y="${round(markTop + glyph + 152)}" fill="${fill}" opacity="0.62"
    font-family="'Inter Variable', Inter, -apple-system, system-ui, sans-serif"
    font-size="27" letter-spacing="-0.2">${tagline}</text>
</svg>`;
}

function round(n) {
  return Number(n.toFixed(3));
}
