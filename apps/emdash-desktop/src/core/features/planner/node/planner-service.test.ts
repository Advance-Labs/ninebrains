import { Brain, InMemoryBrainStore, JOB_STATES, type Identity } from '@ninebrains/brain-core';
import { describe, expect, it } from 'vitest';
import { PLANNER_JOB_STATES, type CanvasDoc, type CanvasEdge, type CanvasNode } from '../api';
import { createBrainPlanTarget } from './brain-plan-target';
import { DRAFTING_UNAVAILABLE_MESSAGE } from './brief-drafter';
import { createMementoCanvasStore, createMemoryMementoRowPort, PLANNER_MEMENTO_IDS } from './canvas-store';
import { createPlannerService, planIdFor, sanitizeProposal } from './planner-service';

const BRAIN: Identity = { role: 'brain', brainId: 'test' };
const KEY = { projectId: 'p1', canvasId: 'c1' };
const PLAN_ID = planIdFor('p1', 'c1');

const job = (id: string, extra: Partial<CanvasNode> = {}): CanvasNode =>
  ({ id, type: 'job', position: { x: 0, y: 0 }, title: id, ...extra }) as CanvasNode;
const edge = (source: string, target: string, extra: Partial<CanvasEdge> = {}): CanvasEdge => ({
  id: `e-${source}-${target}`,
  source,
  target,
  ...extra,
});
const doc = (nodes: CanvasNode[], edges: CanvasEdge[] = []): CanvasDoc => ({
  version: 1,
  ...KEY,
  title: 'Plan',
  nodes,
  edges,
  updatedAt: 0,
});

function setup() {
  let clock = 1_000;
  let seq = 0;
  const brain = new Brain({ store: new InMemoryBrainStore(), now: () => ++clock, newId: () => `job-${++seq}` });
  const rows = createMemoryMementoRowPort();
  const service = createPlannerService({
    canvasStore: createMementoCanvasStore(rows),
    planTarget: createBrainPlanTarget(brain),
    now: () => ++clock,
  });
  const planJobs = (includeArchived = false) => brain.listJobs(BRAIN, { planId: PLAN_ID, includeArchived });
  return { brain, rows, service, planJobs };
}

const threeStep = doc([job('design'), job('api'), job('qa')], [edge('design', 'api'), edge('api', 'qa')]);

