import type { TuiAgentStateStatus } from '@emdash/core/runtimes/tui-agents/api';
import { err, ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { LanesGridConfig } from '../api';
import type { LaneAgentSnapshot, LaneProjectInfo, LaneServicePorts } from './lane-ports';
import { LaneService } from './lane-service';
import type { TuiSessionStatus } from './lane-status';

/**
 * Copied from lane-service.test.ts (not imported: that file is another agent's test file
 * running concurrently). Adds `modelProfilesEnabled` so routing tests can flip the flag.
 */
const LOCAL: LaneProjectInfo = { projectId: 'p1', name: 'Repo', host: 'local', baseRef: 'main' };

function createHarness(options: { modelProfilesEnabled?: boolean | (() => boolean) } = {}) {
  let counter = 0;
  let stored: LanesGridConfig | null = null;
  let feedListener: ((snapshot: LaneAgentSnapshot) => void) | null = null;
  const agents = new Map<string, TuiAgentStateStatus>();
  const sessions = new Map<string, TuiSessionStatus>();
  const ports = {
    projects: {
      get: vi.fn(async (id: string) => (id === LOCAL.projectId ? LOCAL : null)),
    },
    tasks: {
      createWorktreeTask: vi.fn(async () => ok(undefined)),
      provision: vi.fn(async () => ok({ path: '/tmp/wt' })),
      deleteTask: vi.fn(async () => {}),
    },
    conversations: {
      create: vi.fn(async (input: { conversationId: string }) => {
        sessions.set(input.conversationId, 'running');
      }),
      launch: vi.fn(async (input: { conversationId: string }) => {
        sessions.set(input.conversationId, 'running');
      }),
      stop: vi.fn(async (conversationId: string) => {
        sessions.set(conversationId, 'exited');
      }),
    },
    persistence: {
      load: vi.fn(async () => stored),
      save: vi.fn(async (config: LanesGridConfig) => {
        stored = structuredClone(config);
      }),
    },
    agentFeed: {
      subscribe: (listener: (snapshot: LaneAgentSnapshot) => void) => {
        feedListener = listener;
        return () => {
          feedListener = null;
        };
      },
    },
    ...(options.modelProfilesEnabled === undefined
      ? {}
      : {
          modelProfilesEnabled:
            typeof options.modelProfilesEnabled === 'function'
              ? options.modelProfilesEnabled
              : () => options.modelProfilesEnabled as boolean,
        }),
    newId: () => `id-${++counter}-0000`,
    onError: vi.fn(),
  } satisfies LaneServicePorts;
  const service = new LaneService(ports);
  return {
    service,
    ports,
    stored: () => stored,
    pushFeed: () => feedListener?.({ agents: new Map(agents), sessions: new Map(sessions) }),
  };
}

async function addLane(
  harness: ReturnType<typeof createHarness>,
  extra: { subagentModel?: string; authProfileId?: string } = {}
) {
  await harness.service.initialize();
  const tabId = harness.service.boardSnapshot().tabs[0]!.tabId;
  const created = await harness.service.createLane({
    tabId,
    slot: 0,
    projectId: 'p1',
    provider: 'claude',
    ...extra,
  });
  if (!created.success) return created;
  await harness.service.settled();
  harness.pushFeed();
  return created;
}

describe('lane routing', () => {
  it('setLaneRouting persists subagentModel and authProfileId', async () => {
    const harness = createHarness();
    const created = await addLane(harness);
    if (!created.success) throw new Error(created.error.message);
    const { laneId } = created.data;

    const result = await harness.service.setLaneRouting(laneId, {
      subagentModel: 'haiku',
      authProfileId: 'profile-1',
    });
    expect(result.success).toBe(true);
    expect(harness.service.getLane(laneId)).toMatchObject({
      subagentModel: 'haiku',
      authProfileId: 'profile-1',
    });
  });

  it('null clears a routing field', async () => {
    const harness = createHarness();
    const created = await addLane(harness);
    if (!created.success) throw new Error(created.error.message);
    const { laneId } = created.data;
    await harness.service.setLaneRouting(laneId, {
      subagentModel: 'haiku',
      authProfileId: 'profile-1',
    });
    await harness.service.setLaneRouting(laneId, { subagentModel: null, authProfileId: null });
    const lane = harness.service.getLane(laneId);
    expect(lane?.subagentModel).toBeUndefined();
    expect(lane?.authProfileId).toBeUndefined();
  });

  it('keeps an explicit inherit rather than treating it as a clear', async () => {
    const harness = createHarness();
    const created = await addLane(harness);
    if (!created.success) throw new Error(created.error.message);
    const { laneId } = created.data;
    await harness.service.setLaneRouting(laneId, { subagentModel: 'inherit', authProfileId: null });
    expect(harness.service.getLane(laneId)?.subagentModel).toBe('inherit');
  });

  it('createLane copies subagentModel and authProfileId', async () => {
    const harness = createHarness();
    const created = await addLane(harness, { subagentModel: 'opus', authProfileId: 'profile-9' });
    if (!created.success) throw new Error(created.error.message);
    expect(harness.service.getLane(created.data.laneId)).toMatchObject({
      subagentModel: 'opus',
      authProfileId: 'profile-9',
    });
  });

  it('createLane refuses an authProfileId when profiles are disabled, and saves nothing', async () => {
    const harness = createHarness({ modelProfilesEnabled: false });
    const result = await addLane(harness, { authProfileId: 'profile-9' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('routing-disabled');
    expect(harness.service.boardSnapshot().tabs[0]!.slots[0]).toBeNull();
  });

  it('setLaneRouting refuses an authProfileId when profiles are disabled, and saves nothing', async () => {
    const harness = createHarness({ modelProfilesEnabled: false });
    const created = await addLane(harness);
    if (!created.success) throw new Error(created.error.message);
    const { laneId } = created.data;
    const result = await harness.service.setLaneRouting(laneId, {
      subagentModel: null,
      authProfileId: 'profile-9',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('routing-disabled');
    expect(harness.service.getLane(laneId)?.authProfileId).toBeUndefined();
  });

  it('T47: a live toggle takes effect on the next call, not the next restart', async () => {
    let on = false;
    const harness = createHarness({ modelProfilesEnabled: () => on });
    const created = await addLane(harness);
    if (!created.success) throw new Error(created.error.message);
    const { laneId } = created.data;

    const refused = await harness.service.setLaneRouting(laneId, {
      subagentModel: null,
      authProfileId: 'profile-9',
    });
    expect(refused.success).toBe(false);

    on = true;
    const allowed = await harness.service.setLaneRouting(laneId, {
      subagentModel: null,
      authProfileId: 'profile-9',
    });
    expect(allowed.success).toBe(true);
    expect(harness.service.getLane(laneId)?.authProfileId).toBe('profile-9');
  });

  it('returns lane-not-found for an unknown lane', async () => {
    const harness = createHarness();
    await harness.service.initialize();
    const result = await harness.service.setLaneRouting('ghost', {
      subagentModel: 'haiku',
      authProfileId: null,
    });
    expect(result).toEqual(err(expect.objectContaining({ type: 'lane-not-found' })));
  });
});
