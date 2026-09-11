import { findCycle } from '../dag';
import { CycleError, InvalidInputError } from '../errors';
import { assertId } from '../ids';
import { LIMITS } from '../limits';
import type { GateSpec, Identity, ProjectId, Job, JobHints, JobId } from '../types';
import { addressOf } from '../types';
import { requireBrain } from './authz';
import { type BrainContext, type Tx, checkText, checkTitle, touch, withGateFloor } from './context';
import { settle } from './jobs';

export interface PlanNode {
  /** Stable id from the planner canvas. The upsert key. */
  id: string;
  title: string;
  body?: string;
  gateSpec?: GateSpec | null;
  hints?: JobHints;
}

export interface PlanInput {
  planId: string;
  projectId: ProjectId;
  nodes: PlanNode[];
  /** `to` depends on `from`, both plan node ids. */
  edges: Array<{ from: string; to: string }>;
}

export interface CompileResult {
  /** Plan node id -> job id. */
  jobIds: Record<string, JobId>;
  created: JobId[];
  updated: JobId[];
  unchanged: JobId[];
  archived: JobId[];
  edgesAdded: number;
  edgesRemoved: number;
}

/**
 * Upserts a plan into jobs + edges, idempotently:
 * - Jobs are keyed by (planId, node id). Re-running never duplicates; it
 *   updates title/body/gate/hints in place and never touches job state.
 * - Nodes missing from the new plan are archived (kept, not deleted) and
 *   their plan edges removed. A node that comes back is unarchived.
 * - Plan edges are replaced by the new set. Edges added by `link_jobs`
 *   outside the plan are kept.
 * - A cycle, in the plan or in the plan plus the project's other edges,
 *   rejects the whole compile with the cycle path; nothing is written.
 */
export function compilePlan(
  ctx: BrainContext,
  tx: Tx,
  identity: Identity,
  input: PlanInput
): CompileResult {
  requireBrain(identity, 'compile_plan');
  validatePlan(input);

  const planCycle = findCycle(
    input.nodes.map((n) => n.id),
    input.edges
  );
  if (planCycle) throw new CycleError(planCycle);

  const result: CompileResult = {
    jobIds: {},
    created: [],
    updated: [],
    unchanged: [],
    archived: [],
    edgesAdded: 0,
    edgesRemoved: 0,
  };
  const now = ctx.now();
  const touched: Job[] = [];

  for (const node of input.nodes) {
    const existing = ctx.store.findJobByPlanNode(input.planId, node.id);
    const content = {
      title: node.title,
      body: node.body ?? '',
      gateSpec: withGateFloor(
        ctx,
        input.projectId,
        node.hints?.kind ?? 'work',
        node.gateSpec ?? null
      ),
      hints: node.hints ?? {},
    };
    if (!existing) {
      const job: Job = {
        id: ctx.newId(),
        projectId: input.projectId,
        ...content,
        state: 'proposed',
        laneId: null,
        attempts: 0,
        result: null,
        reason: null,
        createdBy: addressOf(identity),
        planId: input.planId,
        planNodeId: node.id,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      ctx.store.insertJob(job);
      tx.raise({ type: 'jobChanged', payload: { job, previousState: null } });
      result.created.push(job.id);
      touched.push(job);
    } else {
      if (existing.projectId !== input.projectId) {
        throw new InvalidInputError(
          `plan ${input.planId} already belongs to project ${existing.projectId}`
        );
      }
      const changed =
        existing.archivedAt !== null ||
        existing.title !== content.title ||
        existing.body !== content.body ||
        JSON.stringify(existing.gateSpec) !== JSON.stringify(content.gateSpec) ||
        JSON.stringify(existing.hints) !== JSON.stringify(content.hints);
      const job = changed ? touch(ctx, tx, existing, { ...content, archivedAt: null }) : existing;
      (changed ? result.updated : result.unchanged).push(job.id);
      touched.push(job);
    }
    result.jobIds[node.id] = touched[touched.length - 1]!.id;
  }

  const keep = new Set(Object.values(result.jobIds));
  for (const job of ctx.store.listJobs({ planId: input.planId })) {
    if (keep.has(job.id)) continue;
    for (const edge of [
      ...ctx.store.listEdges({ from: job.id }),
      ...ctx.store.listEdges({ to: job.id }),
    ]) {
      if (edge.planId === input.planId) {
        ctx.store.deleteEdge(edge.from, edge.to);
        result.edgesRemoved++;
      }
    }
    touch(ctx, tx, job, { archivedAt: now });
    result.archived.push(job.id);
  }

  const wanted = new Map(
    input.edges.map((e) => {
      const edge = { from: result.jobIds[e.from]!, to: result.jobIds[e.to]! };
      return [`${edge.from}>${edge.to}`, edge];
    })
  );
  for (const edge of ctx.store.listEdges({ planId: input.planId })) {
    if (!wanted.has(`${edge.from}>${edge.to}`)) {
      ctx.store.deleteEdge(edge.from, edge.to);
      result.edgesRemoved++;
    }
  }
  const present = new Set(
    ctx.store.listEdges({ projectId: input.projectId }).map((e) => `${e.from}>${e.to}`)
  );
  for (const [key, edge] of wanted) {
    if (present.has(key)) continue;
    ctx.store.insertEdge({
      ...edge,
      projectId: input.projectId,
      planId: input.planId,
      createdAt: now,
    });
    result.edgesAdded++;
  }

  const projectEdges = ctx.store.listEdges({ projectId: input.projectId });
  const liveIds = ctx.store.listJobs({ projectId: input.projectId }).map((t) => t.id);
  const cycle = findCycle(liveIds, projectEdges);
  if (cycle) throw new CycleError(cycle);

  for (const id of keep) {
    const job = ctx.store.getJob(id);
    if (job) settle(ctx, tx, job);
  }
  // Archiving a node can unblock jobs that depended on it outside the plan.
  for (const id of result.archived) {
    for (const edge of ctx.store.listEdges({ from: id })) {
      const dependent = ctx.store.getJob(edge.to);
      if (dependent) settle(ctx, tx, dependent);
    }
  }
  return result;
}

function validatePlan(input: PlanInput): void {
  assertId('planId', input.planId);
  assertId('projectId', input.projectId);
  if (input.nodes.length > LIMITS.planNodes)
    throw new InvalidInputError(`a plan has at most ${LIMITS.planNodes} nodes`);
  const ids = new Set<string>();
  for (const node of input.nodes) {
    assertId('plan node id', node.id);
    if (ids.has(node.id)) throw new InvalidInputError(`duplicate plan node id ${node.id}`);
    ids.add(node.id);
    checkTitle(node.title);
    checkText('body', node.body ?? '', LIMITS.bodyBytes, false);
  }
  for (const edge of input.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      throw new InvalidInputError(`edge ${edge.from} -> ${edge.to} references an unknown node`);
    }
  }
}
