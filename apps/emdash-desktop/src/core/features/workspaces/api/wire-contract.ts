import { runtimeResolveErrorSchema } from '@emdash/core/services/runtime-broker/api';
import { defineContract, fallible, liveJob } from '@emdash/wire/rpc';
import z from 'zod';
import { mutationAckSchema, mutationErrorSchema } from '@core/primitives/wire/api/mutations';

/** Wire shape for workspace activation failures surfaced by the provision job. */
export const workspaceErrorSchema = z.object({
  type: z.string().min(1),
  message: z.string().min(1),
  stageId: z.string().optional(),
  resolutions: z.array(z.string()).optional(),
});

export const workspaceProvisionProgressSchema = z.object({
  message: z.string(),
});

export const workspaceProvisionResultSchema = z.object({
  path: z.string(),
  workspaceId: z.string(),
  sshConnectionId: z.string().optional(),
});

export const workspaceSliceErrorSchema = z.union([runtimeResolveErrorSchema, workspaceErrorSchema]);

export const provisionWorkspaceByIdInputSchema = z.object({
  workspaceId: z.string(),
  taskId: z.string().optional(),
});

const workspaceIdInputSchema = z.object({
  workspaceId: z.string(),
});

export const cleanWorkspaceArtifactsInputSchema = z.object({
  projectId: z.string(),
  workspaceId: z.string(),
});

/** What an artifact clean did: counts plus the kept roots, for the confirmation toast. */
export const cleanWorkspaceArtifactsSummarySchema = z.object({
  removed: z.number().int().nonnegative(),
  kept: z.array(z.string()),
  failed: z.number().int().nonnegative(),
});

export const workspacesDomain = 'workspaces' as const;

export const workspacesWireContract = defineContract({
  /**
   * Activates a task workspace: gates on registry/outbox state, initializes
   * the workspace host-side, and registers the task session.
   */
  provision: liveJob({
    input: provisionWorkspaceByIdInputSchema,
    progress: workspaceProvisionProgressSchema,
    result: workspaceProvisionResultSchema,
    error: workspaceSliceErrorSchema,
  }),
  reprovision: fallible({
    input: workspaceIdInputSchema,
    data: mutationAckSchema,
    error: mutationErrorSchema,
  }),
  removeAndReprovision: fallible({
    input: workspaceIdInputSchema,
    data: mutationAckSchema,
    error: mutationErrorSchema,
  }),
  delete: fallible({
    input: workspaceIdInputSchema,
    data: mutationAckSchema,
    error: mutationErrorSchema,
  }),
  /**
   * Ninebrains: removes a worktree's git-ignored artifacts (dependencies, build output, caches)
   * after stopping its sessions and running teardown. The worktree, its uncommitted
   * work, and `preservePatterns` matches stay.
   */
  cleanArtifacts: fallible({
    input: cleanWorkspaceArtifactsInputSchema,
    data: cleanWorkspaceArtifactsSummarySchema,
    error: mutationErrorSchema,
  }),
});

export type CleanWorkspaceArtifactsInput = z.infer<typeof cleanWorkspaceArtifactsInputSchema>;
export type CleanWorkspaceArtifactsSummary = z.infer<typeof cleanWorkspaceArtifactsSummarySchema>;
export type WorkspaceError = z.infer<typeof workspaceErrorSchema>;
export type WorkspaceProvisionResult = z.infer<typeof workspaceProvisionResultSchema>;
export type WorkspaceSliceError = z.infer<typeof workspaceSliceErrorSchema>;
export type WorkspacesWireContract = typeof workspacesWireContract;
