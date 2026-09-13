/**
 * The screenshot gate's `captureScreenshot`, over the Chrome DevTools Protocol
 * (plan 4.2, SEAMS §3.12). Electron-free on purpose: `electron-gate-host.ts`
 * adapts a `WebContents` to `CdpTargetLike`, and tests use a fake debugger.
 *
 * For each call (one viewport): attach the debugger (protocol 1.3), enable
 * Page/Runtime/Log/Network, set the device metrics, navigate to the preview,
 * wait for `load` plus a short settle, capture a PNG, then clear the metrics
 * and detach in `finally`.
 *
 * - SEC-24: only the lane's own local preview (http/https on loopback) is ever
 *   captured, so a logged-in third-party site never ends up in evidence.
 * - SEC-25: attaches only to a lane *webview* found by browserId, on the lane's
 *   partition; never to the app window or DevTools. If DevTools is open on the
 *   webview (or another debugger holds it), the gate is skipped, not faked.
 * - No mounted webview (unattended runs): an offscreen window on the lane's
 *   partition, or an ephemeral per-lane one, destroyed afterwards.
 * - Every command has its own deadline, so a target that never answers fails
 *   this capture instead of holding the whole gate until its time limit.
 */
import {
  GatePreconditionError,
  type FailedRequest,
  type ScreenshotCapture,
  type Viewport,
} from '@emdash/gates-core';
import type { LaneBrowserTarget, ScreenshotHost } from '@core/features/gates/node/runner/ports';

export interface CdpDebuggerLike {
  attach(protocolVersion: string): void;
  detach(): void;
  isAttached(): boolean;
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Returns an unsubscribe function. */
  onMessage(listener: (method: string, params: unknown) => void): () => void;
  onDetach(listener: (reason: string) => void): () => void;
}

export interface CdpTargetLike {
  readonly debugger: CdpDebuggerLike;
  isDestroyed(): boolean;
  isDevToolsOpened(): boolean;
  /** Electron's `WebContents.getType()`: `webview`, `window`, `offscreen`, … */
  getType(): string;
  /** True when the contents use the session of `partition`. */
  usesPartition?(partition: string): boolean;
}

export interface OffscreenTarget {
  contents: CdpTargetLike;
  destroy(): void;
}

export interface CdpGateHostDeps {
  /** `BrowserWebContentsRegistry.getWebContents`, adapted. */
  getWebContents(browserId: string): CdpTargetLike | undefined;
  /** Opens a hidden offscreen window on `partition`. Omit to disable the fallback. */
  createOffscreen?(partition: string): Promise<OffscreenTarget>;
  /** `offscreen` always uses the fallback (unattended runs). Default `auto`. */
  mode?: 'auto' | 'offscreen';
  loadTimeoutMs?: number;
  /** Time after `load` to catch late console errors. Default 300 ms. */
  settleMs?: number;
  /** How long each CDP command may take to answer. Default 15 s. */
  commandTimeoutMs?: number;
}

/**
 * A `GatePreconditionError`: this reason is an environment state (DevTools
 * open, another debugger attached), never something the worker's change can
 * fix, so the screenshot gate must not spend a self-heal attempt on it.
 */
export class GateSkippedError extends GatePreconditionError {
  constructor(reason: string) {
    super(`gate skipped: ${reason}`);
    this.name = 'GateSkippedError';
  }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const LANE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 500;

/** SEC-24: the gate captures the lane's local preview and nothing else. */
export function assertLanePreviewUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('refused: the preview URL is not a valid URL');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    !LOOPBACK.has(parsed.hostname)
  ) {
    throw new Error(
      "refused: the screenshot gate only captures the lane's local preview (http://localhost:<port>)"
    );
  }
  return parsed;
}

interface RemoteObject {
  type?: string;
  value?: unknown;
  description?: string;
}

/** The fields read from the CDP events this host listens to. */
interface CdpEventParams {
  type?: string;
  args?: RemoteObject[];
  exceptionDetails?: { text?: string; exception?: { description?: string } };
  entry?: { level?: string; source?: string; text?: string };
  requestId?: string;
  request?: { url?: string };
  response?: { url?: string; status?: number };
  errorText?: string;
  canceled?: boolean;
}

