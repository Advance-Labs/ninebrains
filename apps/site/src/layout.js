/**
 * Where the nine cubes are allowed to draw.
 *
 * The stage canvas sits behind the whole page, so nothing stops a cube from drawing under the
 * headline or the demo window except this: every time the layout can change (resize, fonts
 * landing, a scene change) the page measures the boxes that must stay clear and hands the stage
 * one safe rectangle. The stage then frames each scene's whole timeline inside it, so no cube,
 * wire or floor tile can project outside it.
 *
 * The candidate is the active panel's `[data-slot]` box (CSS decides roughly where the cubes
 * live at each breakpoint). Each obstacle that intrudes, grown by PAD, is cut around, keeping the
 * side where the scene's arrangement would draw largest.
 */

/** Clearance between the cubes and anything else on the page, in CSS px (half on phones). */
export const PAD = 24;
/** Below this the arrangement would be a smudge; show no cubes at all rather than a half state. */
export const MIN_SIDE = 72;

/** Text and chrome inside a panel that the cubes must never touch. */
const PANEL_OBSTACLES = [
  '.eyebrow',
  '.kicker',
  'h1',
  'h2',
  '.lede',
  '.feature-copy',
  '.install',
  '.works-with',
  '.stats',
];

function box(el) {
  if (!el) return null;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return null;
  const b = el.getBoundingClientRect();
  if (b.width < 1 || b.height < 1) return null;
  return { x: b.left, y: b.top, w: b.width, h: b.height };
}

const grow = (r, by) => ({ x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 });

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The four pieces of `r` left beside `o`: left of it, right of it, above it, below it. */
function sides(r, o) {
  return [
    { x: r.x, y: r.y, w: o.x - r.x, h: r.h },
    { x: o.x + o.w, y: r.y, w: r.x + r.w - (o.x + o.w), h: r.h },
    { x: r.x, y: r.y, w: r.w, h: o.y - r.y },
    { x: r.x, y: o.y + o.h, w: r.w, h: r.y + r.h - (o.y + o.h) },
  ].filter((s) => s.w > 0 && s.h > 0);
}

/**
 * The best rectangle inside `r` that clears every obstacle. Tries every way of cutting round
 * each one (there are only a handful), and scores a result by how large an arrangement of the
 * given width:height `aspect` would draw in it, then by area.
 */
function clear(r, obstacles, aspect, depth = 0) {
  const hit = obstacles.find((o) => overlaps(r, o));
  if (!hit) return r;
  if (depth > 8) return null;
  const score = (s) => (s ? Math.min(s.w / aspect, s.h) * 1e6 + s.w * s.h : -1);
  let best = null;
  for (const side of sides(r, hit)) {
    const found = clear(side, obstacles, aspect, depth + 1);
    if (score(found) > score(best)) best = found;
  }
  return best;
}

/**
 * Where the demo window will sit once its entry animation settles. The live box is no use while
 * the window is still flying in from translateZ(-220px), so this works from the fitted scale:
 * the pane is centred in its `.win-fit` box, and the tilt plus pointer parallax can push the
 * projected quad a few percent past the flat size.
 */
function windowBox(panel, mobile) {
  const fit = panel.querySelector('[data-fit]');
  const win = fit?.querySelector('.win');
  const outer = box(fit);
  if (!win || !outer) return null;
  if (mobile) return outer;
  const scale = Number.parseFloat(fit.style.getPropertyValue('--s')) || 1;
  const w = win.offsetWidth * scale * 1.07;
  const h = win.offsetHeight * scale * 1.1;
  return { x: outer.x + (outer.w - w) / 2, y: outer.y + (outer.h - h) / 2, w, h };
}

/**
 * The rectangle (viewport CSS px) the cubes may use for this panel, or null for none.
 * `mobile` is the stacked layout, where the window fills its own row; `aspect` is the scene's
 * on-screen width:height, so a wide arrangement gets a wide strip and a tall one a column;
 * `anchorTo` says where the arrangement settles when the rectangle has room to spare.
 */
export function safeRect(panel, { mobile = false, aspect = 1, anchorTo = 'center' } = {}) {
  const slot = panel?.querySelector('[data-slot]');
  let rect = box(slot);
  if (!rect) return null;

  const obstacles = [];
  for (const selector of PANEL_OBSTACLES) {
    for (const el of panel.querySelectorAll(selector)) {
      const b = box(el);
      if (b) obstacles.push(b);
    }
  }
  const win = windowBox(panel, mobile);
  if (win) obstacles.push(win);
  for (const el of document.querySelectorAll('body > .nav, body > footer, .rail')) {
    const b = box(el);
    if (b) obstacles.push(b);
  }

  // Stay inside the viewport too.
  const pad = mobile ? PAD / 2 : PAD;
  const view = { x: pad, y: pad, w: window.innerWidth - pad * 2, h: window.innerHeight - pad * 2 };
  rect = intersect(rect, view);

  if (rect)
    rect = clear(
      rect,
      obstacles.map((o) => grow(o, pad)),
      aspect
    );
  if (!rect || Math.min(rect.w, rect.h) < MIN_SIDE) return null;
  return anchor(rect, aspect, anchorTo);
}

/**
 * Trims the spare side off a rectangle so the arrangement sits where it reads as part of the
 * layout: `start` hangs it from the top-left (a feature's diorama right under its copy), `center`
 * keeps it in the middle (the overview's mark, a phone's row).
 */
function anchor(rect, aspect, to) {
  const slack = 1.06;
  const w = Math.min(rect.w, rect.h * aspect * slack);
  const h = Math.min(rect.h, (rect.w / aspect) * slack);
  if (to === 'start') return { x: rect.x, y: rect.y, w, h };
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
}

function intersect(a, b) {
  if (!a) return null;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}
