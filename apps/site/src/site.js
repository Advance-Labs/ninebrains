/**
 * Page orchestration for the one-screen landing page.
 *
 * One clock drives everything a scene shows: the rail's progress bar, the demo window's timeline
 * (`data-at` / `data-off` / `data-swap` marks in the HTML) and the nine cubes in the WebGL stage.
 * The clock pauses while the pointer or focus is on the rail or the demo, while the verify sheet
 * is open, and while the tab is hidden, so nothing moves on without the reader.
 *
 * None of it gates the content. Without JS the page shows the overview and the install command;
 * without WebGL the stage stays a CSS gradient; with reduced motion every demo shows its final
 * frame, nothing auto-advances and scene changes are instant cuts.
 *
 * The opening (`playIntro`) is decoration on top: the HTML paints a static mark over the page
 * before any script runs, and this file hands it to the stage, which drops nine cubes into that
 * exact mark and flies them to the overview while the copy comes up. Any input skips it; without
 * WebGL, or on any error, the mark is simply removed; if no script arrives, CSS hides it by 2.5s.
 */
import { safeRect } from './layout.js';
import { createStage } from './stage.js';

const RELEASES_API = 'https://api.github.com/repos/Advance-Labs/ninebrains/releases/latest';
const RELEASES_PAGE = 'https://github.com/Advance-Labs/ninebrains/releases/latest';
const CACHE_KEY = 'ninebrains:latest-release';
/** A click or key on the rail holds auto-advance off for this long. */
const MANUAL_HOLD = 30_000;
const STATES = ['idle', 'run', 'pass', 'fail', 'warn'];

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** `?debug=bounds` exposes the scene clock and the stage's drawn boxes to the overlap audit. */
const debug = new URLSearchParams(location.search).get('debug') === 'bounds';
/** How long a loop's fade to and from its entry frame takes, each way. */
const LOOP_FADE_MS = 220;
const mobileQuery = window.matchMedia('(max-width: 899px)');
const phoneQuery = window.matchMedia('(max-width: 480px)');

// --- the scene clock --------------------------------------------------------------------------

const rail = document.querySelector('.rail');
const stageEl = document.querySelector('.stage');
const tabs = [...rail.querySelectorAll('[role="tab"]')];
const panels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')));
const durations = tabs.map((tab) => Number(tab.dataset.duration) || 10);
/**
 * Where each scene's clock starts: a frame with its demo already populated, so a scene never
 * opens on an empty window. Loops come back here too.
 */
const entries = tabs.map((tab) => Number(tab.dataset.entry) || 0);

const clock = {
  index: 0,
  /** Scene time already banked before the current run of unpaused time. */
  banked: 0,
  since: performance.now(),
  paused: false,
  manualUntil: 0,
};
const pauseReasons = new Set();

function sceneTime(now = performance.now()) {
  if (reduced) return durations[clock.index] - 0.001;
  return clock.banked + (clock.paused ? 0 : (now - clock.since) / 1000);
}

function setPaused(reason, on) {
  if (on) pauseReasons.add(reason);
  else pauseReasons.delete(reason);
  const paused = pauseReasons.size > 0;
  if (paused === clock.paused) return;
  const now = performance.now();
  if (paused) clock.banked = sceneTime(now);
  clock.since = now;
  clock.paused = paused;
  rail.dataset.paused = String(paused);
}

function restartClock() {
  clock.banked = entries[clock.index];
  clock.since = performance.now();
}

/** How far through its run (entry frame to end) the active scene is, 0 to 1. */
function progress(t) {
  const entry = entries[clock.index];
  return Math.min(Math.max((t - entry) / (durations[clock.index] - entry), 0), 1);
}

// --- the timeline marks inside each demo ------------------------------------------------------

