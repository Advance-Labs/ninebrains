import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import { shouldShowReleaseNotice, type ReleaseCheckStatus } from '../api';
import { getReleaseCheckClient, type ReleaseCheckClient } from '../api/browser/client';

/** App-scoped mirror of main's release-check status. Main owns every decision and the fetch. */
export class ReleaseCheckStore {
  status: ReleaseCheckStatus | null = null;
  /** Set while a "Check now" press is waiting on main. */
  checking = false;

  constructor(
    private readonly getClient: () => Promise<ReleaseCheckClient> = getReleaseCheckClient
  ) {
    makeObservable(this, {
      status: observable.ref,
      checking: observable,
      setStatus: action,
      showNotice: computed,
    });
  }

  get showNotice(): boolean {
    return shouldShowReleaseNotice(this.status);
  }

  setStatus(status: ReleaseCheckStatus): void {
    this.status = status;
  }

  start(): void {
    void this.subscribe().catch(() => {
      // The notice is optional chrome; a missing domain must not break the workbench.
    });
  }

  async check(): Promise<void> {
    runInAction(() => {
      this.checking = true;
    });
    try {
      const client = await this.getClient();
      this.setStatus(await client.check(undefined));
    } catch {
      // Failures are reported in status.lastFailure by main; a transport error changes nothing.
    } finally {
      runInAction(() => {
        this.checking = false;
      });
    }
  }

  async dismiss(version: string): Promise<void> {
    const previous = this.status;
    if (previous) this.setStatus({ ...previous, dismissedVersion: version });
    try {
      const client = await this.getClient();
      const result = await client.dismiss({ version });
      if (!result.success && previous) this.setStatus(previous);
    } catch {
      if (previous) this.setStatus(previous);
    }
  }

  private async subscribe(): Promise<void> {
    const client = await this.getClient();
    await client.events.subscribe(undefined, {
      onEvent: (status) => this.setStatus(status),
      onGap: () => void this.refresh(),
    });
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const client = await this.getClient();
    this.setStatus(await client.getStatus(undefined));
  }
}
