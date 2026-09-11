import type {
  Address,
  AddressKind,
  DoneEntry,
  Job,
  JobEdge,
  JobState,
  Lane,
  LaneStatus,
  Message,
  Note,
  Provider,
  Run,
  RunMode,
} from '../../types';

/** Raw row as returned by the SQLite driver. */
export type Row = Record<string, unknown>;
export type Param = string | number | null;

const str = (v: unknown): string => v as string;
const strOrNull = (v: unknown): string | null => (v === null ? null : (v as string));
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null ? null : Number(v));
const json = <T>(v: unknown, fallback: T): T =>
  v === null ? fallback : (JSON.parse(v as string) as T);
const address = (kind: unknown, id: unknown): Address => ({
  kind: kind as AddressKind,
  id: str(id),
});

export const JOB_COLUMNS =
  'id, project_id, title, body, state, lane_id, attempts, gate_spec, hints, result, reason, created_by_kind, created_by_id, plan_id, plan_node_id, archived_at, created_at, updated_at';

export function toJob(r: Row): Job {
  return {
    id: str(r.id),
    projectId: str(r.project_id),
    title: str(r.title),
    body: str(r.body),
    state: r.state as JobState,
    laneId: strOrNull(r.lane_id),
    attempts: num(r.attempts),
    gateSpec: json(r.gate_spec, null),
    hints: json(r.hints, {}),
    result: json(r.result, null),
    reason: strOrNull(r.reason),
    createdBy: address(r.created_by_kind, r.created_by_id),
    planId: strOrNull(r.plan_id),
    planNodeId: strOrNull(r.plan_node_id),
    archivedAt: numOrNull(r.archived_at),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

export function jobParams(j: Job): Param[] {
  return [
    j.id,
    j.projectId,
    j.title,
    j.body,
    j.state,
    j.laneId,
    j.attempts,
    j.gateSpec === null ? null : JSON.stringify(j.gateSpec),
    JSON.stringify(j.hints),
    j.result === null ? null : JSON.stringify(j.result),
    j.reason,
    j.createdBy.kind,
    j.createdBy.id,
    j.planId,
    j.planNodeId,
    j.archivedAt,
    j.createdAt,
    j.updatedAt,
  ];
}

export function toEdge(r: Row): JobEdge {
  return {
    from: str(r.from_id),
    to: str(r.to_id),
    projectId: str(r.project_id),
    planId: strOrNull(r.plan_id),
    createdAt: num(r.created_at),
  };
}

export const MESSAGE_COLUMNS =
  'id, from_kind, from_id, to_kind, to_id, body, attachments, created_at, read_at';

export function toMessage(r: Row): Message {
  return {
    id: str(r.id),
    from: address(r.from_kind, r.from_id),
    to: address(r.to_kind, r.to_id),
    body: str(r.body),
    attachments: json(r.attachments, []),
    createdAt: num(r.created_at),
    readAt: numOrNull(r.read_at),
  };
}

export function messageParams(m: Message): Param[] {
  return [
    m.id,
    m.from.kind,
    m.from.id,
    m.to.kind,
    m.to.id,
    m.body,
    JSON.stringify(m.attachments),
    m.createdAt,
    m.readAt,
  ];
}

export function toRun(r: Row): Run {
  return {
    id: str(r.id),
    jobId: str(r.job_id),
    laneId: str(r.lane_id),
    mode: r.mode as RunMode,
    startedAt: num(r.started_at),
    endedAt: numOrNull(r.ended_at),
    exitCode: numOrNull(r.exit_code),
    transcriptPath: strOrNull(r.transcript_path),
  };
}

export const NOTE_COLUMNS = 'id, project_id, job_id, author_kind, author_id, body, created_at';

export function toNote(r: Row): Note {
  return {
    id: str(r.id),
    projectId: str(r.project_id),
    jobId: strOrNull(r.job_id),
    author: address(r.author_kind, r.author_id),
    body: str(r.body),
    createdAt: num(r.created_at),
  };
}

export function noteParams(n: Note): Param[] {
  return [n.id, n.projectId, n.jobId, n.author.kind, n.author.id, n.body, n.createdAt];
}

export function toDone(r: Row): DoneEntry {
  return {
    id: str(r.id),
    jobId: str(r.job_id),
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
    activeJobId: strOrNull(r.active_job_id),
    updatedAt: num(r.updated_at),
  };
}

/** `?, ?, ...` for a column list. */
export function placeholders(columns: string): string {
  return columns
    .split(', ')
    .map(() => '?')
    .join(', ');
}
