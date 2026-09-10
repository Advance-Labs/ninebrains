import { ForbiddenError, NotFoundError } from '../errors';
import type { BrainStore } from '../store/store';
import type { Address, Identity, ProjectId, Job, JobId } from '../types';
import { addressOf } from '../types';

/**
 * Lane-scoped authorization. The rules:
 * - `brain` may do anything.
 * - A lane sees and claims only jobs in its own project.
 * - A lane completes, blocks or releases only jobs it holds (`job.laneId`).
 * - A lane reads only its own inbox.
 */

export function requireBrain(identity: Identity, action: string): asserts identity is Extract<Identity, { role: 'brain' }> {
  if (identity.role !== 'brain') throw new ForbiddenError(`${action} requires the brain role`);
}

export function requireLane(identity: Identity, action: string): asserts identity is Extract<Identity, { role: 'lane' }> {
  if (identity.role !== 'lane') throw new ForbiddenError(`${action} is a lane action`);
}

/** Loads a live (non-archived) job the caller may see. Lanes cannot see other projects' jobs. */
export function loadVisibleJob(store: BrainStore, identity: Identity, jobId: JobId): Job {
  const job = store.getJob(jobId);
  // A lane gets NOT_FOUND for other projects' jobs, so it cannot probe for ids.
  if (!job || (identity.role === 'lane' && job.projectId !== identity.projectId)) {
    throw new NotFoundError('job', jobId);
  }
  return job;
}

export function loadLiveJob(store: BrainStore, identity: Identity, jobId: JobId): Job {
  const job = loadVisibleJob(store, identity, jobId);
  if (job.archivedAt !== null) throw new NotFoundError('job', jobId);
  return job;
}

export function requireHolder(identity: Identity, job: Job, action: string): void {
  if (identity.role === 'brain') return;
  if (job.laneId !== identity.laneId) {
    throw new ForbiddenError(`lane ${identity.laneId} cannot ${action} job ${job.id}: it is not held by this lane`);
  }
}

export function scopeProject(identity: Identity, requested?: ProjectId): ProjectId | undefined {
  if (identity.role === 'brain') return requested;
  if (requested !== undefined && requested !== identity.projectId) {
    throw new ForbiddenError(`lane ${identity.laneId} cannot access project ${requested}`);
  }
  return identity.projectId;
}

export function inboxAddress(identity: Identity, requested?: Address): Address {
  const own = addressOf(identity);
  if (requested === undefined || requested === own) return own;
  if (identity.role === 'brain') return requested;
  throw new ForbiddenError(`lane ${identity.laneId} can only read its own inbox`);
}
