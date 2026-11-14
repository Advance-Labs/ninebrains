/**
 * The background for the reading pages (/compare/): a 2D-canvas port of the homepage stage's field
 * and dust (stage.js), so the eclipse holds still when a page transition swaps the two pages.
 *
 * Same geometry (stage.js `limb()`): a huge circle whose centre sits far up and to the left, its
 * edge crossing the bottom-right corner. Same field: outside the circle a bright edge, then three
 * dithered tiers of grey falling away (sky, mid, far), drawn once per resize in 2px cells. Same
 * dust: specks that sink slowly inward from the rim, each to its own depth, wandering a little.
 *
 * When the page arrives by a view transition (transition.js sets `nbSurgeAt`) the eclipse surges
 * with the sweeping text: the rim moves in toward it, glows, and the dust brightens and quickens.
 *
 * Decoration only: no WebGL, no dependency. The loop stops while the tab is hidden; under reduced
 * motion it draws one still frame. Any failure leaves the black page.
 */

const canvas = document.getElementById('flow');
const ctx = canvas && canvas.getContext('2d');

if (ctx) {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CELL = 2;
  /** far, mid, sky: the stage's three inks, darkest first. */
  const GREYS = ['#3a3a3a', '#8c8c8c', '#e6e6e6'];
  const rim = document.createElement('canvas');
  const rctx = rim.getContext('2d');
  let W = 0;
  let H = 0;
  let R = 0;
  let cx = 0;
  let cy = 0;
  let scale = 1;
  let arc = [0, 0];
  /** Unit vector from the rim's middle toward the circle's centre: up and to the left. */
  let inward = [0, 0];
  let dust = [];
  let last = 0;
  let frame = 0;

  /** 0 to 1 and back over 1.2s after a view-transition arrival; same envelope as stage.js. */
  const surge = (now) => {
    const at = globalThis.nbSurgeAt;
    if (still || at == null) return 0;
    const k = (now - at) / 1200;
    if (k <= 0 || k >= 1) return 0;
    const e = k < 0.22 ? k / 0.22 : 1 - (k - 0.22) / 0.78;
    return e * e * (3 - 2 * e);
  };

  /** One speck, seeded as stage.js's dust vertex shader seeds it. */
  const speck = () => {
    const maxDepth = Math.max(420 * scale * (1 - Math.cbrt(Math.random())), 14 * scale);
    return {
      theta: arc[0] + Math.random() * (arc[1] - arc[0]),
      maxDepth,
      speed: (0.14 + Math.random() * 0.22) * scale,
      depth: Math.random() * maxDepth,
      freq: 0.004 + Math.random() * 0.011,
      phase: Math.random() * Math.PI * 2,
    };
  };

  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    W = innerWidth;
    H = innerHeight;
    for (const c of [canvas, rim]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // stage.js limb(), in y-down canvas space.
    scale = Math.min(Math.max(Math.sqrt((W * H) / (1920 * 1080)), 0.5), 2);
    const portrait = H > W;
    const p1 = [W * (portrait ? 0.3 : 0.52), H];
    const p2 = [W, H * (portrait ? 0.62 : 0.44)];
    const dir = [p2[0] - p1[0], p2[1] - p1[1]];
    const len = Math.hypot(dir[0], dir[1]);
    const normal = [-dir[1] / len, dir[0] / len];
    const reach = Math.max(W, H) * 1.05;
    const sign = normal[0] < 0 ? 1 : -1;
    cx = (p1[0] + p2[0]) / 2 + normal[0] * reach * sign;
    cy = (p1[1] + p2[1]) / 2 + normal[1] * reach * sign;
    R = Math.hypot(p1[0] - cx, p1[1] - cy);
    const theta = (p) => Math.atan2(p[1] - cy, p[0] - cx);
    const [a, b] = [theta(p1), theta(p2)].sort((x, y) => x - y);
    arc = [a - 0.08, b + 0.08];
    const m = (a + b) / 2;
    inward = [-Math.cos(m), -Math.sin(m)];

    paintField();
    const count = Math.round(Math.min(Math.max((W * H) / 260, 1800), 7000));
    dust = Array.from({ length: count }, speck);
  };

  /** The field outside the circle: stage.js's sky, mid and far inks as dither probabilities. */
  const paintField = () => {
    rctx.clearRect(0, 0, W, H);
    const cells = [[], [], []];
    const s = scale;
    for (let y = 0; y < H; y += CELL) {
      for (let x = 0; x < W; x += CELL) {
        const d = Math.hypot(x - cx, y - cy) - R;
        if (d < 0) continue;
        if (d < 5 * s) {
          cells[2].push(x, y);
          continue;
        }
        const sky = Math.exp(-d / (14 * s));
        const mid = Math.exp(-d / (120 * s)) * Math.min(1, d / (10 * s)) * 0.85;
        const far = Math.exp(-d / (600 * s)) * Math.min(1, d / (30 * s)) * 0.7;
        const r = Math.random();
        if (r < sky) cells[2].push(x, y);
        else if (r < sky + mid) cells[1].push(x, y);
        else if (r < Math.min(1, sky + mid + far)) cells[0].push(x, y);
      }
    }
    cells.forEach((list, i) => {
      rctx.fillStyle = GREYS[i];
      for (let j = 0; j < list.length; j += 2) rctx.fillRect(list[j], list[j + 1], CELL, CELL);
    });
  };

  const draw = (t) => {
    const dt = last ? Math.min(t - last, 50) : 16;
    last = t;
    const flare = surge(t);
    ctx.clearRect(0, 0, W, H);

    // The rim moves in toward the sweeping text and glows while the surge lasts.
    const push = 16 * scale * flare;
    const ox = inward[0] * push;
    const oy = inward[1] * push;
    ctx.drawImage(rim, ox, oy, W, H);
    if (flare > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 * flare;
      ctx.drawImage(rim, ox, oy, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // Dust sinks inward from the rim to its own depth, then starts again at the rim.
    const frames = dt / (1000 / 60);
    const levels = [[], [], []];
    for (const p of dust) {
      if (!still) p.depth = (p.depth + p.speed * frames * (1 + 1.5 * flare)) % p.maxDepth;
      const radius = R - p.depth;
      const wander = ((-0.06 * scale) / p.freq) * Math.cos((t / 16.67) * p.freq + p.phase);
      const a = p.theta + wander / radius;
      const x = cx + Math.cos(a) * radius + ox;
      const y = cy + Math.sin(a) * radius + oy;
      if (x < 0 || y < 0 || x > W || y > H) continue;
      const tail = (p.maxDepth - p.depth) / (p.maxDepth * 0.25);
      const fade = Math.max(0, Math.min(1, p.depth / 3, tail));
      const v = fade * (0.75 + 0.6 * flare);
      if (v < 0.12) continue;
      levels[v > 0.85 ? 2 : v > 0.45 ? 1 : 0].push(
        Math.round(x / CELL) * CELL,
        Math.round(y / CELL) * CELL
      );
    }
    levels.forEach((list, i) => {
      ctx.fillStyle = GREYS[i];
      for (let j = 0; j < list.length; j += 2) ctx.fillRect(list[j], list[j + 1], CELL, CELL);
    });
    if (!still && !document.hidden) frame = requestAnimationFrame(draw);
  };

  const start = () => {
    cancelAnimationFrame(frame);
    last = 0;
    frame = requestAnimationFrame(draw);
  };

  let resizing = 0;
  addEventListener('resize', () => {
    clearTimeout(resizing);
    resizing = setTimeout(() => {
      resize();
      start();
    }, 120);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !still) start();
  });

  try {
    resize();
    start();
  } catch {
    canvas.remove();
  }
}
