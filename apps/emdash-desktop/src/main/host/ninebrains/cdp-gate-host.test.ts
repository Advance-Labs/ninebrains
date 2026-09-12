import type { Viewport } from '@emdash/gates-core';
import { describe, expect, it, vi } from 'vitest';
import {
  GateSkippedError,
  createCdpGateHost,
  type CdpDebuggerLike,
  type CdpGateHostDeps,
  type CdpTargetLike,
} from './cdp-gate-host';

const PREVIEW = 'http://127.0.0.1:5173/';
const DESKTOP: Viewport = { label: 'desktop', width: 1440, height: 900 };
const VIEWPORTS: Viewport[] = [
  DESKTOP,
  { label: 'tablet', width: 768, height: 1024 },
  { label: 'mobile', width: 390, height: 844 },
];
const PNG_B64 = Buffer.from('fake-png').toString('base64');

type Event = [method: string, params: unknown];

/** A scripted CDP debugger: `Page.navigate` replays `events`, then fires `load`. */
class FakeDebugger implements CdpDebuggerLike {
  attached = false;
  readonly commands: Array<{ method: string; params?: Record<string, unknown> }> = [];
  readonly attachVersions: string[] = [];
  private messageListeners = new Set<(method: string, params: unknown) => void>();
  private detachListeners = new Set<(reason: string) => void>();
  failOn: string | undefined;
  hangOn: string | undefined;

  constructor(private readonly events: Event[] = []) {}

  attach(version: string) {
    this.attached = true;
    this.attachVersions.push(version);
  }
  detach() {
    this.attached = false;
  }
  isAttached() {
    return this.attached;
  }
  onMessage(listener: (method: string, params: unknown) => void) {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }
  onDetach(listener: (reason: string) => void) {
    this.detachListeners.add(listener);
    return () => this.detachListeners.delete(listener);
  }
  get listenerCount() {
    return this.messageListeners.size + this.detachListeners.size;
  }
  emit(method: string, params: unknown) {
    for (const listener of this.messageListeners) listener(method, params);
  }
  forceDetach(reason: string) {
    this.attached = false;
    for (const listener of this.detachListeners) listener(reason);
  }
  async sendCommand(method: string, params?: Record<string, unknown>) {
    this.commands.push({ method, params });
    if (method === this.failOn) throw new Error(`${method} failed`);
    if (method === this.hangOn) return new Promise(() => undefined);
    if (method === 'Page.navigate') {
      queueMicrotask(() => {
        for (const [m, p] of this.events) this.emit(m, p);
        this.emit('Page.loadEventFired', {});
      });
      return { frameId: 'f1' };
    }
    if (method === 'Page.captureScreenshot') return { data: PNG_B64 };
    return {};
  }
}

function webview(dbg = new FakeDebugger(), overrides: Partial<CdpTargetLike> = {}) {
  return {
    debugger: dbg,
    isDestroyed: () => false,
    isDevToolsOpened: () => false,
    getType: () => 'webview',
    ...overrides,
  } satisfies CdpTargetLike;
}

function host(deps: Partial<CdpGateHostDeps> & Pick<CdpGateHostDeps, 'getWebContents'>) {
  return createCdpGateHost({ settleMs: 0, loadTimeoutMs: 500, ...deps });
}

const signal = () => new AbortController().signal;
const lane = { laneId: 'lane1', browserId: 'b1' };

