import type { Edge, Lane, LaneId, Run, Task, TaskId } from '../types';
import { pickLane } from './route';

export interface DispatchState {
  tasks: readonly Task[];
  edges: readonly Edge[];
  lanes: readonly Lane[];
  /** Recent runs; the routing policy uses them for load and affinity. */
  runs: readonly Run[];
}

export interface PlannedAssignment {
  taskId: TaskId;
  laneId: LaneId;
}

/**
 * Plans one round of dispatch without side effects: ready tasks, oldest
 * first, each get the lane `pickLane` chooses; a lane gets at most one task
 * per tick. The caller applies the plan (`brain.assignTask`) and a stale
 * entry simply fails its assignment, so racing ticks are harmless.
 */
export function dispatchTick(state: DispatchState): PlannedAssignment[] {
  const free = new Map(state.lanes.filter((lane) => lane.status === 'idle').map((lane) => [lane.id, lane]));
  const ready = state.tasks
    .filter((task) => task.state === 'ready' && task.archivedAt === null)
    .sort((a, b) => a.createdAt - b.createdAt);
  const plan: PlannedAssignment[] = [];

  for (const task of ready) {
    if (free.size === 0) break;
    const laneId = pickLane(task, [...free.values()], { runs: state.runs, edges: state.edges });
    if (laneId === null) continue;
    plan.push({ taskId: task.id, laneId });
    free.delete(laneId);
  }
  return plan;
}
