import { defineContract, eventStream, fallible, liveModel, liveState } from '@emdash/wire/rpc';
import { z } from 'zod';
import { laneRunModeSchema } from '@core/features/lanes/api';
import {
  brainAddressSchema,
  brainDispatcherViewSchema,
  brainDoneViewSchema,
  brainErrorSchema,
  brainIdSchema,
  brainJobViewSchema,
  brainMessageViewSchema,
  brainNoteViewSchema,
  brainSessionViewSchema,
  brainUnreadSchema,
  type BrainWireEvent,
} from './schemas';

export const brainDomain = 'brain' as const;

const projectKey = z.object({ projectId: z.string().min(1) });
const panelStates = {
  jobs: liveState({ data: z.array(brainJobViewSchema) }),
  done: liveState({ data: z.array(brainDoneViewSchema) }),
  notes: liveState({ data: z.array(brainNoteViewSchema) }),
};

export const brainContract = defineContract({
  /** Jobs, done log and notes for one project. */
  project: liveModel({ key: projectKey, states: panelStates }),
  /** The same three lists for one lane: what its side panel shows. */
  lanePanel: liveModel({ key: z.object({ laneId: z.string().min(1) }), states: panelStates }),
  /** Unread counts, Brain sessions and dispatcher state. */
  overview: liveModel({
    key: z.void().optional(),
    states: {
      unread: liveState({ data: brainUnreadSchema }),
      sessions: liveState({ data: z.array(brainSessionViewSchema) }),
      dispatcher: liveState({ data: brainDispatcherViewSchema }),
    },
  }),
  /**
   * Every open job across every project, for Arena's cross-project view. Its
   * own model (not folded into `overview`) so the titlebar, Settings and the
   * lane run-mode control — all always-mounted `overview` consumers — don't
   * also subscribe to this larger, more frequently changing list.
   */
  allJobs: liveModel({
    key: z.void().optional(),
    states: { jobs: liveState({ data: z.array(brainJobViewSchema) }) },
  }),
  events: eventStream({ key: z.void(), event: z.custom<BrainWireEvent>() }),

  createJob: fallible({
    input: projectKey.extend({
      title: z.string().trim().min(1).max(200),
      body: z.string().max(32_000).optional(),
      dependsOn: z.array(brainIdSchema).max(100).optional(),
      gates: z.array(z.string().min(1).max(64)).max(10).optional(),
      /** gates-core kind for the floor (`gateSpec.kind`). The user may pick any; agents cannot. */
      gateKind: z.enum(['code', 'ui', 'research', 'seo', 'docs']).optional(),
    }),
    data: z.object({ jobId: z.string() }),
    error: brainErrorSchema,
  }),
  linkJobs: fallible({
    input: z.object({ from: brainIdSchema, to: brainIdSchema }),
    data: z.void(),
    error: brainErrorSchema,
  }),
  requeueJob: fallible({
    input: z.object({ jobId: brainIdSchema }),
    data: z.void(),
    error: brainErrorSchema,
  }),
  /** Sent as `fromBrainId` (a Brain session, or `user`), so replies route back there. */
  sendMessage: fallible({
    input: z.object({
      fromBrainId: brainIdSchema,
      to: brainAddressSchema,
      body: z.string().trim().min(1).max(32_000),
    }),
    data: z.object({ messageId: z.string() }),
    error: brainErrorSchema,
  }),
  /** Reads an inbox and marks what it returns as read. */
  readInbox: fallible({
    input: z.object({ address: brainAddressSchema, includeRead: z.boolean().optional() }),
    data: z.array(brainMessageViewSchema),
    error: brainErrorSchema,
  }),
  listDone: fallible({
    input: projectKey.extend({ limit: z.number().int().min(1).max(500).optional() }),
    data: z.array(brainDoneViewSchema),
    error: brainErrorSchema,
  }),
  listNotes: fallible({
    input: projectKey.extend({ limit: z.number().int().min(1).max(500).optional() }),
    data: z.array(brainNoteViewSchema),
    error: brainErrorSchema,
  }),

  /** Launches a brain-mode `claude` conversation with a Brain-minted token. */
  startBrain: fallible({
    input: projectKey,
    data: z.object({ brainId: z.string() }),
    error: brainErrorSchema,
  }),
  stopBrain: fallible({
    input: z.object({ brainId: brainIdSchema }),
    data: z.void(),
    error: brainErrorSchema,
  }),

  setDispatcherPaused: fallible({
    input: z.object({ paused: z.boolean() }),
    data: z.void(),
    error: brainErrorSchema,
  }),
  setLaneMode: fallible({
    input: z.object({ laneId: z.string().min(1), mode: laneRunModeSchema }),
    data: z.void(),
    error: brainErrorSchema,
  }),
  /** Global STOP (SEC-30): kills runs, pauses dispatch, stops Brain-dispatched lanes. Latches. */
  stopAll: fallible({
    input: z.void(),
    data: z.object({ killedRuns: z.number().int(), stoppedLanes: z.number().int() }),
    error: brainErrorSchema,
  }),
  clearStop: fallible({ input: z.void(), data: z.void(), error: brainErrorSchema }),
});

export type BrainContract = typeof brainContract;
