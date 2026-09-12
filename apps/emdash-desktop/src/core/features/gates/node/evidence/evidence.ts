/**
 * Evidence storage hygiene (SEC-24) on top of gates-core's `FsEvidenceStore`.
 *
 * - Root `<userData>/ninebrains/evidence`, never inside a worktree.
 * - Directories 0700 (so other OS users can't even traverse them), files 0600.
 * - Every text artifact goes through the SEC-35 redactor before it is written.
 * - Retention sweep, per-job delete, and a per-attempt `verdict.json` that the
 *   runner writes before it records the verdict, so a crash in between replays
 *   the verdict instead of re-running the gates (SEAMS §3.11 idempotency).
 */
import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  FsEvidenceStore,
  resolveInside,
  safeFileName,
  type EvidenceStore,
} from '@emdash/gates-core';
import { assertId } from '@ninebrains/brain-core';
import {
  attemptVerdictSchema,
  evidenceManifestSchema,
  type AttemptHistory,
  type AttemptVerdict,
} from '../../api/verification';

export const VERDICT_FILE = 'verdict.json';
export const MANIFEST_FILE = 'manifest.json';
export const MAX_EVIDENCE_READ_BYTES = 10 * 1024 * 1024;

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.json': 'application/json',
  '.log': 'text/plain',
  '.txt': 'text/plain',
  '.diff': 'text/plain',
  '.md': 'text/markdown',
};

async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: DIR_MODE });
  await chmod(dir, DIR_MODE);
}

function attemptDir(root: string, jobId: string, attempt: number): string {
  assertId('jobId', jobId); // SEC-14: stricter than FsEvidenceStore's own check (no '.' or ':').
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError(`bad attempt ${attempt}`);
  return resolveInside(root, jobId, String(attempt));
}

export interface OpenAttemptEvidenceOptions {
  root: string;
  jobId: string;
  attempt: number;
  redact: (text: string) => string;
}

/** Opens `<root>/<jobId>/<attempt>/` with private modes and redaction on every text write. */
export async function openAttemptEvidence(
  options: OpenAttemptEvidenceOptions
): Promise<EvidenceStore> {
  const { root, jobId, attempt, redact } = options;
  const dir = attemptDir(root, jobId, attempt);
  await ensurePrivateDir(root);
  await ensurePrivateDir(resolveInside(root, jobId));
  await ensurePrivateDir(dir);
  const inner = await FsEvidenceStore.open({ root, jobId, attempt });
  return {
    dir: inner.dir,
    list: () => inner.list(),
    async put(input) {
      const data = typeof input.data === 'string' ? redact(input.data) : input.data;
      const evidence = await inner.put({ ...input, data });
      await chmod(evidence.path, FILE_MODE);
      await chmod(join(inner.dir, MANIFEST_FILE), FILE_MODE).catch(() => undefined);
      return evidence;
    },
  };
}

/**
 * Written atomically, before the verdict is recorded in the Brain. Each write
 * uses its own temp file, so two runners racing on one attempt can't clobber
 * each other's rename; the Brain's attempt check decides which verdict counts.
 */
export async function writeVerdict(dir: string, verdict: AttemptVerdict): Promise<void> {
  const target = join(dir, VERDICT_FILE);
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(verdict, null, 2), { mode: FILE_MODE });
  await rename(temp, target);
}

export async function readVerdict(
  root: string,
  jobId: string,
  attempt: number
): Promise<AttemptVerdict | undefined> {
  try {
    const raw = await readFile(join(attemptDir(root, jobId, attempt), VERDICT_FILE), 'utf8');
    const parsed = attemptVerdictSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Every attempt on disk for a job, oldest first. Missing or malformed files read as absent. */
export async function readJobHistory(root: string, jobId: string): Promise<AttemptHistory[]> {
  assertId('jobId', jobId);
  let names: string[];
  try {
    names = await readdir(resolveInside(root, jobId));
  } catch {
    return [];
  }
  const attempts = names
    .filter((name) => /^[1-9][0-9]{0,3}$/.test(name))
    .map(Number)
    .sort((a, b) => a - b);
  return Promise.all(
    attempts.map(async (attempt) => {
      const dir = attemptDir(root, jobId, attempt);
      const manifest = evidenceManifestSchema.safeParse(await readJson(join(dir, MANIFEST_FILE)));
      const verdict = attemptVerdictSchema.safeParse(await readJson(join(dir, VERDICT_FILE)));
      return {
        attempt,
        evidence: manifest.success ? manifest.data.evidence : [],
        verdict: verdict.success ? verdict.data : null,
      };
    })
  );
}

/** Reads one stored evidence file for the UI. Only known types, regular files, capped size. */
export async function readEvidenceFile(
  root: string,
  jobId: string,
  attempt: number,
  file: string
): Promise<{ mime: string; data: Buffer }> {
  if (safeFileName(file) !== file) throw new Error('refused: not an evidence file name');
  const mime = MIME[extname(file).toLowerCase()];
  if (!mime || file === VERDICT_FILE) throw new Error('refused: unsupported evidence type');
  const path = resolveInside(attemptDir(root, jobId, attempt), file);
  const stats = await lstat(path);
  if (!stats.isFile()) throw new Error('refused: not a regular file');
  if (stats.size > MAX_EVIDENCE_READ_BYTES) throw new Error('refused: evidence file too large');
  return { mime, data: await readFile(path) };
}

/** The per-job "delete evidence" action (SEC-24). */
export async function deleteJobEvidence(root: string, jobId: string): Promise<void> {
  assertId('jobId', jobId);
  await rm(resolveInside(root, jobId), { recursive: true, force: true });
}

/** Deletes job directories whose newest attempt is older than `maxAgeMs`. Returns their ids. */
export async function sweepEvidence(
  root: string,
  options: { maxAgeMs: number; now?: number }
): Promise<string[]> {
  const cutoff = (options.now ?? Date.now()) - options.maxAgeMs;
  let jobs: string[];
  try {
    jobs = await readdir(root);
  } catch {
    return [];
  }
  const deleted: string[] = [];
  for (const jobId of jobs) {
    let jobDir: string;
    try {
      assertId('jobId', jobId);
      jobDir = resolveInside(root, jobId);
    } catch {
      continue;
    }
    const entries = await readdir(jobDir).catch(() => [] as string[]);
    const times = await Promise.all(
      [jobDir, ...entries.map((e) => join(jobDir, e))].map((p) =>
        stat(p).then(
          (s) => s.mtimeMs,
          () => 0
        )
      )
    );
    if (Math.max(...times) < cutoff) {
      await rm(jobDir, { recursive: true, force: true });
      deleted.push(jobId);
    }
  }
  return deleted;
}
