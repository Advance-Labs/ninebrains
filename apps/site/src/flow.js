/**
 * The background for the reading pages (/compare/): a 2D-canvas echo of the homepage stage.
 *
 * The limb of a huge off-screen circle sits in the bottom-right corner, drawn once per resize as a
 * dithered field of 2px cells in three greys. Dust drifts off it along a slow flow field, snapped
 * to the same 2px grid, and a brightness wave travels along the rim by biasing where dust is born.
 *
 * It is decoration: no WebGL, no dependency, a few hundred rects a frame. The loop stops while the
 * tab is hidden; under reduced motion it draws one still frame. Any failure leaves the black page.
 */

const canvas = document.getElementById('flow');
const ctx = canvas && canvas.getContext('2d');

if (ctx) {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CELL = 2;
  const GREYS = ['#2e2e2e', '#7a7a7a', '#d6d6d6'];
  const COUNT = 1300;
  const rim = document.createElement('canvas');
  const rctx = rim.getContext('2d');
  let W = 0;
  let H = 0;
  let R = 0;
  let cx = 0;
  let cy = 0;
  let span = 0;
  let dust = [];
  let last = 0;
  let frame = 0;

  /** The rim faces up and to the left (225°), crossing the bottom-right corner of the window. */
  const BASE = (5 * Math.PI) / 4;

  const born = (t, scatter) => {
    // Two births in five land near the travelling wave, so a bright run moves along the rim.
    const wave = BASE + Math.sin(t * 0.00011) * span * 0.45;
    // Born only where the rim is on screen, so every particle can be seen drifting away.
    let a = BASE;
    for (let tries = 0; tries < 12; tries++) {
      a =
        Math.random() < 0.4
          ? wave + (Math.random() - 0.5) * 0.18
          : BASE + (Math.random() - 0.5) * span;
      const x = cx + Math.cos(a) * R;
      const y = cy + Math.sin(a) * R;
      if (x > -20 && x < W + 20 && y > -20 && y < H + 20) break;
    }
    const r = R + Math.random() * 6;
    const life = 7000 + Math.random() * 9000;
    return {
      x: cx + Math.cos(a) * r,
      y: cy + Math.sin(a) * r,
      age: scatter ? Math.random() * life : 0,
      life,
      glow: 0.55 + Math.random() * 0.45,
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
    R = Math.max(W, H) * 1.15;
    const k = R * Math.SQRT1_2;
    cx = W * 0.8 + k;
    cy = H * 0.84 + k;
    span = (1.5 * Math.max(W, H)) / R;
    paintRim();
    dust = Array.from({ length: still ? COUNT / 2 : COUNT }, () => born(0, true));
  };

  /** The limb: bright at the edge, fading into the body inside and into grain outside. */
  const paintRim = () => {
    rctx.clearRect(0, 0, W, H);
    const cells = [[], [], []];
    for (let y = 0; y < H; y += CELL) {
      for (let x = 0; x < W; x += CELL) {
        const d = Math.hypot(x - cx, y - cy) - R; // negative inside the circle
        if (d > 90 || d < -220) continue;
        const v = d < 0 ? 0.9 * Math.exp(d / 55) : 0.75 * Math.exp(-d / 9);
        const r = Math.random();
        if (r > v) continue;
        cells[v > 0.6 && r < v * 0.5 ? 2 : v > 0.25 ? 1 : 0].push(x, y);
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
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(rim, 0, 0, W, H);
    const levels = [[], [], []];
    for (let i = 0; i < dust.length; i++) {
      let p = dust[i];
      p.age += still ? 0 : dt;
      if (p.age > p.life) p = dust[i] = born(t, false);
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dist = Math.hypot(dx, dy) || 1;
      // Outward from the limb, bent by a slow, smooth flow field.
      const a =
        Math.sin(p.x * 0.0031 + t * 0.00021) * 1.4 + Math.cos(p.y * 0.0027 - t * 0.00017) * 1.4;
      const s = dt * 0.042;
      p.x += ((dx / dist) * 0.55 + Math.cos(a) * 0.7) * s;
      p.y += ((dy / dist) * 0.55 + Math.sin(a) * 0.7) * s;
      const f = p.age / p.life;
      const v = p.glow * Math.min(1, f * 6) * (1 - f) * (1 - f);
      if (v < 0.08) continue;
      levels[v > 0.55 ? 2 : v > 0.25 ? 1 : 0].push(
        Math.round(p.x / CELL) * CELL,
        Math.round(p.y / CELL) * CELL
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
