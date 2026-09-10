import { cycleIfAdded } from '../dag';
import { CycleError, ForbiddenError, IllegalTransitionError, InvalidInputError, NotFoundError } from '../errors';
import { LIMITS } from '../limits';
import { MAX_ATTEMPTS } from '../state-machine';
import type { Edge, GateSpec, Identity, LaneId, ProjectId, Task, TaskHints, TaskId } from '../types';
import { addressOf } from '../types';
import { loadLiveTask, requireBrain, requireHolder, requireLane } from './authz';
import { type BrainContext, type Tx, checkText, checkTitle, transition } from './context';

export interface CreateTaskInput {
  projectId: ProjectId;
  title: string;
  body?: string;
  gateSpec?: GateSpec | null;
  hints?: TaskHints;
  dependsOn?: TaskId[];
}

/** True when every inbound edge's source task is done (archived sources no longer count). */
export function dependenciesDone(ctx: BrainContext, taskId: TaskId): boolean {
  return ctx.store.listEdges({ to: taskId }).every((edge) => {
    const source = ctx.store.getTask(edge.from);
    return !source || source.archivedAt !== null || source.state === 'done';
  });
}

/** Re-derives `proposed` vs `ready` from the dependency graph. Other states are left alone. */
export function settle(ctx: BrainContext, tx: Tx, task: Task): Task {
  if (task.archivedAt !== null) return task;
  if (task.state === 'proposed' && dependenciesDone(ctx, task.id)) return transition(ctx, tx, task, 'ready');
  if (task.state === 'ready' && !dependenciesDone(ctx, task.id)) return transition(ctx, tx, task, 'proposed');
  return task;
}

