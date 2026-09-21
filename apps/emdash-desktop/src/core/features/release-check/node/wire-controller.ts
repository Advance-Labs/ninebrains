import type { Scope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import { createEventStreamHost } from '@emdash/wire/live';
import { createController, type Controller } from '@emdash/wire/rpc';
import type { AppSettingsService } from '@core/services/settings/node';
import { releaseCheckContract } from '../api';
import { RELEASE_CHECK_SETTINGS_KEY } from '../contributions/settings';
import { fetchLatestRelease } from './latest-release';
import { ReleaseCheckService } from './release-check-service';

/** What the release check needs from the Electron host, injected so this slice stays testable. */
export type ReleaseCheckHost = {
  getAppVersion(): Promise<string>;
  readonly isPackaged: boolean;
  readonly isCanary: boolean;
};

/** Thin delegate over `ReleaseCheckService`. */
export function createReleaseCheckWireController(service: ReleaseCheckService): Controller {
  const events = createEventStreamHost(releaseCheckContract.events);
  service.onStatus((status) => events.emit(undefined, status));
  return createController(releaseCheckContract, {
    getStatus: () => service.getStatus(),
    check: () => service.check(),
    dismiss: ({ version }) => service.dismiss(version),
    events,
  });
}

export function createReleaseCheckController(options: {
  appSettings: AppSettingsService;
  host: ReleaseCheckHost;
  logger: Logger;
  scope: Scope;
}): Controller {
  const { appSettings, host, logger, scope } = options;
  const service = new ReleaseCheckService({
    getCurrentVersion: () => host.getAppVersion(),
    isPackaged: host.isPackaged,
    isCanary: host.isCanary,
    fetchLatest: () => fetchLatestRelease((url, init) => fetch(url, init)),
    settings: {
      get: () => appSettings.get(RELEASE_CHECK_SETTINGS_KEY),
      update: (next) => appSettings.update(RELEASE_CHECK_SETTINGS_KEY, next),
      onChange: (listener) => {
        const onChanged = (key: string) => {
          if (key === RELEASE_CHECK_SETTINGS_KEY) listener();
        };
        appSettings.on('app-settings:changed', onChanged);
        return () => appSettings.off('app-settings:changed', onChanged);
      },
    },
    logger,
  });
  scope.add(() => service.dispose());
  void service.start();
  return createReleaseCheckWireController(service);
}