/** Per panel, the marked elements, parsed once. */
const marks = panels.map((panel) => {
  const list = [];
  for (const el of panel.querySelectorAll('[data-at], [data-off], [data-swap]')) {
    const at = el.dataset.at === undefined ? null : Number(el.dataset.at);
    const off = el.dataset.off === undefined ? null : Number(el.dataset.off);
    const swap = el.dataset.swap ?? null;
    const swapAt = swap ? Number(el.dataset.swapAt ?? el.dataset.at ?? 0) : null;
    const base = swap ? (STATES.find((state) => el.classList.contains(state)) ?? null) : null;
    list.push({ el, at, off, swap, swapAt, base, state: '' });
  }
  const clocks = [...panel.querySelectorAll('[data-clock]')];
  const terminals = [...panel.querySelectorAll('.term, .fb-term')];
  return { list, clocks, terminals, lastClock: '' };
});

function applyMarks(index, t) {
  const panel = panels[index];
  const set = marks[index];
  panel.style.setProperty('--t', t.toFixed(3));
  panel.style.setProperty('--tp', Math.min(t / durations[index], 1).toFixed(4));
  let printed = false;
  for (const mark of set.list) {
    const on = mark.at === null || t >= mark.at;
    const off = mark.off !== null && t >= mark.off;
    const swapped = mark.swap !== null && t >= mark.swapAt;
    const state = `${on ? 1 : 0}${off ? 1 : 0}${swapped ? 1 : 0}`;
    if (state === mark.state) continue;
    mark.state = state;
    printed = true;
    if (mark.at !== null) mark.el.classList.toggle('on', on);
    mark.el.classList.toggle('off', off);
    if (mark.swap !== null) {
      mark.el.classList.toggle('sw', swapped);
      if (mark.base) mark.el.classList.toggle(mark.base, !swapped);
      if (STATES.includes(mark.swap)) mark.el.classList.toggle(mark.swap, swapped);
    }
  }
  // Keep each terminal on its newest line, the way a real one scrolls.
  if (printed) {
    for (const term of set.terminals) term.scrollTop = term.scrollHeight;
  }
  const seconds = Math.floor(t);
  const text = `00:${String(seconds).padStart(2, '0')}`;
  if (text !== set.lastClock) {
    set.lastClock = text;
    for (const el of set.clocks) el.textContent = text;
  }
}

// --- demo windows scale to fit ----------------------------------------------------------------

function fitWindows() {
  const mobile = mobileQuery.matches;
  for (const fit of document.querySelectorAll('[data-fit]')) {
    const win = fit.querySelector('.win');
    if (!win) continue;
    const w = fit.clientWidth;
    const h = fit.clientHeight;
    if (!w || !h) continue;
    const mini = win.classList.contains('win-mini');
    if (mobile && !mini) {
      // Flat and full width: a fixed-width layout scaled to the column, as tall as fits. Phones
      // get the narrower 340px layout so the scale stays near 1 and text stays readable.
      const s = w / (phoneQuery.matches ? 340 : 500);
      fit.style.setProperty('--s', s.toFixed(4));
      win.style.setProperty('--win-h', `${Math.max(240, Math.floor(h / s))}px`);
    } else {
      const baseW = mini ? 560 : 800;
      const baseH = mini ? 330 : 500;
      // The tilt makes the projected pane a little larger than its box; leave room for it.
      const s = Math.min(w / baseW, h / baseH) * (mini ? 0.96 : 0.95);
      fit.style.setProperty('--s', s.toFixed(4));
    }
  }
}

// --- the stage --------------------------------------------------------------------------------

let stage = null;

function syncStage({ instant = false } = {}) {
  if (!stage) return;
  const rect = safeRect(panels[clock.index], {
    mobile: mobileQuery.matches,
    aspect: stage.aspect(clock.index),
    // Hang the cubes from the top-left, in line with the copy; only the overview's mark column
    // on a desktop keeps them centred.
    anchorTo: clock.index === 0 && !mobileQuery.matches ? 'center' : 'start',
  });
  stage.setScene(clock.index, rect, { instant: instant || reduced });
}

function initStage() {
  const canvas = document.getElementById('scene');
  try {
    stage = createStage(canvas, {
      reduced,
      sceneTime: () => sceneTime(),
      scene: () => clock.index,
      durations,
      debug,
    });
  } catch {
    stage = null;
  }
  if (!stage) return;
  syncStage({ instant: true });
  // Text reflows once the web fonts land; re-measure the safe rectangle then.
  document.fonts?.ready.then(() => syncStage({ instant: true }));
  requestAnimationFrame(() => canvas.classList.add('live'));
}

