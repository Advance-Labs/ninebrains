/**
 * Child process for concurrency.test.ts. Opens its own SqliteBrainStore on
 * the shared file, waits at a file barrier so every worker starts together,
 * then claims jobs as its lane.
 *
 * argv: <dbPath> <laneId> <barrierDir> <mode: race|drain> [jobId]
 * stdout: one JSON line with the result.
 */
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Brain } from '../src/brain/brain';
import { isBrainError } from '../src/errors';
import { SqliteBrainStore } from '../src/store/sqlite/sqlite-store';

const [dbPath, laneId, barrierDir, mode, jobId] = process.argv.slice(2) as [
  string,
  string,
  string,
  string,
  string?,
];
const lane = { role: 'lane', laneId, projectId: 'p1' } as const;
const brain = new Brain({ store: SqliteBrainStore.open(dbPath, { busyTimeoutMs: 30_000 }) });

const sleeper = new Int32Array(new SharedArrayBuffer(4));
writeFileSync(path.join(barrierDir, `ready-${laneId}`), '');
const deadline = Date.now() + 20_000;
while (!existsSync(path.join(barrierDir, 'go'))) {
  if (Date.now() > deadline) throw new Error('barrier timeout');
  Atomics.wait(sleeper, 0, 0, 2);
}

function tryClaim(id: string): { ok: true } | { ok: false; code: string } {
  try {
    brain.claimJob(lane, id);
    return { ok: true };
  } catch (error) {
    if (isBrainError(error)) return { ok: false, code: error.code };
    throw error;
  }
}

if (mode === 'race') {
  process.stdout.write(`${JSON.stringify({ laneId, ...tryClaim(jobId!) })}\n`);
} else {
  const claimed: string[] = [];
  for (;;) {
    const ready = brain.listJobs(lane, { states: ['ready'] });
    if (ready.length === 0) break;
    for (const job of ready) if (tryClaim(job.id).ok) claimed.push(job.id);
  }
  process.stdout.write(`${JSON.stringify({ laneId, claimed })}\n`);
}
brain.close();
