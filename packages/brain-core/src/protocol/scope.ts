import type { Brain } from '../brain/brain';
import { ForbiddenError, NotFoundError } from '../errors';
import { AGENT_GATE_KINDS, type Address, type GateKind, type ProjectId } from '../types';
import type { BrainGrant, ExecuteOptions } from './execute';
import { BRAIN_OPS, LANE_OPS, type ParsedBrainRequest, SESSION_OPS, USER_OPS } from './ops';

/**
 * Request-level authorization for the forwarding contract, run before any op executes.
 *
 * - L2: a token may call only its role's ops (`LANE_OPS`, `BRAIN_OPS` or `USER_OPS`, plus
 *   `whoami`). Only a user token reaches `HOST_OPS`.
 * - M3: a brain-role grant acts only inside `grant.projectId`, for every op: create, link,
 *   assign, requeue, complete, block, notes, listings, broadcast and reading inboxes. v0.1 has no
 *   global Brain grant, so a brain grant without a project may touch no project at all.
 * - L1: `send_message` recipients must exist and belong to the sender's project. A lane may message
 *   only its own project's lanes and Brains.
 * - SEC-08: a token may declare `gateKind` "code" or "ui" only. Every other kind has a weaker gate
 *   floor, so it is refused, never coerced. The app's own identities call `Brain` directly and may
 *   set any kind.
 *
 * - M5: a user token is the human operator. See `authorizeUserRequest` for what that means and
 *   what it deliberately does not constrain.
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
  const allowed: readonly string[] = grant.user
    ? USER_OPS
    : me.role === 'lane'
      ? LANE_OPS
      : BRAIN_OPS;
  if (!(SESSION_OPS as readonly string[]).includes(request.op) && !allowed.includes(request.op)) {
    throw new ForbiddenError(`${request.op} is not available to a ${me.role} session`);
  }

  if (grant.user) return authorizeUserRequest(brain, request);

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
      checkGateKind(request.args.gateKind);
      return inHome(request.args.projectId);
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

function checkGateKind(kind: GateKind | undefined): void {
  if (kind === undefined || (AGENT_GATE_KINDS as readonly string[]).includes(kind)) return;
  throw new ForbiddenError(
    `gateKind "${kind}" has a weaker gate floor than code work; agents may declare "code" or "ui" only`
  );
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

/**
 * M5: what a user-role token may do.
 *
 * A user token is minted for the human operator's CLI and written to a 0600 file
 * under userData, so holding it already means holding that OS account. It is the
 * successor to the desktop UI, which had no project boundary and no gate-kind
 * limit, so pinning the CLI tighter than the window it replaces would only push
 * the operator back to a second tool.
 *
 * What it therefore does NOT do:
 * - It does not pin the caller to `grant.projectId`. That field is only the CLI's
 *   default project when a command omits `--project`.
 * - It does not apply `checkGateKind`. SEC-08 restricts *agents* to "code" and
 *   "ui" because a weaker kind lowers the gate floor; lowering rigor is the
 *   user's call, and always was.
 *
 * What it still does:
 * - The op allowlist above (L2) still applies, so a user token cannot call
 *   `claim_job`: claiming is a lane's move and would corrupt job ownership.
 * - Recipients must exist. A typo'd lane id is a NOT_FOUND, not a silent drop.
 * - The gate floor itself is still `union(floor, requested)` in `Brain`, so even
 *   the user cannot strip a project's floor through this path (SEC-08).
 */
function authorizeUserRequest(brain: Brain, request: ParsedBrainRequest): void {
  const exists = (address: Address): void => {
    if (address.kind !== 'lane') return;
    if (!brain.store.getLane(address.id)) throw new NotFoundError('lane', address.id);
  };
  if (request.op === 'send_message') exists(request.args.to);
  if (request.op === 'read_inbox' && request.args.address) exists(request.args.address);
}
