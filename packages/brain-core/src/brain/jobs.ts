import { cycleIfAdded } from '../dag';
import { CycleError, ForbiddenError, IllegalTransitionError, InvalidInputError, NotFoundError } from '../errors';
import { assertId } from '../ids';
import { LIMITS } from '../limits';
import { MAX_ATTEMPTS } from '../state-machine';
import type { JobEdge, GateSpec, Identity, LaneId, ProjectId, Job, JobHints, JobId } from '../types';
import { addressOf, laneAddress } from '../types';
import { loadLiveJob, requireBrain, requireHolder, requireLane } from './authz';
import { type BrainContext, type Tx, checkText, checkTitle, transition } from './context';

export interface CreateJobInput {
  projectId: ProjectId;
  title: string;
  body?: string;
  gateSpec?: GateSpec | null;
  hints?: JobHints;
  dependsOn?: JobId[];
}

/** True when every inbound edge's source job is done (archived sources no longer count). */
export function dependenciesDone(ctx: BrainContext, jobId: JobId): boolean {
  return ctx.store.listEdges({ to: jobId }).every((edge) => {
    const source = ctx.store.getJob(edge.from);
    return !source || source.archivedAt !== null || source.state === 'done';
  });
}

/** Re-derives `proposed` vs `ready` from the dependency graph. Other states are left alone. */
export function settle(ctx: BrainContext, tx: Tx, job: Job): Job {
  if (job.archivedAt !== null) return job;
  if (job.state === 'proposed' && dependenciesDone(ctx, job.id)) return transition(ctx, tx, job, 'ready');
  if (job.state === 'ready' && !dependenciesDone(ctx, job.id)) return transition(ctx, tx, job, 'proposed');
  return job;
}

