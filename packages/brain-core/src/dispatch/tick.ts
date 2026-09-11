import type { JobEdge, Lane, LaneId, Run, Job, JobId } from '../types';
import { pickLane } from './route';

export interface DispatchState {
  jobs: readonly Job[];
  edges: readonly JobEdge[];
  lanes: readonly Lane[];
  /** Recent runs; the routing policy uses them for load and affinity. */
  runs: readonly Run[];
}

export interface PlannedAssignment {
  jobId: JobId;
  laneId: LaneId;
}

/**
 * Plans one round of dispatch without side effects: ready jobs, oldest
 * first, each get the lane `pickLane` chooses; a lane gets at most one job
 * per tick. The caller applies the plan (`brain.assignJob`) and a stale
 * entry simply fails its assignment, so racing ticks are harmless.
 */
export function dispatchTick(state: DispatchState): PlannedAssignment[] {
  const free = new Map(state.lanes.filter((lane) => lane.status === 'idle').map((lane) => [lane.id, lane]));
  const ready = state.jobs
    .filter((job) => job.state === 'ready' && job.archivedAt === null)
    .sort((a, b) => a.createdAt - b.createdAt);
  const plan: PlannedAssignment[] = [];

  for (const job of ready) {
    if (free.size === 0) break;
    const laneId = pickLane(job, [...free.values()], { runs: state.runs, edges: state.edges });
    if (laneId === null) continue;
    plan.push({ jobId: job.id, laneId });
    free.delete(laneId);
  }
  return plan;
}