const clip = (text: string) =>
  text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS - 1)}…` : text;

function describeArgs(args: RemoteObject[] | undefined): string {
  return (args ?? [])
    .map((arg) =>
      typeof arg.value === 'string'
        ? arg.value
        : arg.value !== undefined
          ? JSON.stringify(arg.value)
          : (arg.description ?? arg.type ?? '')
    )
    .join(' ');
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('aborted'));
      },
      { once: true }
    );
  });
}

/** Rejects when `work` has not settled within `ms`, naming the CDP method that went quiet. */
function answerWithin<T>(work: Promise<T>, ms: number, method: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`the browser did not answer ${method} within ${ms} ms`)),
      ms
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function captureWith(
  contents: CdpTargetLike,
  viewport: Viewport,
  preview: URL,
  signal: AbortSignal,
  options: { loadTimeoutMs: number; settleMs: number; commandTimeoutMs: number }
): Promise<ScreenshotCapture> {
  const dbg = contents.debugger;
  const consoleErrors: string[] = [];
  const failedRequests: FailedRequest[] = [];
  const requests = new Map<string, string>();
  const sameOrigin = (url: string) => {
    try {
      return new URL(url).origin === preview.origin;
    } catch {
      return false;
    }
  };
  const pushError = (text: string) => {
    if (consoleErrors.length < MAX_MESSAGES) consoleErrors.push(clip(text));
  };

  let navigating = false;
  let onLoad = () => undefined as void;
  const loaded = new Promise<void>((resolve) => {
    onLoad = resolve;
  });
  let onDetached: (error: Error) => void = () => undefined;
  const detached = new Promise<never>((_resolve, reject) => {
    onDetached = reject;
  });
  detached.catch(() => undefined);

  const stopMessages = dbg.onMessage((method, raw) => {
    const params = (raw ?? {}) as CdpEventParams;
    switch (method) {
      case 'Runtime.consoleAPICalled':
        if (params.type === 'error' || params.type === 'assert')
          pushError(describeArgs(params.args));
        break;
      case 'Runtime.exceptionThrown': {
        const details = params.exceptionDetails ?? {};
        pushError(details.exception?.description ?? details.text ?? 'Uncaught exception');
        break;
      }
      case 'Log.entryAdded':
        // Network log lines duplicate Network.* and include third-party failures.
        if (params.entry?.level === 'error' && params.entry?.source !== 'network')
          pushError(String(params.entry.text ?? 'error'));
        break;
      case 'Network.requestWillBeSent':
        if (typeof params.requestId === 'string' && typeof params.request?.url === 'string')
          requests.set(params.requestId, params.request.url);
        break;
      case 'Network.responseReceived': {
        const { url, status } = params.response ?? {};
        if (
          typeof url === 'string' &&
          typeof status === 'number' &&
          status >= 400 &&
          sameOrigin(url)
        )
          failedRequests.push({ url, status });
        break;
      }
      case 'Network.loadingFailed': {
        const url = params.requestId ? requests.get(params.requestId) : undefined;
        if (url && sameOrigin(url) && !params.canceled)
          failedRequests.push({ url, error: String(params.errorText ?? 'failed') });
        break;
      }
      case 'Page.loadEventFired':
        if (navigating) onLoad();
        break;
    }
  });
  const stopDetach = dbg.onDetach((reason) => {
    onDetached(
      new GateSkippedError(
        contents.isDevToolsOpened() ? 'devtools open' : `debugger detached (${reason})`
      )
    );
  });
  const aborted = new Promise<never>((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), {
      once: true,
    });
  });
  aborted.catch(() => undefined);
  const guard = <T>(work: Promise<T>) => Promise.race([work, detached, aborted]);
  const send = (method: string, params?: Record<string, unknown>) =>
    guard(answerWithin(dbg.sendCommand(method, params), options.commandTimeoutMs, method));

  dbg.attach('1.3');
  try {
    for (const domain of ['Page', 'Runtime', 'Log', 'Network']) await send(`${domain}.enable`);
    await send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width < 768,
    });
    navigating = true;
    const navigation = (await send('Page.navigate', { url: preview.href })) as {
      errorText?: string;
    } | null;
    if (navigation?.errorText) {
      throw new Error(
        `the preview at ${preview.href} could not be loaded: ${navigation.errorText}`
      );
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(`the preview did not finish loading within ${options.loadTimeoutMs} ms`)
          ),
        options.loadTimeoutMs
      );
    });
    try {
      await guard(Promise.race([loaded, timeout]));
    } finally {
      clearTimeout(timer);
    }
    await guard(delay(options.settleMs, signal));
    const shot = (await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    })) as { data?: string } | null;
    if (typeof shot?.data !== 'string') throw new Error('the browser returned no screenshot');
    return {
      png: Uint8Array.from(Buffer.from(shot.data, 'base64')),
      consoleErrors: [...new Set(consoleErrors)],
      failedRequests,
    };
  } finally {
    stopMessages();
    stopDetach();
    if (dbg.isAttached()) {
      await answerWithin(
        dbg.sendCommand('Emulation.clearDeviceMetricsOverride'),
        options.commandTimeoutMs,
        'Emulation.clearDeviceMetricsOverride'
      ).catch(() => undefined);
      try {
        dbg.detach();
      } catch {
        // Already gone with its target.
      }
    }
  }
}

export function createCdpGateHost(deps: CdpGateHostDeps): ScreenshotHost {
  const options = {
    loadTimeoutMs: deps.loadTimeoutMs ?? 30_000,
    settleMs: deps.settleMs ?? 300,
    commandTimeoutMs: deps.commandTimeoutMs ?? 15_000,
  };

  function laneWebview(target: LaneBrowserTarget): CdpTargetLike | undefined {
    if (deps.mode === 'offscreen' || !target.browserId) return undefined;
    const contents = deps.getWebContents(target.browserId);
    if (!contents || contents.isDestroyed()) return undefined;
    if (contents.getType() !== 'webview') {
      throw new Error("refused: the gate attaches only to a lane's webview (SEC-25)");
    }
    if (target.partition && contents.usesPartition && !contents.usesPartition(target.partition)) {
      throw new Error("refused: the webview is not on the lane's partition (SEC-25)");
    }
    if (contents.isDevToolsOpened()) throw new GateSkippedError('devtools open');
    if (contents.debugger.isAttached()) {
      throw new GateSkippedError('another debugger is attached to the lane browser');
    }
    return contents;
  }

  return {
    async capture(target, viewport, { url, signal }) {
      const preview = assertLanePreviewUrl(url);
      signal.throwIfAborted();
      const mounted = laneWebview(target);
      if (mounted) return captureWith(mounted, viewport, preview, signal, options);

      if (!deps.createOffscreen)
        throw new Error('no lane browser is mounted to capture the preview');
      if (!LANE_ID.test(target.laneId)) throw new Error('refused: invalid lane id');
      // An in-memory partition (no `persist:`) when the lane's own is unknown.
      const offscreen = await deps.createOffscreen(target.partition ?? `nb-gate-${target.laneId}`);
      try {
        return await captureWith(offscreen.contents, viewport, preview, signal, options);
      } finally {
        offscreen.destroy();
      }
    },
  };
}
