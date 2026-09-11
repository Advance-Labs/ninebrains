import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRedactor } from '@core/features/exec-runs/api/node/redact';
import type { AttemptVerdict } from '../../api/verification';
import {
  deleteJobEvidence,
  openAttemptEvidence,
  readEvidenceFile,
  readJobHistory,
  readVerdict,
  sweepEvidence,
  writeVerdict,
} from './evidence';

let base: string;
let root: string;
const PAT = 'ghp_0123456789abcdefghijklmnopqrstuvwxyzAB';
const LIVE_TOKEN = 'nb-live-token-value-1234567890';
const redact = createRedactor([LIVE_TOKEN]);
const mode = async (path: string) => (await stat(path)).mode & 0o777;

function verdict(jobId: string, attempt: number): AttemptVerdict {
  return {
    version: 1,
    jobId,
    attempt,
    jobUpdatedAt: 5,
    status: 'failed',
    decision: 'retry',
    feedback: 'fix it',
    gateIds: ['tests'],
    gates: [],
    skipped: [],
    at: 10,
  };
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'nb-evidence-'));
  root = join(base, 'ninebrains', 'evidence');
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('SEC-24 evidence retention and redaction', () => {
  it('creates private directories and files', async () => {
    const store = await openAttemptEvidence({ root, jobId: 'job1', attempt: 1, redact });
    const log = await store.put({ kind: 'log', label: 'log', fileName: 'tests.log', data: 'ok' });
    const png = await store.put({
      kind: 'screenshot',
      label: 'shot',
      fileName: 'shot.png',
      data: Uint8Array.from([1, 2, 3]),
    });
    expect(await mode(root)).toBe(0o700);
    expect(await mode(join(root, 'job1'))).toBe(0o700);
    expect(await mode(store.dir)).toBe(0o700);
    expect(await mode(log.path)).toBe(0o600);
    expect(await mode(png.path)).toBe(0o600);
    expect(await mode(join(store.dir, 'manifest.json'))).toBe(0o600);
  });

  it('redacts every text artifact before it is written, and leaves binaries alone', async () => {
    const store = await openAttemptEvidence({ root, jobId: 'job1', attempt: 1, redact });
    const log = await store.put({
      kind: 'log',
      label: 'log',
      fileName: 'tests.log',
      data: `GITHUB_TOKEN=${PAT}\nNINEBRAINS_TOKEN=${LIVE_TOKEN}\n`,
    });
    const text = await readFile(log.path, 'utf8');
    expect(text).not.toContain(PAT);
    expect(text).not.toContain(LIVE_TOKEN);
    const bytes = Uint8Array.from(Buffer.from(PAT));
    const bin = await store.put({ kind: 'screenshot', label: 'b', fileName: 'b.png', data: bytes });
    expect(await readFile(bin.path)).toEqual(Buffer.from(PAT));
  });

  it('deletes job directories older than the retention period, keeping recent ones', async () => {
    for (const jobId of ['old', 'recent']) {
      const store = await openAttemptEvidence({ root, jobId, attempt: 1, redact });
      await store.put({ kind: 'log', label: 'l', fileName: 'a.log', data: jobId });
    }
    const now = Date.now();
    const old = new Date(now - 40 * 86_400_000);
    for (const path of [join(root, 'old', '1', 'a.log'), join(root, 'old', '1'), join(root, 'old')])
      await utimes(path, old, old);

    const deleted = await sweepEvidence(root, { maxAgeMs: 30 * 86_400_000, now });

    expect(deleted).toEqual(['old']);
    expect(await readJobHistory(root, 'old')).toEqual([]);
    expect(await readJobHistory(root, 'recent')).toHaveLength(1);
  });

  it('deletes one job on request', async () => {
    const store = await openAttemptEvidence({ root, jobId: 'job1', attempt: 2, redact });
    await store.put({ kind: 'log', label: 'l', fileName: 'a.log', data: 'x' });
    await deleteJobEvidence(root, 'job1');
    expect(await readJobHistory(root, 'job1')).toEqual([]);
  });

  it('SEC-14: job ids that could traverse or name a stream are refused', async () => {
    for (const jobId of ['..', '.', 'a:b', 'a/b', 'a.b', 'x'.repeat(65)]) {
      await expect(openAttemptEvidence({ root, jobId, attempt: 1, redact })).rejects.toThrow();
      await expect(deleteJobEvidence(root, jobId)).rejects.toThrow();
    }
  });
});

describe('evidence reads for the UI', () => {
  it('reads the history: manifest and verdict per attempt, oldest first', async () => {
    for (const attempt of [2, 1]) {
      const store = await openAttemptEvidence({ root, jobId: 'job1', attempt, redact });
      await store.put({ kind: 'log', label: `l${attempt}`, fileName: 'a.log', data: 'x' });
      await writeVerdict(store.dir, verdict('job1', attempt));
    }
    const history = await readJobHistory(root, 'job1');
    expect(history.map((h) => [h.attempt, h.evidence[0]?.label, h.verdict?.decision])).toEqual([
      [1, 'l1', 'retry'],
      [2, 'l2', 'retry'],
    ]);
    expect(await readVerdict(root, 'job1', 1)).toEqual(verdict('job1', 1));
  });

  it('treats a malformed verdict as absent', async () => {
    const store = await openAttemptEvidence({ root, jobId: 'job1', attempt: 1, redact });
    await writeFile(join(store.dir, 'verdict.json'), '{"pass": true}');
    expect(await readVerdict(root, 'job1', 1)).toBeUndefined();
  });

  it('serves stored files by name with a mime type, and refuses anything else', async () => {
    const store = await openAttemptEvidence({ root, jobId: 'job1', attempt: 1, redact });
    await store.put({
      kind: 'screenshot',
      label: 's',
      fileName: 'shot.png',
      data: Uint8Array.of(9),
    });
    await writeVerdict(store.dir, verdict('job1', 1));
    await expect(readEvidenceFile(root, 'job1', 1, 'shot.png')).resolves.toMatchObject({
      mime: 'image/png',
    });
    await expect(readEvidenceFile(root, 'job1', 1, '../../x.png')).rejects.toThrow('refused');
    await expect(readEvidenceFile(root, 'job1', 1, 'verdict.json')).rejects.toThrow('refused');
    await expect(readEvidenceFile(root, 'job1', 1, 'run.sh')).rejects.toThrow('refused');
  });
});
