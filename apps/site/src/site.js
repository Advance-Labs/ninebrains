/**
 * Page orchestration: run the intro if it is welcome, reveal content as it scrolls, and wire up
 * the two tablists (the feature rail and the install tabs), the copy buttons, and the download
 * tab's client-side fetch of the latest GitHub release.
 *
 * The content never depends on the intro finishing, and none of the interactive parts below are
 * required for the page to be readable: if a fetch fails, or JS never runs, the markup already
 * shows the overview panel and the terminal install command.
 */
import { runIntro } from './intro.js';

const RELEASES_API = 'https://api.github.com/repos/Advance-Labs/ninebrains/releases/latest';
const RELEASES_PAGE = 'https://github.com/Advance-Labs/ninebrains/releases/latest';
const CACHE_KEY = 'ninebrains:latest-release';

const canvas = document.getElementById('intro');
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Reveals everything currently on screen, and watches for the rest. */
function watchReveals() {
  const items = [...document.querySelectorAll('[data-reveal]')];
  const showAll = () => {
    for (const item of items) item.classList.add('in');
  };
  if (reduced || !('IntersectionObserver' in window)) {
    showAll();
    return;
  }
  document.body.classList.add('reveals');
  setTimeout(showAll, 4000);
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const delay = Number(entry.target.dataset.delay ?? 0) * 90;
        setTimeout(() => entry.target.classList.add('in'), delay);
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.08 }
  );
  for (const item of items) observer.observe(item);
}

function ready() {
  document.body.classList.add('ready');
  watchReveals();
}

function runPageIntro() {
  if (reduced || !window.WebGLRenderingContext) {
    document.body.classList.add('no-intro');
    ready();
    return;
  }
  try {
    const skip = runIntro({ canvas, onDone: ready });
    for (const event of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
      window.addEventListener(event, () => skip(), { once: true, passive: true });
    }
  } catch {
    document.body.classList.add('no-intro');
    ready();
  }
}

/**
 * A small, accessible tablist: click or arrow-key between `[role="tab"]` buttons inside
 * `container`, show the matching `[role="tabpanel"]` (matched by `aria-controls` -> id), and keep
 * one tab in the natural tab order (roving tabindex). `onSelect` fires after each activation,
 * including the initial one, so callers can lazily load a panel's content.
 */
function tablist(container, { orientation = 'horizontal', onSelect } = {}) {
  const tabs = [...container.querySelectorAll('[role="tab"]')];
  if (tabs.length === 0) return { select: () => {} };

  function panelFor(tab) {
    const id = tab.getAttribute('aria-controls');
    return id ? document.getElementById(id) : null;
  }

  function select(tab, { focus = false } = {}) {
    for (const t of tabs) {
      const active = t === tab;
      t.setAttribute('aria-selected', String(active));
      t.tabIndex = active ? 0 : -1;
      const panel = panelFor(t);
      if (panel) panel.hidden = !active;
    }
    if (focus) tab.focus();
    onSelect?.(tab);
  }

  container.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab && tabs.includes(tab)) select(tab);
  });

  const forward = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
  const backward = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';

  container.addEventListener('keydown', (event) => {
    const current = event.target.closest('[role="tab"]');
    if (!current || !tabs.includes(current)) return;
    const index = tabs.indexOf(current);
    let next = null;
    if (event.key === forward) next = tabs[(index + 1) % tabs.length];
    else if (event.key === backward) next = tabs[(index - 1 + tabs.length) % tabs.length];
    else if (event.key === 'Home') next = tabs[0];
    else if (event.key === 'End') next = tabs[tabs.length - 1];
    if (!next) return;
    event.preventDefault();
    select(next, { focus: true });
  });

  return { select, tabs };
}

function initFeatureRail() {
  const rail = document.querySelector('.rail');
  if (!rail) return;
  tablist(rail, {
    orientation: 'vertical',
    // On narrow screens the rail is a horizontal chip row that scrolls; keep the chosen chip in
    // view. On desktop the rail never overflows, so this is a no-op there.
    onSelect: (tab) => {
      if (rail.scrollWidth <= rail.clientWidth) return;
      const tabBox = tab.getBoundingClientRect();
      const railBox = rail.getBoundingClientRect();
      const left =
        rail.scrollLeft + tabBox.left - railBox.left - (rail.clientWidth - tabBox.width) / 2;
      rail.scrollTo({ left, behavior: reduced ? 'auto' : 'smooth' });
    },
  });
}

