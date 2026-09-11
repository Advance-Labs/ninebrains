import { remote, type RemoteModel } from '@emdash/wire/state';
import { useMemo } from 'react';
import { plannerContract, type PlannerJobState } from '@core/features/planner/api';
import { getPlannerClient } from '@core/features/planner/api/browser/client';
import { useRemoteModelState } from '@core/primitives/wire/browser/use-remote-model-state';

let statesRemotePromise: Promise<RemoteModel<typeof plannerContract.nodeStates>> | undefined;

const EMPTY: Record<string, PlannerJobState> = {};

/** Live Brain job state per canvas node id. Empty until the canvas has been compiled. */
export function usePlannerNodeStates(
  projectId: string,
  canvasId: string
): Record<string, PlannerJobState> {
  const key = useMemo(() => ({ projectId, canvasId }), [projectId, canvasId]);
  const state = useRemoteModelState(plannerContract.nodeStates, getStatesRemote, key, 'states', {
    initialValue: EMPTY,
  });
  return state.value ?? EMPTY;
}

function getStatesRemote(): Promise<RemoteModel<typeof plannerContract.nodeStates>> {
  statesRemotePromise ??= getPlannerClient().then((client) =>
    remote(plannerContract.nodeStates, client.nodeStates, { lingerMs: 15_000 })
  );
  return statesRemotePromise;
}

export async function resetPlannerNodeStatesForTests(): Promise<void> {
  const remoteModel = await statesRemotePromise;
  statesRemotePromise = undefined;
  await remoteModel?.dispose();
}
