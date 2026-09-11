import { defineContract, eventStream, fallible, liveModel, liveState } from '@emdash/wire/rpc';
import { z } from 'zod';
import {
  laneBoardSchema,
  laneErrorSchema,
  laneProviderSchema,
  laneSlotSchema,
  laneStatusMapSchema,
  type LaneEvent,
} from './lane-model';

const laneKey = z.object({ laneId: z.string().min(1) });

export const lanesDomain = 'lanes' as const;

export const lanesContract = defineContract({
  /** Tabs → slots → lanes, with live session facts. */
  board: liveModel({
    key: z.void().optional(),
    states: {
      board: liveState({ data: laneBoardSchema }),
    },
  }),
  /** laneId → status light. Split from the board because it changes far more often. */
  statuses: liveModel({
    key: z.void().optional(),
    states: {
      list: liveState({ data: laneStatusMapSchema }),
    },
  }),
  events: eventStream({ key: z.void(), event: z.custom<LaneEvent>() }),

  createTab: fallible({
    input: z.object({ title: z.string().max(80).optional() }),
    data: z.object({ tabId: z.string() }),
    error: laneErrorSchema,
  }),
  renameTab: fallible({
    input: z.object({ tabId: z.string().min(1), title: z.string().min(1).max(80) }),
    data: z.void(),
    error: laneErrorSchema,
  }),
  removeTab: fallible({
    input: z.object({ tabId: z.string().min(1) }),
    data: z.void(),
    error: laneErrorSchema,
  }),
  /**
   * Provisions a new worktree Task for the project and starts one PTY
   * conversation in it. Returns once the lane is on the board; the worktree
   * and agent come up in the background and report through `board`.
   */
  createLane: fallible({
    input: z.object({
      tabId: z.string().min(1),
      slot: laneSlotSchema,
      projectId: z.string().min(1),
      provider: laneProviderSchema,
      model: z.string().min(1).optional(),
    }),
    data: z.object({ laneId: z.string() }),
    error: laneErrorSchema,
  }),
  startLane: fallible({ input: laneKey, data: z.void(), error: laneErrorSchema }),
  stopLane: fallible({ input: laneKey, data: z.void(), error: laneErrorSchema }),
  relaunchLane: fallible({ input: laneKey, data: z.void(), error: laneErrorSchema }),
  /** Hides the cell. Never stops the PTY. */
  sleepLane: fallible({ input: laneKey, data: z.void(), error: laneErrorSchema }),
  wakeLane: fallible({ input: laneKey, data: z.void(), error: laneErrorSchema }),
  /** Stops the PTY and drops the lane. The worktree stays unless `deleteWorktree`. */
  removeLane: fallible({
    input: laneKey.extend({ deleteWorktree: z.boolean() }),
    data: z.void(),
    error: laneErrorSchema,
  }),
  /** Moves a lane to a slot, swapping with any lane already there. */
  moveLane: fallible({
    input: laneKey.extend({ tabId: z.string().min(1), slot: laneSlotSchema }),
    data: z.void(),
    error: laneErrorSchema,
  }),
});

export type LanesContract = typeof lanesContract;
