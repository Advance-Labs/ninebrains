import { openFixture } from '@tooling/utils/db';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppNotification } from '../api';
import { SqliteNotificationStore } from './sqlite-store';

const notification: AppNotification = {
  id: 'n-1',
  kind: 'agent-attention',
  groupKey: 'conversation:conv-1',
  title: 'Codex - Task',
  body: 'Your agent is waiting for input',
  target: { kind: 'task', projectId: 'project-1', taskId: 'task-1', conversationId: 'conv-1' },
  source: {
    kind: 'conversation',
    projectId: 'project-1',
    taskId: 'task-1',
    conversationId: 'conv-1',
  },
  sound: 'needs_attention',
  count: 1,
  createdAt: 1_000,
  readAt: null,
};

describe('SqliteNotificationStore', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  afterEach(() => {
    fixture?.close();
  });

  it('round-trips notifications and read state', async () => {
    fixture = await openFixture('empty');
    const store = new SqliteNotificationStore(fixture.db);

    expect(await store.insert(notification)).toEqual({ success: true, data: undefined });
    expect(await store.loadRecent({ since: 0, maxRows: 10 })).toEqual([notification]);

    expect(await store.markRead(['n-1'], 2_000)).toEqual({ success: true, data: undefined });
    expect(await store.loadRecent({ since: 0, maxRows: 10 })).toEqual([
      { ...notification, readAt: 2_000 },
    ]);

    expect(await store.remove(['n-1'])).toEqual({ success: true, data: undefined });
    expect(await store.loadRecent({ since: 0, maxRows: 10 })).toEqual([]);
  });

  // prune had no coverage here, which is how `ORDER BY … OFFSET ?` — invalid in SQLite without a
  // LIMIT — shipped and silently turned every prune into a logged `near "offset": syntax error`.
  // The service swallows that into a warn, so the table just grew forever.
  it('drops rows older than the cutoff', async () => {
    fixture = await openFixture('empty');
    const store = new SqliteNotificationStore(fixture.db);

    await store.insert({ ...notification, id: 'old', createdAt: 1_000 });
    await store.insert({ ...notification, id: 'new', createdAt: 5_000 });

    expect(await store.prune({ olderThan: 4_000, maxRows: 100 })).toEqual({
      success: true,
      data: undefined,
    });
    expect((await store.loadRecent({ since: 0, maxRows: 10 })).map((row) => row.id)).toEqual([
      'new',
    ]);
  });

  it('drops everything past maxRows, newest kept', async () => {
    fixture = await openFixture('empty');
    const store = new SqliteNotificationStore(fixture.db);

    for (let i = 0; i < 5; i++) {
      await store.insert({ ...notification, id: `n-${i}`, createdAt: 1_000 + i });
    }

    expect(await store.prune({ olderThan: 0, maxRows: 2 })).toEqual({
      success: true,
      data: undefined,
    });
    // prune keeps the newest `maxRows`; loadRecent hands them back oldest-first.
    expect((await store.loadRecent({ since: 0, maxRows: 10 })).map((row) => row.id)).toEqual([
      'n-3',
      'n-4',
    ]);
  });

  it('keeps every row when maxRows is not reached', async () => {
    fixture = await openFixture('empty');
    const store = new SqliteNotificationStore(fixture.db);

    await store.insert({ ...notification, id: 'only', createdAt: 1_000 });

    expect(await store.prune({ olderThan: 0, maxRows: 50 })).toEqual({
      success: true,
      data: undefined,
    });
    expect((await store.loadRecent({ since: 0, maxRows: 10 })).map((row) => row.id)).toEqual([
      'only',
    ]);
  });
});