// --- the opening ------------------------------------------------------------------------------

const INTRO_SEEN = 'ninebrains:intro-seen';
/**
 * Too late to start (ms since navigation): the static mark's CSS failsafe (for no JS, or JS that
 * never arrives) starts hiding it at 2.2s; an opening can only take over before that.
 */
const INTRO_LATEST = 1800;
/** Once the script has the mark, a slower failsafe of its own, in case it stalls halfway. */
const INTRO_STALL = 'intro-gone 0.3s 3.6s forwards';
const root = document.documentElement;
const introEl = document.getElementById('intro');
/** While the opening plays: ends it at its settled frame (a skip, the last frame, an error). */
let introEnd = null;

/** 'full' on a first visit, 'short' after that or on a deep link, 'fade' for reduced motion. */
function introMode() {
  if (!introEl || debug || performance.now() > INTRO_LATEST) return null;
  if (reduced) return 'fade';
  let seen = false;
  try {
    seen = sessionStorage.getItem(INTRO_SEEN) === '1';
    sessionStorage.setItem(INTRO_SEEN, '1');
  } catch {
    // No storage (private mode, blocked): every visit counts as the first.
  }
  return seen || location.hash ? 'short' : 'full';
}

/** How long the copy's reveal can still run after the cubes land (its longest delay plus fade). */
const REVEAL_TAIL = 1000;
let revealTail = 0;

/** A CSS-px box snapped to the device-pixel grid the way the browser paints a replaced element. */
function snapped(b) {
  const r = window.devicePixelRatio || 1;
  const x = Math.round(b.left * r) / r;
  const y = Math.round(b.top * r) / r;
  return {
    x,
    y,
    w: Math.round((b.left + b.width) * r) / r - x,
    h: Math.round((b.top + b.height) * r) / r - y,
  };
}

function removeIntro({ settle = false } = {}) {
  introEl?.remove();
  clearTimeout(revealTail);
  const clear = () => root.classList.remove('intro', 'intro-reveal', 'intro-short');
  // Landing on its own, the copy finishes easing in; a skip or a failure shows it at once.
  if (settle && root.classList.contains('intro-reveal'))
    revealTail = setTimeout(clear, REVEAL_TAIL);
  else clear();
}

function playIntro() {
  const mode = introMode();
  if (!mode) return removeIntro();
  // The script is here: the no-JS failsafe gives way to this one's own.
  introEl.style.animation = INTRO_STALL;
  if (mode === 'fade') {
    // The reduced-motion CSS clamps every transition to 1ms, so this crossfade is scripted.
    const fade = introEl.animate?.([{ opacity: 1 }, { opacity: 0 }], {
      duration: 200,
      fill: 'forwards',
    });
    if (fade) fade.finished.then(removeIntro, removeIntro);
    else removeIntro();
    return;
  }
  const box = introEl.querySelector('svg')?.getBoundingClientRect();
  if (!stage || !box || box.width < 1) return removeIntro();

  const canvas = document.getElementById('scene');
  const skips = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
  let safety = 0;
  const finish = (settle = false) => {
    if (introEnd !== finish) return;
    introEnd = null;
    clearTimeout(safety);
    for (const type of skips) window.removeEventListener(type, skip, true);
    window.removeEventListener('resize', skip);
    stage?.skipIntro();
    canvas.style.transition = '';
    removeIntro({ settle });
    // The copy was measured with its lines still rising; measure the settled page.
    syncStage({ instant: true });
  };
  const skip = () => finish(false);
  introEnd = finish;
  // Under the opaque mark the stage can come up at once; the hand-off needs it already there.
  canvas.style.transition = 'none';
  canvas.classList.add('live');
  const started = stage.intro({
    // Where the browser actually paints the SVG: it snaps the box to whole device pixels.
    mark: snapped(box),
    mode,
    // Stacked layouts send the cubes up across the headline; let them pass before it comes up.
    revealLate: mobileQuery.matches,
    hooks: {
      start() {
        if (performance.now() > INTRO_LATEST + 500) return skip();
        // The overview's demo starts from its entry frame as it comes into view.
        for (const mark of marks[clock.index].list) mark.state = '';
        restartClock();
        root.classList.add('intro');
        root.classList.toggle('intro-short', mode === 'short');
        introEl.classList.add(mode === 'full' ? 'is-ghost' : 'is-handoff');
      },
      land() {
        introEl.classList.add('is-landed');
      },
      lift() {
        introEl.classList.add('is-lifted');
      },
      reveal() {
        root.classList.add('intro-reveal');
      },
      done: () => finish(true),
    },
  });
  if (!started) return skip();
  for (const type of skips) window.addEventListener(type, skip, { capture: true, passive: true });
  window.addEventListener('resize', skip);
  // If frames stop coming (a hidden tab, a stalled GPU), never leave the page covered.
  safety = setTimeout(skip, 4500);
}

