import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { NotFoundError } from '../../errors';
import type { BrainEvent, StoredBrainEvent } from '../../events';
import type {
  DoneEntry,
  Job,
  JobEdge,
  JobId,
  Lane,
  LaneId,
  Message,
  Note,
  ProjectId,
  Run,
} from '../../types';
import type { BrainStore, JobEdgeFilter, JobFilter, MessageFilter, RunFilter } from '../store';
import { type SqliteConnectionLike, openNodeSqliteConnection } from './connection';
import { migrate } from './migrations';
import {
  JOB_COLUMNS,
  MESSAGE_COLUMNS,
  NOTE_COLUMNS,
  type Param,
  type Row,
  jobParams,
  messageParams,
  noteParams,
  placeholders,
  toDone,
  toEdge,
  toJob,
  toLane,
  toMessage,
  toNote,
  toRun,
} from './rows';

export const DEFAULT_DB_FILENAME = 'brain.sqlite';

export interface SqliteBrainStoreOptions {
  /** How long a writer waits for another process's lock before failing. */
  busyTimeoutMs?: number;
}

/** A file path is used as-is; anything else is treated as a directory holding `brain.sqlite`. */
export function resolveBrainDbPath(dirOrFile: string): string {
  return /\.(sqlite3?|db)$/i.test(dirOrFile)
    ? dirOrFile
    : path.join(dirOrFile, DEFAULT_DB_FILENAME);
}

/**
 * SQLite-backed store over any `SqliteConnectionLike`.
 *
 * - `open(dirOrFile)`: direct/headless mode. node:sqlite, WAL, busy_timeout,
 *   brain-core's own migration runner. Several processes may share the file.
 * - `fromConnection(connection)`: the app. Main opens the file through core's
 *   `defineDurableSqliteStore` with `BRAIN_BUNDLED_MIGRATIONS`; core owns the
 *   pragmas, migrations and backups, and this class only reads and writes.
 *
 * Every transaction is `BEGIN IMMEDIATE`, so read-modify-write sequences such
 * as a claim are serialized even across processes.
 */
export class SqliteBrainStore implements BrainStore {
  readonly path: string | null;
  private readonly connection: SqliteConnectionLike;
  private readonly ownsConnection: boolean;
  private depth = 0;
  private closed = false;

  static open(dirOrFile: string, options: SqliteBrainStoreOptions = {}): SqliteBrainStore {
    const file = resolveBrainDbPath(dirOrFile);
    mkdirSync(path.dirname(file), { recursive: true });
    const busyTimeoutMs = Math.trunc(options.busyTimeoutMs ?? 10_000);
    const connection = openNodeSqliteConnection(file, { busyTimeoutMs });
    try {
      connection.exec('PRAGMA journal_mode = WAL');
      connection.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
      connection.exec('PRAGMA synchronous = NORMAL');
      connection.exec('PRAGMA foreign_keys = ON');
      migrate(connection);
    } catch (error) {
      connection.close();
      throw error;
    }
    return new SqliteBrainStore(connection, { path: file, ownsConnection: true });
  }

  /**
   * Wraps a connection that is already configured and migrated (by core's
   * store primitive). The store never closes a connection it does not own.
   */
  static fromConnection(
    connection: SqliteConnectionLike,
    options: { path?: string; ownsConnection?: boolean } = {}
  ): SqliteBrainStore {
    return new SqliteBrainStore(connection, {
      path: options.path ?? null,
      ownsConnection: options.ownsConnection ?? false,
    });
  }

  private constructor(
    connection: SqliteConnectionLike,
    options: { path: string | null; ownsConnection: boolean }
  ) {
    this.connection = connection;
    this.path = options.path;
    this.ownsConnection = options.ownsConnection;
  }

