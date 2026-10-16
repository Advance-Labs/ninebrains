import { Button, Select, Switch, Tooltip, useToast } from '@emdash/ui/react/primitives';
import { Info } from 'lucide-react';
import React from 'react';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { getTasksWireClient } from '@core/features/tasks/api/browser/client';
import { useTaskSettings } from '@core/features/tasks/api/browser/hooks/useTaskSettings';
import { detectPlatformContext } from '@core/primitives/keybindings/api';
import {
  ARCHIVED_TASK_RETENTION_PRESETS,
  DEFAULT_ARCHIVED_TASK_RETENTION_DAYS,
  type ArchivedTaskCleanupResult,
} from '@core/primitives/tasks/api';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

/**
 * Scrollback choices, in lines per pane.
 *
 * Presets rather than a free number field on purpose: tmux keeps scrollback in the
 * server's own address space, so the cost of a large value is paid in live memory,
 * multiplied by every open agent pane. A menu makes the shape of that trade visible
 * where a text box invites a number nobody costed.
 *
 * The default is deliberately not among them. It lives in the pty layer
 * (DEFAULT_TMUX_HISTORY_LIMIT), which this browser surface cannot import, so "Default"
 * clears the setting instead of restating a number that could drift out of step.
 */
const TMUX_HISTORY_PRESETS = [2_000, 10_000, 50_000, 100_000] as const;
const TMUX_HISTORY_DEFAULT = 'default';

function formatScrollbackLines(lines: number): string {
  return `${lines.toLocaleString()} lines`;
}

function InfoTooltip({ label, content }: { label: string; content: React.ReactNode }) {
  return (
    <Tooltip.Provider delay={150}>
      <Tooltip.Root>
        <Tooltip.Trigger>
          <button
            type="button"
            className="text-muted-foreground inline-flex h-4 w-4 items-center justify-center hover:text-foreground"
            aria-label={label}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Content side="top" className="max-w-xs text-xs">
          {content}
        </Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

export const AutoGenerateTaskNamesRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title="Auto-generate task names"
      description="Automatically suggests a task name when creating a new task."
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('autoGenerateName')}
            defaultLabel="on"
            onReset={taskSettings.resetAutoGenerateName}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.autoGenerateName}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updateAutoGenerateName}
          />
        </>
      }
    />
  );
};

export const AutoApproveByDefaultRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title="Auto-approve by default"
      description="Skip permission prompts for supported agents when creating new tasks and conversations."
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('autoApproveByDefault')}
            defaultLabel="off"
            onReset={taskSettings.resetAutoApproveByDefault}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.autoApproveByDefault}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updateAutoApproveByDefault}
          />
        </>
      }
    />
  );
};

export const AutoTrustWorktreesRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title={
        <div className="flex items-center gap-1.5">
          Auto-trust worktree directories
          <InfoTooltip
            label="More info about auto-trust worktrees"
            content="For agents that support workspace trust, Ninebrains writes trust entries before launching."
          />
        </div>
      }
      description="Skip the folder trust prompt in supported CLIs for new tasks."
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('autoTrustWorktrees')}
            defaultLabel="on"
            onReset={taskSettings.resetAutoTrustWorktrees}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.autoTrustWorktrees}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updateAutoTrustWorktrees}
          />
        </>
      }
    />
  );
};

export const CreateBranchAndWorktreeRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title="Create branch and worktree by default"
      description="Start new From Branch tasks in a dedicated task branch and worktree unless changed in the task modal."
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('createBranchAndWorktree')}
            defaultLabel="on"
            onReset={taskSettings.resetCreateBranchAndWorktree}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.createBranchAndWorktree}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updateCreateBranchAndWorktree}
          />
        </>
      }
    />
  );
};

export const DeleteBranchByDefaultRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title="Delete branch by default"
      description="Preselect the delete branch option when deleting tasks with a deletable task branch."
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('deleteBranchByDefault')}
            defaultLabel="off"
            onReset={taskSettings.resetDeleteBranchByDefault}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.deleteBranchByDefault}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updateDeleteBranchByDefault}
          />
        </>
      }
    />
  );
};