describe('CDP gate host', () => {
  it('captures each viewport with a device-metrics override, then detaches', async () => {
    const dbg = new FakeDebugger();
    const h = host({ getWebContents: () => webview(dbg) });
    for (const viewport of VIEWPORTS) {
      const capture = await h.capture(lane, viewport, { url: PREVIEW, signal: signal() });
      expect(Buffer.from(capture.png).toString()).toBe('fake-png');
      expect(dbg.attached).toBe(false);
    }
    expect(dbg.attachVersions).toEqual(['1.3', '1.3', '1.3']);
    const metrics = dbg.commands.filter((c) => c.method === 'Emulation.setDeviceMetricsOverride');
    expect(metrics.map((c) => [c.params?.width, c.params?.mobile])).toEqual([
      [1440, false],
      [768, false],
      [390, true],
    ]);
    expect(dbg.commands.filter((c) => c.method === 'Page.navigate')[0]?.params).toEqual({
      url: PREVIEW,
    });
    expect(
      dbg.commands.filter((c) => c.method === 'Emulation.clearDeviceMetricsOverride')
    ).toHaveLength(3);
    expect(dbg.listenerCount).toBe(0);
  });

  it('collects console errors and exceptions, and same-origin network failures only', async () => {
    const dbg = new FakeDebugger([
      ['Runtime.consoleAPICalled', { type: 'log', args: [{ type: 'string', value: 'hello' }] }],
      ['Runtime.consoleAPICalled', { type: 'error', args: [{ type: 'string', value: 'boom' }] }],
      [
        'Runtime.exceptionThrown',
        { exceptionDetails: { exception: { description: 'TypeError: x' } } },
      ],
      ['Log.entryAdded', { entry: { level: 'error', source: 'security', text: 'CSP blocked' } }],
      ['Log.entryAdded', { entry: { level: 'error', source: 'network', text: '404 elsewhere' } }],
      ['Network.requestWillBeSent', { requestId: 'r1', request: { url: `${PREVIEW}app.js` } }],
      ['Network.loadingFailed', { requestId: 'r1', errorText: 'net::ERR_CONNECTION_RESET' }],
      ['Network.requestWillBeSent', { requestId: 'r2', request: { url: 'https://cdn.test/x.js' } }],
      ['Network.loadingFailed', { requestId: 'r2', errorText: 'net::ERR_BLOCKED' }],
      ['Network.responseReceived', { response: { url: `${PREVIEW}logo.png`, status: 404 } }],
      ['Network.responseReceived', { response: { url: 'https://cdn.test/y.png', status: 500 } }],
    ]);
    const capture = await host({ getWebContents: () => webview(dbg) }).capture(lane, DESKTOP, {
      url: PREVIEW,
      signal: signal(),
    });
    expect(capture.consoleErrors).toEqual(['boom', 'TypeError: x', 'CSP blocked']);
    expect(capture.failedRequests).toEqual([
      { url: `${PREVIEW}app.js`, error: 'net::ERR_CONNECTION_RESET' },
      { url: `${PREVIEW}logo.png`, status: 404 },
    ]);
  });

  it('skips the gate when DevTools is open on the lane webview', async () => {
    const dbg = new FakeDebugger();
    const h = host({ getWebContents: () => webview(dbg, { isDevToolsOpened: () => true }) });
    await expect(h.capture(lane, DESKTOP, { url: PREVIEW, signal: signal() })).rejects.toThrow(
      'gate skipped: devtools open'
    );
    expect(dbg.attachVersions).toEqual([]);
  });

  it('skips when another debugger already holds the webview', async () => {
    const dbg = new FakeDebugger();
    dbg.attached = true;
    const h = host({ getWebContents: () => webview(dbg) });
    await expect(h.capture(lane, DESKTOP, { url: PREVIEW, signal: signal() })).rejects.toThrow(
      GateSkippedError
    );
  });

  it('reports DevTools opening mid-capture as a skip, and cleans up', async () => {
    const dbg = new FakeDebugger();
    dbg.hangOn = 'Page.captureScreenshot';
    let devtools = false;
    const h = host({ getWebContents: () => webview(dbg, { isDevToolsOpened: () => devtools }) });
    const capture = h.capture(lane, DESKTOP, { url: PREVIEW, signal: signal() });
    await vi.waitFor(() =>
      expect(dbg.commands.some((c) => c.method === 'Page.captureScreenshot')).toBe(true)
    );
    devtools = true;
    dbg.forceDetach('Replaced by client');
    await expect(capture).rejects.toThrow('gate skipped: devtools open');
    expect(dbg.listenerCount).toBe(0);
  });

  it('detaches when a command fails', async () => {
    const dbg = new FakeDebugger();
    dbg.failOn = 'Page.captureScreenshot';
    const h = host({ getWebContents: () => webview(dbg) });
    await expect(h.capture(lane, DESKTOP, { url: PREVIEW, signal: signal() })).rejects.toThrow(
      'Page.captureScreenshot failed'
    );
    expect(dbg.attached).toBe(false);
    expect(dbg.listenerCount).toBe(0);
  });

  it('detaches when the run is aborted', async () => {
    const dbg = new FakeDebugger();
    dbg.hangOn = 'Page.captureScreenshot';
    const controller = new AbortController();
    const h = host({ getWebContents: () => webview(dbg) });
    const capture = h.capture(lane, DESKTOP, { url: PREVIEW, signal: controller.signal });
    await vi.waitFor(() =>
      expect(dbg.commands.some((c) => c.method === 'Page.captureScreenshot')).toBe(true)
    );
    controller.abort(new Error('stop'));
    await expect(capture).rejects.toThrow('stop');
    expect(dbg.attached).toBe(false);
  });

  it('fails when the preview does not load in time', async () => {
    const dbg = new FakeDebugger();
    dbg.sendCommand = async (method, params) => {
      dbg.commands.push({ method, params });
      return method === 'Page.navigate' ? { frameId: 'f' } : {};
    };
    const h = host({ getWebContents: () => webview(dbg), loadTimeoutMs: 20 });
    await expect(h.capture(lane, DESKTOP, { url: PREVIEW, signal: signal() })).rejects.toThrow(
      'did not finish loading'
    );
    expect(dbg.attached).toBe(false);
  });

  it('falls back to an offscreen window on the lane partition and destroys it', async () => {
    const dbg = new FakeDebugger();
    const destroy = vi.fn();
    const createOffscreen = vi.fn(async (_partition: string) => ({
      contents: webview(dbg),
      destroy,
    }));
    const h = host({ getWebContents: () => undefined, createOffscreen });

    await h.capture({ laneId: 'lane1', browserId: 'gone', partition: 'persist:lane1' }, DESKTOP, {
      url: PREVIEW,
      signal: signal(),
    });
    await h.capture({ laneId: 'lane2' }, DESKTOP, { url: PREVIEW, signal: signal() });

    expect(createOffscreen.mock.calls.map((c) => c[0])).toEqual(['persist:lane1', 'nb-gate-lane2']);
    expect(destroy).toHaveBeenCalledTimes(2);
  });

  it('unattended mode always uses the offscreen fallback, destroyed even on error', async () => {
    const dbg = new FakeDebugger();
    dbg.failOn = 'Page.navigate';
    const destroy = vi.fn();
    const getWebContents = vi.fn();
    const h = host({
      mode: 'offscreen',
      getWebContents,
      createOffscreen: async () => ({ contents: webview(dbg), destroy }),
    });
    await expect(h.capture(lane, DESKTOP, { url: PREVIEW, signal: signal() })).rejects.toThrow();
    expect(getWebContents).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe('SEC-25 CDP scope', () => {
  it('refuses anything that is not a lane webview (the app window, DevTools)', async () => {
    const dbg = new FakeDebugger();
    for (const type of ['window', 'browserView', 'remote']) {
      const h = host({ getWebContents: () => webview(dbg, { getType: () => type }) });
      await expect(h.capture(lane, DESKTOP, { url: PREVIEW, signal: signal() })).rejects.toThrow(
        'SEC-25'
      );
    }
    expect(dbg.attachVersions).toEqual([]);
  });

  it("refuses a webview that is not on the lane's partition", async () => {
    const h = host({
      getWebContents: () => webview(new FakeDebugger(), { usesPartition: () => false }),
    });
    await expect(
      h.capture({ ...lane, partition: 'persist:lane1' }, DESKTOP, {
        url: PREVIEW,
        signal: signal(),
      })
    ).rejects.toThrow('SEC-25');
  });

  it('SEC-24: captures only the local preview, never a third-party site', async () => {
    const dbg = new FakeDebugger();
    const h = host({ getWebContents: () => webview(dbg) });
    for (const url of [
      'https://mail.example.com/',
      'file:///etc/passwd',
      'http://10.0.0.1/',
      'x',
    ]) {
      await expect(h.capture(lane, DESKTOP, { url, signal: signal() })).rejects.toThrow('refused');
    }
    await expect(
      h.capture(lane, DESKTOP, { url: 'http://localhost:3000/', signal: signal() })
    ).resolves.toBeDefined();
    expect(dbg.attachVersions).toEqual(['1.3']);
  });

  it('rejects an unsafe lane id before naming a partition after it', async () => {
    const createOffscreen = vi.fn();
    const h = host({ getWebContents: () => undefined, createOffscreen });
    await expect(
      h.capture({ laneId: '../x' }, DESKTOP, { url: PREVIEW, signal: signal() })
    ).rejects.toThrow('invalid lane id');
    expect(createOffscreen).not.toHaveBeenCalled();
  });
});
