import type { JobSummary, Lane } from '@ninebrains/brain-core';

/**
 * The activity feed, derived by diffing successive polls of the Brain.
 *
 * ponytail: the endpoint has no event op yet, so a change that starts and ends between two polls
 * is never seen. A `read_events` op (protocol change, SEC review) can replace the diff later.
 */

export type FeedTone = 'ok' | 'go' | 'warn' | 'fail' | 'info';

export interface FeedEntry {
  tone: FeedTone;
  kind: 'job' | 'lane' | 'brain' | 'you';
  text: string;
}

export interface FeedEvent extends FeedEntry {
  id: number;
  at: number;
}

export interface Snapshot {
  jobs: JobSummary[];
  lanes: Lane[];
  paused: boolean;
  stopLatched: boolean;
}

export const TONE_GLYPH: Record<FeedTone, string> = {
  ok: '✓',
  go: '▸',
  warn: '⚠',
  fail: '✗',
  info: '·',
};

const JOB_TONE: Record<string, FeedTone> = {
  proposed: 'info',
  ready: 'info',
  claimed: 'go',
  running: 'go',
  verifying: 'go',
  done: 'ok',
  blocked: 'warn',
  failed: 'fail',
};

/** Held by a lane: claimed, running, or waiting on its gates. */
export function isActive(job: Pick<JobSummary, 'state'>): boolean {
  return job.state === 'claimed' || job.state === 'running' || job.state === 'verifying';
}

/** A lane's display name. Lanes have no names in the Brain, so provider plus a short id. */
export function laneLabel(lane: Pick<Lane, 'id' | 'provider'>): string {
  return `${lane.provider}-${lane.id.slice(0, 4)}`;
}

function jobLine(job: JobSummary, lanes: Map<string, Lane>): string {
  const lane = job.laneId ? lanes.get(job.laneId) : undefined;
  const where = lane ? ` → ${laneLabel(lane)}` : '';
  const why = job.reason ? `: ${job.reason}` : '';
  return `${job.title}  ${job.state}${where}${why}`;
}

/** What changed between two polls, oldest first. The first poll has no history to diff. */
export function diffSnapshots(prev: Snapshot | null, next: Snapshot): FeedEntry[] {
  if (!prev) return [];
  const out: FeedEntry[] = [];
  const lanes = new Map(next.lanes.map((lane) => [lane.id, lane]));

  if (prev.stopLatched !== next.stopLatched) {
    out.push(
      next.stopLatched
        ? { tone: 'fail', kind: 'brain', text: 'STOP latched: runs killed, dispatch halted' }
        : { tone: 'ok', kind: 'brain', text: 'STOP cleared' }
    );
  }
  if (prev.paused !== next.paused) {
    out.push({
      tone: 'info',
      kind: 'brain',
      text: next.paused ? 'dispatch paused' : 'dispatch resumed',
    });
  }

  const before = new Map(prev.jobs.map((job) => [job.id, job]));
  for (const job of next.jobs) {
    const old = before.get(job.id);
    if (old?.state === job.state && old.laneId === job.laneId) continue;
    out.push({
      tone: old ? (JOB_TONE[job.state] ?? 'info') : 'info',
      kind: 'job',
      text: old ? jobLine(job, lanes) : `${job.title}  created (${job.state})`,
    });
  }

  const lanesBefore = new Map(prev.lanes.map((lane) => [lane.id, lane]));
  for (const lane of next.lanes) {
    const old = lanesBefore.get(lane.id);
    if (old?.status === lane.status) continue;
    out.push({
      tone: lane.status === 'blocked' ? 'warn' : 'info',
      kind: 'lane',
      text: old
        ? `${laneLabel(lane)}  ${old.status} → ${lane.status}`
        : `${laneLabel(lane)}  joined (${lane.status})`,
    });
  }
  return out;
}

/** Why ready jobs are not moving, or null when nothing is holding them. */
export function dispatchHint(snapshot: Snapshot): string | null {
  if (!snapshot.jobs.some((job) => job.state === 'ready')) return null;
  if (snapshot.stopLatched) return 'STOP is latched: /clear-stop, then /resume';
  if (snapshot.paused) return 'dispatch is paused: /resume';
  if (snapshot.lanes.some((lane) => lane.status === 'idle')) return null;
  if (snapshot.lanes.length === 0) return 'no lanes: add one in the Lanes grid';
  const asleep = snapshot.lanes.filter((lane) => lane.status === 'asleep').length;
  return asleep === snapshot.lanes.length
    ? 'no live lane: every lane is asleep, add or wake one in the Lanes grid'
    : 'no idle lane: ready jobs wait for one to finish';
}
