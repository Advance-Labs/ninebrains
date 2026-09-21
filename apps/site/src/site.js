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
  stage.intro();
  // Text reflows once the web fonts land; re-measure the safe rectangle then.
  document.fonts?.ready.then(() => syncStage({ instant: true }));
  requestAnimationFrame(() => canvas.classList.add('live'));
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

function initCopyButtons() {
  for (const button of document.querySelectorAll('[data-copy]')) {
    button.addEventListener('click', async () => {
      const code = button.closest('.cmd')?.querySelector('code');
      // The formatter may wrap the command in the HTML; copy the one line the page shows.
      const text = code?.textContent?.replace(/\s+/g, ' ').trim();
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // No clipboard (insecure context, permissions): the command is still selectable text.
        return;
      }
      const original = button.textContent;
      button.textContent = '✓ Copied';
      button.dataset.copied = 'true';
      setTimeout(() => {
        button.textContent = original;
        button.dataset.copied = 'false';
      }, 1800);
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

initDebug();
main();
