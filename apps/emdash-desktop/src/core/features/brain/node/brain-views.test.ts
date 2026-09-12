import { peek as peekCell } from '@emdash/wire/state';
import { Brain, InMemoryBrainStore } from '@ninebrains/brain-core';
import { describe, expect, it } from 'vitest';
import { BrainViews } from './brain-views';
import { APP_IDENTITY } from './dispatcher';
import { startVerification, type GateRunnerPort } from './verification';

const LANE = { role: 'lane', laneId: 'A', projectId: 'p1' } as const;

function setup(gateRunner?: GateRunnerPort) {
  const brain = new Brain({ store: new InMemoryBrainStore() });
  brain.upsertLane(APP_IDENTITY, { id: 'A', projectId: 'p1', provider: 'claude', status: 'idle' });
  const dispatcher = {
    paused: false,
    stopLatched: false,
    laneModes: {},
    activeRuns: 0,
    gatesConnected: gateRunner !== undefined,
  };
  const views = new BrainViews(brain, () => [{ kind: 'lane', id: 'A' }], () => dispatcher);
  const verification = startVerification({ brain, gateRunner, onError: () => {} });
  return { brain, views, verification };
}

async function finishJob(brain: Brain, title: string) {
  const job = brain.createJob(APP_IDENTITY, { projectId: 'p1', title, gateSpec: { gates: ['tests'] } });
  brain.assignJob(APP_IDENTITY, job.id, 'A');
  brain.startRun(APP_IDENTITY, { jobId: job.id, laneId: 'A', mode: 'attended' });
  brain.completeJob(LANE, job.id, { summary: `${title} done` });
  return job;
}

describe('lane side panel source (Brain DB read model)', () => {
  it('lists the lane jobs, done log and notes, and marks work unverified without a gate runner', async () => {
    const { brain, views, verification } = setup();
    const panel = views.lanePanel('A');
    const done = await finishJob(brain, 'first');
    await verification.settled();
    const open = brain.createJob(APP_IDENTITY, { projectId: 'p1', title: 'second' });
    brain.assignJob(APP_IDENTITY, open.id, 'A');
    brain.addNote(LANE, { body: 'remember the cache' });
    brain.sendMessage(LANE, { to: { kind: 'brain', id: 'user' }, body: 'question' });
    views.refresh();

    expect(peekCell(panel.jobs).map((j) => [j.title, j.state])).toEqual([['second', 'claimed']]);
    const [entry] = peekCell(panel.done);
    expect(entry).toMatchObject({ jobId: done.id, title: 'first', summary: 'first done', verified: false });
    expect(peekCell(panel.notes).map((n) => n.body)).toEqual(
      expect.arrayContaining(['remember the cache', expect.stringMatching(/^\[gates\] unverified:/)])
    );
    expect(brain.getJob(APP_IDENTITY, done.id).state).toBe('done');
    expect(peekCell(views.unread)).toEqual({ 'lane:A': 0 });
  });

  it('marks work verified only when the gate runner passed it', async () => {
    const { brain, views, verification } = setup({ verify: async () => ({ pass: true }) });
    await finishJob(brain, 'gated');
    await verification.settled();
    views.refresh();
    expect(peekCell(views.lanePanel('A').done)[0]!.verified).toBe(true);
  });

  it('never passes a job whose gate runner throws', async () => {
    const { brain, verification } = setup({
      verify: async () => {
        throw new Error('runner crashed');
      },
    });
    const job = await finishJob(brain, 'crashy');
    await verification.settled();
    const after = brain.getJob(APP_IDENTITY, job.id);
    expect(after.state).toBe('running');
    expect(after.attempts).toBe(1);
  });
});
