import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Ordered, append-only schema history. Never edit a shipped migration: add a
 * new one with the next version number.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial',
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
        created_by TEXT NOT NULL,
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
        from_addr TEXT NOT NULL,
        to_addr TEXT NOT NULL,
        body TEXT NOT NULL,
        attachments TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        read_at INTEGER
      ) STRICT;
      CREATE INDEX messages_inbox ON messages (to_addr, read_at);

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
        author TEXT NOT NULL,
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

/**
 * Applies pending migrations inside one `BEGIN IMMEDIATE` transaction, so
 * several processes opening a fresh file at once serialize: the first one
 * migrates, the rest see the work done and apply nothing. Versions newer
 * than this binary knows are tolerated (a downgraded app keeps working on
 * additive changes).
 */
export function migrate(db: DatabaseSync, migrations: readonly Migration[] = MIGRATIONS): number[] {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(
      'CREATE TABLE IF NOT EXISTS brain_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL) STRICT'
    );
    const applied = new Set(
      (db.prepare('SELECT version FROM brain_migrations').all() as Array<{ version: number }>).map(
        (row) => row.version
      )
    );
    const ran: number[] = [];
    const record = db.prepare(
      'INSERT INTO brain_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    );
    for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
      if (applied.has(migration.version)) continue;
      db.exec(migration.sql);
      record.run(migration.version, migration.name, Date.now());
      ran.push(migration.version);
    }
    db.exec('COMMIT');
    return ran;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {}
    throw error;
  }
}
