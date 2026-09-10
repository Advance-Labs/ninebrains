import { findCycle } from '../dag';
import { CycleError, InvalidInputError } from '../errors';
import { LIMITS } from '../limits';
import type { GateSpec, Identity, ProjectId, Task, TaskHints, TaskId } from '../types';
import { addressOf } from '../types';
import { requireBrain } from './authz';
import { type BrainContext, type Tx, checkText, checkTitle, touch } from './context';
import { settle } from './tasks';

export interface PlanNode {
  /** Stable id from the planner canvas. The upsert key. */
  id: string;
  title: string;
  body?: string;
  gateSpec?: GateSpec | null;
  hints?: TaskHints;
}

export interface PlanInput {
  planId: string;
  projectId: ProjectId;
  nodes: PlanNode[];
  /** `to` depends on `from`, both plan node ids. */
  edges: Array<{ from: string; to: string }>;
}

export interface CompileResult {
  /** Plan node id -> task id. */
  taskIds: Record<string, TaskId>;
  created: TaskId[];
  updated: TaskId[];
  unchanged: TaskId[];
  archived: TaskId[];
  edgesAdded: number;
  edgesRemoved: number;
}

/**
 * Upserts a plan into tasks + edges, idempotently:
 * - Tasks are keyed by (planId, node id). Re-running never duplicates; it
 *   updates title/body/gate/hints in place and never touches task state.
 * - Nodes missing from the new plan are archived (kept, not deleted) and
 *   their plan edges removed. A node that comes back is unarchived.
 * - Plan edges are replaced by the new set. Edges added by `link_tasks`
 *   outside the plan are kept.
 * - A cycle, in the plan or in the plan plus the project's other edges,
 *   rejects the whole compile with the cycle path; nothing is written.
 */
export function compilePlan(ctx: BrainContext, tx: Tx, identity: Identity, input: PlanInput): CompileResult {
  requireBrain(identity, 'compile_plan');
  validatePlan(input);

  const planCycle = findCycle(
    input.nodes.map((n) => n.id),
    input.edges
  );
  if (planCycle) throw new CycleError(planCycle);

  const result: CompileResult = {
    taskIds: {},
    created: [],
    updated: [],
    unchanged: [],
    archived: [],
    edgesAdded: 0,
    edgesRemoved: 0,
  };
  const now = ctx.now();
  const touched: Task[] = [];

  for (const node of input.nodes) {
    const existing = ctx.store.findTaskByPlanNode(input.planId, node.id);
    const content = {
      title: node.title,
      body: node.body ?? '',
      gateSpec: node.gateSpec ?? null,
      hints: node.hints ?? {},
    };
    if (!existing) {
      const task: Task = {
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
      ctx.store.insertTask(task);
      tx.raise({ type: 'taskChanged', payload: { task, previousState: null } });
      result.created.push(task.id);
      touched.push(task);
    } else {
      if (existing.projectId !== input.projectId) {
        throw new InvalidInputError(`plan ${input.planId} already belongs to project ${existing.projectId}`);
      }
      const changed =
        existing.archivedAt !== null ||
        existing.title !== content.title ||
        existing.body !== content.body ||
        JSON.stringify(existing.gateSpec) !== JSON.stringify(content.gateSpec) ||
        JSON.stringify(existing.hints) !== JSON.stringify(content.hints);
      const task = changed ? touch(ctx, tx, existing, { ...content, archivedAt: null }) : existing;
      (changed ? result.updated : result.unchanged).push(task.id);
      touched.push(task);
    }
    result.taskIds[node.id] = touched[touched.length - 1]!.id;
  }

  const keep = new Set(Object.values(result.taskIds));
  for (const task of ctx.store.listTasks({ planId: input.planId })) {
    if (keep.has(task.id)) continue;
    for (const edge of [...ctx.store.listEdges({ from: task.id }), ...ctx.store.listEdges({ to: task.id })]) {
      if (edge.planId === input.planId) {
        ctx.store.deleteEdge(edge.from, edge.to);
        result.edgesRemoved++;
      }
    }
    touch(ctx, tx, task, { archivedAt: now });
    result.archived.push(task.id);
  }

  const wanted = new Map(
    input.edges.map((e) => {
      const edge = { from: result.taskIds[e.from]!, to: result.taskIds[e.to]! };
      return [`${edge.from}>${edge.to}`, edge];
    })
  );
  for (const edge of ctx.store.listEdges({ planId: input.planId })) {
    if (!wanted.has(`${edge.from}>${edge.to}`)) {
      ctx.store.deleteEdge(edge.from, edge.to);
      result.edgesRemoved++;
    }
  }
  const present = new Set(ctx.store.listEdges({ projectId: input.projectId }).map((e) => `${e.from}>${e.to}`));
  for (const [key, edge] of wanted) {
    if (present.has(key)) continue;
    ctx.store.insertEdge({ ...edge, projectId: input.projectId, planId: input.planId, createdAt: now });
    result.edgesAdded++;
  }

  const projectEdges = ctx.store.listEdges({ projectId: input.projectId });
  const liveIds = ctx.store.listTasks({ projectId: input.projectId }).map((t) => t.id);
  const cycle = findCycle(liveIds, projectEdges);
  if (cycle) throw new CycleError(cycle);

  for (const id of keep) {
    const task = ctx.store.getTask(id);
    if (task) settle(ctx, tx, task);
  }
  // Archiving a node can unblock tasks that depended on it outside the plan.
  for (const id of result.archived) {
    for (const edge of ctx.store.listEdges({ from: id })) {
      const dependent = ctx.store.getTask(edge.to);
      if (dependent) settle(ctx, tx, dependent);
    }
  }
  return result;
}

function validatePlan(input: PlanInput): void {
  if (!input.planId.trim()) throw new InvalidInputError('planId must not be empty');
  if (input.nodes.length > LIMITS.planNodes) throw new InvalidInputError(`a plan has at most ${LIMITS.planNodes} nodes`);
  const ids = new Set<string>();
  for (const node of input.nodes) {
    if (!node.id.trim()) throw new InvalidInputError('plan node id must not be empty');
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
