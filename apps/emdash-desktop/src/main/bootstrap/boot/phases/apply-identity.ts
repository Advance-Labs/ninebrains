import { join } from 'node:path';
import { app } from 'electron';
import { COPYRIGHT } from '@core/primitives/app-identity/api/app-identity';
import type { AppConfig } from '../../core/config';
import { markUserDataConfigured } from '../../core/config';

export function applyIdentity(config: AppConfig): void {
  app.setName(config.identity.productName);
  app.setAboutPanelOptions({
    applicationName: config.identity.productName,
    copyright: COPYRIGHT,
  });
  // EMDASH_USER_DATA_DIR redirects the whole profile (DB, logs, mementos) to an
  // isolated directory — used by the boot-measurement harness and scratch profiles.
  const userDataPath =
    config.userDataDir ?? join(app.getPath('appData'), config.identity.userDataDirName);
  app.setPath('userData', userDataPath);
  markUserDataConfigured();
}
