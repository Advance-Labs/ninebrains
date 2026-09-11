import type { Result } from '@emdash/shared';
import { toast } from '@emdash/ui/react/primitives';
import { remote, type RemoteModel } from '@emdash/wire/state';
import { useRemoteModelState } from '@core/primitives/wire/browser/use-remote-model-state';
import {
  brainContract,
  type BrainDispatcherView,
  type BrainError,
  type BrainJobView,
  type BrainSessionView,
  type BrainUnread,
} from '../api';
import { getBrainClient, type BrainClient } from '../api/browser/client';

let overviewRemote: Promise<RemoteModel<typeof brainContract.overview>> | undefined;
let projectRemote: Promise<RemoteModel<typeof brainContract.project>> | undefined;

const getOverviewRemote = () => {
  overviewRemote ??= getBrainClient().then((client) =>
    remote(brainContract.overview, client.overview, { lingerMs: 15_000 })
  );
  return overviewRemote;
};

const getProjectRemote = () => {
  projectRemote ??= getBrainClient().then((client) =>
    remote(brainContract.project, client.project, { lingerMs: 15_000 })
  );
  return projectRemote;
};

const NO_UNREAD: BrainUnread = {};
const NO_SESSIONS: BrainSessionView[] = [];
const NO_JOBS: BrainJobView[] = [];
const IDLE_DISPATCHER: BrainDispatcherView = {
  paused: false,
  stopLatched: false,
  laneModes: {},
  activeRuns: 0,
  gatesConnected: false,
};

export function useBrainOverview() {
  const unread = useRemoteModelState(brainContract.overview, getOverviewRemote, undefined, 'unread', {
    initialValue: NO_UNREAD,
  });
  const sessions = useRemoteModelState(
    brainContract.overview,
    getOverviewRemote,
    undefined,
    'sessions',
    { initialValue: NO_SESSIONS }
  );
  const dispatcher = useRemoteModelState(
    brainContract.overview,
    getOverviewRemote,
    undefined,
    'dispatcher',
    { initialValue: IDLE_DISPATCHER }
  );
  return {
    unread: unread.value ?? NO_UNREAD,
    sessions: sessions.value ?? NO_SESSIONS,
    dispatcher: dispatcher.value ?? IDLE_DISPATCHER,
  };
}

export function useBrainJobs(projectId: string | null): BrainJobView[] {
  const jobs = useRemoteModelState(
    brainContract.project,
    getProjectRemote,
    { projectId: projectId ?? '-' },
    'jobs',
    { initialValue: NO_JOBS, enabled: projectId !== null }
  );
  return jobs.value ?? NO_JOBS;
}

/** Runs a Brain procedure and toasts its expected failure. */
export async function runBrainAction<T>(
  title: string,
  action: (client: BrainClient) => Promise<Result<T, BrainError>>
): Promise<T | undefined> {
  try {
    const result = await action(await getBrainClient());
    if (result.success) return result.data;
    toast.error(title, { description: result.error.message });
  } catch (error) {
    toast.error(title, { description: error instanceof Error ? error.message : String(error) });
  }
  return undefined;
}
