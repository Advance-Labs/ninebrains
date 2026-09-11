import type { Result } from '@emdash/shared';
import { toast } from '@emdash/ui/react/primitives';
import { remote, type RemoteModel } from '@emdash/wire/state';
import { useRemoteModelState } from '@core/primitives/wire/browser/use-remote-model-state';
import { lanesContract, type LaneBoard, type LaneError, type LaneStatusMap } from '../api';
import { getLanesClient, type LanesRpcClient } from '../api/browser/client';

const EMPTY_BOARD: LaneBoard = { tabs: [] };
const EMPTY_STATUSES: LaneStatusMap = {};

let boardRemote: Promise<RemoteModel<typeof lanesContract.board>> | undefined;
let statusesRemote: Promise<RemoteModel<typeof lanesContract.statuses>> | undefined;

function getBoardRemote() {
  boardRemote ??= getLanesClient().then((client) =>
    remote(lanesContract.board, client.board, { lingerMs: 15_000 })
  );
  return boardRemote;
}

function getStatusesRemote() {
  statusesRemote ??= getLanesClient().then((client) =>
    remote(lanesContract.statuses, client.statuses, { lingerMs: 15_000 })
  );
  return statusesRemote;
}

export function useLaneBoard(): { board: LaneBoard; isLoading: boolean } {
  const state = useRemoteModelState(lanesContract.board, getBoardRemote, undefined, 'board', {
    initialValue: EMPTY_BOARD,
  });
  return { board: state.value ?? EMPTY_BOARD, isLoading: state.isLoading };
}

export function useLaneStatuses(): LaneStatusMap {
  const state = useRemoteModelState(lanesContract.statuses, getStatusesRemote, undefined, 'list', {
    initialValue: EMPTY_STATUSES,
  });
  return state.value ?? EMPTY_STATUSES;
}

/** Runs a lanes procedure and toasts its expected failure. */
export async function runLaneAction<T>(
  title: string,
  action: (client: LanesRpcClient) => Promise<Result<T, LaneError>>
): Promise<T | undefined> {
  try {
    const result = await action(await getLanesClient());
    if (result.success) return result.data;
    toast.error(title, { description: result.error.message });
  } catch (error) {
    toast.error(title, { description: error instanceof Error ? error.message : String(error) });
  }
  return undefined;
}

export async function resetLanesRemotesForTests(): Promise<void> {
  const [board, statuses] = await Promise.all([boardRemote, statusesRemote]);
  boardRemote = undefined;
  statusesRemote = undefined;
  await Promise.all([board?.dispose(), statuses?.dispose()]);
}
