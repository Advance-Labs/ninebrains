import type { Brain } from '../brain/brain';
import { ForbiddenError, NotFoundError } from '../errors';
import type { Address, ProjectId } from '../types';
import type { BrainGrant, ExecuteOptions } from './execute';
import { BRAIN_OPS, LANE_OPS, type ParsedBrainRequest, SESSION_OPS } from './ops';

/**
 * Request-level authorization for the forwarding contract, run before any op executes.
 *
 * - L2: a token may call only its role's ops (`LANE_OPS` or `BRAIN_OPS`, plus `whoami`).
 * - M3: a brain-role grant acts only inside `grant.projectId`, for every op: create, link,
 *   assign, requeue, complete, block, notes, listings, broadcast and reading inboxes. v0.1 has no
 *   global Brain grant, so a brain grant without a project may touch no project at all.
 * - L1: `send_message` recipients must exist and belong to the sender's project. A lane may message
 *   only its own project's lanes and Brains.
 *
 * The domain layer (`Brain`) stays unscoped for the brain role on purpose: main's own identity uses
 * it directly. Scoping is a property of tokens, so it lives here.
 */
export function authorizeRequest(
  brain: Brain,
  grant: BrainGrant,
  request: ParsedBrainRequest,
  options: ExecuteOptions
): void {
  const me = grant.identity;
  const allowed: readonly string[] = me.role === 'lane' ? LANE_OPS : BRAIN_OPS;
  if (!(SESSION_OPS as readonly string[]).includes(request.op) && !allowed.includes(request.op)) {
    throw new ForbiddenError(`${request.op} is not available to a ${me.role} session`);
  }

  const home = me.role === 'lane' ? me.projectId : grant.projectId;
  if (request.op === 'send_message') checkRecipient(brain, grant, home, request.args.to, options);
  if (me.role !== 'brain') return;

  const inHome = (projectId: ProjectId | undefined) => {
    if (home === null) {
      throw new ForbiddenError(
        'this Brain session has no project, and v0.1 has no global Brain grant'
      );
    }
    if (projectId !== undefined && projectId !== home) {
      throw new ForbiddenError(
        `this Brain session is scoped to project ${home} and cannot access project ${projectId}`
      );
    }
  };
  // Other projects' jobs look missing, as they do to lanes, so ids cannot be probed.
  const job = (jobId: string | undefined) => {
    if (jobId === undefined) return;
    const found = brain.store.getJob(jobId);
    if (found && (home === null || found.projectId !== home)) throw new NotFoundError('job', jobId);
  };

  switch (request.op) {
    case 'create_job':
    case 'broadcast':
    case 'list_jobs':
    case 'list_lanes':
      return inHome(request.args.projectId);
    case 'add_note':
      inHome(request.args.projectId);
      return job(request.args.jobId);
    case 'link_jobs':
      job(request.args.from);
      return job(request.args.to);
    case 'assign_job':
      job(request.args.jobId);
      return laneInProject(brain, request.args.laneId, home);
    case 'complete_job':
    case 'block_job':
    case 'requeue_job':
      return job(request.args.jobId);
    case 'read_inbox':
      if (request.args.address) checkAddress(brain, grant, home, request.args.address, options);
      return;
    default:
      return;
  }
}

function checkRecipient(
  brain: Brain,
  grant: BrainGrant,
  home: ProjectId | null,
  to: Address,
  options: ExecuteOptions
): void {
  checkAddress(brain, grant, home, to, options);
}

/** The address must exist and belong to `home`. A Brain's own address always qualifies. */
function checkAddress(
  brain: Brain,
  grant: BrainGrant,
  home: ProjectId | null,
  address: Address,
  options: ExecuteOptions
): void {
  const me = grant.identity;
  if (address.kind === 'lane') return laneInProject(brain, address.id, home);
  if (me.role === 'brain' && me.brainId === address.id) return;
  const project = options.resolveBrainProject?.(address.id);
  if (project === undefined) throw new NotFoundError('brain', address.id);
  if (home === null || project !== home) {
    throw new ForbiddenError(`brain ${address.id} belongs to another project`);
  }
}

function laneInProject(brain: Brain, laneId: string, home: ProjectId | null): void {
  const lane = brain.store.getLane(laneId);
  if (!lane) throw new NotFoundError('lane', laneId);
  if (home === null || lane.projectId !== home) {
    throw new ForbiddenError(`lane ${laneId} belongs to another project`);
  }
}
