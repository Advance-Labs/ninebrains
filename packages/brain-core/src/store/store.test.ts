import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { STORES, tempDir } from '../../test/helpers';
import type { Run, Task } from '../types';
import { LATEST_SCHEMA_VERSION, MIGRATIONS, migrate } from './sqlite/migrations';
import { DEFAULT_DB_FILENAME, SqliteBrainStore, resolveBrainDbPath } from './sqlite/sqlite-store';

const task = (id: string, createdAt: number): Task => ({
  id,
  projectId: 'p1',
  title: id,
  body: '',
  state: 'ready',
  laneId: null,
  attempts: 0,
  gateSpec: null,
  hints: {},
  result: null,
  reason: null,
  createdBy: 'brain:main',
  planId: null,
  planNodeId: null,
  archivedAt: null,
  createdAt,
  updatedAt: createdAt,
});

const run = (id: string, laneId: string, startedAt: number): Run => ({
  id,
  taskId: 't',
  laneId,
  mode: 'attended',
  startedAt,
  endedAt: null,
  exitCode: null,
  transcriptPath: null,
});

describe.each(STORES)('BrainStore contract (%s)', (_name, createStore) => {
  it('commits a transaction and rolls back a throwing one', () => {
    const store = createStore();
    store.transaction(() => store.insertTask(task('kept', 1)));
    expect(() =>
      store.transaction(() => {
        store.insertTask(task('lost', 2));
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(store.listTasks().map((t) => t.id)).toEqual(['kept']);
  });

  it('joins nested transactions to the outer one', () => {
    const store = createStore();
    expect(() =>
      store.transaction(() => {
        store.transaction(() => store.insertTask(task('inner', 1)));
        throw new Error('outer fails');
      })
    ).toThrow('outer fails');
    expect(store.listTasks()).toEqual([]);
  });

  it('rejects async transaction callbacks', () => {
    const store = createStore();
    expect(() => store.transaction(() => Promise.resolve(1))).toThrow(TypeError);
  });

  it('returns copies, not live references', () => {
    const store = createStore();
    store.insertTask(task('t', 1));
    const read = store.getTask('t')!;
    read.title = 'mutated';
    read.hints.paths = ['x'];
    expect(store.getTask('t')).toMatchObject({ title: 't', hints: {} });
  });

  it('orders tasks by creation and filters them', () => {
    const store = createStore();
    store.insertTask(task('b', 2));
    store.insertTask(task('a', 1));
    store.insertTask({ ...task('c', 3), state: 'done', laneId: 'L' });
    expect(store.listTasks().map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(store.listTasks({ states: ['done'] }).map((t) => t.id)).toEqual(['c']);
    expect(store.listTasks({ states: [] })).toEqual([]);
    expect(store.listTasks({ laneId: 'L' }).map((t) => t.id)).toEqual(['c']);
    expect(store.listTasks({ limit: 1 }).map((t) => t.id)).toEqual(['a']);
  });

  it('throws when updating a missing task or run', () => {
    const store = createStore();
    expect(() => store.updateTask(task('ghost', 1))).toThrow();
    expect(() => store.updateRun(run('ghost', 'A', 1))).toThrow();
  });

  it('treats insertEdge as idempotent', () => {
    const store = createStore();
    store.insertTask(task('a', 1));
    store.insertTask(task('b', 2));
    const edge = { from: 'a', to: 'b', projectId: 'p1', planId: null, createdAt: 1 };
    store.insertEdge(edge);
    store.insertEdge(edge);
    expect(store.listEdges()).toHaveLength(1);
    store.deleteEdge('a', 'b');
    expect(store.listEdges()).toEqual([]);
  });

  it('lists runs newest first so limit keeps the most recent', () => {
    const store = createStore();
    store.insertRun(run('r1', 'A', 10));
    store.insertRun(run('r2', 'B', 30));
    store.insertRun(run('r3', 'A', 20));
    expect(store.listRuns().map((r) => r.id)).toEqual(['r2', 'r3', 'r1']);
    expect(store.listRuns({ laneId: 'A', limit: 1 }).map((r) => r.id)).toEqual(['r3']);
    expect(store.listRuns({ since: 20 }).map((r) => r.id)).toEqual(['r2', 'r3']);
  });

  it('upserts lanes', () => {
    const store = createStore();
    const lane = { id: 'A', projectId: 'p1', provider: 'claude' as const, status: 'idle' as const, recentFiles: [], activeTaskId: null, updatedAt: 1 };
    store.upsertLane(lane);
    store.upsertLane({ ...lane, status: 'running', recentFiles: ['x.ts'] });
    expect(store.listLanes()).toEqual([{ ...lane, status: 'running', recentFiles: ['x.ts'] }]);
    expect(store.getLane('nope')).toBeUndefined();
  });
});

describe('SqliteBrainStore', () => {
  it('resolves a directory to brain.sqlite and keeps explicit files', () => {
    expect(resolveBrainDbPath('/data')).toBe(path.join('/data', DEFAULT_DB_FILENAME));
    expect(resolveBrainDbPath('/data/custom.db')).toBe('/data/custom.db');
    expect(resolveBrainDbPath('/data/x.sqlite3')).toBe('/data/x.sqlite3');
  });

  it('creates the directory, enables WAL and records the schema version', () => {
    const dir = path.join(tempDir(), 'nested', 'deeper');
    const store = SqliteBrainStore.open(dir);
    expect(store.path).toBe(path.join(dir, DEFAULT_DB_FILENAME));
    store.close();

    const raw = new DatabaseSync(path.join(dir, DEFAULT_DB_FILENAME));
    expect(raw.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(raw.prepare('SELECT max(version) AS v FROM brain_migrations').get()).toEqual({ v: LATEST_SCHEMA_VERSION });
    raw.close();
  });

  it('applies migrations once and tolerates re-opening', () => {
    const file = path.join(tempDir(), 'brain.sqlite');
    const db = new DatabaseSync(file);
    expect(migrate(db)).toEqual(MIGRATIONS.map((m) => m.version));
    expect(migrate(db)).toEqual([]);
    const extra = [...MIGRATIONS, { version: 99, name: 'extra', sql: 'CREATE TABLE extra (x INTEGER) STRICT' }];
    expect(migrate(db, extra)).toEqual([99]);
    // An older binary ignores newer applied versions instead of failing.
    expect(migrate(db)).toEqual([]);
    db.close();
  });

  it('rolls back a failed migration completely', () => {
    const file = path.join(tempDir(), 'brain.sqlite');
    const db = new DatabaseSync(file);
    const broken = [...MIGRATIONS, { version: 2, name: 'broken', sql: 'CREATE TABLE ok (x) ; NOT VALID SQL' }];
    expect(() => migrate(db, broken)).toThrow();
    expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('tasks','ok')").get()).toEqual({ n: 0 });
    db.close();
  });

  it('persists data across reopen and close is idempotent', () => {
    const dir = tempDir();
    const store = SqliteBrainStore.open(dir);
    store.insertTask(task('t', 1));
    store.close();
    store.close();
    const again = SqliteBrainStore.open(dir);
    expect(again.getTask('t')?.title).toBe('t');
    again.close();
    expect(existsSync(path.join(dir, DEFAULT_DB_FILENAME))).toBe(true);
  });

  it('lets a second connection read while the first holds a write transaction (WAL)', () => {
    const dir = tempDir();
    const writer = SqliteBrainStore.open(dir);
    const reader = SqliteBrainStore.open(dir);
    writer.insertTask(task('visible', 1));
    writer.transaction(() => {
      writer.insertTask(task('pending', 2));
      expect(reader.listTasks().map((t) => t.id)).toEqual(['visible']);
    });
    expect(reader.listTasks().map((t) => t.id)).toEqual(['visible', 'pending']);
    writer.close();
    reader.close();
  });
});
