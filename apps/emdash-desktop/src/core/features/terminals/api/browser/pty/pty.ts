import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import {
  FileLinkProvider,
  isPrimaryMouseButton,
} from '@core/features/terminals/api/browser/pty/file-link-provider';
import { buildTerminalFontFamily } from '@core/features/terminals/api/browser/pty/terminal-font';
import { confirmOpenExternalLink } from '@core/features/workbench/api/browser/open-external-link';
import { copyTextToClipboard } from '@core/primitives/desktop-host/browser/host-client';
import { log } from '@core/primitives/logging/browser/logger';
import { cssColorToHex, cssVar } from '@core/primitives/styling/browser/cssVars';
import { decodeOsc52ClipboardData } from '../../../browser/pty/pty-clipboard';
import { ensureXtermHost } from '../../../browser/pty/xterm-host';

/**
 * Task-terminal scrollback. The main side retains only 1 MB of output per PTY
 * session for replay, so deep scrollback never survives a restart anyway; 10k
 * lines is an order of magnitude beyond realistic scroll review and cuts the
 * dominant per-terminal memory cost ~10× versus the previous 100k.
 */
const SCROLLBACK_LINES = 10_000;

export const TERMINAL_PADDING_PX = 8;
// The DOM renderer cannot draw custom contiguous block glyphs. Keep xterm's
// default line height so ANSI block QR codes have no vertical seams.
export const TERMINAL_LINE_HEIGHT = 1;
export const TERMINAL_LETTER_SPACING = 0;

// ── Theme helpers ─────────────────────────────────────────────────────────────

export interface SessionTheme {
  override?: ITerminalOptions['theme'];
  /** Optional per-mount bottom inset; other sides retain the standard terminal padding. */
  paddingBottom?: number;
}

export type FrontendPtyConnector = {
  connect(terminal: Terminal): Promise<() => void> | (() => void);
  sendInput?(data: string): void;
  resize?(cols: number, rows: number): void;
};

export function readXtermCssVars(): ITerminalOptions['theme'] {
  const color = (name: string) => cssColorToHex(cssVar(name));
  return {
    background: color('--xterm-bg'),
    foreground: color('--xterm-fg'),
    cursor: color('--xterm-cursor'),
    cursorAccent: color('--xterm-cursor-accent'),
    selectionBackground: color('--xterm-selection-bg'),
    selectionForeground: color('--xterm-selection-fg'),
  };
}

function resolveOverride(override: NonNullable<ITerminalOptions['theme']>) {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(override)) {
    const varName =
      typeof value === 'string' ? /^var\((--[\w-]+)\)$/.exec(value.trim())?.[1] : undefined;
    resolved[key] = varName ? cssColorToHex(cssVar(varName)) : value;
  }
  return resolved as ITerminalOptions['theme'];
}

export function buildTheme(theme?: SessionTheme): ITerminalOptions['theme'] {
  if (theme?.override) return { ...readXtermCssVars(), ...resolveOverride(theme.override) };
  return readXtermCssVars();
}

// ── FrontendPty ───────────────────────────────────────────────────────────────

/**
 * Frontend counterpart to the main-process Pty interface.
 *
 * Owns the xterm Terminal instance for the full lifetime of the session.
 * The terminal is created synchronously during construction and opened into
 * an off-screen container. Call connect() to subscribe to the main-process
 * ring buffer and live IPC events — this writes historical output directly
 * to xterm and sets up ongoing data delivery without any renderer-side buffer.
 *
 * DOM management is handled via mount() / unmount():
 *  - mount()   → appends ownedContainer to the visible mount target
 *  - unmount() → moves ownedContainer back to the off-screen host
 *
 * Lifecycle: created and owned by PtySession (stores/pty-session.ts), one per
 * live session. Survives React component unmounts (e.g. navigating away from a
 * task), and is disposed only when the entity (terminal or conversation) is
 * explicitly deleted.
 */
export class FrontendPty {
  /** All live FrontendPty instances — used for app-wide operations (e.g. theme updates). */
  static readonly all = new Set<FrontendPty>();
  /** Lookup from session ID to live FrontendPty — used by the resize controller to fan out grid resizes. */
  static readonly bySession = new Map<string, FrontendPty>();
  readonly terminal: Terminal;
  readonly ownedContainer: HTMLDivElement;
  private theme?: SessionTheme;
  private offData: (() => void) | null = null;
  /** Ninebrains: GPU renderer, held only while mounted (see attachWebgl). */
  private webgl: WebglAddon | null = null;
  /** Set once WebGL fails to initialise; every terminal stays on the DOM renderer after that. */
  private static webglUnavailable = false;

