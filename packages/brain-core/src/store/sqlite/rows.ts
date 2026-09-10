import type {
  Address,
  DoneEntry,
  Edge,
  Lane,
  Message,
  Note,
  Provider,
  Run,
  RunMode,
  Task,
  TaskState,
  LaneStatus,
} from '../../types';

/** Raw row as returned by node:sqlite. */
export type Row = Record<string, unknown>;

const str = (v: unknown): string => v as string;
const strOrNull = (v: unknown): string | null => (v === null ? null : (v as string));
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null ? null : Number(v));
const json = <T>(v: unknown, fallback: T): T => (v === null ? fallback : (JSON.parse(v as string) as T));

export function toTask(r: Row): Task {
  return {
    id: str(r.id),
    projectId: str(r.project_id),
    title: str(r.title),
    body: str(r.body),
    state: r.state as TaskState,
    laneId: strOrNull(r.lane_id),
    attempts: num(r.attempts),
    gateSpec: json(r.gate_spec, null),
    hints: json(r.hints, {}),
    result: json(r.result, null),
    reason: strOrNull(r.reason),
    createdBy: r.created_by as Address,
    planId: strOrNull(r.plan_id),
    planNodeId: strOrNull(r.plan_node_id),
    archivedAt: numOrNull(r.archived_at),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

export function taskParams(t: Task): Array<string | number | null> {
  return [
    t.id,
    t.projectId,
    t.title,
    t.body,
    t.state,
    t.laneId,
    t.attempts,
    t.gateSpec === null ? null : JSON.stringify(t.gateSpec),
    JSON.stringify(t.hints),
    t.result === null ? null : JSON.stringify(t.result),
    t.reason,
    t.createdBy,
    t.planId,
    t.planNodeId,
    t.archivedAt,
    t.createdAt,
    t.updatedAt,
  ];
}

export const TASK_COLUMNS =
  'id, project_id, title, body, state, lane_id, attempts, gate_spec, hints, result, reason, created_by, plan_id, plan_node_id, archived_at, created_at, updated_at';

export function toEdge(r: Row): Edge {
  return {
    from: str(r.from_id),
    to: str(r.to_id),
    projectId: str(r.project_id),
    planId: strOrNull(r.plan_id),
    createdAt: num(r.created_at),
  };
}

export function toMessage(r: Row): Message {
  return {
    id: str(r.id),
    from: r.from_addr as Address,
    to: r.to_addr as Address,
    body: str(r.body),
    attachments: json(r.attachments, []),
    createdAt: num(r.created_at),
    readAt: numOrNull(r.read_at),
  };
}

export function toRun(r: Row): Run {
  return {
    id: str(r.id),
    taskId: str(r.task_id),
    laneId: str(r.lane_id),
    mode: r.mode as RunMode,
    startedAt: num(r.started_at),
    endedAt: numOrNull(r.ended_at),
    exitCode: numOrNull(r.exit_code),
    transcriptPath: strOrNull(r.transcript_path),
  };
}

export function toNote(r: Row): Note {
  return {
    id: str(r.id),
    projectId: str(r.project_id),
    taskId: strOrNull(r.task_id),
    author: r.author as Address,
    body: str(r.body),
    createdAt: num(r.created_at),
  };
}

export function toDone(r: Row): DoneEntry {
  return {
    id: str(r.id),
    taskId: str(r.task_id),
    projectId: str(r.project_id),
    laneId: strOrNull(r.lane_id),
    summary: str(r.summary),
    artifacts: json(r.artifacts, []),
    at: num(r.at),
  };
}

export function toLane(r: Row): Lane {
  return {
    id: str(r.id),
    projectId: str(r.project_id),
    provider: r.provider as Provider,
    status: r.status as LaneStatus,
    recentFiles: json(r.recent_files, []),
    activeTaskId: strOrNull(r.active_task_id),
    updatedAt: num(r.updated_at),
  };
}
