import { defineContract, fallible, liveModel, liveState } from '@emdash/wire/rpc';
import { z } from 'zod';
import {
  canvasDocSchema,
  canvasEdgeSchema,
  canvasNodeSchema,
  canvasSummarySchema,
  PLANNER_LIMITS,
  plannerIdSchema,
  plannerJobStateSchema,
} from './schema';

export const plannerDomain = 'planner' as const;

export const plannerErrorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('invalid'), message: z.string() }),
  z.object({ type: z.literal('persistence'), message: z.string() }),
  /** A port is not wired yet (for example, drafting before the Brain can run unattended). */
  z.object({ type: z.literal('unavailable'), message: z.string() }),
]);
export type PlannerError = z.infer<typeof plannerErrorSchema>;

const canvasKeySchema = z.object({ projectId: plannerIdSchema, canvasId: plannerIdSchema });
export type PlannerCanvasKey = z.infer<typeof canvasKeySchema>;

export const compileOutcomeSchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
  /** Set when the plan was rejected. Each path is node ids, first node repeated at the end. */
  cycles: z.array(z.array(z.string())).optional(),
});
export type CompileOutcome = z.infer<typeof compileOutcomeSchema>;

export const draftProposalSchema = z.object({
  nodes: z.array(canvasNodeSchema).max(PLANNER_LIMITS.nodes),
  edges: z.array(canvasEdgeSchema).max(PLANNER_LIMITS.edges),
});
export type DraftProposal = z.infer<typeof draftProposalSchema>;

export const plannerContract = defineContract({
  listCanvases: fallible({
    input: z.object({ projectId: plannerIdSchema }),
    data: z.array(canvasSummarySchema),
    error: plannerErrorSchema,
  }),
  /** A missing canvas comes back empty; a corrupt one comes back empty with `recovered`. */
  getCanvas: fallible({
    input: canvasKeySchema,
    data: z.object({ doc: canvasDocSchema, recovered: z.boolean() }),
    error: plannerErrorSchema,
  }),
  saveCanvas: fallible({
    input: z.object({ doc: canvasDocSchema }),
    data: z.object({ updatedAt: z.number().int().nonnegative() }),
    error: plannerErrorSchema,
  }),
  /** Compiles the saved canvas into Brain jobs and edges. Idempotent, keyed by node id. */
  compile: fallible({
    input: canvasKeySchema,
    data: compileOutcomeSchema,
    error: plannerErrorSchema,
  }),
  draftFromBrief: fallible({
    input: canvasKeySchema.extend({
      brief: z.string().trim().min(1).max(PLANNER_LIMITS.briefChars),
    }),
    data: draftProposalSchema,
    error: plannerErrorSchema,
  }),
  /** Live Brain job state per compiled canvas node id. */
  nodeStates: liveModel({
    key: canvasKeySchema,
    states: {
      states: liveState({ data: z.record(z.string(), plannerJobStateSchema) }),
    },
  }),
});

export type PlannerContract = typeof plannerContract;
