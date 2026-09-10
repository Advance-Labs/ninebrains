import { describe, expect, it } from 'vitest';
import { BRAIN } from '../../test/helpers';
import { executeBrainRequest } from '../protocol/execute';
import { InMemoryBrainStore } from '../store/memory-store';
import type { JobKind } from '../types';
import { Brain } from './brain';

/** Stands in for the app's rigor settings: project "strict" is at a high testing rigor, "lax" at 0. */
function setup() {
  const calls: Array<[string, JobKind]> = [];
  const brain = new Brain({
    store: new InMemoryBrainStore(),
    resolveGateFloor: (projectId, kind) => {
      calls.push([projectId, kind]);
      if (projectId !== 'strict') return [];
      return kind === 'review' ? ['reviewer'] : ['tests', 'reviewer'];
    },
  });
  return { brain, calls };
}

const gatesOf = (brain: Brain, id: string) => brain.getJob(BRAIN, id).gateSpec;

describe('SEC-08 caller cannot drop gates', () => {
  it('gates: [] still yields the floor', () => {
    const { brain } = setup();
    const job = brain.createJob(BRAIN, { projectId: 'strict', title: 'no gates please', gateSpec: { gates: [] } });
    expect(gatesOf(brain, job.id)).toEqual({ gates: ['tests', 'reviewer'] });
  });

  it('omitting gates also yields the floor', () => {
    const { brain } = setup();
    expect(gatesOf(brain, brain.createJob(BRAIN, { projectId: 'strict', title: 't' }).id)).toEqual({
      gates: ['tests', 'reviewer'],
    });
  });

  it('callers can only add: requested gates join the floor, floor first, deduplicated', () => {
    const { brain } = setup();
    const job = brain.createJob(BRAIN, { projectId: 'strict', title: 't', gateSpec: { gates: ['screenshot', 'tests'] } });
    expect(gatesOf(brain, job.id)?.gates).toEqual(['tests', 'reviewer', 'screenshot']);
  });

  it('asks the resolver for the job kind', () => {
    const { brain, calls } = setup();
    const job = brain.createJob(BRAIN, { projectId: 'strict', title: 'review it', hints: { kind: 'review' } });
    expect(gatesOf(brain, job.id)).toEqual({ gates: ['reviewer'] });
    expect(calls).toContainEqual(['strict', 'review']);
  });

  it('applies to the agent-facing create_job operation', () => {
    const { brain } = setup();
    const response = executeBrainRequest(
      brain,
      { identity: BRAIN, projectId: 'strict', attachmentRoots: [] },
      { v: 1, op: 'create_job', args: { title: 'from an agent', gates: [] } }
    );
    expect(response.ok).toBe(true);
    const id = (response as { ok: true; result: { id: string } }).result.id;
    expect(gatesOf(brain, id)?.gates).toEqual(['tests', 'reviewer']);
  });

  it('applies to compiled plans, and a recompile cannot strip the floor', () => {
    const { brain } = setup();
    const plan = (gates: string[] | null) => ({
      planId: 'plan',
      projectId: 'strict',
      nodes: [{ id: 'n1', title: 'node', gateSpec: gates === null ? null : { gates } }],
      edges: [],
    });
    const first = brain.compilePlan(BRAIN, plan(['screenshot']));
    const id = first.jobIds.n1!;
    expect(gatesOf(brain, id)?.gates).toEqual(['tests', 'reviewer', 'screenshot']);
    brain.compilePlan(BRAIN, plan([]));
    expect(gatesOf(brain, id)?.gates).toEqual(['tests', 'reviewer']);
    brain.compilePlan(BRAIN, plan(null));
    expect(gatesOf(brain, id)?.gates).toEqual(['tests', 'reviewer']);
  });

  it('only a project whose floor is empty (rigor 0) can have an unverified job', () => {
    const { brain } = setup();
    expect(gatesOf(brain, brain.createJob(BRAIN, { projectId: 'lax', title: 't' }).id)).toBeNull();
    expect(gatesOf(brain, brain.createJob(BRAIN, { projectId: 'lax', title: 't', gateSpec: { gates: ['tests'] } }).id)).toEqual({
      gates: ['tests'],
    });
  });

  it('defaults to no floor when the app supplies no resolver', () => {
    const brain = new Brain({ store: new InMemoryBrainStore() });
    expect(brain.createJob(BRAIN, { projectId: 'p1', title: 't', gateSpec: { gates: [] } }).gateSpec).toEqual({ gates: [] });
  });
});