// --- the rail ---------------------------------------------------------------------------------

function select(index, { user = false, focus = false } = {}) {
  const changed = index !== clock.index;
  tabs.forEach((tab, i) => {
    const active = i === index;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    panels[i].hidden = !active;
    if (!active) tab.style.removeProperty('--p');
  });
  if (focus) tabs[index].focus();
  if (user) clock.manualUntil = performance.now() + MANUAL_HOLD;
  clock.index = index;
  restartClock();
  // Restart the demo's own CSS animations (entry push, typing) from the top.
  if (changed) {
    stageEl.dataset.switched = '';
    for (const mark of marks[index].list) mark.state = '';
  }
  applyMarks(index, sceneTime());
  requestAnimationFrame(() => {
    fitWindows();
    syncStage();
  });
}

function initRail() {
  rail.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) select(tabs.indexOf(tab), { user: true });
  });
  rail.addEventListener('keydown', (event) => {
    const current = event.target.closest('[role="tab"]');
    if (!current) return;
    const index = tabs.indexOf(current);
    const vertical = !mobileQuery.matches;
    const next = vertical ? 'ArrowDown' : 'ArrowRight';
    const prev = vertical ? 'ArrowUp' : 'ArrowLeft';
    let target = null;
    if (event.key === next || event.key === 'ArrowDown') target = (index + 1) % tabs.length;
    else if (event.key === prev || event.key === 'ArrowUp')
      target = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = tabs.length - 1;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(index, { user: true });
      return;
    }
    if (target === null) return;
    event.preventDefault();
    select(target, { user: true, focus: true });
  });

  const hoverables = [rail, ...document.querySelectorAll('.win-fit')];
  for (const el of hoverables) {
    el.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse') setPaused('hover', true);
    });
    el.addEventListener('pointerleave', () => setPaused('hover', false));
  }
  rail.addEventListener('focusin', () => setPaused('focus', true));
  rail.addEventListener('focusout', (event) => {
    if (!rail.contains(event.relatedTarget)) setPaused('focus', false);
  });
  document.addEventListener('visibilitychange', () => setPaused('hidden', document.hidden));

  // Swipe the stage on a phone to move between scenes.
  let startX = null;
  let startY = 0;
  stageEl.addEventListener(
    'touchstart',
    (event) => {
      if (event.target.closest('.cmd code, .install-tabs')) return;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    },
    { passive: true }
  );
  stageEl.addEventListener(
    'touchend',
    (event) => {
      if (startX === null) return;
      const dx = event.changedTouches[0].clientX - startX;
      const dy = event.changedTouches[0].clientY - startY;
      startX = null;
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      const step = dx < 0 ? 1 : -1;
      select((clock.index + step + tabs.length) % tabs.length, { user: true });
    },
    { passive: true }
  );
}

/** A held scene loops: its window fades down, jumps back to the entry frame and fades up. */
let looping = 0;

