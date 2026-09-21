import { observer } from 'mobx-react-lite';
import { settingsViewDef } from '@core/features/settings/contributions/views';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { ReleaseNoticeView } from '../../browser/release-notice';
import { getReleaseCheckStore } from '../app-stores';

/**
 * Left sidebar: shown once a check finds a newer release, until the user closes it for that
 * version. Opens Settings → General, where the download and update steps are.
 */
export const ReleaseNotice = observer(function ReleaseNotice() {
  const store = getReleaseCheckStore();
  const { navigate } = useNavigate();
  const version = store.status?.latest?.version;
  if (!store.showNotice || !version) return null;
  return (
    <ReleaseNoticeView
      version={version}
      onOpen={() => navigate(settingsViewDef({ tab: 'general' }))}
      onDismiss={() => void store.dismiss(version)}
    />
  );
});
