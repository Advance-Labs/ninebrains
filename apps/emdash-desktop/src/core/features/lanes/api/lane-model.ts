import { z } from 'zod';

/** A tab holds a 2×2 grid: slots 0-3, left-to-right then top-to-bottom. */
export const LANE_SLOT_COUNT = 4;

export const laneProviderSchema = z.enum(['claude', 'codex']);
export type LaneProvider = z.infer<typeof laneProviderSchema>;

/**
 * How the Brain hands a lane its jobs. `attended` (the default) pastes each job into the lane's
 * terminal. `unattended` runs each job headless (`claude -p` / `codex exec`) under run budgets.
 */
export const laneRunModeSchema = z.enum(['attended', 'unattended']);
export type LaneRunMode = z.infer<typeof laneRunModeSchema>;

/** A pack role: `role` (unique across the project's enabled packs) or `pack:role`. */
export const laneRoleIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}(:[A-Za-z0-9_-]{1,64})?$/);

export const laneSlotSchema = z
  .number()
  .int()
  .min(0)
  .max(LANE_SLOT_COUNT - 1);
export type LaneSlot = z.infer<typeof laneSlotSchema>;

/**
 * The status light. `verifying` and `blocked` also come from Brain Job state
 * (Phase 2), which overrides the hook-derived value.
 */
export const laneStatusSchema = z.enum([
  'idle',
  'running',
  'waiting',
  'verifying',
  'blocked',
  'asleep',
]);
export type LaneStatus = z.infer<typeof laneStatusSchema>;

/** Whether the lane's PTY is alive. Independent of the status light. */
export const laneSessionSchema = z.enum(['stopped', 'starting', 'running', 'failed']);
export type LaneSession = z.infer<typeof laneSessionSchema>;

/**
 * The persisted part of a lane. A lane is one Emdash Task (its worktree) plus
 * one PTY Conversation in it. Brain rows reference `laneId` as text.
 */
export const laneConfigSchema = z.object({
  laneId: z.string().min(1),
  projectId: z.string().min(1),
  taskId: z.string().min(1),
  conversationId: z.string().min(1),
  provider: laneProviderSchema,
  model: z.string().nullable(),
  accountLabel: z.string().nullable(),
  /** Stable browser id owned by the lane, so its preview survives remounts. */
  browserId: z.string().min(1),
  /** Sleep hides the cell; the PTY keeps running. */
  asleep: z.boolean(),
  /** True once the conversation record exists, so a start resumes instead of creating. */
  conversationReady: z.boolean(),
  /** The Brain Job this lane is working on (Phase 2). */
  activeJobId: z.string().optional(),
  /** Absent means `attended`, the safe default (older grids have no field). */
  runMode: laneRunModeSchema.optional(),
  /** The pack role whose prompt and servers the lane launches with. */
  roleId: laneRoleIdSchema.optional(),
});
export type LaneConfig = z.infer<typeof laneConfigSchema>;

export const laneTabConfigSchema = z.object({
  tabId: z.string().min(1),
  title: z.string(),
  slots: z.array(laneConfigSchema.nullable()).length(LANE_SLOT_COUNT),
});
export type LaneTabConfig = z.infer<typeof laneTabConfigSchema>;

export const lanesGridConfigSchema = z.object({
  tabs: z.array(laneTabConfigSchema),
});
export type LanesGridConfig = z.infer<typeof lanesGridConfigSchema>;

/** A lane as the renderer sees it: config plus live runtime facts. */
export const laneSchema = laneConfigSchema.extend({
  tabId: z.string(),
  slot: laneSlotSchema,
  session: laneSessionSchema,
  status: laneStatusSchema,
  projectName: z.string().nullable(),
  branch: z.string().nullable(),
  error: z.string().nullable(),
});
export type Lane = z.infer<typeof laneSchema>;

export const laneTabSchema = z.object({
  tabId: z.string(),
  title: z.string(),
  /** Indexed by slot; `null` is an empty slot. */
  slots: z.array(laneSchema.nullable()).length(LANE_SLOT_COUNT),
});
export type LaneTab = z.infer<typeof laneTabSchema>;

export const laneBoardSchema = z.object({
  tabs: z.array(laneTabSchema),
});
export type LaneBoard = z.infer<typeof laneBoardSchema>;

export const laneStatusMapSchema = z.record(z.string(), laneStatusSchema);
export type LaneStatusMap = z.infer<typeof laneStatusMapSchema>;

export const laneErrorSchema = z.object({
  type: z.enum([
    'tab-not-found',
    'tab-not-empty',
    'lane-not-found',
    'slot-occupied',
    'project-not-found',
    'ssh-unsupported',
    'start-failed',
    'stop-failed',
  ]),
  message: z.string(),
});
export type LaneError = z.infer<typeof laneErrorSchema>;

export type LaneEvent =
  | { type: 'lane-added'; laneId: string; tabId: string; slot: LaneSlot }
  | { type: 'lane-removed'; laneId: string }
  | { type: 'lane-moved'; laneId: string; tabId: string; slot: LaneSlot }
  | { type: 'lane-session'; laneId: string; session: LaneSession; error: string | null };

export const SSH_UNSUPPORTED_MESSAGE =
  'Lanes run on this machine only for now. Open the project locally to add a lane.';

/** Aggregate for a tab dot: the most urgent light among the tab's lanes. */
export function aggregateLaneStatus(statuses: readonly LaneStatus[]): LaneStatus | null {
  for (const status of ['blocked', 'waiting', 'verifying', 'running', 'idle'] as const) {
    if (statuses.includes(status)) return status;
  }
  return statuses.length > 0 ? 'asleep' : null;
}