function osHint() {
  const platform = `${navigator.userAgentData?.platform ?? navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  return /win/i.test(platform) ? 'windows' : 'terminal';
}

function initInstallTabs(onPanelShown) {
  const container = document.querySelector('.install-tabs');
  if (!container) return null;
  const hint = container.querySelector('[data-install-hint]');

  const { select, tabs } = tablist(container, {
    orientation: 'horizontal',
    onSelect: (tab) => {
      const kind = tab.dataset.install;
      if (hint) {
        hint.textContent =
          kind === 'windows' ? 'Windows' : kind === 'download' ? 'all platforms' : 'macOS · Linux';
      }
      if (kind === 'download') loadDownloads();
      // A hidden panel measures as zero wide, so re-check the fade once it is visible.
      onPanelShown?.();
    },
  });

  const preferred = tabs.find((tab) => tab.dataset.install === osHint());
  if (preferred) select(preferred);
  return { select, tabs };
}

function initCopyButtons() {
  for (const button of document.querySelectorAll('[data-copy]')) {
    button.addEventListener('click', async () => {
      const code = button.closest('.cmd')?.querySelector('code');
      // The formatter may wrap the command across lines in the HTML; copy it as the one line
      // the page shows.
      const text = code?.textContent?.replace(/\s+/g, ' ').trim();
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Clipboard API can be unavailable (insecure context, permissions); fall back silently,
        // the command is still selectable text.
        return;
      }
      const original = button.textContent;
      button.textContent = '✓ copied';
      button.dataset.copied = 'true';
      setTimeout(() => {
        button.textContent = original;
        button.dataset.copied = 'false';
      }, 1800);
    });
  }
}

/**
 * Marks a command that is wider than its box, so CSS can fade its right edge as a scroll cue, and
 * drops the fade once it is scrolled to the end.
 */
function initCommandFades() {
  const codes = [...document.querySelectorAll('.cmd code')];
  const update = (code) => {
    const hidden = code.scrollWidth - code.clientWidth - code.scrollLeft;
    code.dataset.overflow = String(hidden > 1);
  };
  const updateAll = () => {
    for (const code of codes) update(code);
  };
  for (const code of codes) {
    code.addEventListener('scroll', () => update(code), { passive: true });
  }
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(updateAll);
    for (const code of codes) observer.observe(code);
  } else {
    window.addEventListener('resize', updateAll);
  }
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
  if (/mac-arm64\.dmg$/.test(name)) return { os: 'macOS · Apple Silicon', order: 0 };
  if (/mac-x64\.dmg$/.test(name)) return { os: 'macOS · Intel', order: 1 };
  if (/win-x64\.exe$/.test(name)) return { os: 'Windows x64', order: 2 };
  if (/linux-x86_64\.AppImage$/.test(name)) return { os: 'Linux x86_64', order: 3 };
  if (/linux-amd64\.deb$/.test(name)) return { os: 'Linux (.deb)', order: 4 };
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

  const fallback = () => {
    status.textContent = "Couldn't load release assets automatically.";
    const link = document.createElement('a');
    link.href = RELEASES_PAGE;
    link.textContent = 'See every download on GitHub';
    link.className = 'install-note';
    root.append(link);
  };

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
    fallback();
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
    // Private browsing or a full quota; the fetch already worked, so this is not fatal.
  }
}

function renderDownloads(release, root, status, versionLabel) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const rows = assets
    .map((asset) => ({ asset, meta: describeAsset(asset.name ?? '') }))
    .filter((row) => row.meta && isGithubReleaseAsset(row.asset.browser_download_url))
    .sort((a, b) => a.meta.order - b.meta.order);

  if (rows.length === 0) {
    status.textContent = "This release doesn't have installer assets yet.";
    return;
  }

  status.remove();
  const frag = document.createDocumentFragment();
  for (const { asset, meta } of rows) {
    const a = document.createElement('a');
    a.className = 'dl-button';
    a.href = asset.browser_download_url;
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
    versionLabel.textContent = version ? `Ninebrains ${version} · ` : '';
  }

  const sums = assets.find(
    (asset) => asset.name === 'SHA256SUMS' && isGithubReleaseAsset(asset.browser_download_url)
  );
  if (sums) {
    const note = root.parentElement?.querySelector('.install-note');
    if (note) {
      const link = document.createElement('a');
      link.href = sums.browser_download_url;
      link.textContent = 'SHA256SUMS';
      note.append(' · ', link);
    }
  }
}

function main() {
  runPageIntro();
  initFeatureRail();
  const refreshFades = initCommandFades();
  initInstallTabs(refreshFades);
  initCopyButtons();
}

main();
