import { ForbiddenError, NotFoundError } from '../errors';
import type { BrainStore } from '../store/store';
import type { Address, Identity, ProjectId, Task, TaskId } from '../types';
import { addressOf } from '../types';

/**
 * Lane-scoped authorization. The rules:
 * - `brain` may do anything.
 * - A lane sees and claims only tasks in its own project.
 * - A lane completes, blocks or releases only tasks it holds (`task.laneId`).
 * - A lane reads only its own inbox.
 */

export function requireBrain(identity: Identity, action: string): asserts identity is Extract<Identity, { role: 'brain' }> {
  if (identity.role !== 'brain') throw new ForbiddenError(`${action} requires the brain role`);
}

export function requireLane(identity: Identity, action: string): asserts identity is Extract<Identity, { role: 'lane' }> {
  if (identity.role !== 'lane') throw new ForbiddenError(`${action} is a lane action`);
}

/** Loads a live (non-archived) task the caller may see. Lanes cannot see other projects' tasks. */
export function loadVisibleTask(store: BrainStore, identity: Identity, taskId: TaskId): Task {
  const task = store.getTask(taskId);
  // A lane gets NOT_FOUND for other projects' tasks, so it cannot probe for ids.
  if (!task || (identity.role === 'lane' && task.projectId !== identity.projectId)) {
    throw new NotFoundError('task', taskId);
  }
  return task;
}

export function loadLiveTask(store: BrainStore, identity: Identity, taskId: TaskId): Task {
  const task = loadVisibleTask(store, identity, taskId);
  if (task.archivedAt !== null) throw new NotFoundError('task', taskId);
  return task;
}

export function requireHolder(identity: Identity, task: Task, action: string): void {
  if (identity.role === 'brain') return;
  if (task.laneId !== identity.laneId) {
    throw new ForbiddenError(`lane ${identity.laneId} cannot ${action} task ${task.id}: it is not held by this lane`);
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
