import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { DEFAULT_ARCHIVED_TASK_RETENTION_DAYS } from '@core/primitives/tasks/api';

export interface TaskSettingsModel {
  autoGenerateName: boolean;
  autoApproveByDefault: boolean;
  autoTrustWorktrees: boolean;
  createBranchAndWorktree: boolean;
  deleteBranchByDefault: boolean;
  preserveNameCapitalization: boolean;
  includeIssueContextByDefault: boolean;
  cleanUpArchivedWorktrees: boolean;
  archivedTaskRetentionDays: number;
  loading: boolean;
  saving: boolean;
  isFieldOverridden: (
    field:
      | 'autoGenerateName'
      | 'autoApproveByDefault'
      | 'autoTrustWorktrees'
      | 'createBranchAndWorktree'
      | 'deleteBranchByDefault'
      | 'preserveNameCapitalization'
      | 'includeIssueContextByDefault'
      | 'cleanUpArchivedWorktrees'
      | 'archivedTaskRetentionDays'
  ) => boolean;
  updateAutoGenerateName: (next: boolean) => void;
  updateAutoApproveByDefault: (next: boolean) => void;
  updateAutoTrustWorktrees: (next: boolean) => void;
  updateCreateBranchAndWorktree: (next: boolean) => void;
  updateDeleteBranchByDefault: (next: boolean) => void;
  updatePreserveNameCapitalization: (next: boolean) => void;
  updateIncludeIssueContextByDefault: (next: boolean) => void;
  updateCleanUpArchivedWorktrees: (next: boolean) => void;
  updateArchivedTaskRetentionDays: (next: number) => void;
  resetAutoGenerateName: () => void;
  resetAutoApproveByDefault: () => void;
  resetAutoTrustWorktrees: () => void;
  resetCreateBranchAndWorktree: () => void;
  resetDeleteBranchByDefault: () => void;
  resetPreserveNameCapitalization: () => void;
  resetIncludeIssueContextByDefault: () => void;
  resetCleanUpArchivedWorktrees: () => void;
  resetArchivedTaskRetentionDays: () => void;
}

export function useTaskSettings(): TaskSettingsModel {
  const {
    value: tasks,
    isLoading: loading,
    isSaving: saving,
    isFieldOverridden,
    update,
    resetField,
  } = useAppSettingsKey('tasks');

  return {
    autoGenerateName: tasks?.autoGenerateName ?? false,
    autoApproveByDefault: tasks?.autoApproveByDefault ?? false,
    autoTrustWorktrees: tasks?.autoTrustWorktrees ?? false,
    createBranchAndWorktree: tasks?.createBranchAndWorktree ?? true,
    deleteBranchByDefault: tasks?.deleteBranchByDefault ?? false,
    preserveNameCapitalization: tasks?.preserveNameCapitalization ?? false,
    includeIssueContextByDefault: tasks?.includeIssueContextByDefault ?? true,
    cleanUpArchivedWorktrees: tasks?.cleanUpArchivedWorktrees ?? true,
    archivedTaskRetentionDays:
      tasks?.archivedTaskRetentionDays ?? DEFAULT_ARCHIVED_TASK_RETENTION_DAYS,
    loading,
    saving,
    isFieldOverridden,
    updateAutoGenerateName: (next) => update({ autoGenerateName: next }),
    updateAutoApproveByDefault: (next) => update({ autoApproveByDefault: next }),
    updateAutoTrustWorktrees: (next) => update({ autoTrustWorktrees: next }),
    updateCreateBranchAndWorktree: (next) => update({ createBranchAndWorktree: next }),
    updateDeleteBranchByDefault: (next) => update({ deleteBranchByDefault: next }),
    updatePreserveNameCapitalization: (next) => update({ preserveNameCapitalization: next }),
    updateIncludeIssueContextByDefault: (next) => update({ includeIssueContextByDefault: next }),
    updateCleanUpArchivedWorktrees: (next) => update({ cleanUpArchivedWorktrees: next }),
    updateArchivedTaskRetentionDays: (next) => update({ archivedTaskRetentionDays: next }),
    resetAutoGenerateName: () => resetField('autoGenerateName'),
    resetAutoApproveByDefault: () => resetField('autoApproveByDefault'),
    resetAutoTrustWorktrees: () => resetField('autoTrustWorktrees'),
    resetCreateBranchAndWorktree: () => resetField('createBranchAndWorktree'),
    resetDeleteBranchByDefault: () => resetField('deleteBranchByDefault'),
    resetPreserveNameCapitalization: () => resetField('preserveNameCapitalization'),
    resetIncludeIssueContextByDefault: () => resetField('includeIssueContextByDefault'),
    resetCleanUpArchivedWorktrees: () => resetField('cleanUpArchivedWorktrees'),
    resetArchivedTaskRetentionDays: () => resetField('archivedTaskRetentionDays'),
  };
}
