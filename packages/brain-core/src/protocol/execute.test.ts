import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BRAIN, makeBrain } from '../../test/helpers';
import type { Brain } from '../brain/brain';
import { InMemoryBrainStore } from '../store/memory-store';
import { type BrainGrant, executeBrainRequest } from './execute';
import { BRAIN_OPS, type BrainOp, type BrainOpInput, LANE_OPS, SESSION_OPS, opArgs } from './ops';
import { opResults } from './results';

let dir: string;
let brain: Brain;
let grants: Record<'A' | 'B' | 'X' | 'hub', BrainGrant>;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'brain-exec-')));
  mkdirSync(path.join(dir, 'project'));
  writeFileSync(path.join(dir, 'project', 'out.png'), '');
  brain = makeBrain(new InMemoryBrainStore());
  const roots = [path.join(dir, 'project')];
  grants = {
    A: {
      identity: { role: 'lane', laneId: 'A', projectId: 'p1' },
      projectId: 'p1',
      attachmentRoots: roots,
    },
    B: {
      identity: { role: 'lane', laneId: 'B', projectId: 'p1' },
      projectId: 'p1',
      attachmentRoots: roots,
    },
    X: {
      identity: { role: 'lane', laneId: 'X', projectId: 'p2' },
      projectId: 'p2',
      attachmentRoots: roots,
    },
    hub: { identity: BRAIN, projectId: 'p1', attachmentRoots: roots },
  };
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Runs a request and, when it succeeds, holds the result to the published result schema. */
function call<O extends BrainOp>(who: keyof typeof grants, op: O, args: BrainOpInput<O>) {
  const response = executeBrainRequest(brain, grants[who], { v: 1, op, args });
  if (response.ok) {
    const check = opResults[op].safeParse(response.result);
    expect(
      check.success,
      `${op} result violates its schema: ${JSON.stringify(response.result)}`
    ).toBe(true);
  }
  return response;
}

function result<O extends BrainOp>(who: keyof typeof grants, op: O, args: BrainOpInput<O>): any {
  const response = call(who, op, args);
  if (!response.ok)
    throw new Error(`${op} failed: ${response.error.code} ${response.error.message}`);
  return response.result;
}

