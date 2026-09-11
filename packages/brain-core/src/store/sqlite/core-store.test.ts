/**
 * Proves the in-app storage path against the real upstream primitive: core's
 * `defineDurableSqliteStore` runs `BRAIN_BUNDLED_MIGRATIONS`, and the Brain
 * works on the connection it hands back. The app does the same with
 * `betterSqlite3Driver`; here node:sqlite stands in because better-sqlite3 in
 * this repo is rebuilt for Electron's ABI.
 */
import path from 'node:path';
import { defineDurableSqliteStore } from '@emdash/core/primitives/sqlite-store/node';
import { describe, expect, it } from 'vitest';
import { BRAIN, LANE_A, finish, tempDir } from '../../../test/helpers';
import { Brain } from '../../brain/brain';
import { nodeSqliteDriver } from './connection';
import { BRAIN_BUNDLED_MIGRATIONS, CORE_MIGRATIONS_TABLE, MIGRATIONS, migrationTag } from './migrations';
import { SqliteBrainStore } from './sqlite-store';

const brainStoreDefinition = defineDurableSqliteStore({
  name: 'brain',
  driver: nodeSqliteDriver,
  migrations: BRAIN_BUNDLED_MIGRATIONS,
});

describe('Brain on core defineDurableSqliteStore', () => {
  it('exposes the history in core BundledMigration shape', () => {
    expect(BRAIN_BUNDLED_MIGRATIONS.map((m) => [m.idx, m.tag])).toEqual(MIGRATIONS.map((m, i) => [i, migrationTag(m)]));
    for (const m of BRAIN_BUNDLED_MIGRATIONS) expect(m.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('migrates through core and runs the Brain on its connection', () => {
    const file = path.join(tempDir(), 'ninebrains-brain.db');
    const handle = brainStoreDefinition.open(file);
    const store = SqliteBrainStore.fromConnection(handle.connection, { path: file });
    const brain = new Brain({ store });
    brain.upsertLane(BRAIN, { id: 'A', projectId: 'p1', provider: 'claude', status: 'idle' });
    const first = brain.createJob(BRAIN, { projectId: 'p1', title: 'first' });
    const second = brain.createJob(BRAIN, { projectId: 'p1', title: 'second', dependsOn: [first.id] });
    finish(brain, LANE_A, first.id);
    expect(brain.getJob(BRAIN, second.id).state).toBe('ready');

    const tags = handle.connection.all<{ tag: string }>(`SELECT tag FROM ${CORE_MIGRATIONS_TABLE}`).map((r) => r.tag);
    expect(tags).toEqual(BRAIN_BUNDLED_MIGRATIONS.map((m) => m.tag));

    // The store does not own core's connection: closing it leaves the handle usable.
    store.close();
    expect(handle.connection.get<{ n: number }>('SELECT count(*) AS n FROM jobs')?.n).toBe(2);
    handle.close();

    const reopened = brainStoreDefinition.open(file);
    expect(new Brain({ store: SqliteBrainStore.fromConnection(reopened.connection) }).listJobs(BRAIN)).toHaveLength(2);
    reopened.close();
  });

  it('lets direct mode open a core-managed file without re-running DDL', () => {
    const file = path.join(tempDir(), 'ninebrains-brain.db');
    const handle = brainStoreDefinition.open(file);
    new Brain({ store: SqliteBrainStore.fromConnection(handle.connection) }).createJob(BRAIN, { projectId: 'p1', title: 'from app' });
    handle.close();

    const direct = SqliteBrainStore.open(file);
    expect(new Brain({ store: direct }).listJobs(BRAIN).map((j) => j.title)).toEqual(['from app']);
    direct.close();
  });
});
