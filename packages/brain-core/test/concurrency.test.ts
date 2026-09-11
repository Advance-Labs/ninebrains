import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Brain } from '../src/brain/brain';
import { SqliteBrainStore } from '../src/store/sqlite/sqlite-store';
import { BRAIN, tempDir } from './helpers';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const worker = path.join(packageDir, 'test', 'claim-worker.ts');

function runWorker(args: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', worker, ...args], {
      cwd: packageDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const line = out.trim().split('\n').pop();
      if (code !== 0 || !line) reject(new Error(`worker exited ${code}: ${err}`));
      else resolve(JSON.parse(line) as Record<string, unknown>);
    });
  });
}

/** Starts workers, waits until all are parked at the barrier, then releases them together. */
async function race(barrierDir: string, lanes: string[], argsFor: (lane: string) => string[]) {
  mkdirSync(barrierDir, { recursive: true });
  const results = Promise.all(lanes.map((lane) => runWorker(argsFor(lane))));
  const deadline = Date.now() + 20_000;
  while (!lanes.every((lane) => existsSync(path.join(barrierDir, `ready-${lane}`)))) {
    if (Date.now() > deadline) throw new Error('workers never reached the barrier');
    await new Promise((r) => setTimeout(r, 10));
  }
  writeFileSync(path.join(barrierDir, 'go'), '');
  return results;
}

describe('multi-process claims on one SQLite file', () => {
  it('exactly one of several processes racing for the same job wins', async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, 'brain.sqlite');
    const setup = new Brain({ store: SqliteBrainStore.open(dbPath) });
    const job = setup.createJob(BRAIN, { projectId: 'p1', title: 'contested' });
    setup.close();

    const lanes = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
    const results = await race(path.join(dir, 'barrier'), lanes, (lane) => [
      dbPath,
      lane,
      path.join(dir, 'barrier'),
      'race',
      job.id,
    ]);

    const winners = results.filter((r) => r.ok === true);
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => r.ok === false).map((r) => r.code)).toEqual(
      Array(5).fill('ILLEGAL_TRANSITION')
    );

    const check = new Brain({ store: SqliteBrainStore.open(dbPath) });
    expect(check.getJob(BRAIN, job.id)).toMatchObject({
      state: 'claimed',
      laneId: winners[0]!.laneId,
    });
    check.close();
  }, 60_000);

  it('several processes draining a queue claim every job exactly once', async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, 'brain.sqlite');
    const setup = new Brain({ store: SqliteBrainStore.open(dbPath) });
    const ids = Array.from(
      { length: 40 },
      (_, i) => setup.createJob(BRAIN, { projectId: 'p1', title: `t${i}` }).id
    );
    setup.close();

    const lanes = ['D1', 'D2', 'D3', 'D4'];
    const results = await race(path.join(dir, 'barrier'), lanes, (lane) => [
      dbPath,
      lane,
      path.join(dir, 'barrier'),
      'drain',
    ]);

    const claimedBy = new Map<string, string>();
    for (const result of results) {
      for (const id of result.claimed as string[]) {
        expect(claimedBy.has(id), `job ${id} claimed twice`).toBe(false);
        claimedBy.set(id, result.laneId as string);
      }
    }
    expect([...claimedBy.keys()].sort()).toEqual([...ids].sort());

    const check = new Brain({ store: SqliteBrainStore.open(dbPath) });
    for (const t of check.listJobs(BRAIN)) {
      expect(t).toMatchObject({ state: 'claimed', laneId: claimedBy.get(t.id) });
    }
    // Every claim is also in the durable event log, visible to other processes.
    const claims = check
      .readEvents(0, 10_000)
      .filter((e) => e.type === 'jobChanged' && e.payload.job.state === 'claimed');
    expect(claims).toHaveLength(40);
    check.close();
  }, 60_000);
});
