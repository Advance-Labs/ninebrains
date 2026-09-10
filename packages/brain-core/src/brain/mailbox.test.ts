import { describe, expect, it } from 'vitest';
import { BRAIN, LANE_A, LANE_B, STORES, makeBrain, tempDir } from '../../test/helpers';
import { InvalidInputError } from '../errors';
import { SqliteBrainStore } from '../store/sqlite/sqlite-store';
import { Brain } from './brain';

describe.each(STORES)('mailbox (%s store)', (_name, createStore) => {
  it('holds messages for a sleeping lane until it reads them, then marks them read', () => {
    const brain = makeBrain(createStore());
    brain.upsertLane(BRAIN, { id: 'A', projectId: 'p1', provider: 'claude', status: 'asleep' });
    brain.sendMessage(BRAIN, { to: 'lane:A', body: 'first' });
    brain.sendMessage(LANE_B, {
      to: 'lane:A',
      body: 'second',
      attachments: [
        { kind: 'file', path: 'src/app.ts' },
        { kind: 'screenshot', ref: 'evidence/t1/1440.png' },
      ],
    });

    const inbox = brain.readInbox(LANE_A);
    expect(inbox.map((m) => [m.from, m.body])).toEqual([
      ['brain:main', 'first'],
      ['lane:B', 'second'],
    ]);
    expect(inbox[1]!.attachments).toEqual([
      { kind: 'file', path: 'src/app.ts' },
      { kind: 'screenshot', ref: 'evidence/t1/1440.png' },
    ]);
    expect(inbox.every((m) => m.readAt !== null)).toBe(true);
    expect(brain.readInbox(LANE_A)).toEqual([]);
    expect(brain.readInbox(LANE_A, { includeRead: true })).toHaveLength(2);
  });

  it('honours the read limit and leaves the rest unread', () => {
    const brain = makeBrain(createStore());
    for (const n of [1, 2, 3]) brain.sendMessage(BRAIN, { to: 'lane:A', body: `m${n}` });
    expect(brain.readInbox(LANE_A, { limit: 2 }).map((m) => m.body)).toEqual(['m1', 'm2']);
    expect(brain.readInbox(LANE_A).map((m) => m.body)).toEqual(['m3']);
  });

  it('delivers to lanes that are not registered yet (store-and-forward)', () => {
    const brain = makeBrain(createStore(), { lanes: false });
    brain.sendMessage(BRAIN, { to: 'lane:future', body: 'when you wake up' });
    expect(brain.readInbox({ role: 'lane', laneId: 'future', projectId: 'p1' }).map((m) => m.body)).toEqual([
      'when you wake up',
    ]);
  });

  it('routes replies to the originating brain', () => {
    const brain = makeBrain(createStore());
    const other = { role: 'brain', brainId: 'second' } as const;
    brain.sendMessage(LANE_A, { to: 'brain:second', body: 'done with it' });
    expect(brain.readInbox(BRAIN)).toEqual([]);
    expect(brain.readInbox(other).map((m) => m.body)).toEqual(['done with it']);
  });

  it('broadcasts to every lane of one project only', () => {
    const brain = makeBrain(createStore());
    const sent = brain.broadcast(BRAIN, { projectId: 'p1', body: 'standup' });
    expect(sent.map((m) => m.to)).toEqual(['lane:A', 'lane:B']);
    expect(brain.readInbox(BRAIN, { address: 'lane:X' })).toEqual([]);
  });

  it('rejects bad addresses, empty bodies, oversized bodies and too many attachments', () => {
    const brain = makeBrain(createStore());
    expect(() => brain.sendMessage(BRAIN, { to: 'A', body: 'x' })).toThrow(InvalidInputError);
    expect(() => brain.sendMessage(BRAIN, { to: 'lane:', body: 'x' })).toThrow(InvalidInputError);
    expect(() => brain.sendMessage(BRAIN, { to: 'lane:A', body: ' ' })).toThrow(InvalidInputError);
    expect(() => brain.sendMessage(BRAIN, { to: 'lane:A', body: 'x'.repeat(32 * 1024 + 1) })).toThrow(InvalidInputError);
    const attachments = Array.from({ length: 21 }, (_, i) => ({ kind: 'file' as const, path: `f${i}` }));
    expect(() => brain.sendMessage(BRAIN, { to: 'lane:A', body: 'x', attachments })).toThrow(InvalidInputError);
  });

  it('emits messageSent after commit', () => {
    const brain = makeBrain(createStore());
    const seen: string[] = [];
    brain.events.on('messageSent', ({ message }) => seen.push(message.body));
    brain.sendMessage(BRAIN, { to: 'lane:A', body: 'ping' });
    expect(seen).toEqual(['ping']);
  });

  it('stores notes scoped to the project', () => {
    const brain = makeBrain(createStore());
    const job = brain.createJob(BRAIN, { projectId: 'p1', title: 'T' });
    brain.addNote(LANE_A, { body: 'uses port 3001' });
    brain.addNote(LANE_A, { body: 'flaky test', jobId: job.id });
    brain.addNote(BRAIN, { body: 'brain note', projectId: 'p2' });
    expect(() => brain.addNote(BRAIN, { body: 'where?' })).toThrow(InvalidInputError);
    expect(brain.listNotes(LANE_A).map((n) => [n.author, n.body, n.jobId])).toEqual([
      ['lane:A', 'uses port 3001', null],
      ['lane:A', 'flaky test', job.id],
    ]);
    expect(brain.listNotes(BRAIN, { jobId: job.id })).toHaveLength(1);
  });
});

describe('mailbox persistence (sqlite)', () => {
  it('keeps unread messages across process restarts', () => {
    const dir = tempDir();
    const first = new Brain({ store: SqliteBrainStore.open(dir) });
    first.sendMessage(BRAIN, { to: 'lane:A', body: 'survives restart' });
    first.close();

    const second = new Brain({ store: SqliteBrainStore.open(dir) });
    expect(second.readInbox(LANE_A).map((m) => m.body)).toEqual(['survives restart']);
    second.close();

    const third = new Brain({ store: SqliteBrainStore.open(dir) });
    expect(third.readInbox(LANE_A)).toEqual([]);
    third.close();
  });
});
