import { describe, expect, it } from 'vitest';
import { Brain } from '../brain/brain';
import { InMemoryBrainStore } from '../store/memory-store';
import type { ProjectId } from '../types';
import { type BrainGrant, type ExecuteOptions, executeBrainRequest } from './execute';
import { TokenRegistry } from './tokens';

/** The security review's cross-project repro, turned into denial tests. */
const ADMIN = { role: 'brain' as const, brainId: 'main' };

function setup() {
  const brain = new Brain({
    store: new InMemoryBrainStore(),
    resolveGateFloor: () => ['reviewer'],
  });
  for (const [id, projectId] of [
    ['laneA1', 'projA'],
    ['laneA2', 'projA'],
    ['laneB1', 'projB'],
  ] as const) {
    brain.upsertLane(ADMIN, { id, projectId, provider: 'claude', status: 'idle' });
  }
  const jobA = brain.createJob(ADMIN, { projectId: 'projA', title: 'A work' });
  const jobB = brain.createJob(ADMIN, { projectId: 'projB', title: 'B work' });
  return { brain, jobA, jobB };
}

const BRAINS: Record<string, ProjectId> = { brainA: 'projA', brainB: 'projB' };
const OPTIONS: ExecuteOptions = { resolveBrainProject: (id) => BRAINS[id] };

const grant = (identity: BrainGrant['identity'], projectId: ProjectId | null): BrainGrant => ({
  identity,
  projectId,
  attachmentRoots: [],
});
const brainA = grant({ role: 'brain', brainId: 'brainA' }, 'projA');
const brainNoProject = grant({ role: 'brain', brainId: 'loose' }, null);
const laneA = grant({ role: 'lane', laneId: 'laneA1', projectId: 'projA' }, 'projA');

function codeOf(
  brain: Brain,
  who: BrainGrant,
  op: string,
  args: object,
  options: ExecuteOptions = OPTIONS
): string {
  const response = executeBrainRequest(brain, who, { v: 1, op, args }, options);
  return response.ok ? 'OK' : response.error.code;
}

describe('M3 a Brain token acts only inside its own project', () => {
  it('refuses every op that names or touches another project', () => {
    const { brain, jobA, jobB } = setup();
    const lane = { kind: 'lane', id: 'laneB1' };
    const cases: Array<[string, object, string]> = [
      ['create_job', { title: 'x', projectId: 'projB' }, 'FORBIDDEN'],
      ['broadcast', { body: 'hi', projectId: 'projB' }, 'FORBIDDEN'],
      ['read_inbox', { address: lane }, 'FORBIDDEN'],
      ['read_inbox', { address: { kind: 'brain', id: 'brainB' } }, 'FORBIDDEN'],
      ['list_lanes', { projectId: 'projB' }, 'FORBIDDEN'],
      ['list_jobs', { projectId: 'projB' }, 'FORBIDDEN'],
      ['add_note', { body: 'n', projectId: 'projB' }, 'FORBIDDEN'],
      ['add_note', { body: 'n', jobId: jobB.id }, 'NOT_FOUND'],
      ['link_jobs', { from: jobA.id, to: jobB.id }, 'NOT_FOUND'],
      ['assign_job', { jobId: jobB.id, laneId: 'laneB1' }, 'NOT_FOUND'],
      ['assign_job', { jobId: jobA.id, laneId: 'laneB1' }, 'FORBIDDEN'],
      ['requeue_job', { jobId: jobB.id }, 'NOT_FOUND'],
      ['complete_job', { jobId: jobB.id, summary: 's' }, 'NOT_FOUND'],
      ['block_job', { jobId: jobB.id, reason: 'r' }, 'NOT_FOUND'],
      ['send_message', { to: lane, body: 'x' }, 'FORBIDDEN'],
    ];
    for (const [op, args, expected] of cases) {
      expect(`${op} ${JSON.stringify(args)} -> ${codeOf(brain, brainA, op, args)}`).toBe(
        `${op} ${JSON.stringify(args)} -> ${expected}`
      );
    }
    // Nothing leaked into project B.
    expect(brain.readInbox(ADMIN, { address: { kind: 'lane', id: 'laneB1' } })).toEqual([]);
    expect(brain.listJobs(ADMIN, { projectId: 'projB' }).map((j) => j.title)).toEqual(['B work']);
  });

  it('still works inside its project, and defaults listings to it', () => {
    const { brain } = setup();
    expect(codeOf(brain, brainA, 'create_job', { title: 'mine' })).toBe('OK');
    expect(codeOf(brain, brainA, 'broadcast', { body: 'hi' })).toBe('OK');
    expect(codeOf(brain, brainA, 'read_inbox', {})).toBe('OK');
    expect(codeOf(brain, brainA, 'read_inbox', { address: { kind: 'lane', id: 'laneA1' } })).toBe(
      'OK'
    );
    const lanes = executeBrainRequest(brain, brainA, { v: 1, op: 'list_lanes', args: {} }, OPTIONS);
    expect(lanes.ok && (lanes.result as Array<{ id: string }>).map((l) => l.id)).toEqual([
      'laneA1',
      'laneA2',
    ]);
  });

  it('gives a Brain grant with no project no project at all (no global grant in v0.1)', () => {
    const { brain } = setup();
    expect(codeOf(brain, brainNoProject, 'create_job', { title: 'x', projectId: 'projA' })).toBe(
      'FORBIDDEN'
    );
    expect(codeOf(brain, brainNoProject, 'list_lanes', {})).toBe('FORBIDDEN');
    expect(codeOf(brain, brainNoProject, 'list_jobs', {})).toBe('FORBIDDEN');
  });
});

