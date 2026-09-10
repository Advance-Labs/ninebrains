import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { STORES, tempDir } from '../../test/helpers';
import type { Job, Run } from '../types';
import { openNodeSqliteConnection } from './sqlite/connection';
import { CORE_MIGRATIONS_TABLE, LATEST_SCHEMA_VERSION, MIGRATIONS, migrate, migrationTag } from './sqlite/migrations';
import { DEFAULT_DB_FILENAME, SqliteBrainStore, resolveBrainDbPath } from './sqlite/sqlite-store';

const job = (id: string, createdAt: number): Job => ({
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
  jobId: 't',
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
    store.transaction(() => store.insertJob(job('kept', 1)));
    expect(() =>
      store.transaction(() => {
        store.insertJob(job('lost', 2));
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(store.listJobs().map((j) => j.id)).toEqual(['kept']);
  });

  it('joins nested transactions to the outer one', () => {
    const store = createStore();
    expect(() =>
      store.transaction(() => {
        store.transaction(() => store.insertJob(job('inner', 1)));
        throw new Error('outer fails');
      })
    ).toThrow('outer fails');
    expect(store.listJobs()).toEqual([]);
  });

  it('rejects async transaction callbacks', () => {
    const store = createStore();
    expect(() => store.transaction(() => Promise.resolve(1))).toThrow(TypeError);
  });

  it('returns copies, not live references', () => {
    const store = createStore();
    store.insertJob(job('t', 1));
    const read = store.getJob('t')!;
    read.title = 'mutated';
    read.hints.paths = ['x'];
    expect(store.getJob('t')).toMatchObject({ title: 't', hints: {} });
  });

  it('orders jobs by creation and filters them', () => {
    const store = createStore();
    store.insertJob(job('b', 2));
    store.insertJob(job('a', 1));
    store.insertJob({ ...job('c', 3), state: 'done', laneId: 'L' });
    expect(store.listJobs().map((j) => j.id)).toEqual(['a', 'b', 'c']);
    expect(store.listJobs({ states: ['done'] }).map((j) => j.id)).toEqual(['c']);
    expect(store.listJobs({ states: [] })).toEqual([]);
    expect(store.listJobs({ laneId: 'L' }).map((j) => j.id)).toEqual(['c']);
    expect(store.listJobs({ limit: 1 }).map((j) => j.id)).toEqual(['a']);
  });

  it('throws when updating a missing job or run', () => {
    const store = createStore();
    expect(() => store.updateJob(job('ghost', 1))).toThrow();
    expect(() => store.updateRun(run('ghost', 'A', 1))).toThrow();
  });

  it('treats insertEdge as idempotent', () => {
    const store = createStore();
    store.insertJob(job('a', 1));
    store.insertJob(job('b', 2));
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
    const lane = {
      id: 'A',
      projectId: 'p1',
      provider: 'claude' as const,
      status: 'idle' as const,
      recentFiles: [],
      activeJobId: null,
      updatedAt: 1,
    };
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

  it('persists data across reopen and close is idempotent', () => {
    const dir = tempDir();
    const store = SqliteBrainStore.open(dir);
    store.insertJob(job('t', 1));
    store.close();
    store.close();
    const again = SqliteBrainStore.open(dir);
    expect(again.getJob('t')?.title).toBe('t');
    again.close();
    expect(existsSync(path.join(dir, DEFAULT_DB_FILENAME))).toBe(true);
  });

  it('lets a second connection read while the first holds a write transaction (WAL)', () => {
    const dir = tempDir();
    const writer = SqliteBrainStore.open(dir);
    const reader = SqliteBrainStore.open(dir);
    writer.insertJob(job('visible', 1));
    writer.transaction(() => {
      writer.insertJob(job('pending', 2));
      expect(reader.listJobs().map((j) => j.id)).toEqual(['visible']);
    });
    expect(reader.listJobs().map((j) => j.id)).toEqual(['visible', 'pending']);
    writer.close();
    reader.close();
  });

  it('does not close a connection it was handed', () => {
    const connection = openNodeSqliteConnection(path.join(tempDir(), 'brain.sqlite'));
    migrate(connection);
    const store = SqliteBrainStore.fromConnection(connection);
    store.insertJob(job('t', 1));
    store.close();
    expect(connection.get<{ n: number }>('SELECT count(*) AS n FROM jobs')).toEqual({ n: 1 });
    connection.close();
  });
});

describe('brain migration runner', () => {
  it('applies migrations once and tolerates newer versions', () => {
    const connection = openNodeSqliteConnection(path.join(tempDir(), 'brain.sqlite'));
    expect(migrate(connection)).toEqual(MIGRATIONS.map((m) => m.version));
    expect(migrate(connection)).toEqual([]);
    const extra = [...MIGRATIONS, { version: 99, name: 'extra', when: 0, sql: 'CREATE TABLE extra (x INTEGER) STRICT' }];
    expect(migrate(connection, extra)).toEqual([99]);
    // An older binary ignores newer applied versions instead of failing.
    expect(migrate(connection)).toEqual([]);
    connection.close();
  });

  it('rolls back a failed migration completely', () => {
    const connection = openNodeSqliteConnection(path.join(tempDir(), 'brain.sqlite'));
    const broken = [...MIGRATIONS, { version: 2, name: 'broken', when: 0, sql: 'CREATE TABLE ok (x) ; NOT VALID SQL' }];
    expect(() => migrate(connection, broken)).toThrow();
    expect(connection.get("SELECT count(*) AS n FROM sqlite_schema WHERE name IN ('jobs','ok')")).toEqual({ n: 0 });
    connection.close();
  });

  it('treats migrations recorded by core runner as applied', () => {
    const connection = openNodeSqliteConnection(path.join(tempDir(), 'brain.sqlite'));
    migrate(connection);
    connection.exec('DROP TABLE brain_migrations');
    connection.exec(`CREATE TABLE ${CORE_MIGRATIONS_TABLE} (tag TEXT PRIMARY KEY, hash TEXT NOT NULL, applied_at INTEGER NOT NULL)`);
    connection.run(`INSERT INTO ${CORE_MIGRATIONS_TABLE} VALUES (?, 'h', 0)`, [migrationTag(MIGRATIONS[0]!)]);
    expect(migrate(connection)).toEqual([]);
    connection.close();
  });
});
