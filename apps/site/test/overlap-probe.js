/**
 * The overlap audit's in-page half, injected by overlap-audit.mjs into a page opened with
 * `?debug=bounds`. It drives the scene clock through `window.__dbg` (site.js) and reads the boxes
 * of everything on screen: the page's own text and chrome from the DOM, and every cube, wire set
 * and floor from the stage's projection of what it drew last frame.
 *
 * Allowed to overlap: the WebGL background (field and dust, never measured), toasts and banners
 * inside the demo window (children of it), dialogs (not open during the audit). Nothing else.
 */
(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const frames = (n = 2) =>
    new Promise((resolve) => {
      const step = (left) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
      step(n);
    });

  /** Effective opacity: an element fading in at 0.02 cannot collide with anything yet. */
  function opacity(el) {
    let o = 1;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      o *= Number(getComputedStyle(e).opacity);
    }
    return o;
  }

  function rectOf(el) {
    if (!el) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const b = el.getBoundingClientRect();
    if (b.width < 0.5 || b.height < 0.5) return null;
    if (opacity(el) < 0.05) return null;
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  }

  function inter(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w >= 1 && h >= 1 ? { w, h, area: w * h } : null;
  }

  const mobile = () => matchMedia('(max-width: 899px)').matches;
  const activePanel = () => document.querySelector('.panel:not([hidden])');
  const round = (r) => ({
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.round(r.w),
    h: Math.round(r.h),
  });

  function collect() {
    const panel = activePanel();
    const items = [];
    const add = (name, el) => {
      const r = rectOf(el);
      if (r) items.push({ name, el, kind: 'dom', ...r });
    };
    add('header', document.querySelector('body > .nav'));
    add(mobile() ? 'bottombar' : 'rail', document.querySelector('.rail'));
    document.querySelectorAll('.rail [role="tab"]').forEach((tab, i) => {
      add(`rail-item-0${i}`, tab);
      add(`rail-caption-0${i}`, tab.querySelector('.rail-caption'));
    });
    const q = (s) => panel.querySelector(s);
    add('eyebrow', q('.eyebrow'));
    add('kicker', q('.kicker'));
    add('title', q('h1, h2'));
    add('lede', q('.lede, .feature-copy'));
    add('install', q('.install'));
    add('works-with', q('.works-with'));
    add('stats', q('.stats'));
    for (const win of panel.querySelectorAll('.win')) add('window', win);
    add('footer', document.querySelector('body > footer'));
    const stage = window.__dbg.stage();
    for (const c of stage ? stage.debugBounds() : []) {
      items.push({ ...c, kind: c.name === 'wires' || c.name === 'floor' ? 'scenery' : 'cube' });
    }
    return { items, panel };
  }

  const within = (a, b) => a.el && b.el && (a.el.contains(b.el) || b.el.contains(a.el));
  const drawn = (i) => i.kind === 'cube' || i.kind === 'scenery';

  /** Page text that must never be cut: single-line labels, and anything line-clamped. */
  const TEXT = [
    '.eyebrow',
    '.kicker',
    'h1',
    'h2',
    '.lede',
    '.feature-copy',
    '.install-note',
    '.install-hint',
    '.works-with',
    '.stats dd',
    '.stats dt',
  ];
  /** Demo text that is meant to read whole (terminals are allowed to crop, like terminals). */
  const DEMO_TEXT = [
    '.bl .t',
    '.bl .lane-head',
    '.queue .t',
    '.drawer-head',
    '.attempt-head',
    '.check',
    '.evidence',
    '.pk-row',
    '.pk-head',
    '.pn-t',
    '.toast p',
    '.banner .bt p',
    '.win-title',
    '.lane-head',
  ];

  function textOverflow(panel) {
    const out = [];
    const els = [
      ...document.querySelectorAll('.nav, .rail, .rail-label, .rail-caption, body > footer'),
    ];
    for (const s of TEXT) els.push(...panel.querySelectorAll(s));
    const win = panel.querySelector('.win:not(.win-mini)');
    if (win) for (const s of DEMO_TEXT) els.push(...win.querySelectorAll(s));
    for (const el of els) {
      if (!rectOf(el)) continue;
      // Mid-reveal (a caption opening, a line typing out) is motion, not clipping.
      if (el.getAnimations().some((a) => a.playState === 'running')) continue;
      const cs = getComputedStyle(el);
      const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
      const ox = el.scrollWidth - el.clientWidth;
      const oy = el.scrollHeight - el.clientHeight;
      const clipsY = clamp || cs.overflowY !== 'visible';
      const clipsX = cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis';
      if ((ox > 1 && clipsX) || (oy > 1 && clipsY)) {
        out.push({
          el:
            typeof el.className === 'string' && el.className
              ? `.${el.className.split(' ')[0]}`
              : el.tagName.toLowerCase(),
          text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 48),
          ox,
          oy,
        });
      }
    }
    // The install command: whole at 1280 and wider; narrower, it scrolls under a fade.
    for (const code of panel.querySelectorAll('.install-panel:not([hidden]) .cmd code')) {
      const ox = code.scrollWidth - code.clientWidth;
      if (ox > 1 && innerWidth >= 1280)
        out.push({ el: '.cmd code', text: 'install command', ox, oy: 0 });
    }
    return out;
  }

  function analyse() {
    const { items, panel } = collect();
    const pairs = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (within(a, b)) continue;
        if (drawn(a) && drawn(b)) continue;
        const x = inter(a, b);
        if (!x) continue;
        pairs.push({
          a: a.name,
          b: b.name,
          w: Math.round(x.w),
          h: Math.round(x.h),
          ra: round(a),
          rb: round(b),
        });
      }
    }
    const offscreen = [];
    for (const it of items) {
      const outX = Math.max(0, -it.x) + Math.max(0, it.x + it.w - innerWidth);
      const outY = Math.max(0, -it.y) + Math.max(0, it.y + it.h - innerHeight);
      if (outX > 0.5 || outY > 0.5)
        offscreen.push({ name: it.name, outX: Math.round(outX), outY: Math.round(outY) });
    }
    const cut = items
      .filter((i) => drawn(i) && i.cut > 1)
      .map((i) => ({ name: i.name, px: Math.round(i.cut) }));
    const root = document.documentElement;
    const scroll =
      root.scrollHeight > innerHeight ||
      root.scrollWidth > innerWidth ||
      document.body.scrollHeight > innerHeight;
    return {
      pairs,
      offscreen,
      cut,
      overflow: textOverflow(panel),
      scroll,
      cubes: items.filter((i) => i.kind === 'cube').length,
    };
  }

  /** Panes in the demo window that show no text at all (headers do not count). */
  function emptyPanes() {
    const win =
      activePanel().querySelector('.win:not(.win-mini)') ?? activePanel().querySelector('.win');
    if (!win) return [];
    const out = [];
    const panes = win.querySelectorAll(
      '.lane, .mini-lane, .bl, .drawer-term, .queue, .attempt, .shots, .pk-grid, .fb-term, .planner'
    );
    for (const pane of panes) {
      if (!rectOf(pane)) continue;
      const text = [...pane.querySelectorAll('*')].filter((e) => {
        if (e.children.length || !e.textContent.trim()) return false;
        if (e.closest('.lane-head, .queue-head, .attempt-head, header')) return false;
        return rectOf(e);
      });
      const visual = pane.querySelectorAll('.shot, .pnode, .pack');
      if (text.length === 0 && ![...visual].some((v) => rectOf(v))) {
        out.push(pane.className.split(' ')[0]);
      }
    }
    return out;
  }

  const settle = () => frames(3).then(() => sleep(40));

  /** Every scene: its entry frame and four points through its run, a loop, and the change out. */
  async function run() {
    const { durations, entries } = window.__dbg;
    const points = [0, 0.25, 0.5, 0.75, 0.97];
    const samples = [];
    const record = (s, label, r) => samples.push({ s, label, ...r });
    for (let s = 0; s < durations.length; s++) {
      const span = durations[s] - entries[s];
      for (const f of points) {
        const t = +(entries[s] + span * f).toFixed(2);
        window.__dbg.seek(s, t);
        await settle();
        if (f === 0) await sleep(700); // the window's entry push, and anything fading in
        const r = analyse();
        if (f === 0) r.empty = emptyPanes();
        record(s, `${Math.round(f * 100)}%`, r);
      }
      // A held scene reaching its end loops back to its entry frame.
      window.__dbg.seek(s, durations[s] - 0.05);
      await settle();
      window.__dbg.play();
      let looped = 0;
      for (const at of [150, 330, 520]) {
        await sleep(at - looped);
        looped = at;
        record(s, `loop +${at}ms`, analyse());
      }
      // The change to the next scene, sampled through the dissolve.
      const next = (s + 1) % durations.length;
      window.__dbg.seek(s, durations[s] * 0.9);
      await settle();
      window.__dbg.seek(next, entries[next], { transition: true });
      let elapsed = 0;
      for (const at of [60, 180, 300, 450, 700]) {
        await sleep(at - elapsed);
        elapsed = at;
        record(next, `change ${s}>${next} +${at}ms`, analyse());
      }
    }
    return samples;
  }

  /** Dashed boxes around whatever collides, for screenshots. */
  let overlay = null;
  function mark(r) {
    overlay?.remove();
    overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999';
    for (const p of r.pairs) {
      for (const [n, b] of [
        [p.a, p.ra],
        [p.b, p.rb],
      ]) {
        const d = document.createElement('div');
        d.style.cssText = `position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;outline:2px dashed #ff2d55`;
        d.title = n;
        overlay.append(d);
      }
    }
    document.body.append(overlay);
  }

  window.__audit = { run, analyse, emptyPanes, mark, sleep, settle };
})();