  transaction<T>(fn: () => T): T {
    if (this.depth > 0) {
      this.depth++;
      try {
        return fn();
      } finally {
        this.depth--;
      }
    }
    this.connection.exec('BEGIN IMMEDIATE');
    this.depth = 1;
    try {
      const result = fn();
      if (result instanceof Promise)
        throw new TypeError('transaction callbacks must be synchronous');
      this.connection.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.connection.exec('ROLLBACK');
      } catch {}
      throw error;
    } finally {
      this.depth = 0;
    }
  }

  getJob(id: JobId): Job | undefined {
    const row = this.get(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ?`, [id]);
    return row && toJob(row);
  }

  findJobByPlanNode(planId: string, planNodeId: string): Job | undefined {
    const row = this.get(`SELECT ${JOB_COLUMNS} FROM jobs WHERE plan_id = ? AND plan_node_id = ?`, [
      planId,
      planNodeId,
    ]);
    return row && toJob(row);
  }

  listJobs(filter: JobFilter = {}): Job[] {
    const where = new Where();
    where
      .eq('project_id', filter.projectId)
      .eq('lane_id', filter.laneId)
      .eq('plan_id', filter.planId);
    if (filter.states !== undefined) {
      if (filter.states.length === 0) return [];
      where.add(`state IN (${filter.states.map(() => '?').join(', ')})`, ...filter.states);
    }
    if (!filter.includeArchived) where.add('archived_at IS NULL');
    return this.all(
      `SELECT ${JOB_COLUMNS} FROM jobs ${where.sql} ORDER BY created_at, rowid ${limit(filter.limit)}`,
      where.params
    ).map(toJob);
  }

  insertJob(job: Job): void {
    const placeholders = JOB_COLUMNS.split(', ')
      .map(() => '?')
      .join(', ');
    this.run(`INSERT INTO jobs (${JOB_COLUMNS}) VALUES (${placeholders})`, jobParams(job));
  }

  updateJob(job: Job): void {
    const [id, ...rest] = jobParams(job);
    const sets = JOB_COLUMNS.split(', ')
      .slice(1)
      .map((column) => `${column} = ?`)
      .join(', ');
    const result = this.run(`UPDATE jobs SET ${sets} WHERE id = ?`, [...rest, id!]);
    if (Number(result.changes) === 0) throw new NotFoundError('job', job.id);
  }

  listEdges(filter: JobEdgeFilter = {}): JobEdge[] {
    const where = new Where();
    where
      .eq('project_id', filter.projectId)
      .eq('from_id', filter.from)
      .eq('to_id', filter.to)
      .eq('plan_id', filter.planId);
    return this.all(`SELECT * FROM job_edges ${where.sql} ORDER BY rowid`, where.params).map(
      toEdge
    );
  }

  insertEdge(edge: JobEdge): void {
    this.run(
      'INSERT OR IGNORE INTO job_edges (from_id, to_id, project_id, plan_id, created_at) VALUES (?, ?, ?, ?, ?)',
      [edge.from, edge.to, edge.projectId, edge.planId, edge.createdAt]
    );
  }

  deleteEdge(from: JobId, to: JobId): void {
    this.run('DELETE FROM job_edges WHERE from_id = ? AND to_id = ?', [from, to]);
  }

  insertMessage(m: Message): void {
    this.run(
      `INSERT INTO messages (${MESSAGE_COLUMNS}) VALUES (${placeholders(MESSAGE_COLUMNS)})`,
      messageParams(m)
    );
  }

  listMessages(filter: MessageFilter): Message[] {
    const unread = filter.unreadOnly ? 'AND read_at IS NULL' : '';
    return this.all(
      `SELECT * FROM messages WHERE to_kind = ? AND to_id = ? ${unread} ORDER BY seq ${limit(filter.limit)}`,
      [filter.to.kind, filter.to.id]
    ).map(toMessage);
  }

  markMessagesRead(ids: readonly string[], at: number): void {
    for (const id of ids)
      this.run('UPDATE messages SET read_at = ? WHERE id = ? AND read_at IS NULL', [at, id]);
  }

  insertRun(r: Run): void {
    this.run(
      'INSERT INTO runs (id, job_id, lane_id, mode, started_at, ended_at, exit_code, transcript_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [r.id, r.jobId, r.laneId, r.mode, r.startedAt, r.endedAt, r.exitCode, r.transcriptPath]
    );
  }

  updateRun(r: Run): void {
    const result = this.run(
      'UPDATE runs SET job_id = ?, lane_id = ?, mode = ?, started_at = ?, ended_at = ?, exit_code = ?, transcript_path = ? WHERE id = ?',
      [r.jobId, r.laneId, r.mode, r.startedAt, r.endedAt, r.exitCode, r.transcriptPath, r.id]
    );
    if (Number(result.changes) === 0) throw new NotFoundError('run', r.id);
  }

  getRun(id: string): Run | undefined {
    const row = this.get('SELECT * FROM runs WHERE id = ?', [id]);
    return row && toRun(row);
  }

  listRuns(filter: RunFilter = {}): Run[] {
    const where = new Where();
    where.eq('lane_id', filter.laneId).eq('job_id', filter.jobId);
    if (filter.since !== undefined) where.add('started_at >= ?', filter.since);
    return this.all(
      `SELECT * FROM runs ${where.sql} ORDER BY started_at DESC, seq DESC ${limit(filter.limit)}`,
      where.params
    ).map(toRun);
  }

  insertNote(n: Note): void {
    this.run(
      `INSERT INTO notes (${NOTE_COLUMNS}) VALUES (${placeholders(NOTE_COLUMNS)})`,
      noteParams(n)
    );
  }

  listNotes(filter: { projectId?: ProjectId; jobId?: JobId; limit?: number } = {}): Note[] {
    const where = new Where();
    where.eq('project_id', filter.projectId).eq('job_id', filter.jobId);
    return this.all(
      `SELECT * FROM notes ${where.sql} ORDER BY seq ${limit(filter.limit)}`,
      where.params
    ).map(toNote);
  }

  insertDone(d: DoneEntry): void {
    this.run(
      'INSERT INTO done_log (id, job_id, project_id, lane_id, summary, artifacts, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [d.id, d.jobId, d.projectId, d.laneId, d.summary, JSON.stringify(d.artifacts), d.at]
    );
  }

  listDone(filter: { projectId?: ProjectId; limit?: number } = {}): DoneEntry[] {
    const where = new Where().eq('project_id', filter.projectId);
    return this.all(
      `SELECT * FROM done_log ${where.sql} ORDER BY seq ${limit(filter.limit)}`,
      where.params
    ).map(toDone);
  }

  upsertLane(l: Lane): void {
    this.run(
      `INSERT INTO lanes (id, project_id, provider, status, recent_files, active_job_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET project_id = excluded.project_id, provider = excluded.provider,
         status = excluded.status, recent_files = excluded.recent_files,
         active_job_id = excluded.active_job_id, updated_at = excluded.updated_at`,
      [
        l.id,
        l.projectId,
        l.provider,
        l.status,
        JSON.stringify(l.recentFiles),
        l.activeJobId,
        l.updatedAt,
      ]
    );
  }

  getLane(id: LaneId): Lane | undefined {
    const row = this.get('SELECT * FROM lanes WHERE id = ?', [id]);
    return row && toLane(row);
  }

  listLanes(filter: { projectId?: ProjectId } = {}): Lane[] {
    const where = new Where().eq('project_id', filter.projectId);
    return this.all(`SELECT * FROM lanes ${where.sql} ORDER BY rowid`, where.params).map(toLane);
  }

  appendEvent(event: BrainEvent, at: number): number {
    const result = this.run('INSERT INTO event_log (type, payload, at) VALUES (?, ?, ?)', [
      event.type,
      JSON.stringify(event.payload),
      at,
    ]);
    return Number(result.lastInsertRowid);
  }

  readEvents(afterSeq: number, max = 500): StoredBrainEvent[] {
    return this.all('SELECT * FROM event_log WHERE seq > ? ORDER BY seq LIMIT ?', [
      afterSeq,
      max,
    ]).map(
      (r) =>
        ({
          seq: Number(r.seq),
          at: Number(r.at),
          type: r.type,
          payload: JSON.parse(r.payload as string),
        }) as StoredBrainEvent
    );
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.ownsConnection) this.connection.close();
  }

  private get(sql: string, params: Param[]): Row | undefined {
    return this.connection.get<Row>(sql, params);
  }

  private all(sql: string, params: Param[]): Row[] {
    return this.connection.all<Row>(sql, params);
  }

  private run(sql: string, params: Param[]) {
    return this.connection.run(sql, params);
  }
}

/** Builds a WHERE clause from optional equality filters. */
class Where {
  private readonly clauses: string[] = [];
  readonly params: Param[] = [];

  eq(column: string, value: Param | undefined): this {
    if (value !== undefined) this.add(`${column} = ?`, value);
    return this;
  }

  add(clause: string, ...params: Param[]): this {
    this.clauses.push(clause);
    this.params.push(...params);
    return this;
  }

  get sql(): string {
    return this.clauses.length === 0 ? '' : `WHERE ${this.clauses.join(' AND ')}`;
  }
}

function limit(n: number | undefined): string {
  return n === undefined ? '' : `LIMIT ${Math.max(0, Math.trunc(n))}`;
}
