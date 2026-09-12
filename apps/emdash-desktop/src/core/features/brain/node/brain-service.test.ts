import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok } from '@emdash/shared';
import { peek } from '@emdash/wire/state';
import { Brain, InMemoryBrainStore } from '@ninebrains/brain-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LaneConfig } from '@core/features/lanes/api';
import { BrainService, type BrainLaneInfo } from './brain-service';
import { APP_IDENTITY } from './dispatcher';
import { startBrainEndpoint } from './endpoint';

const services: BrainService[] = [];
afterEach(async () => {
  while (services.length > 0) await services.pop()!.dispose();
});

async function setup() {
  const userDataDir = realpathSync(mkdtempSync(join(tmpdir(), 'nb-service-')));
  const brain = new Brain({ store: new InMemoryBrainStore() });
  const endpoint = await startBrainEndpoint({ brain, onInternalError: () => {} });
  const lane: BrainLaneInfo = {
    laneId: 'lane-1',
    projectId: 'p1',
    provider: 'claude',
    taskId: 't1',
    conversationId: 'c1',
    asleep: false,
    sessionRunning: true,
    agent: { status: 'completed' },
    worktreePath: join(userDataDir, 'wt', 'lane-1'),
  };
  const writes: string[] = [];
  const stopped: string[] = [];
  const refresh = vi.fn();
  const supervisor = {
    run: vi.fn(),
    killAll: vi.fn(async () => {}),
    clearStop: vi.fn(),
    activeRunIds: [] as string[],
  };
  const service = new BrainService({
    brain,
    endpoint,
    userDataDir,
    brainMcp: { execPath: '/app/Ninebrains', binPath: '/app/brain-mcp/bin.mjs' },
    lanes: {
      list: () => [lane],
      sendInput: async (_id, data) => void writes.push(data),
      stop: async (laneId) => void stopped.push(laneId),
      setMode: async (laneId, mode) => {
        if (laneId !== lane.laneId) throw new Error('That lane no longer exists.');
        lane.mode = mode;
      },
      subscribe: () => () => {},
      refresh,
    },
    sessions: {
      projects: { get: async () => null },
      tasks: {
        createWorktreeTask: async () => ok(undefined),
        provision: async () => ok({ path: '/x' }),
      },
      conversations: { create: async () => {}, launch: async () => {}, stop: async () => {} },
      persistence: { load: async () => [], save: async () => {} },
      newId: () => 'b1',
      onError: () => {},
    },
    supervisor,
    onError: (context, error) => {
      throw new Error(`${context}: ${String(error)}`);
    },
    sleep: async () => {},
    dispatch: { intervalMs: 60_000, debounceMs: 1 },
  });
  services.push(service);
  return { service, brain, endpoint, lane, writes, stopped, refresh, supervisor, userDataDir };
}

const laneConfig = (lane: BrainLaneInfo): LaneConfig => ({
  laneId: lane.laneId,
  projectId: lane.projectId,
  taskId: lane.taskId,
  conversationId: lane.conversationId,
  provider: lane.provider,
  model: null,
  accountLabel: null,
  browserId: 'lane-lane-1',
  asleep: false,
  conversationReady: true,
});

describe('BrainService', () => {
  it('persists a lane run mode through the lanes port before the dispatcher uses it', async () => {
    const { service, lane } = await setup();
    service.start();
    expect(await service.setLaneMode('lane-1', 'unattended')).toEqual({
      success: true,
      data: undefined,
    });
    expect(lane.mode).toBe('unattended');
    expect(service.dispatcher.modeOf('lane-1')).toBe('unattended');
    expect(peek(service.views.dispatcher).unattendedBudgets).toMatchObject({
      wallClockMs: 1_800_000,
    });

    const missing = await service.setLaneMode('gone', 'unattended');
    expect(missing).toMatchObject({ success: false, error: { type: 'not-found' } });
    expect(service.dispatcher.modeOf('gone')).toBe('attended');
  });

  it('constructs, starts and serves the overview before any lane has launched', async () => {
    const { service } = await setup();
    service.start();
    expect(peek(service.views.dispatcher)).toMatchObject({ paused: false, stopLatched: false });
  });

  it('launches a lane with a token, dispatches a job into it, and releases the launch', async () => {
    const { service, brain, endpoint, lane, writes, refresh, userDataDir } = await setup();
    service.start();
    const port = service.laneBrainPort();
    const launch = port.resolveLaunch(laneConfig(lane), {
      extraArgs: [],
      autoApprove: false,
      cwd: lane.worktreePath!,
    });
    expect(launch.extraArgs[0]).toMatch(/^--mcp-config=/);
    expect(endpoint.liveTokens()).toBe(1);

    const job = brain.createJob(APP_IDENTITY, { projectId: 'p1', title: 'Ship it' });
    const [record] = await service.dispatcher.tick();
    expect(record).toMatchObject({ jobId: job.id, laneId: 'lane-1', outcome: 'pasted' });
    expect(writes[0]).toContain(`Brain job ${job.id}: Ship it`);
    expect(writes[1]).toBe('\r');
    expect(port.override('lane-1')).toEqual({ job: undefined, activeJobId: job.id });
    expect(refresh).toHaveBeenCalled();

    port.releaseLaunch('lane-1');
    expect(endpoint.liveTokens()).toBe(0);
    expect(existsSync(join(userDataDir, 'ninebrains', 'lanes', 'lane-1'))).toBe(false);
  });

  it('STOP latches dispatch, kills runs and stops the dispatched attended lane', async () => {
    const { service, brain, stopped, supervisor } = await setup();
    service.start();
    brain.createJob(APP_IDENTITY, { projectId: 'p1', title: 'Work' });
    await service.dispatcher.tick();

    const result = await service.stopAll();
    expect(result).toMatchObject({ success: true, data: { stoppedLanes: 1 } });
    expect(supervisor.killAll).toHaveBeenCalledOnce();
    expect(stopped).toEqual(['lane-1']);
    expect(peek(service.views.dispatcher).stopLatched).toBe(true);
    expect(service.setDispatcherPaused(false).success).toBe(false);

    expect(service.clearStop().success).toBe(true);
    expect(supervisor.clearStop).toHaveBeenCalledOnce();
    expect(service.dispatcher.state).toMatchObject({ paused: false, stopLatched: false });
  });
});