describe('executeBrainRequest', () => {
  it('covers every operation, and each result matches its schema', () => {
    const covered = new Set<BrainOp>();
    const track = <O extends BrainOp>(who: keyof typeof grants, op: O, args: BrainOpInput<O>) => {
      covered.add(op);
      return result(who, op, args);
    };

    const first = track('hub', 'create_job', {
      title: 'Build',
      body: 'b'.repeat(300),
      gates: ['tests'],
      paths: ['src'],
    });
    const second = track('hub', 'create_job', { title: 'Review', kind: 'review' });
    expect(track('A', 'whoami', {})).toEqual({ role: 'lane', laneId: 'A', projectId: 'p1' });
    expect(track('hub', 'link_jobs', { from: first.id, to: second.id })).toMatchObject({
      from: first.id,
      to: second.id,
    });
    expect(track('A', 'list_jobs', { states: ['ready'] }).map((j: { id: string }) => j.id)).toEqual(
      [first.id]
    );
    expect(track('A', 'claim_job', {})).toMatchObject({
      id: first.id,
      state: 'running',
      gates: ['tests'],
    });
    expect(
      track('A', 'complete_job', { jobId: first.id, summary: 'built', artifacts: ['out.png'] })
    ).toMatchObject({
      state: 'verifying',
    });
    expect(brain.getJob(BRAIN, first.id).result?.artifacts).toEqual([
      path.join(dir, 'project', 'out.png'),
    ]);
    track('A', 'send_message', {
      to: { kind: 'lane', id: 'B' },
      body: 'look',
      attachments: [{ kind: 'file', path: 'out.png' }],
    });
    expect(track('B', 'read_inbox', {})).toMatchObject([
      { from: { kind: 'lane', id: 'A' }, body: 'look' },
    ]);
    expect(track('B', 'add_note', { body: 'noted' })).toMatchObject({
      projectId: 'p1',
      jobId: null,
    });
    expect(
      track('hub', 'assign_job', {
        jobId: track('hub', 'create_job', { title: 'C' }).id,
        laneId: 'B',
      })
    ).toMatchObject({
      state: 'claimed',
      laneId: 'B',
    });
    const blocked = track('B', 'list_jobs', { mine: true })[0];
    expect(track('B', 'block_job', { jobId: blocked.id, reason: 'no creds' })).toMatchObject({
      state: 'blocked',
    });
    expect(track('hub', 'requeue_job', { jobId: blocked.id })).toMatchObject({
      state: 'ready',
      attempts: 0,
    });
    expect(track('hub', 'list_lanes', {}).map((l: { id: string }) => l.id)).toEqual(['A', 'B']);
    expect(track('hub', 'broadcast', { body: 'hello' })).toEqual([
      { kind: 'lane', id: 'A' },
      { kind: 'lane', id: 'B' },
    ]);

    expect([...covered].sort()).toEqual(
      [...new Set([...LANE_OPS, ...BRAIN_OPS, ...SESSION_OPS])].sort()
    );
    expect(Object.keys(opArgs).sort()).toEqual([...covered].sort());
  });

  it('returns claimed:null when nothing is ready', () => {
    expect(result('A', 'claim_job', {})).toEqual({ claimed: null, message: expect.any(String) });
  });

  it.each([
    [null],
    ['claim_job'],
    [{ op: 'claim_job', args: {} }],
    [{ v: 2, op: 'claim_job', args: {} }],
    [{ v: 1, op: 'drop_database', args: {} }],
    [{ v: 1, op: 'complete_job', args: { jobId: 'j' } }],
    [{ v: 1, op: 'send_message', args: { to: 'nobody', body: 'x' } }],
    [
      {
        v: 1,
        op: 'send_message',
        args: { to: { kind: 'lane', id: 'B' }, body: 'x'.repeat(32 * 1024 + 1) },
      },
    ],
    [{ v: 1, op: 'list_jobs', args: { states: ['sleeping'] } }],
  ])('rejects malformed request %# as BAD_REQUEST without throwing', (input) => {
    const response = executeBrainRequest(brain, grants.A, input);
    expect(response).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
  });

  it('maps Brain errors to their codes', () => {
    const job = result('hub', 'create_job', { title: 'T' });
    result('A', 'claim_job', { jobId: job.id });
    expect(call('B', 'claim_job', { jobId: job.id })).toMatchObject({
      error: { code: 'ILLEGAL_TRANSITION' },
    });
    expect(call('B', 'complete_job', { jobId: job.id, summary: 'mine' })).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
    expect(call('B', 'read_inbox', { address: { kind: 'lane', id: 'A' } })).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
    expect(call('X', 'claim_job', { jobId: job.id })).toMatchObject({
      error: { code: 'NOT_FOUND' },
    });
    expect(call('X', 'list_jobs', { projectId: 'p1' })).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
    expect(call('hub', 'claim_job', { jobId: job.id })).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
    expect(call('A', 'create_job', { title: 'sneaky' })).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
    expect(call('hub', 'link_jobs', { from: job.id, to: job.id })).toMatchObject({
      error: { code: 'CYCLE' },
    });
    expect(
      call('A', 'complete_job', { jobId: job.id, summary: 'x', artifacts: ['/etc/hosts'] })
    ).toMatchObject({
      error: { code: 'INVALID', message: expect.stringContaining('outside') },
    });
  });

  it('requires a project when the grant has no default', () => {
    const response = executeBrainRequest(
      brain,
      { ...grants.hub, projectId: null },
      { v: 1, op: 'create_job', args: { title: 'T' } }
    );
    expect(response).toMatchObject({
      ok: false,
      error: { code: 'INVALID', message: expect.stringContaining('projectId') },
    });
  });

  it('SEC-07 errors do not leak internals: unexpected exceptions become a bare INTERNAL', () => {
    const store = new InMemoryBrainStore();
    store.listLanes = () => {
      throw new Error('disk on fire');
    };
    const broken = makeBrain(store, { lanes: false });
    expect(executeBrainRequest(broken, grants.hub, { v: 1, op: 'list_lanes', args: {} })).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'internal error' },
    });
  });
});