describe('L1 message recipients must exist and share the sender project', () => {
  it('lanes may message only their own project lanes and Brains', () => {
    const { brain } = setup();
    const send = (to: object) => codeOf(brain, laneA, 'send_message', { to, body: 'x' });
    expect(send({ kind: 'brain', id: 'brainB' })).toBe('FORBIDDEN');
    expect(send({ kind: 'brain', id: 'nobody' })).toBe('NOT_FOUND');
    expect(send({ kind: 'lane', id: 'ghost' })).toBe('NOT_FOUND');
    expect(send({ kind: 'lane', id: 'laneB1' })).toBe('FORBIDDEN');
    expect(send({ kind: 'brain', id: 'brainA' })).toBe('OK');
    expect(send({ kind: 'lane', id: 'laneA2' })).toBe('OK');
  });

  it('fails closed when no Brain resolver is configured', () => {
    const { brain } = setup();
    expect(
      codeOf(brain, laneA, 'send_message', { to: { kind: 'brain', id: 'brainA' }, body: 'x' }, {})
    ).toBe('NOT_FOUND');
  });

  it('the token registry resolves live Brains to their project', () => {
    const tokens = new TokenRegistry();
    tokens.issue(brainA);
    expect(tokens.brainProject('brainA')).toBe('projA');
    expect(tokens.brainProject('brainB')).toBeUndefined();
  });
});

describe('L2 LANE_OPS are enforced on the server', () => {
  it('a lane token calling a brain-only op gets FORBIDDEN', () => {
    const { brain, jobA } = setup();
    for (const [op, args] of [
      ['list_lanes', {}],
      ['create_job', { title: 'x' }],
      ['link_jobs', { from: jobA.id, to: jobA.id }],
      ['assign_job', { jobId: jobA.id, laneId: 'laneA1' }],
      ['requeue_job', { jobId: jobA.id }],
      ['broadcast', { body: 'hi' }],
    ] as const) {
      expect(`${op}: ${codeOf(brain, laneA, op, args)}`).toBe(`${op}: FORBIDDEN`);
    }
    expect(brain.listJobs(ADMIN, { projectId: 'projA' })).toHaveLength(1);
  });

  it('a Brain token cannot claim, and whoami works for both roles', () => {
    const { brain } = setup();
    expect(codeOf(brain, brainA, 'claim_job', {})).toBe('FORBIDDEN');
    expect(codeOf(brain, laneA, 'whoami', {})).toBe('OK');
    expect(codeOf(brain, brainA, 'whoami', {})).toBe('OK');
  });

  it('lane reads stay confined to the lane (repro rows)', () => {
    const { brain } = setup();
    expect(codeOf(brain, laneA, 'read_inbox', { address: { kind: 'lane', id: 'laneB1' } })).toBe(
      'FORBIDDEN'
    );
    expect(codeOf(brain, laneA, 'list_jobs', { projectId: 'projB' })).toBe('FORBIDDEN');
  });
});