function loopScene() {
  const panel = panels[clock.index];
  const index = clock.index;
  looping = performance.now();
  setPaused('loop', true);
  panel.classList.add('is-looping');
  setTimeout(() => {
    if (clock.index === index) {
      for (const mark of marks[index].list) mark.state = '';
      restartClock();
      applyMarks(index, sceneTime());
    }
    panel.classList.remove('is-looping');
    setPaused('loop', false);
    looping = 0;
  }, LOOP_FADE_MS);
}

function tick(now) {
  const t = sceneTime(now);
  const duration = durations[clock.index];
  if (!reduced && t >= duration) {
    if (now >= clock.manualUntil) {
      select((clock.index + 1) % tabs.length);
    } else if (!looping) {
      // Held on a scene the reader picked: loop it.
      loopScene();
    }
  } else {
    applyMarks(clock.index, t);
    tabs[clock.index].style.setProperty('--p', progress(t).toFixed(4));
  }
  requestAnimationFrame(tick);
}

// --- pointer parallax -------------------------------------------------------------------------

function initParallax() {
  if (reduced) return;
  const root = document.documentElement;
  let frame = 0;
  window.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType !== 'mouse') return;
      const x = (event.clientX / window.innerWidth) * 2 - 1;
      const y = (event.clientY / window.innerHeight) * 2 - 1;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.style.setProperty('--px', x.toFixed(3));
        root.style.setProperty('--py', y.toFixed(3));
        stage?.setPointer(x, y);
      });
    },
    { passive: true }
  );
}

// --- install tabs, copy, downloads ------------------------------------------------------------

