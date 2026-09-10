import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';
import type { BrainEvent, StoredBrainEvent } from '../../events';
import { NotFoundError } from '../../errors';
import type { DoneEntry, Edge, Lane, LaneId, Message, Note, ProjectId, Run, Task, TaskId } from '../../types';
import type { BrainStore, EdgeFilter, MessageFilter, RunFilter, TaskFilter } from '../store';
import { migrate } from './migrations';
import {
  type Row,
  TASK_COLUMNS,
  taskParams,
  toDone,
  toEdge,
  toLane,
  toMessage,
  toNote,
  toRun,
  toTask,
} from './rows';

export const DEFAULT_DB_FILENAME = 'brain.sqlite';

const requireBuiltin = createRequire(import.meta.url);

export interface SqliteBrainStoreOptions {
  /** How long a writer waits for another process's lock before failing. */
  busyTimeoutMs?: number;
}

/** A file path is used as-is; anything else is treated as a directory holding `brain.sqlite`. */
export function resolveBrainDbPath(dirOrFile: string): string {
  return /\.(sqlite3?|db)$/i.test(dirOrFile) ? dirOrFile : path.join(dirOrFile, DEFAULT_DB_FILENAME);
}

/**
 * SQLite-backed store on `node:sqlite` (built into Node >= 22.13 and
 * Electron >= 35; no native addon, so no ABI to match). Many processes may
 * open the same file: WAL lets readers run beside the single writer,
 * `busy_timeout` makes writers queue instead of failing, and every
 * transaction is `BEGIN IMMEDIATE`, so claim-style read-modify-write
 * sequences are serialized across processes.
 */
export class SqliteBrainStore implements BrainStore {
  readonly path: string;
  private readonly db: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private depth = 0;

  static open(dirOrFile: string, options: SqliteBrainStoreOptions = {}): SqliteBrainStore {
    const file = resolveBrainDbPath(dirOrFile);
    mkdirSync(path.dirname(file), { recursive: true });
    return new SqliteBrainStore(file, options);
  }