function formatRetentionDays(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

export const CleanUpArchivedWorktreesRow: React.FC = () => {
  const taskSettings = useTaskSettings();
  const disabled = taskSettings.loading || taskSettings.saving;
  const days = taskSettings.archivedTaskRetentionDays;

  return (
    <SettingRow
      title="Delete archived tasks"
      description={`Delete a task archived for over ${formatRetentionDays(days)}, with its worktree and branch, including commits that were never pushed. Worktrees with uncommitted changes are never removed.`}
      control={
        <>
          <ResetToDefaultButton
            visible={
              taskSettings.isFieldOverridden('cleanUpArchivedWorktrees') ||
              taskSettings.isFieldOverridden('archivedTaskRetentionDays')
            }
            defaultLabel={`on, ${formatRetentionDays(DEFAULT_ARCHIVED_TASK_RETENTION_DAYS)}`}
            onReset={() => {
              taskSettings.resetCleanUpArchivedWorktrees();
              taskSettings.resetArchivedTaskRetentionDays();
            }}
            disabled={disabled}
          />
          <Select.Root
            value={String(days)}
            onValueChange={(next) => taskSettings.updateArchivedTaskRetentionDays(Number(next))}
            disabled={disabled || !taskSettings.cleanUpArchivedWorktrees}
          >
            <Select.Trigger className="w-[110px] shrink-0 gap-2">
              <Select.Value>{formatRetentionDays(days)}</Select.Value>
            </Select.Trigger>
            <Select.Content align="end" className="min-w-max">
              {ARCHIVED_TASK_RETENTION_PRESETS.map((preset) => (
                <Select.Item key={preset} value={String(preset)}>
                  {formatRetentionDays(preset)}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <Switch
            checked={taskSettings.cleanUpArchivedWorktrees}
            disabled={disabled}
            onCheckedChange={taskSettings.updateCleanUpArchivedWorktrees}
          />
        </>
      }
    />
  );
};

/**
 * Runs the archived-task cleanup now, with the configured retention. The count comes from
 * a dry run, and the button asks once more before deleting.
 */
export const CleanUpArchivedTasksNowRow: React.FC = () => {
  const { archivedTaskRetentionDays: retentionDays } = useTaskSettings();
  const { toast } = useToast();
  const [preview, setPreview] = React.useState<ArchivedTaskCleanupResult | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [running, setRunning] = React.useState(false);

  const refreshPreview = React.useCallback(async () => {
    const client = await getTasksWireClient();
    setPreview(await client.cleanUpArchivedTasks({ retentionDays, dryRun: true }));
  }, [retentionDays]);

  React.useEffect(() => {
    setConfirming(false);
    void refreshPreview().catch(() => setPreview(null));
  }, [refreshPreview]);

  const run = async () => {
    setRunning(true);
    try {
      const client = await getTasksWireClient();
      const result = await client.cleanUpArchivedTasks({ retentionDays, dryRun: false });
      toast(`Deleted ${result.removed} archived ${result.removed === 1 ? 'task' : 'tasks'}`, {
        description:
          result.skipped + result.failed > 0
            ? `${result.skipped} skipped, ${result.failed} failed`
            : undefined,
      });
    } catch (error) {
      toast('Cleanup failed', { description: String(error) });
    } finally {
      setRunning(false);
      setConfirming(false);
      void refreshPreview().catch(() => setPreview(null));
    }
  };

  const eligible = preview?.removed ?? 0;
  return (
    <SettingRow
      title="Clean up archived tasks now"
      description={
        preview === null
          ? 'Counting archived tasks…'
          : `${eligible} ${eligible === 1 ? 'task' : 'tasks'} archived over ${formatRetentionDays(retentionDays)} can be deleted${preview.skipped > 0 ? `; ${preview.skipped} skipped (uncommitted changes, or Project not connected)` : ''}.`
      }
      control={
        <Button
          type="button"
          size="xs"
          variant={confirming ? 'destructive' : 'secondary'}
          disabled={running || eligible === 0}
          onClick={() => (confirming ? void run() : setConfirming(true))}
        >
          {running ? 'Deleting…' : confirming ? `Delete ${eligible}?` : 'Clean up now'}
        </Button>
      }
    />
  );
};

export const PreserveTaskNameCapitalizationRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title="Preserve task name capitalization"
      description="Keep uppercase letters in generated and manually entered task names. Defaults to lowercase."
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('preserveNameCapitalization')}
            defaultLabel="off"
            onReset={taskSettings.resetPreserveNameCapitalization}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.preserveNameCapitalization}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updatePreserveNameCapitalization}
          />
        </>
      }
    />
  );
};

export const IncludeIssueContextByDefaultRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title="Include issue context by default"
      description="Add the selected issue to the initial agent prompt when creating a task from an issue."
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('includeIssueContextByDefault')}
            defaultLabel="on"
            onReset={taskSettings.resetIncludeIssueContextByDefault}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.includeIssueContextByDefault}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updateIncludeIssueContextByDefault}
          />
        </>
      }
    />
  );
};

export const EnableTmuxRow: React.FC = () => {
  const {
    value: projects,
    update,
    isLoading: loading,
    isSaving: saving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('project');

  const tmuxByDefault = projects?.tmuxByDefault ?? false;
  const tmuxSupported = detectPlatformContext().os !== 'windows';

  return (
    <SettingRow
      title="Enable tmux"
      description={
        tmuxSupported
          ? 'Run agent sessions and terminals in tmux sessions by default.'
          : 'tmux is unavailable for Windows sessions. Your stored preference is preserved.'
      }
      control={
        <>
          <ResetToDefaultButton
            visible={isFieldOverridden('tmuxByDefault')}
            defaultLabel="off"
            onReset={() => resetField('tmuxByDefault')}
            disabled={loading || saving || !tmuxSupported}
          />
          <Switch
            checked={tmuxSupported ? tmuxByDefault : false}
            disabled={loading || saving || !tmuxSupported}
            onCheckedChange={(checked) => update({ tmuxByDefault: checked })}
          />
        </>
      }
    />
  );
};

/**
 * Scrollback depth for tmux-backed panes.
 *
 * Only meaningful when tmux is on, and only on platforms where tmux runs, so it follows
 * the same support and disabled rules as the switch above rather than offering a control
 * that cannot take effect.
 */
export const TmuxScrollbackSettingRow: React.FC = () => {
  const {
    value: projects,
    update,
    isLoading: loading,
    isSaving: saving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('project');

  const tmuxSupported = detectPlatformContext().os !== 'windows';
  const tmuxEnabled = projects?.tmuxByDefault ?? false;
  const stored = projects?.tmuxHistoryLimit;
  const disabled = loading || saving || !tmuxSupported || !tmuxEnabled;

  return (
    <SettingRow
      title="tmux scrollback"
      description={
        tmuxEnabled
          ? "Lines of history each tmux pane keeps. Held in the tmux server's memory for as long as the session exists, so a large value costs memory across every open pane."
          : 'Enable tmux to choose how much scrollback each pane keeps.'
      }
      control={
        <>
          <ResetToDefaultButton
            visible={isFieldOverridden('tmuxHistoryLimit')}
            defaultLabel="default"
            onReset={() => resetField('tmuxHistoryLimit')}
            disabled={disabled}
          />
          <Select.Root
            value={stored === undefined ? TMUX_HISTORY_DEFAULT : String(stored)}
            onValueChange={(next) =>
              update({
                tmuxHistoryLimit: next === TMUX_HISTORY_DEFAULT ? undefined : Number(next),
              })
            }
            disabled={disabled}
          >
            <Select.Trigger className="w-[183px] shrink-0 gap-2">
              <Select.Value>
                {stored === undefined ? 'Default' : formatScrollbackLines(stored)}
              </Select.Value>
            </Select.Trigger>
            <Select.Content align="end" className="min-w-max">
              <Select.Item value={TMUX_HISTORY_DEFAULT}>Default</Select.Item>
              {TMUX_HISTORY_PRESETS.map((lines) => (
                <Select.Item key={lines} value={String(lines)}>
                  {formatScrollbackLines(lines)}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </>
      }
    />
  );
};
