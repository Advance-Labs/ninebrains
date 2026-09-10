import { describe, expect, it } from 'vitest';
import { BRAIN, LANE_A, STORES, finish, makeBrain } from '../../test/helpers';
import { CycleError, ForbiddenError, InvalidInputError, NotFoundError } from '../errors';
import type { PlanInput } from './plan';

const plan = (overrides: Partial<PlanInput> = {}): PlanInput => ({
  planId: 'plan-1',
  projectId: 'p1',
  nodes: [
    { id: 'design', title: 'Design' },
    { id: 'api', title: 'API' },
    { id: 'ui', title: 'UI' },
    { id: 'qa', title: 'QA', gateSpec: { gates: ['screenshot'] } },
  ],
  edges: [
    { from: 'design', to: 'api' },
    { from: 'design', to: 'ui' },
    { from: 'api', to: 'qa' },
    { from: 'ui', to: 'qa' },
  ],
  ...overrides,
});

describe.each(STORES)('compilePlan (%s store)', (_name, createStore) => {
  it('creates tasks and edges; roots are ready, the rest proposed', () => {
    const brain = makeBrain(createStore());
    const result = brain.compilePlan(BRAIN, plan());
    expect(result.created).toHaveLength(4);
    expect(result.edgesAdded).toBe(4);
    const byNode = (id: string) => brain.getTask(BRAIN, result.taskIds[id]!);
    expect(byNode('design').state).toBe('ready');
    expect(byNode('api').state).toBe('proposed');
    expect(byNode('qa')).toMatchObject({ planId: 'plan-1', planNodeId: 'qa', gateSpec: { gates: ['screenshot'] } });
  });

  it('is idempotent: re-running never duplicates tasks or edges', () => {
    const brain = makeBrain(createStore());
    const first = brain.compilePlan(BRAIN, plan());
    const second = brain.compilePlan(BRAIN, plan());
    expect(second.taskIds).toEqual(first.taskIds);
    expect(second).toMatchObject({ created: [], updated: [], archived: [], edgesAdded: 0, edgesRemoved: 0 });
    expect(second.unchanged).toHaveLength(4);
    expect(brain.listTasks(BRAIN)).toHaveLength(4);
    expect(brain.listEdges(BRAIN)).toHaveLength(4);
  });

  it('updates content in place without touching progress', () => {
    const brain = makeBrain(createStore());
    const first = brain.compilePlan(BRAIN, plan());
    brain.claimTask(LANE_A, first.taskIds.design!, { start: true });
    const edited = plan();
    edited.nodes[0] = { id: 'design', title: 'Design v2', body: 'more detail' };
    const second = brain.compilePlan(BRAIN, edited);
    expect(second.updated).toEqual([first.taskIds.design]);
    expect(brain.getTask(BRAIN, first.taskIds.design!)).toMatchObject({
      title: 'Design v2',
      body: 'more detail',
      state: 'running',
      laneId: 'A',
    });
  });

  it('archives removed nodes instead of deleting them, and unblocks their dependents', () => {
    const brain = makeBrain(createStore());
    const first = brain.compilePlan(BRAIN, plan());
    finish(brain, LANE_A, first.taskIds.design!);
    finish(brain, LANE_A, first.taskIds.api!);

    const withoutUi = plan({
      nodes: plan().nodes.filter((n) => n.id !== 'ui'),
      edges: plan().edges.filter((e) => e.from !== 'ui' && e.to !== 'ui'),
    });
    const second = brain.compilePlan(BRAIN, withoutUi);
    const uiId = first.taskIds.ui!;

    expect(second.archived).toEqual([uiId]);
    expect(second.edgesRemoved).toBe(2);
    expect(brain.listTasks(BRAIN).map((t) => t.id)).not.toContain(uiId);
    expect(brain.listTasks(BRAIN, { includeArchived: true }).map((t) => t.id)).toContain(uiId);
    expect(brain.getTask(BRAIN, uiId).archivedAt).not.toBeNull();
    // QA only waited on ui now, and api is done.
    expect(brain.getTask(BRAIN, first.taskIds.qa!).state).toBe('ready');
    expect(() => brain.claimTask(LANE_A, uiId)).toThrow(NotFoundError);

    const third = brain.compilePlan(BRAIN, plan());
    expect(third.taskIds.ui).toBe(uiId);
    expect(third.updated).toContain(uiId);
    expect(brain.getTask(BRAIN, uiId).archivedAt).toBeNull();
    expect(brain.listEdges(BRAIN)).toHaveLength(4);
  });

  it('replaces plan edges but keeps edges linked outside the plan', () => {
    const brain = makeBrain(createStore());
    const first = brain.compilePlan(BRAIN, plan());
    const extra = brain.createTask(BRAIN, { projectId: 'p1', title: 'Manual follow-up' });
    brain.linkTasks(BRAIN, first.taskIds.qa!, extra.id);

    const rewired = plan({ edges: [{ from: 'design', to: 'qa' }] });
    const second = brain.compilePlan(BRAIN, rewired);
    expect(second).toMatchObject({ edgesAdded: 1, edgesRemoved: 4 });
    const edges = brain.listEdges(BRAIN).map((e) => `${e.from}>${e.to}`);
    expect(edges.sort()).toEqual([`${first.taskIds.design}>${first.taskIds.qa}`, `${first.taskIds.qa}>${extra.id}`].sort());
    expect(brain.getTask(BRAIN, first.taskIds.api!).state).toBe('ready');
  });

  it('rejects a cyclic plan with the cycle path and writes nothing', () => {
    const brain = makeBrain(createStore());
    let caught: unknown;
    try {
      brain.compilePlan(
        BRAIN,
        plan({ edges: [...plan().edges, { from: 'qa', to: 'design' }] })
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CycleError);
    const path = (caught as CycleError).path;
    expect(path[0]).toBe(path[path.length - 1]);
    expect(path).toContain('design');
    expect(path).toContain('qa');
    expect(brain.listTasks(BRAIN, { includeArchived: true })).toEqual([]);
  });

  it('rejects a plan that forms a cycle with edges outside it, and rolls back', () => {
    const brain = makeBrain(createStore());
    const first = brain.compilePlan(BRAIN, plan({ edges: [] }));
    const outside = brain.createTask(BRAIN, { projectId: 'p1', title: 'Outside' });
    brain.linkTasks(BRAIN, first.taskIds.qa!, outside.id);
    brain.linkTasks(BRAIN, outside.id, first.taskIds.design!);

    expect(() => brain.compilePlan(BRAIN, plan({ edges: [{ from: 'design', to: 'qa' }] }))).toThrow(CycleError);
    expect(brain.listEdges(BRAIN, { projectId: 'p1' })).toHaveLength(2);
  });

  it('validates the plan shape', () => {
    const brain = makeBrain(createStore());
    expect(() => brain.compilePlan(BRAIN, plan({ nodes: [{ id: 'a', title: 'A' }, { id: 'a', title: 'A2' }], edges: [] }))).toThrow(
      InvalidInputError
    );
    expect(() => brain.compilePlan(BRAIN, plan({ edges: [{ from: 'design', to: 'nope' }] }))).toThrow(InvalidInputError);
    expect(() => brain.compilePlan(BRAIN, plan({ planId: ' ' }))).toThrow(InvalidInputError);
    brain.compilePlan(BRAIN, plan());
    expect(() => brain.compilePlan(BRAIN, plan({ projectId: 'p2' }))).toThrow(InvalidInputError);
  });

  it('is a brain-only operation', () => {
    const brain = makeBrain(createStore());
    expect(() => brain.compilePlan(LANE_A, plan())).toThrow(ForbiddenError);
  });
});
