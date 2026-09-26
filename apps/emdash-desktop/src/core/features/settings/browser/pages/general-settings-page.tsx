import { PageLayout, SettingsSection } from '@emdash/ui/react/patterns';
import {
  HOSTED_ACCOUNT_ENABLED,
  TELEMETRY_SETTINGS_ENABLED,
  UPDATES_ENABLED,
} from '@core/primitives/app-identity/api/fork-flags';
import { AccountTab } from '../components/AccountTab';
import NotificationSettingsCard from '../components/NotificationSettingsCard';
import {
  AutoApproveByDefaultRow,
  AutoGenerateTaskNamesRow,
  AutoTrustWorktreesRow,
  CleanUpArchivedWorktreesRow,
  CreateBranchAndWorktreeRow,
  DeleteBranchByDefaultRow,
  EnableTmuxRow,
  TmuxScrollbackSettingRow,
  IncludeIssueContextByDefaultRow,
  PreserveTaskNameCapitalizationRow,
} from '../components/TaskSettingsRows';
import TelemetryCard from '../components/TelemetryCard';
import { UpdateCard } from '../components/UpdateCard';

export function GeneralSettingsPage() {
  return (
    <div className="space-y-8 pb-10">
      <PageLayout.Header
        sticky
        draggable
        title="General"
        description="Manage notifications and task preferences."
      />
      {HOSTED_ACCOUNT_ENABLED && (
        <SettingsSection>
          <AccountTab />
        </SettingsSection>
      )}
      <SettingsSection title="App">
        {UPDATES_ENABLED && <UpdateCard />}
        {TELEMETRY_SETTINGS_ENABLED && <TelemetryCard />}
      </SettingsSection>
      <SettingsSection title="Notifications" bare>
        <NotificationSettingsCard />
      </SettingsSection>
      <SettingsSection title="Preferences">
        <AutoGenerateTaskNamesRow />
        <AutoApproveByDefaultRow />
        <AutoTrustWorktreesRow />
        <CreateBranchAndWorktreeRow />
        <DeleteBranchByDefaultRow />
        <CleanUpArchivedWorktreesRow />
        <PreserveTaskNameCapitalizationRow />
        <IncludeIssueContextByDefaultRow />
        <EnableTmuxRow />
        <TmuxScrollbackSettingRow />
      </SettingsSection>
    </div>
  );
}
