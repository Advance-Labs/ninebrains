/**
 * The background for the reading pages (/compare/): a 2D-canvas echo of the homepage stage.
 *
 * The limb of a huge off-screen circle sits in the bottom-right corner, at exactly the homepage's
 * geometry (stage.js `limb()`), so the eclipse holds still when a page transition swaps the two.
 * It is drawn once per resize as a dithered field of 2px cells in three greys. Dust drifts off it along a slow flow field, snapped
 * to the same 2px grid, and a brightness wave travels along the rim by biasing where dust is born.
 *
 * When the page arrives by a view transition, the eclipse surges (see transition.js): it swells
 * toward the sweeping text, brightens, and throws a burst of dust.
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
  let t1 = 0;
  let t2 = 0;
  /** Unit vector from the circle's centre to the middle of the visible rim (up and to the left). */
  let out = [0, 0];
  let burst = false;
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

  const born = (t, scatter) => {
    // Two births in five land near the travelling wave, so a bright run moves along the rim.
    const mid = (t1 + t2) / 2;
    const half = (t2 - t1) / 2 + 0.08;
    const wave = mid + Math.sin(t * 0.00011) * half * 0.9;
    // Born only where the rim is on screen, so every particle can be seen drifting away.
    let a = mid;
    for (let tries = 0; tries < 12; tries++) {
      a =
        Math.random() < 0.4
          ? wave + (Math.random() - 0.5) * 0.18
          : mid + (Math.random() * 2 - 1) * half;
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
    // stage.js limb(): the rim crosses the bottom edge at 52% and the right edge at 44% height.
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
    [t1, t2] = [theta(p1), theta(p2)].sort((a, b) => a - b);
    const m = (t1 + t2) / 2;
    out = [Math.cos(m), Math.sin(m)];
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
    const flare = surge(t);
    if (flare > 0 && !burst) {
      // The sweep has started: a fresh wave of dust leaves the rim with the text.
      burst = true;
      for (let i = 0; i < dust.length; i++) if (Math.random() < 0.45) dust[i] = born(t, false);
    }
    ctx.clearRect(0, 0, W, H);
    // The rim swells outward, toward the content, and glows while the text sweeps in.
    const push = 28 * flare;
    ctx.drawImage(rim, out[0] * push, out[1] * push, W, H);
    if (flare > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.7 * flare;
      ctx.drawImage(rim, out[0] * push, out[1] * push, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
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
      const s = dt * 0.042 * (1 + 2.5 * flare);
      p.x += ((dx / dist) * 0.55 + Math.cos(a) * 0.7) * s;
      p.y += ((dy / dist) * 0.55 + Math.sin(a) * 0.7) * s;
      const f = p.age / p.life;
      const v = p.glow * Math.min(1, f * 6) * (1 - f) * (1 - f) * (1 + flare);
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
