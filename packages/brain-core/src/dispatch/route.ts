/**
 * ROUTING POLICY: the tuning point of the whole product.
 *
 * `pickLane` decides which free lane gets a ready task. It is pure (no I/O,
 * no clock) so it is cheap to test and safe to rewrite. Change the policy
 * here and nowhere else; `dispatchTick` and the dispatcher only call it.
 *
 * Default policy, in priority order:
 *   1. Eligibility: only `idle` lanes in the task's project.
 *   2. Independence (review tasks only): if any eligible lane runs a
 *      different provider from the author, only those lanes are considered.
 *      A reviewer on the same model tends to agree with itself.
 *   3. Context affinity: prefer the lane that already has the context. Each
 *      overlapping file between `lane.recentFiles` and `task.hints.paths`
 *      scores 1; a lane whose last task is in this task's dependency chain
 *      scores 2 more (it just built what this task builds on).
 *   4. Throughput: among equal affinity, the lane with the fewest runs in
 *      `history.runs` (least loaded). Lane id breaks remaining ties so the
 *      choice is deterministic.
 */
import { ancestors } from '../dag';
import type { Edge, Lane, LaneId, Run, Task } from '../types';

export interface RoutingHistory {
  /** Recent runs, any order. Used for load and for each lane's last task. */
  runs: readonly Run[];
  /** Project edges, used to find the task's dependency chain. */
  edges?: readonly Edge[];
}

export type RoutableTask = Pick<Task, 'id' | 'projectId' | 'hints'>;

const FILE_OVERLAP_WEIGHT = 1;
const DEPENDENCY_CHAIN_WEIGHT = 2;

export function pickLane(task: RoutableTask, lanes: readonly Lane[], history: RoutingHistory): LaneId | null {
  let candidates = lanes.filter((lane) => lane.status === 'idle' && lane.projectId === task.projectId);
  if (candidates.length === 0) return null;

  const author = task.hints.authorProvider;
  if (task.hints.kind === 'review' && author) {
    const independent = candidates.filter((lane) => lane.provider !== author);
    if (independent.length > 0) candidates = independent;
  }

  const chain = history.edges ? ancestors(history.edges, task.id) : new Set<string>();
  const paths = task.hints.paths ?? [];
  const load = new Map<LaneId, number>();
  const lastTask = new Map<LaneId, { taskId: string; at: number }>();
  for (const run of history.runs) {
    load.set(run.laneId, (load.get(run.laneId) ?? 0) + 1);
    const last = lastTask.get(run.laneId);
    if (!last || run.startedAt > last.at) lastTask.set(run.laneId, { taskId: run.taskId, at: run.startedAt });
  }

  const scored = candidates.map((lane) => {
    let affinity = FILE_OVERLAP_WEIGHT * overlap(lane.recentFiles, paths);
    const last = lastTask.get(lane.id);
    if (last && chain.has(last.taskId)) affinity += DEPENDENCY_CHAIN_WEIGHT;
    return { lane, affinity, load: load.get(lane.id) ?? 0 };
  });
  scored.sort((a, b) => b.affinity - a.affinity || a.load - b.load || a.lane.id.localeCompare(b.lane.id));
  return scored[0]!.lane.id;
}

/** Counts task paths touched by the lane. A directory path matches files inside it. */
function overlap(recentFiles: readonly string[], paths: readonly string[]): number {
  let count = 0;
  for (const p of paths) {
    if (recentFiles.some((f) => samePathOrInside(f, p) || samePathOrInside(p, f))) count++;
  }
  return count;
}

function samePathOrInside(child: string, parent: string): boolean {
  const c = normalize(child);
  const p = normalize(parent);
  return c === p || c.startsWith(`${p}/`);
}

function normalize(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}