export function createTask(ctx: BrainContext, tx: Tx, identity: Identity, input: CreateTaskInput): Task {
  requireBrain(identity, 'create_task');
  checkTitle(input.title);
  checkText('body', input.body ?? '', LIMITS.bodyBytes, false);
  const now = ctx.now();
  const task: Task = {
    id: ctx.newId(),
    projectId: input.projectId,
    title: input.title,
    body: input.body ?? '',
    state: 'proposed',
    laneId: null,
    attempts: 0,
    gateSpec: input.gateSpec ?? null,
    hints: input.hints ?? {},
    result: null,
    reason: null,
    createdBy: addressOf(identity),
    planId: null,
    planNodeId: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  ctx.store.insertTask(task);
  tx.raise({ type: 'taskChanged', payload: { task, previousState: null } });
  for (const dep of new Set(input.dependsOn ?? [])) {
    const source = loadLiveTask(ctx.store, identity, dep);
    if (source.projectId !== task.projectId) throw new InvalidInputError(`dependency ${dep} is in another project`);
    ctx.store.insertEdge({ from: dep, to: task.id, projectId: task.projectId, planId: null, createdAt: now });
  }
  return settle(ctx, tx, task);
}

/**
 * Adds `to depends on from`. Idempotent. Rejects cycles with the cycle path.
 * A `ready` target with a not-done source drops back to `proposed`; tasks a
 * lane already holds are not pulled back (the Brain decides what to do).
 */
export function linkTasks(ctx: BrainContext, tx: Tx, identity: Identity, from: TaskId, to: TaskId): Edge {
  requireBrain(identity, 'link_tasks');
  const source = loadLiveTask(ctx.store, identity, from);
  const target = loadLiveTask(ctx.store, identity, to);
  if (source.projectId !== target.projectId) throw new InvalidInputError('cannot link tasks across projects');
  const existing = ctx.store.listEdges({ from, to });
  if (existing.length > 0) return existing[0]!;
  const cycle = cycleIfAdded(ctx.store.listEdges({ projectId: source.projectId }), from, to);
  if (cycle) throw new CycleError(cycle);
  const edge: Edge = { from, to, projectId: source.projectId, planId: null, createdAt: ctx.now() };
  ctx.store.insertEdge(edge);
  settle(ctx, tx, target);
  return edge;
}

export function unlinkTasks(ctx: BrainContext, tx: Tx, identity: Identity, from: TaskId, to: TaskId): void {
  requireBrain(identity, 'unlink_tasks');
  ctx.store.deleteEdge(from, to);
  const target = ctx.store.getTask(to);
  if (target) settle(ctx, tx, target);
}

/** A lane claims a ready task in its own project. With `start`, it also begins running it. */
export function claimTask(
  ctx: BrainContext,
  tx: Tx,
  identity: Identity,
  taskId: TaskId,
  options: { start?: boolean } = {}
): Task {
  requireLane(identity, 'claim_task');
  const task = loadLiveTask(ctx.store, identity, taskId);
  if (task.state !== 'ready') {
    throw new IllegalTransitionError(task.id, task.state, 'claimed', 'only ready tasks can be claimed');
  }
  let claimed = transition(ctx, tx, task, 'claimed', { laneId: identity.laneId });
  setLaneTask(ctx, tx, identity.laneId, claimed.id);
  if (options.start) claimed = transition(ctx, tx, claimed, 'running');
  return claimed;
}

/** The Brain hands a ready task to a specific lane of the same project. */
export function assignTask(ctx: BrainContext, tx: Tx, identity: Identity, taskId: TaskId, laneId: LaneId): Task {
  requireBrain(identity, 'assign_task');
  const task = loadLiveTask(ctx.store, identity, taskId);
  const lane = ctx.store.getLane(laneId);
  if (!lane) throw new NotFoundError('lane', laneId);
  if (lane.projectId !== task.projectId) {
    throw new ForbiddenError(`lane ${laneId} belongs to project ${lane.projectId}, task is in ${task.projectId}`);
  }
  if (task.state !== 'ready') {
    throw new IllegalTransitionError(task.id, task.state, 'claimed', 'only ready tasks can be assigned');
  }
  const assigned = transition(ctx, tx, task, 'claimed', { laneId });
  setLaneTask(ctx, tx, laneId, assigned.id);
  return assigned;
}

export function startTask(ctx: BrainContext, tx: Tx, identity: Identity, taskId: TaskId): Task {
  const task = loadLiveTask(ctx.store, identity, taskId);
  requireHolder(identity, task, 'start');
  return transition(ctx, tx, task, 'running');
}

/** Gives back a claimed task that was never started. */
export function releaseTask(ctx: BrainContext, tx: Tx, identity: Identity, taskId: TaskId): Task {
  const task = loadLiveTask(ctx.store, identity, taskId);
  requireHolder(identity, task, 'release');
  const released = transition(ctx, tx, task, 'ready', { laneId: null });
  if (task.laneId) setLaneTask(ctx, tx, task.laneId, null);
  return settle(ctx, tx, released);
}

export function completeTask(
  ctx: BrainContext,
  tx: Tx,
  identity: Identity,
  taskId: TaskId,
  report: { summary: string; artifacts?: string[] }
): Task {
  const task = loadLiveTask(ctx.store, identity, taskId);
  requireHolder(identity, task, 'complete');
  checkText('summary', report.summary, LIMITS.summaryBytes);
  const artifacts = report.artifacts ?? [];
  if (artifacts.length > LIMITS.artifacts) throw new InvalidInputError(`at most ${LIMITS.artifacts} artifacts`);
  return transition(ctx, tx, task, 'verifying', { result: { summary: report.summary, artifacts } });
}

/**
 * Outcome of the task's gates. Pass: `done`, logged, dependents promoted.
 * Fail: `attempts += 1` and back to `running` with the feedback in the lane's
 * inbox, or `blocked` once `MAX_ATTEMPTS` failures have accumulated.
 */
export function recordGateResult(
  ctx: BrainContext,
  tx: Tx,
  identity: Identity,
  taskId: TaskId,
  outcome: { pass: boolean; feedback?: string }
): Task {
  requireBrain(identity, 'record_gate_result');
  const task = loadLiveTask(ctx.store, identity, taskId);
  if (task.state !== 'verifying') {
    throw new IllegalTransitionError(task.id, task.state, outcome.pass ? 'done' : 'running', 'task is not verifying');
  }
  if (outcome.pass) {
    const done = transition(ctx, tx, task, 'done', { reason: null });
    ctx.store.insertDone({
      id: ctx.newId(),
      taskId: done.id,
      projectId: done.projectId,
      laneId: done.laneId,
      summary: done.result?.summary ?? '',
      artifacts: done.result?.artifacts ?? [],
      at: ctx.now(),
    });
    if (done.laneId) setLaneTask(ctx, tx, done.laneId, null);
    promoteDependents(ctx, tx, done.id);
    return done;
  }

  const attempts = task.attempts + 1;
  const feedback = (outcome.feedback ?? '').slice(0, LIMITS.reasonChars);
  if (task.laneId && feedback) {
    const message = {
      id: ctx.newId(),
      from: addressOf(identity),
      to: `lane:${task.laneId}` as const,
      body: `Gate failed for task ${task.id} (attempt ${attempts}/${MAX_ATTEMPTS}):\n${feedback}`,
      attachments: [],
      createdAt: ctx.now(),
      readAt: null,
    };
    ctx.store.insertMessage(message);
    tx.raise({ type: 'messageSent', payload: { message } });
  }
  if (attempts >= MAX_ATTEMPTS) {
    const reason = `gate failed ${attempts} times${feedback ? `: ${feedback}` : ''}`;
    const blocked = transition(ctx, tx, task, 'blocked', { attempts, reason });
    tx.raise({ type: 'taskBlocked', payload: { task: blocked, reason } });
    return blocked;
  }
  return transition(ctx, tx, task, 'running', { attempts });
}

export function blockTask(ctx: BrainContext, tx: Tx, identity: Identity, taskId: TaskId, reason: string): Task {
  const task = loadLiveTask(ctx.store, identity, taskId);
  requireHolder(identity, task, 'block');
  checkText('reason', reason, LIMITS.reasonChars);
  const blocked = transition(ctx, tx, task, 'blocked', { reason });
  tx.raise({ type: 'taskBlocked', payload: { task: blocked, reason } });
  return blocked;
}

export function failTask(ctx: BrainContext, tx: Tx, identity: Identity, taskId: TaskId, reason: string): Task {
  requireBrain(identity, 'fail_task');
  const task = loadLiveTask(ctx.store, identity, taskId);
  checkText('reason', reason, LIMITS.reasonChars);
  const failed = transition(ctx, tx, task, 'failed', { reason });
  if (task.laneId) setLaneTask(ctx, tx, task.laneId, null);
  return failed;
}

/** Puts a blocked or failed task back in the queue with a fresh attempt budget. */
export function requeueTask(ctx: BrainContext, tx: Tx, identity: Identity, taskId: TaskId): Task {
  requireBrain(identity, 'requeue_task');
  const task = loadLiveTask(ctx.store, identity, taskId);
  if (task.state !== 'blocked' && task.state !== 'failed') {
    throw new IllegalTransitionError(task.id, task.state, 'ready', 'only blocked or failed tasks can be requeued');
  }
  const target = dependenciesDone(ctx, task.id) ? 'ready' : 'proposed';
  if (task.laneId) setLaneTask(ctx, tx, task.laneId, null);
  return transition(ctx, tx, task, target, { attempts: 0, laneId: null, reason: null, result: null });
}

export function promoteDependents(ctx: BrainContext, tx: Tx, taskId: TaskId): void {
  for (const edge of ctx.store.listEdges({ from: taskId })) {
    const dependent = ctx.store.getTask(edge.to);
    if (dependent && dependent.state === 'proposed') settle(ctx, tx, dependent);
  }
}

/** Keeps `lane.activeTaskId` in step with claims, when the lane is registered. */
function setLaneTask(ctx: BrainContext, tx: Tx, laneId: LaneId, taskId: TaskId | null): void {
  const lane = ctx.store.getLane(laneId);
  if (!lane || lane.activeTaskId === taskId) return;
  const next = { ...lane, activeTaskId: taskId, updatedAt: ctx.now() };
  ctx.store.upsertLane(next);
  tx.raise({ type: 'laneChanged', payload: { lane: next } });
}