describe('planner compile through brain-core', () => {
  it('round-trips a canvas into jobs and edges keyed by node id', async () => {
    const { brain, service, planJobs } = setup();
    expect((await service.saveCanvas(threeStep)).success).toBe(true);
    const outcome = await service.compile(KEY);
    expect(outcome).toEqual({ success: true, data: { created: 3, updated: 0, unchanged: 0, archived: 0 } });
    expect(planJobs().map((j) => [j.planNodeId, j.state])).toEqual([
      ['design', 'ready'],
      ['api', 'proposed'],
      ['qa', 'proposed'],
    ]);
    expect(brain.listEdges(BRAIN, { projectId: 'p1' })).toHaveLength(2);
  });

  it('re-running never duplicates jobs or edges', async () => {
    const { brain, service, planJobs } = setup();
    await service.saveCanvas(threeStep);
    await service.compile(KEY);
    const again = await service.compile(KEY);
    expect(again).toEqual({ success: true, data: { created: 0, updated: 0, unchanged: 3, archived: 0 } });
    expect(planJobs()).toHaveLength(3);
    expect(brain.listEdges(BRAIN, { projectId: 'p1' })).toHaveLength(2);
  });

  it('updates an edited node in place', async () => {
    const { service, planJobs } = setup();
    await service.saveCanvas(threeStep);
    await service.compile(KEY);
    const edited = doc([job('design', { title: 'Design v2' } as Partial<CanvasNode>), job('api'), job('qa')], threeStep.edges);
    await service.saveCanvas(edited);
    const outcome = await service.compile(KEY);
    expect(outcome.success && outcome.data).toMatchObject({ created: 0, updated: 1, unchanged: 2 });
    expect(planJobs().find((j) => j.planNodeId === 'design')?.title).toBe('Design v2');
  });

  it('archives a node removed from the canvas instead of deleting it', async () => {
    const { service, planJobs } = setup();
    await service.saveCanvas(threeStep);
    await service.compile(KEY);
    await service.saveCanvas(doc([job('design'), job('api')], [edge('design', 'api')]));
    const outcome = await service.compile(KEY);
    expect(outcome.success && outcome.data).toMatchObject({ archived: 1, unchanged: 2 });
    expect(planJobs().map((j) => j.planNodeId)).toEqual(['design', 'api']);
    const qa = planJobs(true).find((j) => j.planNodeId === 'qa');
    expect(qa?.archivedAt).not.toBeNull();
  });

  it('rejects a cycle, surfaces the path in node ids, and writes nothing', async () => {
    const { service, planJobs } = setup();
    await service.saveCanvas(
      doc([job('a'), job('b'), job('c')], [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')])
    );
    const outcome = await service.compile(KEY);
    expect(outcome.success).toBe(true);
    const cycles = outcome.success ? outcome.data.cycles : undefined;
    expect(cycles).toHaveLength(1);
    const path = cycles![0]!;
    expect(path[0]).toBe(path[path.length - 1]);
    expect(new Set(path)).toEqual(new Set(['a', 'b', 'c']));
    expect(planJobs()).toHaveLength(0);
  });

  it('expands module edges to the jobs inside and skips notes and proposed nodes', async () => {
    const { brain, service, planJobs } = setup();
    const module: CanvasNode = {
      id: 'm',
      type: 'module',
      position: { x: 0, y: 0 },
      title: 'Backend',
      size: { width: 300, height: 200 },
    };
    await service.saveCanvas(
      doc(
        [
          module,
          job('j1', { parentId: 'm' }),
          job('j2', { parentId: 'm' }),
          job('j3'),
          job('draft', { proposed: true }),
          { id: 'n', type: 'note', position: { x: 0, y: 0 }, text: 'remember' },
        ],
        [edge('m', 'j3'), edge('draft', 'j3'), edge('n', 'j3')]
      )
    );
    const outcome = await service.compile(KEY);
    expect(outcome.success && outcome.data.created).toBe(3);
    expect(planJobs().map((j) => j.planNodeId).sort()).toEqual(['j1', 'j2', 'j3']);
    expect(brain.listEdges(BRAIN, { projectId: 'p1' })).toHaveLength(2);
  });

  it('refuses to compile a canvas that was never saved', async () => {
    const { service } = setup();
    const outcome = await service.compile(KEY);
    expect(outcome.success).toBe(false);
    expect(!outcome.success && outcome.error.type).toBe('invalid');
  });

  it('reports live job state per node through the plan target', async () => {
    const { brain, service } = setup();
    await service.saveCanvas(threeStep);
    await service.compile(KEY);
    const target = createBrainPlanTarget(brain);
    expect(target.jobStates('p1', PLAN_ID)).toEqual({ design: 'ready', api: 'proposed', qa: 'proposed' });
  });

  it('keeps the api job-state enum in step with brain-core', () => {
    expect([...PLANNER_JOB_STATES]).toEqual([...JOB_STATES]);
  });
});

describe('planner canvas persistence', () => {
  it('lists saved canvases and loads them back', async () => {
    const { service } = setup();
    await service.saveCanvas(threeStep);
    const list = await service.listCanvases('p1');
    expect(list.success && list.data.map((c) => c.canvasId)).toEqual(['c1']);
    const loaded = await service.getCanvas(KEY);
    expect(loaded.success && loaded.data.doc.nodes.map((n) => n.id)).toEqual(['design', 'api', 'qa']);
  });

  it('returns an empty doc for an unknown canvas', async () => {
    const { service } = setup();
    const loaded = await service.getCanvas({ projectId: 'p1', canvasId: 'fresh' });
    expect(loaded.success && loaded.data).toMatchObject({ recovered: false, doc: { nodes: [], edges: [] } });
  });

  it('recovers from a corrupt stored document instead of crashing', async () => {
    const { rows, service } = setup();
    const id = JSON.stringify([PLANNER_MEMENTO_IDS.doc, 'planner-canvas', 'p1/c1']);
    rows.rows.set(id, { version: '1', data: '{"version":1,"nodes":[{"id":"../x"}]}', updatedAt: 1 });
    const loaded = await service.getCanvas(KEY);
    expect(loaded.success && loaded.data).toMatchObject({ recovered: true, doc: { nodes: [] } });
    rows.rows.set(id, { version: '1', data: 'x'.repeat(600 * 1024), updatedAt: 1 });
    const oversized = await service.getCanvas(KEY);
    expect(oversized.success && oversized.data.recovered).toBe(true);
  });
});

describe('draft from brief', () => {
  it('reports that drafting needs the Brain until it is wired', async () => {
    const { service } = setup();
    const drafted = await service.draftFromBrief({ ...KEY, brief: 'Build a login page' });
    expect(drafted).toEqual({ success: false, error: { type: 'unavailable', message: DRAFTING_UNAVAILABLE_MESSAGE } });
  });

  it('marks drafted nodes proposed and drops ids that collide with the canvas', () => {
    const proposal = sanitizeProposal(
      { nodes: [job('design'), job('new-1'), job('new-2')], edges: [edge('design', 'new-1'), edge('x', 'new-2')] },
      threeStep
    );
    expect(proposal.nodes.map((n) => [n.id, n.proposed])).toEqual([
      ['new-1', true],
      ['new-2', true],
    ]);
    expect(proposal.edges).toEqual([{ ...edge('design', 'new-1'), proposed: true }]);
  });
});
