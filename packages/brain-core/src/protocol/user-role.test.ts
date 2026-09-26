import { beforeEach, describe, expect, it } from 'vitest';
import { BRAIN, makeBrain } from '../../test/helpers';
import type { Brain } from '../brain/brain';
import { InMemoryBrainStore } from '../store/memory-store';
import { USER_BRAIN_ID } from '../types';
import {
  type BrainGrant,
  type BrainHostOps,
  executeBrainRequest,
  executeBrainRequestAsync,
} from './execute';
import { HOST_OPS, LANE_OPS, USER_OPS, opArgs } from './ops';
import { TokenRegistry } from './tokens';

/**
 * M5: the user role. A user token is a brain grant with `user: true`, minted only
 * by main for the operator's CLI. These tests are the proof for the claims in
 * `scope.ts`'s `authorizeUserRequest`.
 */

const USER: BrainGrant = {
  identity: { role: 'brain', brainId: USER_BRAIN_ID },
  projectId: 'alpha',
  attachmentRoots: [],
  user: true,
};

const AGENT_BRAIN: BrainGrant = {
  identity: { role: 'brain', brainId: 'hub' },
  projectId: 'alpha',
  attachmentRoots: [],
};

/** Records which host op ran, so the coverage assertion below can be exhaustive. */
function fakeHost(): { host: BrainHostOps; calls: string[] } {
  const calls: string[] = [];
  const note =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(name);
      return Promise.resolve({ name, args });
    };
  return {
    calls,
    host: {
      listDone: note('list_done'),
      listNotes: note('list_notes'),
      dispatcherStatus: note('dispatcher_status'),
      setDispatcherPaused: note('set_dispatcher_paused'),
      setLaneMode: note('set_lane_mode'),
      listSessions: note('list_sessions'),
      startBrain: note('start_brain'),
      stopBrain: note('stop_brain'),
      stopAll: note('stop_all'),
      clearStop: note('clear_stop'),
    } as BrainHostOps,
  };
}

const HOST_ARGS: Record<(typeof HOST_OPS)[number], Record<string, unknown>> = {
  list_done: {},
  list_notes: {},
  dispatcher_status: {},
  set_dispatcher_paused: { paused: true },
  set_lane_mode: { laneId: 'A', mode: 'unattended' },
  list_sessions: {},
  start_brain: {},
  stop_brain: { brainId: 'hub' },
  stop_all: {},
  clear_stop: {},
};

describe('the user role', () => {
  let brain: Brain;

  beforeEach(() => {
    brain = makeBrain(new InMemoryBrainStore());
    brain.upsertLane(BRAIN, { id: 'A', projectId: 'alpha', provider: 'claude', status: 'idle' });
    brain.upsertLane(BRAIN, { id: 'B', projectId: 'beta', provider: 'codex', status: 'idle' });
  });

  it('reaches every host op through the async executor', async () => {
    const { host, calls } = fakeHost();
    for (const op of HOST_OPS) {
      const response = await executeBrainRequestAsync(
        brain,
        USER,
        { v: 1, op, args: HOST_ARGS[op] },
        { host }
      );
      expect(response, op).toMatchObject({ ok: true });
    }
    expect(calls.sort()).toEqual([...HOST_OPS].sort());
  });

  it('answers UNAVAILABLE, never a silent success, when no host is wired', async () => {
    for (const op of HOST_OPS) {
      const response = await executeBrainRequestAsync(brain, USER, {
        v: 1,
        op,
        args: HOST_ARGS[op],
      });
      expect(response, op).toEqual({
        ok: false,
        error: { code: 'UNAVAILABLE', message: expect.stringContaining(op) },
      });
    }
  });

  it('refuses host ops on the sync executor rather than running them', () => {
    const response = executeBrainRequest(brain, USER, { v: 1, op: 'stop_all', args: {} });
    expect(response).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
  });

  it('refuses host ops to an agent brain token, host or not', async () => {
    const { host } = fakeHost();
    const response = await executeBrainRequestAsync(
      brain,
      AGENT_BRAIN,
      { v: 1, op: 'stop_all', args: {} },
      { host }
    );
    expect(response).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('refuses claim_job: claiming is a lane move, even for the operator', () => {
    const response = executeBrainRequest(brain, USER, { v: 1, op: 'claim_job', args: {} });
    expect(response).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(USER_OPS as readonly string[]).not.toContain('claim_job');
    expect(LANE_OPS as readonly string[]).toContain('claim_job');
  });

  it('is not pinned to grant.projectId, unlike an agent brain token', () => {
    const args = { title: 'cross-project', projectId: 'beta' };
    expect(executeBrainRequest(brain, USER, { v: 1, op: 'create_job', args })).toMatchObject({
      ok: true,
    });
    expect(executeBrainRequest(brain, AGENT_BRAIN, { v: 1, op: 'create_job', args })).toMatchObject(
      {
        ok: false,
        error: { code: 'FORBIDDEN' },
      }
    );
  });

  it('may declare a gate kind SEC-08 refuses to agents', () => {
    const args = { title: 'docs pass', gateKind: 'docs' as const };
    expect(executeBrainRequest(brain, USER, { v: 1, op: 'create_job', args })).toMatchObject({
      ok: true,
    });
    expect(executeBrainRequest(brain, AGENT_BRAIN, { v: 1, op: 'create_job', args })).toMatchObject(
      {
        ok: false,
        error: { code: 'FORBIDDEN' },
      }
    );
  });

  it('still gets NOT_FOUND for a recipient that does not exist', () => {
    const response = executeBrainRequest(brain, USER, {
      v: 1,
      op: 'send_message',
      args: { to: { kind: 'lane', id: 'ghost' }, body: 'hi' },
    });
    expect(response).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('reports role "user" from whoami', () => {
    const response = executeBrainRequest(brain, USER, { v: 1, op: 'whoami', args: {} });
    expect(response).toMatchObject({ ok: true, result: { role: 'user' } });
  });

  it('every host op has arguments in this file, so the coverage above is exhaustive', () => {
    expect(Object.keys(HOST_ARGS).sort()).toEqual([...HOST_OPS].sort());
    for (const op of HOST_OPS) expect(opArgs[op].safeParse(HOST_ARGS[op]).success, op).toBe(true);
  });

  it('SEC-02: a user grant must be the brain identity "user"', () => {
    const tokens = new TokenRegistry();
    expect(() =>
      tokens.issue({
        identity: { role: 'brain', brainId: 'hub' },
        projectId: 'alpha',
        attachmentRoots: [],
        user: true,
      })
    ).toThrow(/brainId "user"/);
    expect(() =>
      tokens.issue({
        identity: { role: 'lane', laneId: 'A', projectId: 'alpha' },
        projectId: 'alpha',
        attachmentRoots: [],
        user: true,
      })
    ).toThrow(/not a lane grant/);
  });
});
