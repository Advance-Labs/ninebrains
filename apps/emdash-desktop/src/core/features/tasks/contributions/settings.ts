import { z } from 'zod';
import type { TaskSettings } from '@core/primitives/app-settings/api';
import { defineSettingsContribution } from '@core/primitives/settings/api';
import { DEFAULT_ARCHIVED_TASK_RETENTION_DAYS } from '@core/primitives/tasks/api';

const taskSettingsSchema = z.object({
  autoGenerateName: z.boolean(),
  autoApproveByDefault: z.boolean(),
  autoTrustWorktrees: z.boolean(),
  createBranchAndWorktree: z.boolean(),
  deleteBranchByDefault: z.boolean(),
  preserveNameCapitalization: z.boolean(),
  includeIssueContextByDefault: z.boolean(),
  cleanUpArchivedWorktrees: z.boolean(),
  archivedTaskRetentionDays: z.number().int().positive(),
});

export const taskSettingsContribution = defineSettingsContribution<'tasks', TaskSettings>({
  key: 'tasks',
  schema: taskSettingsSchema,
  defaults: {
    autoGenerateName: true,
    autoApproveByDefault: false,
    autoTrustWorktrees: true,
    createBranchAndWorktree: true,
    deleteBranchByDefault: false,
    preserveNameCapitalization: false,
    includeIssueContextByDefault: true,
    cleanUpArchivedWorktrees: true,
    archivedTaskRetentionDays: DEFAULT_ARCHIVED_TASK_RETENTION_DAYS,
  },
});