function osHint() {
  const platform = `${navigator.userAgentData?.platform ?? navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  return /win/i.test(platform) ? 'windows' : 'terminal';
}

function initInstallTabs(onShown) {
  const container = document.querySelector('.install-tabs');
  const installTabs = [...container.querySelectorAll('[role="tab"]')];
  const hint = container.querySelector('[data-install-hint]');

  function pick(tab, { focus = false } = {}) {
    for (const t of installTabs) {
      const active = t === tab;
      t.setAttribute('aria-selected', String(active));
      t.tabIndex = active ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !active;
    }
    if (focus) tab.focus();
    const kind = tab.dataset.install;
    if (hint) {
      hint.textContent =
        kind === 'windows' ? 'Windows' : kind === 'download' ? 'Every platform' : 'macOS, Linux';
    }
    if (kind === 'download') loadDownloads();
    onShown?.();
  }

  container.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) pick(tab);
  });
  container.addEventListener('keydown', (event) => {
    const current = event.target.closest('[role="tab"]');
    if (!current) return;
    const index = installTabs.indexOf(current);
    let next = null;
    if (event.key === 'ArrowRight') next = installTabs[(index + 1) % installTabs.length];
    else if (event.key === 'ArrowLeft')
      next = installTabs[(index - 1 + installTabs.length) % installTabs.length];
    if (!next) return;
    event.preventDefault();
    pick(next, { focus: true });
  });

  const preferred = installTabs.find((tab) => tab.dataset.install === osHint());
  if (preferred) pick(preferred);

  // The app links to /#download: open the overview on the Download tab.
  const openDownload = () => {
    if (location.hash !== '#download') return;
    select(0, { user: true });
    pick(installTabs.find((tab) => tab.dataset.install === 'download'));
  };
  window.addEventListener('hashchange', openDownload);
  openDownload();
}

/**
 * The legacy copy path: a selected, off-screen textarea and execCommand. It is synchronous, so it
 * still runs inside the click's user activation, and it works where the async Clipboard API is
 * missing or refused (older or locked-down browsers, embedded webviews, plain http).
 *
 * Returns 'copied', 'refused' (the call ran and said no) or 'blocked': it answered yes without
 * copying anything. A real copy always fires a copy event at the document first, so that event is
 * the only honest witness. Content blockers stand in for execCommand and return true, which is
 * what a shell one-liner meets today: uBlock Origin's ClickFix defence matches `irm ... | iex`,
 * takes the call, and reports success. Trusting the return value there puts a green Copied on a
 * button over an untouched clipboard, which is the worst of the three answers.
 */
function copyWithSelection(text) {
  const focused = document.activeElement;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
  document.body.append(area);
  area.select();
  let witnessed = false;
  const witness = () => {
    witnessed = true;
  };
  document.addEventListener('copy', witness, true);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.removeEventListener('copy', witness, true);
  area.remove();
  // Selecting the textarea moved focus; hand it back so keyboard users stay on the button.
  if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
  if (witnessed) return 'copied';
  return ok ? 'blocked' : 'refused';
}

/** Selects the command on the page so a manual Ctrl+C / Cmd+C picks it up. */
function selectCommand(code) {
  const range = document.createRange();
  range.selectNodeContents(code);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function initCopyButtons() {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  for (const button of document.querySelectorAll('[data-copy]')) {
    const original = button.textContent;
    let reset = 0;
    const show = (label, state) => {
      clearTimeout(reset);
      button.textContent = label;
      button.dataset.copied = state;
      reset = setTimeout(() => {
        button.textContent = original;
        button.dataset.copied = 'false';
      }, 1800);
    };
    button.addEventListener('click', async () => {
      const code = button.closest('.cmd')?.querySelector('code');
      // The formatter may wrap the command in the HTML; copy the one line the page shows.
      const text = code?.textContent?.replace(/\s+/g, ' ').trim();
      if (!code || !text) return;
      // Try the synchronous path first: an await before it would spend the click's activation.
      const wrote = copyWithSelection(text);
      if (wrote === 'copied') return show('✓ Copied', 'true');
      // Only when the sync path refused outright. 'blocked' means something took the write and
      // said yes without making it; the async API answers to the same block and refuses just as
      // quietly, so asking it would buy a second false yes and a second warning over the page.
      if (wrote === 'refused' && navigator.clipboard?.writeText) {
        const ok = await navigator.clipboard.writeText(text).then(
          () => true,
          () => false
        );
        if (ok) return show('✓ Copied', 'true');
      }
      // Nothing let us write: leave the command selected and say how to finish by hand. A copy the
      // reader makes themselves is theirs, so no blocker stands in the way of that one.
      selectCommand(code);
      show(mac ? 'Press ⌘C' : 'Press Ctrl+C', 'manual');
    });
  }
}

/** Fades a command's right edge while part of it is scrolled out of view. */
function initCommandFades() {
  const codes = [...document.querySelectorAll('.cmd code')];
  const update = (code) => {
    const hidden = code.scrollWidth - code.clientWidth - code.scrollLeft;
    code.dataset.overflow = String(hidden > 1);
  };
  const updateAll = () => {
    for (const code of codes) update(code);
  };
  for (const code of codes) code.addEventListener('scroll', () => update(code), { passive: true });
  new ResizeObserver(updateAll).observe(document.body);
  updateAll();
  return updateAll;
}

/** Only ever link to files GitHub itself is serving for this release. */
function isGithubReleaseAsset(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'github.com' || parsed.hostname === 'objects.githubusercontent.com')
    );
  } catch {
    return false;
  }
}

/** Maps a release asset's file name to a short OS label and sort position. */
function describeAsset(name) {
  if (/mac-arm64\.dmg$/.test(name)) return { os: 'macOS Apple Silicon', order: 0 };
  if (/mac-x64\.dmg$/.test(name)) return { os: 'macOS Intel', order: 1 };
  if (/win-x64\.exe$/.test(name)) return { os: 'Windows x64', order: 2 };
  if (/linux-x86_64\.AppImage$/.test(name)) return { os: 'Linux AppImage', order: 3 };
  if (/linux-amd64\.deb$/.test(name)) return { os: 'Linux .deb', order: 4 };
  return null;
}

let downloadsRequested = false;

async function loadDownloads() {
  if (downloadsRequested) return;
  downloadsRequested = true;

  const root = document.querySelector('[data-downloads]');
  const status = document.querySelector('[data-downloads-status]');
  const versionLabel = document.querySelector('[data-downloads-version]');
  if (!root || !status) return;

  try {
    let release = readCache();
    if (!release) {
      const response = await fetch(RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) throw new Error(`releases: ${response.status}`);
      release = await response.json();
      writeCache(release);
    }
    renderDownloads(release, root, status, versionLabel);
  } catch {
    status.textContent = "Couldn't load the release files. ";
    const link = document.createElement('a');
    link.href = RELEASES_PAGE;
    link.textContent = 'See every download on GitHub';
    status.append(link);
  }
}

function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(release) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(release));
  } catch {
    // Private browsing or a full quota; the fetch already worked.
  }
}

function renderDownloads(release, root, status, versionLabel) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const rows = assets
    .map((asset) => ({ asset, meta: describeAsset(asset.name ?? '') }))
    .filter((row) => row.meta && isGithubReleaseAsset(row.asset.browser_download_url))
    .sort((a, b) => a.meta.order - b.meta.order);

  if (rows.length === 0) {
    status.textContent = "This release doesn't have installer files yet.";
    return;
  }

  status.remove();
  const frag = document.createDocumentFragment();
  for (const { asset, meta } of rows) {
    const a = document.createElement('a');
    a.className = 'dl-button';
    a.href = asset.browser_download_url;
    a.title = asset.name;
    const os = document.createElement('span');
    os.className = 'dl-os';
    os.textContent = meta.os;
    const file = document.createElement('span');
    file.className = 'dl-file';
    file.textContent = asset.name;
    a.append(os, file);
    frag.append(a);
  }
  root.append(frag);

  if (versionLabel) {
    const version = typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/, '') : '';
    versionLabel.textContent = version ? `Ninebrains ${version}. ` : '';
  }

  const sums = assets.find(
    (asset) => asset.name === 'SHA256SUMS' && isGithubReleaseAsset(asset.browser_download_url)
  );
  const note = root.parentElement?.querySelector('.install-note');
  if (sums && note) {
    const link = document.createElement('a');
    link.href = sums.browser_download_url;
    link.textContent = 'SHA256SUMS';
    note.append(' ', link);
  }
}

// --- the verify sheet -------------------------------------------------------------------------

function initSheets() {
  for (const opener of document.querySelectorAll('[data-open]')) {
    const dialog = document.getElementById(opener.dataset.open);
    if (!(dialog instanceof HTMLDialogElement)) continue;
    opener.addEventListener('click', () => {
      dialog.showModal();
      setPaused('sheet', true);
    });
    dialog.addEventListener('close', () => {
      setPaused('sheet', false);
      opener.focus();
    });
    // A click on the backdrop (outside the sheet's box) closes it.
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      const inside =
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom;
      if (!inside) dialog.close();
    });
    // showModal makes the rest of the page inert; keep Tab cycling inside the sheet as well.
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusables = [...dialog.querySelectorAll('a[href], button')];
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }
}

// --- go ---------------------------------------------------------------------------------------

function main() {
  initRail();
  const refreshFades = initCommandFades();
  initInstallTabs(refreshFades);
  initCopyButtons();
  initSheets();
  initParallax();
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(() => {
      fitWindows();
      syncStage({ instant: true });
    });
    observer.observe(document.querySelector('.stage'));
  }
  fitWindows();
  applyMarks(clock.index, sceneTime());
  initStage();
  playIntro();
  requestAnimationFrame(tick);
}

/**
 * The overlap audit's handle (apps/site/test/overlap-audit.mjs), only with `?debug=bounds`:
 * jump any scene to any moment, optionally as a live scene change, and read what the stage drew.
 */
function initDebug() {
  if (!debug) return;
  window.__dbg = {
    stage: () => stage,
    durations,
    entries,
    seek(index, t, { transition = false } = {}) {
      clock.manualUntil = performance.now() + 1e9;
      setPaused('debug', true);
      if (index !== clock.index) select(index, { user: true });
      clock.banked = t;
      clock.since = performance.now();
      for (const mark of marks[index].list) mark.state = '';
      applyMarks(index, t);
      fitWindows();
      if (!transition) {
        stage?.debugSettle();
        syncStage({ instant: true });
      }
    },
    play() {
      setPaused('debug', false);
    },
  };
}

try {
  initDebug();
  main();
} catch (error) {
  // Whatever broke, the page underneath is complete: uncover it.
  introEnd?.();
  removeIntro();
  throw error;
}