export function createJob(ctx: BrainContext, tx: Tx, identity: Identity, input: CreateJobInput): Job {
  requireBrain(identity, 'create_job');
  assertId('projectId', input.projectId);
  checkTitle(input.title);
  checkText('body', input.body ?? '', LIMITS.bodyBytes, false);
  const now = ctx.now();
  const job: Job = {
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
  ctx.store.insertJob(job);
  tx.raise({ type: 'jobChanged', payload: { job, previousState: null } });
  for (const dep of new Set(input.dependsOn ?? [])) {
    const source = loadLiveJob(ctx.store, identity, dep);
    if (source.projectId !== job.projectId) throw new InvalidInputError(`dependency ${dep} is in another project`);
    ctx.store.insertEdge({ from: dep, to: job.id, projectId: job.projectId, planId: null, createdAt: now });
  }
  return settle(ctx, tx, job);
}

/**
 * Adds `to depends on from`. Idempotent. Rejects cycles with the cycle path.
 * A `ready` target with a not-done source drops back to `proposed`; jobs a
 * lane already holds are not pulled back (the Brain decides what to do).
 */
export function linkJobs(ctx: BrainContext, tx: Tx, identity: Identity, from: JobId, to: JobId): JobEdge {
  requireBrain(identity, 'link_jobs');
  const source = loadLiveJob(ctx.store, identity, from);
  const target = loadLiveJob(ctx.store, identity, to);
  if (source.projectId !== target.projectId) throw new InvalidInputError('cannot link jobs across projects');
  const existing = ctx.store.listEdges({ from, to });
  if (existing.length > 0) return existing[0]!;
  const cycle = cycleIfAdded(ctx.store.listEdges({ projectId: source.projectId }), from, to);
  if (cycle) throw new CycleError(cycle);
  const edge: JobEdge = { from, to, projectId: source.projectId, planId: null, createdAt: ctx.now() };
  ctx.store.insertEdge(edge);
  settle(ctx, tx, target);
  return edge;
}

export function unlinkJobs(ctx: BrainContext, tx: Tx, identity: Identity, from: JobId, to: JobId): void {
  requireBrain(identity, 'unlink_jobs');
  ctx.store.deleteEdge(from, to);
  const target = ctx.store.getJob(to);
  if (target) settle(ctx, tx, target);
}

/** A lane claims a ready job in its own project. With `start`, it also begins running it. */
export function claimJob(
  ctx: BrainContext,
  tx: Tx,
  identity: Identity,
  jobId: JobId,
  options: { start?: boolean } = {}
): Job {
  requireLane(identity, 'claim_job');
  const job = loadLiveJob(ctx.store, identity, jobId);
  if (job.state !== 'ready') {
    throw new IllegalTransitionError(job.id, job.state, 'claimed', 'only ready jobs can be claimed');
  }
  let claimed = transition(ctx, tx, job, 'claimed', { laneId: identity.laneId });
  setLaneJob(ctx, tx, identity.laneId, claimed.id);
  if (options.start) claimed = transition(ctx, tx, claimed, 'running');
  return claimed;
}

/** The Brain hands a ready job to a specific lane of the same project. */
export function assignJob(ctx: BrainContext, tx: Tx, identity: Identity, jobId: JobId, laneId: LaneId): Job {
  requireBrain(identity, 'assign_job');
  const job = loadLiveJob(ctx.store, identity, jobId);
  const lane = ctx.store.getLane(laneId);
  if (!lane) throw new NotFoundError('lane', laneId);
  if (lane.projectId !== job.projectId) {
    throw new ForbiddenError(`lane ${laneId} belongs to project ${lane.projectId}, job is in ${job.projectId}`);
  }
  if (job.state !== 'ready') {
    throw new IllegalTransitionError(job.id, job.state, 'claimed', 'only ready jobs can be assigned');
  }
  const assigned = transition(ctx, tx, job, 'claimed', { laneId });
  setLaneJob(ctx, tx, laneId, assigned.id);
  return assigned;
}

export function startJob(ctx: BrainContext, tx: Tx, identity: Identity, jobId: JobId): Job {
  const job = loadLiveJob(ctx.store, identity, jobId);
  requireHolder(identity, job, 'start');
  return transition(ctx, tx, job, 'running');
}

/** Gives back a claimed job that was never started. */
export function releaseJob(ctx: BrainContext, tx: Tx, identity: Identity, jobId: JobId): Job {
  const job = loadLiveJob(ctx.store, identity, jobId);
  requireHolder(identity, job, 'release');
  const released = transition(ctx, tx, job, 'ready', { laneId: null });
  if (job.laneId) setLaneJob(ctx, tx, job.laneId, null);
  return settle(ctx, tx, released);
}

export function completeJob(
  ctx: BrainContext,
  tx: Tx,
  identity: Identity,
  jobId: JobId,
  report: { summary: string; artifacts?: string[] }
): Job {
  const job = loadLiveJob(ctx.store, identity, jobId);
  requireHolder(identity, job, 'complete');
  checkText('summary', report.summary, LIMITS.summaryBytes);
  const artifacts = report.artifacts ?? [];
  if (artifacts.length > LIMITS.artifacts) throw new InvalidInputError(`at most ${LIMITS.artifacts} artifacts`);
  return transition(ctx, tx, job, 'verifying', { result: { summary: report.summary, artifacts } });
}

/**
 * Outcome of the job's gates. Pass: `done`, logged, dependents promoted.
 * Fail: `attempts += 1` and back to `running` with the feedback in the lane's
 * inbox, or `blocked` once `MAX_ATTEMPTS` failures have accumulated.
 */
export function recordGateResult(
  ctx: BrainContext,
  tx: Tx,
  identity: Identity,
  jobId: JobId,
  outcome: { pass: boolean; feedback?: string }
): Job {
  requireBrain(identity, 'record_gate_result');
  const job = loadLiveJob(ctx.store, identity, jobId);
  if (job.state !== 'verifying') {
    throw new IllegalTransitionError(job.id, job.state, outcome.pass ? 'done' : 'running', 'job is not verifying');
  }
  if (outcome.pass) {
    const done = transition(ctx, tx, job, 'done', { reason: null });
    ctx.store.insertDone({
      id: ctx.newId(),
      jobId: done.id,
      projectId: done.projectId,
      laneId: done.laneId,
      summary: done.result?.summary ?? '',
      artifacts: done.result?.artifacts ?? [],
      at: ctx.now(),
    });
    if (done.laneId) setLaneJob(ctx, tx, done.laneId, null);
    promoteDependents(ctx, tx, done.id);
    return done;
  }

  const attempts = job.attempts + 1;
  const feedback = (outcome.feedback ?? '').slice(0, LIMITS.reasonChars);
  if (job.laneId && feedback) {
    const message = {
      id: ctx.newId(),
      from: addressOf(identity),
      to: laneAddress(job.laneId),
      body: `Gate failed for job ${job.id} (attempt ${attempts}/${MAX_ATTEMPTS}):\n${feedback}`,
      attachments: [],
      createdAt: ctx.now(),
      readAt: null,
    };
    ctx.store.insertMessage(message);
    tx.raise({ type: 'messageSent', payload: { message } });
  }
  if (attempts >= MAX_ATTEMPTS) {
    const reason = `gate failed ${attempts} times${feedback ? `: ${feedback}` : ''}`;
    const blocked = transition(ctx, tx, job, 'blocked', { attempts, reason });
    tx.raise({ type: 'jobBlocked', payload: { job: blocked, reason } });
    return blocked;
  }
  return transition(ctx, tx, job, 'running', { attempts });
}

export function blockJob(ctx: BrainContext, tx: Tx, identity: Identity, jobId: JobId, reason: string): Job {
  const job = loadLiveJob(ctx.store, identity, jobId);
  requireHolder(identity, job, 'block');
  checkText('reason', reason, LIMITS.reasonChars);
  const blocked = transition(ctx, tx, job, 'blocked', { reason });
  tx.raise({ type: 'jobBlocked', payload: { job: blocked, reason } });
  return blocked;
}

export function failJob(ctx: BrainContext, tx: Tx, identity: Identity, jobId: JobId, reason: string): Job {
  requireBrain(identity, 'fail_job');
  const job = loadLiveJob(ctx.store, identity, jobId);
  checkText('reason', reason, LIMITS.reasonChars);
  const failed = transition(ctx, tx, job, 'failed', { reason });
  if (job.laneId) setLaneJob(ctx, tx, job.laneId, null);
  return failed;
}

/** Puts a blocked or failed job back in the queue with a fresh attempt budget. */
export function requeueJob(ctx: BrainContext, tx: Tx, identity: Identity, jobId: JobId): Job {
  requireBrain(identity, 'requeue_job');
  const job = loadLiveJob(ctx.store, identity, jobId);
  if (job.state !== 'blocked' && job.state !== 'failed') {
    throw new IllegalTransitionError(job.id, job.state, 'ready', 'only blocked or failed jobs can be requeued');
  }
  const target = dependenciesDone(ctx, job.id) ? 'ready' : 'proposed';
  if (job.laneId) setLaneJob(ctx, tx, job.laneId, null);
  return transition(ctx, tx, job, target, { attempts: 0, laneId: null, reason: null, result: null });
}

export function promoteDependents(ctx: BrainContext, tx: Tx, jobId: JobId): void {
  for (const edge of ctx.store.listEdges({ from: jobId })) {
    const dependent = ctx.store.getJob(edge.to);
    if (dependent && dependent.state === 'proposed') settle(ctx, tx, dependent);
  }
}

/** Keeps `lane.activeJobId` in step with claims, when the lane is registered. */
function setLaneJob(ctx: BrainContext, tx: Tx, laneId: LaneId, jobId: JobId | null): void {
  const lane = ctx.store.getLane(laneId);
  if (!lane || lane.activeJobId === jobId) return;
  const next = { ...lane, activeJobId: jobId, updatedAt: ctx.now() };
  ctx.store.upsertLane(next);
  tx.raise({ type: 'laneChanged', payload: { lane: next } });
}
