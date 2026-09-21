import { SettingsRow } from '@emdash/ui/react/patterns';
import { Button, RelativeTime, Switch } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import type React from 'react';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { BRAND_NAME } from '@core/primitives/app-identity/api/app-identity';
import {
  copyTextToClipboard,
  openExternal,
} from '@core/primitives/desktop-host/browser/host-client';
import { detectPlatformContext } from '@core/primitives/keybindings/api';
import type { ReleaseCheckFailure, ReleaseCheckStatus } from '../../api';
import { DOWNLOAD_PAGE_URL, installCommandFor } from '../../api/release-links';
import { ReleaseUpdatePanel } from '../../browser/release-update-panel';
import { getReleaseCheckStore } from '../app-stores';
import { RELEASE_CHECK_SETTINGS_KEY } from '../settings';

const FAILURE_MESSAGES: Record<ReleaseCheckFailure, string> = {
  offline: "Couldn't reach GitHub. Check your connection and try again.",
  timeout: "GitHub didn't answer in time. Try again later.",
  'rate-limited': 'GitHub is limiting requests from your network. Try again in an hour.',
  'http-error': "GitHub didn't return a release. Try again later.",
  'invalid-response': "GitHub's answer didn't include a release version.",
};

function statusLine(status: ReleaseCheckStatus, checking: boolean): React.ReactNode {
  if (checking || status.checking) return 'Checking…';
  if (status.updateAvailable && status.latest) {
    return `${BRAND_NAME} ${status.latest.version} is available.`;
  }
  if (status.lastFailure) return FAILURE_MESSAGES[status.lastFailure];
  if (status.lastCheckedAt !== null) {
    return (
      <>
        Up to date. Checked <RelativeTime value={status.lastCheckedAt} />.
      </>
    );
  }
  return null;
}

/** Settings → General → App: the "Check for new versions" switch, "Check now", and the update. */
export const ReleaseCheckCard = observer(function ReleaseCheckCard() {
  const store = getReleaseCheckStore();
  const settings = useAppSettingsKey(RELEASE_CHECK_SETTINGS_KEY);
  const status = store.status;
  const install = installCommandFor(detectPlatformContext().os);
  const line = status ? statusLine(status, store.checking) : null;

  if (status && !status.supported) {
    return (
      <SettingsRow
        label="Check for new versions"
        description="This build does not check for releases. Canary builds update by installing a newer canary."
        control={null}
      />
    );
  }

  return (
    <>
      <SettingsRow
        label="Check for new versions"
        description={`Once after startup and every 12 hours, ask GitHub whether a newer ${BRAND_NAME} release is out. Nothing is downloaded or installed. Off until you turn it on.`}
        control={
          <Switch
            aria-label="Check for new versions"
            checked={settings.value?.autoCheck ?? false}
            disabled={settings.isLoading || settings.isSaving}
            onCheckedChange={(checked) => settings.update({ autoCheck: checked })}
          />
        }
      />
      <SettingsRow
        label="Version"
        description={
          <span>
            {BRAND_NAME} {status?.currentVersion ?? ''}
            {line ? <> · {line}</> : null}
          </span>
        }
        control={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!status || store.checking || status.checking}
            onClick={() => void store.check()}
          >
            Check now
          </Button>
        }
      />
      {status?.updateAvailable && status.latest ? (
        <ReleaseUpdatePanel
          version={status.latest.version}
          install={install}
          onDownload={() => void openExternal(DOWNLOAD_PAGE_URL)}
          onCopyCommand={(command) => copyTextToClipboard(command)}
          onOpenReleaseNotes={() => {
            if (status.latest) void openExternal(status.latest.releaseUrl);
          }}
        />
      ) : null}
    </>
  );
});