  private constructor(file: string, options: SqliteBrainStoreOptions) {
    const busyTimeoutMs = options.busyTimeoutMs ?? 10_000;
    this.path = file;
    // Loaded on first open, not at import: importing brain-core stays cheap and
    // side-effect free, and a host can filter node:sqlite's warning first.
    const { DatabaseSync: Database } = requireBuiltin('node:sqlite') as { DatabaseSync: typeof DatabaseSync };
    this.db = new Database(file, { timeout: busyTimeoutMs });
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`PRAGMA busy_timeout = ${Math.trunc(busyTimeoutMs)}`);
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    migrate(this.db);
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
    this.db.exec('BEGIN IMMEDIATE');
    this.depth = 1;
    try {
      const result = fn();
      if (result instanceof Promise) throw new TypeError('transaction callbacks must be synchronous');
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {}
      throw error;
    } finally {
      this.depth = 0;
    }
  }

  getTask(id: TaskId): Task | undefined {
    const row = this.get(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`, [id]);
    return row && toTask(row);
  }

  findTaskByPlanNode(planId: string, planNodeId: string): Task | undefined {
    const row = this.get(`SELECT ${TASK_COLUMNS} FROM tasks WHERE plan_id = ? AND plan_node_id = ?`, [
      planId,
      planNodeId,
    ]);
    return row && toTask(row);
  }

  listTasks(filter: TaskFilter = {}): Task[] {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.projectId !== undefined) add(where, params, 'project_id = ?', filter.projectId);
    if (filter.laneId !== undefined) add(where, params, 'lane_id = ?', filter.laneId);
    if (filter.planId !== undefined) add(where, params, 'plan_id = ?', filter.planId);
    if (filter.states !== undefined) {
      if (filter.states.length === 0) return [];
      where.push(`state IN (${filter.states.map(() => '?').join(', ')})`);
      params.push(...filter.states);
    }
    if (!filter.includeArchived) where.push('archived_at IS NULL');
    return this.all(
      `SELECT ${TASK_COLUMNS} FROM tasks ${clause(where)} ORDER BY created_at, rowid ${limit(filter.limit)}`,
      params
    ).map(toTask);
  }

  insertTask(task: Task): void {
    this.run(
      `INSERT INTO tasks (${TASK_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      taskParams(task)
    );
  }

  updateTask(task: Task): void {
    const [id, ...rest] = taskParams(task);
    const sets = TASK_COLUMNS.split(', ')
      .slice(1)
      .map((c) => `${c} = ?`)
      .join(', ');
    const result = this.run(`UPDATE tasks SET ${sets} WHERE id = ?`, [...rest, id!]);
    if (Number(result.changes) === 0) throw new NotFoundError('task', task.id);
  }

  listEdges(filter: EdgeFilter = {}): Edge[] {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.projectId !== undefined) add(where, params, 'project_id = ?', filter.projectId);
    if (filter.from !== undefined) add(where, params, 'from_id = ?', filter.from);
    if (filter.to !== undefined) add(where, params, 'to_id = ?', filter.to);
    if (filter.planId !== undefined) add(where, params, 'plan_id = ?', filter.planId);
    return this.all(`SELECT * FROM task_edges ${clause(where)} ORDER BY rowid`, params).map(toEdge);
  }

  insertEdge(edge: Edge): void {
    this.run(
      'INSERT OR IGNORE INTO task_edges (from_id, to_id, project_id, plan_id, created_at) VALUES (?, ?, ?, ?, ?)',
      [edge.from, edge.to, edge.projectId, edge.planId, edge.createdAt]
    );
  }

  deleteEdge(from: TaskId, to: TaskId): void {
    this.run('DELETE FROM task_edges WHERE from_id = ? AND to_id = ?', [from, to]);
  }

  insertMessage(m: Message): void {
    this.run(
      'INSERT INTO messages (id, from_addr, to_addr, body, attachments, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [m.id, m.from, m.to, m.body, JSON.stringify(m.attachments), m.createdAt, m.readAt]
    );
  }

  listMessages(filter: MessageFilter): Message[] {
    const unread = filter.unreadOnly ? 'AND read_at IS NULL' : '';
    return this.all(
      `SELECT * FROM messages WHERE to_addr = ? ${unread} ORDER BY seq ${limit(filter.limit)}`,
      [filter.to]
    ).map(toMessage);
  }

  markMessagesRead(ids: readonly string[], at: number): void {
    const mark = this.statement('UPDATE messages SET read_at = ? WHERE id = ? AND read_at IS NULL');
    for (const id of ids) mark.run(at, id);
  }

  insertRun(r: Run): void {
    this.run(
      'INSERT INTO runs (id, task_id, lane_id, mode, started_at, ended_at, exit_code, transcript_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [r.id, r.taskId, r.laneId, r.mode, r.startedAt, r.endedAt, r.exitCode, r.transcriptPath]
    );
  }

  updateRun(r: Run): void {
    const result = this.run(
      'UPDATE runs SET task_id = ?, lane_id = ?, mode = ?, started_at = ?, ended_at = ?, exit_code = ?, transcript_path = ? WHERE id = ?',
      [r.taskId, r.laneId, r.mode, r.startedAt, r.endedAt, r.exitCode, r.transcriptPath, r.id]
    );
    if (Number(result.changes) === 0) throw new NotFoundError('run', r.id);
  }

  getRun(id: string): Run | undefined {
    const row = this.get('SELECT * FROM runs WHERE id = ?', [id]);
    return row && toRun(row);
  }

  listRuns(filter: RunFilter = {}): Run[] {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.laneId !== undefined) add(where, params, 'lane_id = ?', filter.laneId);
    if (filter.taskId !== undefined) add(where, params, 'task_id = ?', filter.taskId);
    if (filter.since !== undefined) add(where, params, 'started_at >= ?', filter.since);
    return this.all(
      `SELECT * FROM runs ${clause(where)} ORDER BY started_at DESC, seq DESC ${limit(filter.limit)}`,
      params
    ).map(toRun);
  }

  insertNote(n: Note): void {
    this.run(
      'INSERT INTO notes (id, project_id, task_id, author, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [n.id, n.projectId, n.taskId, n.author, n.body, n.createdAt]
    );
  }

  listNotes(filter: { projectId?: ProjectId; taskId?: TaskId; limit?: number } = {}): Note[] {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.projectId !== undefined) add(where, params, 'project_id = ?', filter.projectId);
    if (filter.taskId !== undefined) add(where, params, 'task_id = ?', filter.taskId);
    return this.all(`SELECT * FROM notes ${clause(where)} ORDER BY seq ${limit(filter.limit)}`, params).map(
      toNote
    );
  }

  insertDone(d: DoneEntry): void {
    this.run(
      'INSERT INTO done_log (id, task_id, project_id, lane_id, summary, artifacts, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [d.id, d.taskId, d.projectId, d.laneId, d.summary, JSON.stringify(d.artifacts), d.at]
    );
  }

  listDone(filter: { projectId?: ProjectId; limit?: number } = {}): DoneEntry[] {
    const where = filter.projectId === undefined ? '' : 'WHERE project_id = ?';
    const params = filter.projectId === undefined ? [] : [filter.projectId];
    return this.all(`SELECT * FROM done_log ${where} ORDER BY seq ${limit(filter.limit)}`, params).map(toDone);
  }

  upsertLane(l: Lane): void {
    this.run(
      `INSERT INTO lanes (id, project_id, provider, status, recent_files, active_task_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET project_id = excluded.project_id, provider = excluded.provider,
         status = excluded.status, recent_files = excluded.recent_files,
         active_task_id = excluded.active_task_id, updated_at = excluded.updated_at`,
      [l.id, l.projectId, l.provider, l.status, JSON.stringify(l.recentFiles), l.activeTaskId, l.updatedAt]
    );
  }

  getLane(id: LaneId): Lane | undefined {
    const row = this.get('SELECT * FROM lanes WHERE id = ?', [id]);
    return row && toLane(row);
  }

  listLanes(filter: { projectId?: ProjectId } = {}): Lane[] {
    const where = filter.projectId === undefined ? '' : 'WHERE project_id = ?';
    const params = filter.projectId === undefined ? [] : [filter.projectId];
    return this.all(`SELECT * FROM lanes ${where} ORDER BY rowid`, params).map(toLane);
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
    return this.all('SELECT * FROM event_log WHERE seq > ? ORDER BY seq LIMIT ?', [afterSeq, max]).map(
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
    this.statements.clear();
    if (this.db.isOpen) this.db.close();
  }

  private statement(sql: string): StatementSync {
    let stmt = this.statements.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.statements.set(sql, stmt);
    }
    return stmt;
  }

  private get(sql: string, params: SQLInputValue[]): Row | undefined {
    return this.statement(sql).get(...params) as Row | undefined;
  }

  private all(sql: string, params: SQLInputValue[]): Row[] {
    return this.statement(sql).all(...params) as Row[];
  }

  private run(sql: string, params: SQLInputValue[]) {
    return this.statement(sql).run(...params);
  }
}

function clause(where: string[]): string {
  return where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`;
}

function limit(n: number | undefined): string {
  return n === undefined ? '' : `LIMIT ${Math.max(0, Math.trunc(n))}`;
}

function add(where: string[], params: SQLInputValue[], condition: string, value: SQLInputValue): void {
  where.push(condition);
  params.push(value);
}
