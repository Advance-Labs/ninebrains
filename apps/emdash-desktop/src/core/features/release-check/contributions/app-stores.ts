import {
  contributeScopedStore,
  getAppStores,
  scopedStoreToken,
  type AppScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';
import { ReleaseCheckStore } from '../browser/release-check-store';

const releaseCheckStoreToken = scopedStoreToken<ReleaseCheckStore>('releaseCheck.store');

export const releaseCheckAppStoreContributions: readonly AppScopedStoreContribution[] = [
  contributeScopedStore({
    token: releaseCheckStoreToken,
    create: () => new ReleaseCheckStore(),
    activate: (store) => store.start(),
  }),
];

/** Returns the app-scoped ReleaseCheckStore. */
export function getReleaseCheckStore(): ReleaseCheckStore {
  return getAppStores().get(releaseCheckStoreToken);
}
