import type { ContractImpl } from '@emdash/wire/rpc';
import { expose } from '@emdash/wire/state';
import { lanesContract } from '../api';
import { lanesEvents } from './event-host';
import type { LaneService } from './lane-service';

/** Thin delegate to LaneService; returns an owner so the caller disposes the providers. */
export function createLanesWireController(lanes: LaneService): {
  impl: ContractImpl<typeof lanesContract>;
  dispose(): Promise<void>;
} {
  const board = expose(lanesContract.board, { board: lanes.board });
  const statuses = expose(lanesContract.statuses, { list: lanes.statuses });
  return {
    impl: {
      board,
      statuses,
      events: lanesEvents,
      createTab: ({ title }) => lanes.createTab(title),
      renameTab: ({ tabId, title }) => lanes.renameTab(tabId, title),
      removeTab: ({ tabId }) => lanes.removeTab(tabId),
      createLane: (input) => lanes.createLane(input),
      startLane: ({ laneId }) => lanes.startLane(laneId),
      stopLane: ({ laneId }) => lanes.stopLane(laneId),
      relaunchLane: ({ laneId }) => lanes.relaunchLane(laneId),
      sleepLane: ({ laneId }) => lanes.sleepLane(laneId),
      wakeLane: ({ laneId }) => lanes.wakeLane(laneId),
      removeLane: ({ laneId, deleteWorktree }) => lanes.removeLane(laneId, deleteWorktree),
      moveLane: ({ laneId, tabId, slot }) => lanes.moveLane(laneId, tabId, slot),
      setLaneMode: ({ laneId, mode }) => lanes.setLaneMode(laneId, mode),
    },
    async dispose() {
      await board.dispose();
      await statuses.dispose();
    },
  };
}