  constructor(
    readonly sessionId: string,
    theme?: SessionTheme,
    onOpenFile?: (filePath: string) => void,
    onOpenExternal?: (filePath: string) => void,
    private readonly connector: FrontendPtyConnector = noopConnector()
  ) {
    this.theme = theme;
    this.ownedContainer = document.createElement('div');
    Object.assign(this.ownedContainer.style, {
      width: '100%',
      height: '100%',
    });
    ensureXtermHost().appendChild(this.ownedContainer);

    this.terminal = new Terminal({
      cols: 120,
      rows: 32,
      scrollback: SCROLLBACK_LINES,
      // NOTE: convertEol must stay false (the default). The PTY/app owns line
      // discipline; rewriting bare \n to \r\n corrupts raw-mode TUIs (tmux, claude
      // code) that use \n as "line feed, keep column" — yanking the cursor to
      // column 0 and mangling column alignment, while leaving plain shells fine.
      fontFamily: buildTerminalFontFamily(),
      fontSize: 13,
      lineHeight: TERMINAL_LINE_HEIGHT,
      letterSpacing: TERMINAL_LETTER_SPACING,
      allowProposedApi: true,
      macOptionClickForcesSelection: true,
      scrollOnUserInput: false,
      linkHandler: {
        activate: (_event: MouseEvent, text: string) => {
          if (!isPrimaryMouseButton(_event)) return;
          confirmOpenExternalLink(text, (error) => {
            log.warn('FrontendPty: failed to open external link', { text, error });
          });
        },
      },
      theme: buildTheme(theme),
    });

    // Ninebrains: on-screen terminals render with WebGL (attachWebgl), parked ones fall back
    // to the DOM renderer, which is paused off-screen anyway. A canvas renderer clears its
    // canvas synchronously on resize but redraws on the next animation frame, so a resize from
    // a ResizeObserver painted one blank frame: the panel-transition flicker that kept xterm
    // on the DOM renderer before. Rendering synchronously after each resize closes that frame.

    const webLinksAddon = new WebLinksAddon((event, uri) => {
      if (!isPrimaryMouseButton(event)) return;
      event.preventDefault();
      confirmOpenExternalLink(uri);
    });

    this.terminal.loadAddon(webLinksAddon);
    if (onOpenFile && onOpenExternal) {
      this.terminal.registerLinkProvider(
        new FileLinkProvider(this.terminal, onOpenFile, onOpenExternal)
      );
    }

    this.terminal.parser.registerOscHandler(52, (data) => {
      const text = decodeOsc52ClipboardData(data);
      if (text === null) return false;

      void copyTextToClipboard(text).catch((error) => {
        log.warn('FrontendPty: failed to write OSC 52 clipboard payload', { error });
      });
      return true;
    });

    this.terminal.open(this.ownedContainer);
    // Registered after open(), so it runs after the renderer's own resize handler has
    // cleared the canvas.
    this.terminal.onResize(() => {
      if (this.webgl) renderPendingRowsNow(this.terminal);
    });

    // xterm v6 insets .xterm-screen by padding on the .xterm element and subtracts
    // padding-left/padding-top in its coordinate math (getCoordsRelativeToElement),
    // so padding must live here — not on the parent ownedContainer.
    const el = (this.terminal as unknown as { element?: HTMLElement }).element;
    if (el) {
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.boxSizing = 'border-box';
      el.style.padding = `${TERMINAL_PADDING_PX}px`;
      this.applyElementTheme(theme);
    }

    FrontendPty.all.add(this);
    FrontendPty.bySession.set(this.sessionId, this);
  }

  setTheme(theme?: SessionTheme): void {
    this.theme = theme;
    this.terminal.options.theme = buildTheme(theme);
    this.applyElementTheme(theme);
  }

  refreshTheme(): void {
    this.terminal.options.theme = buildTheme(this.theme);
    this.applyElementTheme(this.theme);
  }

  private applyElementTheme(theme?: SessionTheme): void {
    const element = this.terminal.element;
    if (!element) return;
    element.style.paddingBottom = `${theme?.paddingBottom ?? TERMINAL_PADDING_PX}px`;
    element.style.backgroundColor = theme?.override?.background ?? 'var(--xterm-bg)';
  }

  clear(): void {
    this.terminal.clear();
    this.terminal.clearSelection();
  }

  /**
   * Subscribe to the runtime-backed retained output log and mark status as
   * ready once the connector has replayed its snapshot.
   */
  async connect(): Promise<void> {
    this.offData?.();
    this.offData = null;
    this.offData = await this.connector.connect(this.terminal);
  }

