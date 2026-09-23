import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import type { DesktopUpdateEvent } from '@core/features/updates/api';
import { getHostClient } from '@core/primitives/desktop-host/browser/host-client';
import { getUpdatesClient } from '../api/browser/client';

export type DownloadProgress = {
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
};

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; info?: { version: string } }
  | { status: 'not-available' }
  | { status: 'downloading'; progress?: DownloadProgress }
  | { status: 'downloaded' }
  | { status: 'installing' }
  | { status: 'error'; message: string };

export class UpdateStore {
  state: UpdateState = { status: 'idle' };
  currentVersion = '';
  availableVersion: string | undefined = undefined;

  constructor() {
    makeObservable(this, {
      state: observable,
      currentVersion: observable,
      availableVersion: observable,
      setState: action,
      hasUpdate: computed,
      progressLabel: computed,
    });
  }

  get hasUpdate(): boolean {
    const { status } = this.state;
    return status === 'available' || status === 'downloading' || status === 'downloaded';
  }

  setState(state: UpdateState): void {
    this.state = state;
  }

  get progressLabel(): string {
    if (this.state.status !== 'downloading') return '';
    const p = this.state.progress?.percent ?? 0;
    return `${p.toFixed(0)}%`;
  }

  start(): void {
    void this._startWire();

    void getHostClient().then((client) => {
      void client.events.subscribe(undefined, {
        onEvent: (event) => {
          if (event.type === 'menu-check-for-updates') void this.check();
        },
        onGap: () => {},
      });
    });
  }

  async check(): Promise<void> {
    runInAction(() => {
      this.state = { status: 'checking' };
    });
    try {
      const client = await getUpdatesClient();
      const res = await client.check(undefined);
      if (!res) {
        runInAction(() => {
          this.state = { status: 'error', message: 'Update API unavailable' };
        });
        return;
      }
      if (!res.success) {
        runInAction(() => {
          this.state = { status: 'error', message: res.error ?? 'Failed to check for updates' };
        });
      } else if (res.result === null) {
        runInAction(() => {
          this.state = { status: 'not-available' };
        });
      }
    } catch {
      runInAction(() => {
        this.state = { status: 'error', message: 'Failed to check for updates' };
      });
    }
  }

  async download(): Promise<void> {
    try {
      const client = await getUpdatesClient();
      const res = await client.download(undefined);
      if (!res) {
        runInAction(() => {
          this.state = { status: 'error', message: 'Update API unavailable' };
        });
        return;
      }
      if (!res.success) {
        const message = res.error ?? 'Failed to download update';
        runInAction(() => {
          this.state = { status: 'error', message };
        });
      }
    } catch {
      runInAction(() => {
        this.state = { status: 'error', message: 'Failed to download update' };
      });
    }
  }

  async install(): Promise<void> {
    runInAction(() => {
      this.state = { status: 'installing' };
    });
    try {
      const client = await getUpdatesClient();
      const res = await client.quitAndInstall(undefined);
      if (!res) {
        runInAction(() => {
          this.state = { status: 'error', message: 'Update API unavailable' };
        });
        return;
      }
      if (!res.success) {
        runInAction(() => {
          this.state = { status: 'error', message: res.error ?? 'Failed to install update' };
        });
      }
    } catch {
      runInAction(() => {
        this.state = { status: 'error', message: 'Failed to install update' };
      });
    }
  }

  async openLatest(): Promise<void> {
    try {
      const client = await getUpdatesClient();
      await client.openLatest(undefined);
    } catch {
      // openLatest quits the app — errors are best-effort
    }
  }

  private async _startWire(): Promise<void> {
    const client = await getUpdatesClient();
    await client.events.subscribe(undefined, {
      onEvent: (event) => this._applyEvent(event),
      onGap: () => void this._refreshWireState(),
    });
    await this._refreshWireState();
    await this.check();
  }

  private async _refreshWireState(): Promise<void> {
    const client = await getUpdatesClient();
    const result = await client.getState(undefined);
    if (!result.success) return;
    runInAction(() => {
      this.currentVersion = result.data.currentVersion;
      this.availableVersion = result.data.availableVersion;
      switch (result.data.status) {
        case 'available':
          this.state = {
            status: 'available',
            info: result.data.availableVersion
              ? { version: result.data.availableVersion }
              : undefined,
          };
          break;
        case 'downloading':
          this.state = { status: 'downloading', progress: result.data.downloadProgress };
          break;
        case 'error':
          this.state = { status: 'error', message: result.data.error ?? 'Update failed' };
          break;
        case 'idle':
        case 'checking':
        case 'downloaded':
        case 'installing':
          this.state = { status: result.data.status };
          break;
      }
    });
  }

  private _applyEvent(event: DesktopUpdateEvent): void {
    runInAction(() => {
      switch (event.type) {
        case 'checking':
          this.state = { status: 'checking' };
          break;
        case 'available':
          this.availableVersion = event.version;
          this.state = { status: 'available', info: { version: event.version } };
          break;
        case 'not-available':
          this.state = { status: 'not-available' };
          break;
        case 'downloading':
          this.state = { status: 'downloading', progress: { percent: 0 } };
          break;
        case 'progress':
          this.state = {
            status: 'downloading',
            progress: {
              percent: event.percent,
              transferred: event.transferred,
              total: event.total,
              bytesPerSecond: event.bytesPerSecond,
            },
          };
          break;
        case 'downloaded':
          this.state = { status: 'downloaded' };
          break;
        case 'installing':
          this.state = { status: 'installing' };
          break;
        case 'error':
          this.state = { status: 'error', message: event.message };
          break;
      }
    });
  }
}
