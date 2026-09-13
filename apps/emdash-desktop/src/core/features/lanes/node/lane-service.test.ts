import type { TuiAgentStateStatus } from '@emdash/core/runtimes/tui-agents/api';
import { err, ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { LanesGridConfig } from '../api';
import type { LaneAgentSnapshot, LaneProjectInfo, LaneServicePorts } from './lane-ports';
import { LaneService } from './lane-service';
import type { TuiSessionStatus } from './lane-status';

const LOCAL: LaneProjectInfo = { projectId: 'p1', name: 'Repo', host: 'local', baseRef: 'main' };
const SSH: LaneProjectInfo = { projectId: 'p2', name: 'Remote', host: 'remote', baseRef: 'main' };

function createHarness(options: { persisted?: LanesGridConfig } = {}) {
  let counter = 0;
  let stored: LanesGridConfig | null = options.persisted ?? null;
  let feedListener: ((snapshot: LaneAgentSnapshot) => void) | null = null;
  const agents = new Map<string, TuiAgentStateStatus>();
  const sessions = new Map<string, TuiSessionStatus>();
  const calls: string[] = [];
  const ports = {
    projects: {
      get: vi.fn(async (id: string) => [LOCAL, SSH].find((p) => p.projectId === id) ?? null),
    },
    tasks: {
      createWorktreeTask: vi.fn(async (_input: { baseRef: string; branchName: string }) => {
        calls.push('createTask');
        return ok(undefined);
      }),
      provision: vi.fn(async (_taskId: string) => {
        calls.push('provision');
        return ok({ path: '/tmp/wt' });
      }),
      deleteTask: vi.fn(async () => {
        calls.push('deleteTask');
      }),
    },
    conversations: {
      create: vi.fn(async (input: { conversationId: string; model: string | null }) => {
        calls.push('create');
        sessions.set(input.conversationId, 'running');
      }),
      launch: vi.fn(async (input: { conversationId: string }) => {
        calls.push('launch');
        sessions.set(input.conversationId, 'running');
      }),
      stop: vi.fn(async (conversationId: string) => {
        calls.push('stop');
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
    newId: () => `id-${++counter}-0000`,
    onError: vi.fn(),
  } satisfies LaneServicePorts;
  const service = new LaneService(ports);
  return {
    service,
    ports,
    calls,
    stored: () => stored,
    pushFeed: () => feedListener?.({ agents: new Map(agents), sessions: new Map(sessions) }),
    agents,
  };
}

async function addLane(harness: ReturnType<typeof createHarness>, slot: 0 | 1 | 2 | 3 = 0) {
  await harness.service.initialize();
  const tabId = harness.service.boardSnapshot().tabs[0]!.tabId;
  const created = await harness.service.createLane({
    tabId,
    slot,
    projectId: 'p1',
    provider: 'claude',
  });
  if (!created.success) throw new Error(created.error.message);
  await harness.service.settled();
  harness.pushFeed();
  return { tabId, laneId: created.data.laneId };
}

describe('LaneService lifecycle', () => {
  it('starts with one empty tab', async () => {
    const { service } = createHarness();
    await service.initialize();
    const tabs = service.boardSnapshot().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.slots).toEqual([null, null, null, null]);
  });

  it('provisions a worktree task, then creates and launches the conversation', async () => {
    const harness = createHarness();
    const { laneId } = await addLane(harness);
    expect(harness.calls).toEqual(['createTask', 'provision', 'create']);
    expect(harness.ports.tasks.createWorktreeTask.mock.calls[0]![0]).toMatchObject({
      baseRef: 'main',
      branchName: expect.stringMatching(/^lanes\//),
    });
    const lane = harness.service.getLane(laneId);
    expect(lane).toMatchObject({ session: 'running', status: 'idle', projectName: 'Repo' });
    expect(lane?.conversationReady).toBe(true);
    expect(harness.stored()?.tabs[0]!.slots[0]?.laneId).toBe(laneId);
  });

  it('refuses SSH projects with a clear message', async () => {
    const { service } = createHarness();
    await service.initialize();
    const tabId = service.boardSnapshot().tabs[0]!.tabId;
    const result = await service.createLane({ tabId, slot: 0, projectId: 'p2', provider: 'codex' });
    expect(result).toEqual(err(expect.objectContaining({ type: 'ssh-unsupported' })));
    expect(service.boardSnapshot().tabs[0]!.slots[0]).toBeNull();
  });

  it('refuses an occupied slot', async () => {
    const harness = createHarness();
    const { tabId } = await addLane(harness);
    const result = await harness.service.createLane({
      tabId,
      slot: 0,
      projectId: 'p1',
      provider: 'codex',
    });
    expect(result.success).toBe(false);
  });

  it('marks the lane failed when the worktree cannot be created', async () => {
    const harness = createHarness();
    harness.ports.tasks.createWorktreeTask.mockResolvedValueOnce(err('branch exists') as never);
    const { laneId } = await addLane(harness);
    expect(harness.service.getLane(laneId)).toMatchObject({
      session: 'failed',
      error: 'branch exists',
    });
    expect(harness.ports.conversations.create).not.toHaveBeenCalled();
  });

  it('stops, and relaunch resumes instead of creating a second conversation', async () => {
    const harness = createHarness();
    const { laneId } = await addLane(harness);
    expect((await harness.service.stopLane(laneId)).success).toBe(true);
    harness.pushFeed();
    expect(harness.service.getLane(laneId)?.session).toBe('stopped');
    expect((await harness.service.relaunchLane(laneId)).success).toBe(true);
    expect(harness.calls.slice(-3)).toEqual(['stop', 'provision', 'launch']);
    expect(harness.ports.conversations.create).toHaveBeenCalledTimes(1);
  });

  it('reports a start failure when provisioning fails', async () => {
    const harness = createHarness();
    const { laneId } = await addLane(harness);
    await harness.service.stopLane(laneId);
    harness.pushFeed();
    harness.ports.tasks.provision.mockResolvedValueOnce(err('project-unavailable') as never);
    const result = await harness.service.startLane(laneId);
    expect(result).toEqual(err(expect.objectContaining({ type: 'start-failed' })));
    expect(harness.service.getLane(laneId)?.session).toBe('failed');
  });
});

describe('LaneService sleep', () => {
  it('never stops the PTY when a lane sleeps or wakes', async () => {
    const harness = createHarness();
    const { laneId } = await addLane(harness);
    await harness.service.sleepLane(laneId);
    expect(harness.service.getLane(laneId)).toMatchObject({ status: 'asleep', session: 'running' });
    expect(harness.service.statusSnapshot()[laneId]).toBe('asleep');
    await harness.service.wakeLane(laneId);
    expect(harness.service.getLane(laneId)?.status).toBe('idle');
    expect(harness.ports.conversations.stop).not.toHaveBeenCalled();
  });
});

describe('LaneService status lights', () => {
  it('follows hook states from the agent feed', async () => {
    const harness = createHarness();
    const { laneId } = await addLane(harness);
    const conversationId = harness.service.getLane(laneId)!.conversationId;
    harness.agents.set(conversationId, 'working');
    harness.pushFeed();
    expect(harness.service.statusSnapshot()[laneId]).toBe('running');
    harness.agents.set(conversationId, 'awaiting-input');
    harness.pushFeed();
    expect(harness.service.statusSnapshot()[laneId]).toBe('waiting');
  });
});

describe('LaneService slots', () => {
  it('moves a lane to an empty slot', async () => {
    const harness = createHarness();
    const { tabId, laneId } = await addLane(harness, 0);
    await harness.service.moveLane(laneId, tabId, 3);
    const slots = harness.service.boardSnapshot().tabs[0]!.slots;
    expect(slots[0]).toBeNull();
    expect(slots[3]?.laneId).toBe(laneId);
  });

  it('swaps with the lane already in the target slot', async () => {
    const harness = createHarness();
    const first = await addLane(harness, 0);
    const second = await addLane(harness, 1);
    await harness.service.moveLane(first.laneId, first.tabId, 1);
    const slots = harness.service.boardSnapshot().tabs[0]!.slots;
    expect(slots[0]?.laneId).toBe(second.laneId);
    expect(slots[1]?.laneId).toBe(first.laneId);
  });

  it('moves a lane across tabs', async () => {
    const harness = createHarness();
    const { laneId } = await addLane(harness, 2);
    const tab = await harness.service.createTab('Second');
    if (!tab.success) throw new Error('tab');
    await harness.service.moveLane(laneId, tab.data.tabId, 0);
    const [first, second] = harness.service.boardSnapshot().tabs;
    expect(first!.slots[2]).toBeNull();
    expect(second!.slots[0]?.laneId).toBe(laneId);
  });

  it('refuses to remove a tab that still has lanes', async () => {
    const harness = createHarness();
    const { tabId } = await addLane(harness);
    expect((await harness.service.removeTab(tabId)).success).toBe(false);
  });
});

describe('LaneService removal and persistence', () => {
  it('stops the PTY and keeps the worktree unless asked', async () => {
    const harness = createHarness();
    const kept = await addLane(harness, 0);
    await harness.service.removeLane(kept.laneId, false);
    expect(harness.calls).toContain('stop');
    expect(harness.ports.tasks.deleteTask).not.toHaveBeenCalled();
    const deleted = await addLane(harness, 1);
    await harness.service.removeLane(deleted.laneId, true);
    expect(harness.ports.tasks.deleteTask).toHaveBeenCalledWith('p1', expect.any(String), {
      deleteWorktree: true,
    });
    expect(harness.service.boardSnapshot().tabs[0]!.slots.every((slot) => slot === null)).toBe(
      true
    );
  });

  it('restores lanes as stopped and resumes them on start', async () => {
    const first = createHarness();
    const { laneId } = await addLane(first);
    await first.service.settled();
    const second = createHarness({ persisted: first.stored()! });
    await second.service.initialize();
    expect(second.service.getLane(laneId)).toMatchObject({ session: 'stopped', status: 'idle' });
    expect((await second.service.startLane(laneId)).success).toBe(true);
    expect(second.calls).toEqual(['provision', 'launch']);
  });

  it('persists the run mode with the lane, attended by default', async () => {
    const first = createHarness();
    const { laneId } = await addLane(first);
    expect(first.service.getLane(laneId)?.runMode).toBeUndefined();
    expect((await first.service.setLaneMode(laneId, 'unattended')).success).toBe(true);
    expect(first.service.getLane(laneId)?.runMode).toBe('unattended');
    await first.service.settled();

    // A restart keeps the lane unattended.
    const second = createHarness({ persisted: first.stored()! });
    await second.service.initialize();
    expect(second.service.getLane(laneId)?.runMode).toBe('unattended');

    // Back to attended stores no field, so older builds read the grid unchanged.
    await second.service.setLaneMode(laneId, 'attended');
    await second.service.settled();
    expect(second.stored()!.tabs[0]!.slots[0]).not.toHaveProperty('runMode');
    expect((await second.service.setLaneMode('missing', 'unattended')).success).toBe(false);
  });

  it('keeps the pack role and model a lane was created with', async () => {
    const harness = createHarness();
    await harness.service.initialize();
    const tabId = harness.service.boardSnapshot().tabs[0]!.tabId;
    const created = await harness.service.createLane({
      tabId,
      slot: 2,
      projectId: 'p1',
      provider: 'claude',
      model: 'claude-sonnet-5',
      roleId: 'coding:builder',
    });
    if (!created.success) throw new Error(created.error.message);
    await harness.service.settled();
    expect(harness.service.getLane(created.data.laneId)).toMatchObject({
      roleId: 'coding:builder',
      model: 'claude-sonnet-5',
    });
    expect(harness.stored()!.tabs[0]!.slots[2]).toMatchObject({ roleId: 'coding:builder' });
    expect(harness.ports.conversations.create.mock.calls[0]![0]).toMatchObject({
      model: 'claude-sonnet-5',
    });
  });

  it('leaves launches untouched in Phase 1', async () => {
    const harness = createHarness();
    const { laneId } = await addLane(harness);
    const conversationId = harness.service.getLane(laneId)!.conversationId;
    expect(harness.service.resolveLaneLaunch(conversationId)).toBeUndefined();
  });
});