  sendInput(data: string): void {
    this.connector.sendInput?.(data);
  }

  resizeBackend(cols: number, rows: number): void {
    this.connector.resize?.(cols, rows);
  }

  /**
   * Append ownedContainer to a visible mount target.
   * If targetDims are provided the terminal is resized BEFORE the appendChild
   * to eliminate the flash caused by a post-mount resize.
   */
  mount(mountTarget: HTMLElement, targetDims?: { cols: number; rows: number }): void {
    if (
      targetDims &&
      (this.terminal.cols !== targetDims.cols || this.terminal.rows !== targetDims.rows)
    ) {
      this.terminal.resize(targetDims.cols, targetDims.rows);
    }
    mountTarget.appendChild(this.ownedContainer);
    this.attachWebgl();
    // Force a repaint after reparenting in the DOM.
    const t = this.terminal;
    requestAnimationFrame(() => {
      try {
        if ((t as unknown as { _isDisposed?: boolean })._isDisposed) return;
        t.refresh(0, t.rows - 1);
      } catch {}
    });
  }

  /**
   * Move ownedContainer back to the off-screen host (tab deactivated /
   * TerminalPane unmounting).  Must be called after all ResizeObservers on
   * the visible mount target have been disconnected.
   *
   * While parked, xterm's render service pauses itself: the host sits outside
   * the viewport, so the core IntersectionObserver reports zero intersection
   * and refreshes are skipped until the terminal is mounted again. The text
   * buffer stays intact for an instant, pixel-faithful restore.
   */
  unmount(): void {
    this.detachWebgl();
    ensureXtermHost().appendChild(this.ownedContainer);
  }

  /**
   * Chromium caps live WebGL contexts per page (about 16) and drops the oldest past that, so
   * only mounted terminals hold one; FrontendPty keeps every terminal alive, parked ones too.
   */
  private attachWebgl(): void {
    if (this.webgl || FrontendPty.webglUnavailable) return;
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => this.detachWebgl());
      this.terminal.loadAddon(addon);
      this.webgl = addon;
      // Swapping renderers leaves an empty canvas until the next frame; fill it now.
      renderPendingRowsNow(this.terminal);
    } catch (error) {
      FrontendPty.webglUnavailable = true;
      log.warn('FrontendPty: WebGL unavailable, using the DOM renderer', { error: String(error) });
    }
  }

  private detachWebgl(): void {
    const addon = this.webgl;
    this.webgl = null;
    try {
      addon?.dispose();
    } catch {}
  }

  /**
   * Permanently dispose this session (terminal or conversation deleted).
   * Tears down the runtime output binding, disposes the xterm Terminal, and
   * removes the owned container from the DOM.
   */
  dispose(): void {
    FrontendPty.all.delete(this);
    FrontendPty.bySession.delete(this.sessionId);
    this.offData?.();
    this.offData = null;
    this.detachWebgl();
    try {
      this.terminal.dispose();
    } catch {}
    try {
      this.ownedContainer.remove();
    } catch {}
  }
}

function noopConnector(): FrontendPtyConnector {
  return {
    connect() {
      return () => {};
    },
  };
}

// ── Session lookup ────────────────────────────────────────────────────────────

/** Returns the live FrontendPty for the given session ID, or undefined if not yet connected. */
export function getFrontendPty(sessionId: string): FrontendPty | undefined {
  return FrontendPty.bySession.get(sessionId);
}

// ── App-wide helpers ──────────────────────────────────────────────────────────

/** Apply a theme to all live terminals. Called on app-level theme change. */
export function applyThemeToAll(theme?: SessionTheme): void {
  for (const pty of FrontendPty.all) {
    if (theme) {
      pty.setTheme(theme);
    } else {
      pty.refreshTheme();
    }
  }
}

/** Dispose all live FrontendPty instances. Called on app teardown. */
export function disposeAllPtys(): void {
  for (const pty of [...FrontendPty.all]) {
    pty.dispose();
  }
}

/**
 * Renders xterm's pending rows now instead of on its next animation frame. xterm has no public
 * API for this, so it reaches the render debouncer through private fields and does nothing if
 * a future version renames them (the frame is then just drawn one frame later, as before).
 */
function renderPendingRowsNow(terminal: Terminal): void {
  type Internals = {
    _core?: { _renderService?: { _renderDebouncer?: { _innerRefresh?: () => void } } };
  };
  const debouncer = (terminal as unknown as Internals)._core?._renderService?._renderDebouncer;
  if (typeof debouncer?._innerRefresh !== 'function') return;
  try {
    debouncer._innerRefresh();
  } catch {}
}
