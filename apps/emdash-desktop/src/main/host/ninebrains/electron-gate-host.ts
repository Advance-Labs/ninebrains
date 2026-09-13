/**
 * Electron side of the CDP gate host: adapts lane webviews from
 * `BrowserWebContentsRegistry` and offscreen windows to `CdpTargetLike`.
 */
import { BrowserWindow, session, type Session, type WebContents } from 'electron';
import type { ScreenshotHost } from '@core/features/gates/node/runner/ports';
import { browserWebContentsRegistry } from '../browser/browser-webcontents-registry';
import { createCdpGateHost, type CdpGateHostDeps, type CdpTargetLike } from './cdp-gate-host';

function asCdpTarget(contents: WebContents): CdpTargetLike {
  const dbg = contents.debugger;
  return {
    debugger: {
      attach: (version) => dbg.attach(version),
      detach: () => dbg.detach(),
      isAttached: () => dbg.isAttached(),
      sendCommand: (method, params) => dbg.sendCommand(method, params),
      onMessage(listener) {
        const handler = (_event: unknown, method: string, params: unknown) =>
          listener(method, params);
        dbg.on('message', handler);
        return () => dbg.removeListener('message', handler);
      },
      onDetach(listener) {
        const handler = (_event: unknown, reason: string) => listener(reason);
        dbg.on('detach', handler);
        return () => dbg.removeListener('detach', handler);
      },
    },
    isDestroyed: () => contents.isDestroyed(),
    isDevToolsOpened: () => contents.isDevToolsOpened(),
    getType: () => contents.getType(),
    usesPartition: (partition) => contents.session === session.fromPartition(partition),
  };
}

const hardened = new WeakSet<Session>();

/** SEC-25: gate windows never download files or open popups. */
function hardenGateSession(target: Session): void {
  if (hardened.has(target)) return;
  hardened.add(target);
  target.on('will-download', (event) => event.preventDefault());
}

async function createOffscreenWindow(partition: string) {
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    webPreferences: {
      offscreen: true,
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  hardenGateSession(win.webContents.session);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // A window that has loaded nothing has no renderer yet, and CDP commands sent to it (the first
  // is `Page.enable`) never answer. A blank page gives it one before the gate attaches.
  await win.loadURL('about:blank');
  return {
    contents: asCdpTarget(win.webContents),
    destroy: () => {
      if (!win.isDestroyed()) win.destroy();
    },
  };
}

export function createElectronCdpGateHost(
  options: Pick<CdpGateHostDeps, 'mode' | 'loadTimeoutMs' | 'settleMs'> = {}
): ScreenshotHost {
  return createCdpGateHost({
    getWebContents(browserId) {
      const contents = browserWebContentsRegistry.getWebContents(browserId);
      return contents ? asCdpTarget(contents) : undefined;
    },
    createOffscreen: createOffscreenWindow,
    ...options,
  });
}
