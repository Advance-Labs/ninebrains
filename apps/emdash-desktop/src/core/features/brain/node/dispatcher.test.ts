import { Brain, InMemoryBrainStore, type Job } from '@ninebrains/brain-core';
import { describe, expect, it } from 'vitest';
import type { LaneAgentState, PasteOutcome } from './attended';
import { APP_IDENTITY, Dispatcher, type DispatchLane } from './dispatcher';

function lane(
  id: string,
  agent: LaneAgentState | undefined = { status: 'completed' }
): DispatchLane {
  return {
    laneId: id,
    projectId: 'p1',
    provider: 'claude',
    sessionRunning: true,
    asleep: false,
    agent,
    worktreePath: `/wt/${id}`,
  };
}

function setup(
  lanes: DispatchLane[],
  paste: (lane: DispatchLane) => PasteOutcome = () => 'pasted'
) {
  let clock = 1_000;
  const brain = new Brain({ store: new InMemoryBrainStore(), now: () => clock++ });
  const pasted: Array<{ laneId: string; prompt: string }> = [];
  const unattended: Array<{ laneId: string; job: Job }> = [];
  const dispatcher = new Dispatcher({
    brain,
    lanes: () => lanes,
    paste: async (target, prompt) => {
      pasted.push({ laneId: target.laneId, prompt });
      return paste(target);
    },
    runUnattended: async (target, job) => void unattended.push({ laneId: target.laneId, job }),
    onError: (context, error) => {
      throw new Error(`${context}: ${String(error)}`);
    },
  });
  const job = (title: string, dependsOn: string[] = []) =>
    brain.createJob(APP_IDENTITY, { projectId: 'p1', title, dependsOn });
  return { brain, dispatcher, pasted, unattended, job };
}

describe('Dispatcher', () => {
  it('gives each idle lane at most one job per tick, oldest first, and starts attended runs', async () => {
    const { brain, dispatcher, pasted, job } = setup([lane('A'), lane('B')]);
    const first = job('first');
    const second = job('second');
    job('third');

    const records = await dispatcher.tick();
    expect(records.map((r) => r.jobId).sort()).toEqual([first.id, second.id].sort());
    expect(records.every((r) => r.outcome === 'pasted')).toBe(true);
    expect(pasted).toHaveLength(2);
    expect(pasted[0]!.prompt).toContain(`complete_job with jobId "`);
    for (const r of records) expect(brain.getJob(APP_IDENTITY, r.jobId).state).toBe('running');

    // Both lanes now hold a running job: nothing more goes out.
    expect(await dispatcher.tick()).toEqual([]);
  });

  it('waits on dependencies', async () => {
    const { dispatcher, job } = setup([lane('A'), lane('B')]);
    const base = job('base');
    const dependent = job('dependent', [base.id]);
    const records = await dispatcher.tick();
    expect(records.map((r) => r.jobId)).toEqual([base.id]);
    expect(records.some((r) => r.jobId === dependent.id)).toBe(false);
  });

  it('releases the job when the paste does not land', async () => {
    const { brain, dispatcher, job } = setup([lane('A')], () => 'not-ready');
    const only = job('only');
    const [record] = await dispatcher.tick();
    expect(record).toMatchObject({ jobId: only.id, outcome: 'not-ready' });
    expect(brain.getJob(APP_IDENTITY, only.id)).toMatchObject({ state: 'ready', laneId: null });
  });

  it('SEC-15 never dispatches to a lane that is awaiting input or not yet started', async () => {
    const waiting = lane('A', { status: 'awaiting-input', notificationType: 'permission_prompt' });
    const fresh: DispatchLane = { ...lane('B'), agent: undefined };
    const { dispatcher, pasted, job } = setup([waiting, fresh]);
    job('work');
    expect(await dispatcher.tick()).toEqual([]);
    expect(pasted).toEqual([]);
  });

  it('plans nothing while paused or latched by STOP', async () => {
    const { dispatcher, pasted, job } = setup([lane('A')]);
    job('work');
    dispatcher.setPaused(true);
    expect(await dispatcher.tick()).toEqual([]);
    dispatcher.setPaused(false);
    dispatcher.latch();
    expect(await dispatcher.tick()).toEqual([]);
    expect(pasted).toEqual([]);
    dispatcher.clearStop();
    dispatcher.setPaused(false);
    expect(await dispatcher.tick()).toHaveLength(1);
  });

  it('hands unattended lanes to the run path instead of pasting', async () => {
    const { dispatcher, pasted, unattended, job } = setup([lane('A')]);
    dispatcher.setMode('A', 'unattended');
    const work = job('work');
    const [record] = await dispatcher.tick();
    expect(record).toMatchObject({ jobId: work.id, mode: 'unattended', outcome: 'started' });
    expect(pasted).toEqual([]);
    expect(unattended.map((u) => u.job.id)).toEqual([work.id]);
    dispatcher.dispose();
  });

  it("adopts each lane's persisted mode, so a restart keeps it", async () => {
    const persisted: DispatchLane = { ...lane('A'), mode: 'unattended' };
    const { dispatcher, pasted, unattended, job } = setup([persisted]);
    // A fresh dispatcher knows nothing yet: attended until the first round reads the lane.
    expect(dispatcher.modeOf('A')).toBe('attended');
    const work = job('work');
    const [record] = await dispatcher.tick();
    expect(record).toMatchObject({ jobId: work.id, mode: 'unattended', outcome: 'started' });
    expect(pasted).toEqual([]);
    expect(unattended).toHaveLength(1);
    expect(dispatcher.state.laneModes).toEqual({ A: 'unattended' });
  });

  it('lets the lane record win over an unpersisted mode change', async () => {
    const attended: DispatchLane = { ...lane('A'), mode: 'attended' };
    const { dispatcher, pasted, unattended, job } = setup([attended]);
    dispatcher.setMode('A', 'unattended');
    job('work');
    const [record] = await dispatcher.tick();
    expect(record).toMatchObject({ mode: 'attended', outcome: 'pasted' });
    expect(pasted).toHaveLength(1);
    expect(unattended).toEqual([]);
    dispatcher.dispose();
  });
});
