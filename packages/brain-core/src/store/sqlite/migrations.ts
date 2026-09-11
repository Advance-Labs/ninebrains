import { createHash } from 'node:crypto';
import type { SqliteConnectionLike } from './connection';

export interface Migration {
  version: number;
  name: string;
  /** Fixed creation time in ms; core's runner calls this `when`. Never change it. */
  when: number;
  sql: string;
}

/**
 * Ordered, append-only schema history. Never edit a shipped migration: add a
 * new one with the next version. Both runners consume this list: brain-core's
 * own (direct/headless mode) and core's `defineDurableSqliteStore` in the app
 * (via `BRAIN_BUNDLED_MIGRATIONS`).
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial',
    when: 1_789_056_000_000,
    sql: `
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN
          ('proposed','ready','claimed','running','verifying','done','blocked','failed')),
        lane_id TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        gate_spec TEXT,
        hints TEXT NOT NULL DEFAULT '{}',
        result TEXT,
        reason TEXT,
        created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('lane','brain')),
        created_by_id TEXT NOT NULL,
        plan_id TEXT,
        plan_node_id TEXT,
        archived_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX jobs_project_state ON jobs (project_id, state);
      CREATE INDEX jobs_lane ON jobs (lane_id);
      CREATE UNIQUE INDEX jobs_plan_node ON jobs (plan_id, plan_node_id) WHERE plan_id IS NOT NULL;

      CREATE TABLE job_edges (
        from_id TEXT NOT NULL REFERENCES jobs (id),
        to_id TEXT NOT NULL REFERENCES jobs (id),
        project_id TEXT NOT NULL,
        plan_id TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (from_id, to_id)
      ) STRICT;
      CREATE INDEX job_edges_to ON job_edges (to_id);
      CREATE INDEX job_edges_project ON job_edges (project_id);

      CREATE TABLE messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        from_kind TEXT NOT NULL CHECK (from_kind IN ('lane','brain')),
        from_id TEXT NOT NULL,
        to_kind TEXT NOT NULL CHECK (to_kind IN ('lane','brain')),
        to_id TEXT NOT NULL,
        body TEXT NOT NULL,
        attachments TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        read_at INTEGER
      ) STRICT;
      CREATE INDEX messages_inbox ON messages (to_kind, to_id, read_at);

      CREATE TABLE runs (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        job_id TEXT NOT NULL,
        lane_id TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('attended','unattended')),
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        exit_code INTEGER,
        transcript_path TEXT
      ) STRICT;
      CREATE INDEX runs_lane ON runs (lane_id, started_at);
      CREATE INDEX runs_job ON runs (job_id);

      CREATE TABLE notes (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        project_id TEXT NOT NULL,
        job_id TEXT,
        author_kind TEXT NOT NULL CHECK (author_kind IN ('lane','brain')),
        author_id TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX notes_project ON notes (project_id);

      CREATE TABLE done_log (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        job_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        lane_id TEXT,
        summary TEXT NOT NULL,
        artifacts TEXT NOT NULL DEFAULT '[]',
        at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX done_log_project ON done_log (project_id);

      CREATE TABLE lanes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        recent_files TEXT NOT NULL DEFAULT '[]',
        active_job_id TEXT,
        updated_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE event_log (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        at INTEGER NOT NULL
      ) STRICT;
    `,
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

/** Core's bookkeeping table (`@emdash/core` sqlite-store `STORE_TABLE`). */
export const CORE_MIGRATIONS_TABLE = '__emdash_migrations';

export function migrationTag(migration: Pick<Migration, 'version' | 'name'>): string {
  return `${String(migration.version).padStart(4, '0')}_${migration.name}`;
}

/**
 * The same history in core's `BundledMigration` shape, for the app:
 *
 *   defineDurableSqliteStore({ name: 'brain', driver: betterSqlite3Driver,
 *     migrations: BRAIN_BUNDLED_MIGRATIONS })
 *
 * `hash` is SHA-256 of the raw SQL, as core's runner verifies.
 */
export const BRAIN_BUNDLED_MIGRATIONS = MIGRATIONS.map((migration) => ({
  idx: migration.version - 1,
  tag: migrationTag(migration),
  when: migration.when,
  hash: createHash('sha256').update(migration.sql, 'utf8').digest('hex'),
  sql: migration.sql,
}));

/**
 * brain-core's own runner (direct/headless mode). Applies pending migrations
 * in one `BEGIN IMMEDIATE` transaction, so several processes opening a fresh
 * file serialize: the first migrates, the rest apply nothing. Versions newer
 * than this binary are tolerated (additive downgrade). A file already managed
 * by core's runner (the app DB) counts core's applied tags as applied, so
 * direct mode can open it without re-running DDL.
 */
export function migrate(connection: SqliteConnectionLike, migrations: readonly Migration[] = MIGRATIONS): number[] {
  connection.exec('BEGIN IMMEDIATE');
  try {
    connection.exec(
      'CREATE TABLE IF NOT EXISTS brain_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL) STRICT'
    );
    const applied = new Set(
      connection.all<{ version: number }>('SELECT version FROM brain_migrations').map((row) => Number(row.version))
    );
    const coreManaged =
      connection.get("SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = ?", [CORE_MIGRATIONS_TABLE]) !==
      undefined;
    const coreTags = coreManaged
      ? new Set(connection.all<{ tag: string }>(`SELECT tag FROM ${CORE_MIGRATIONS_TABLE}`).map((row) => row.tag))
      : new Set<string>();

    const ran: number[] = [];
    for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
      if (applied.has(migration.version) || coreTags.has(migrationTag(migration))) continue;
      connection.exec(migration.sql);
      connection.run('INSERT INTO brain_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
        migration.version,
        migration.name,
        Date.now(),
      ]);
      ran.push(migration.version);
    }
    connection.exec('COMMIT');
    return ran;
  } catch (error) {
    try {
      connection.exec('ROLLBACK');
    } catch {}
    throw error;
  }
}
