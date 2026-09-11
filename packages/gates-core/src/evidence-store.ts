/**
 * Filesystem evidence store: `<root>/<jobId>/<attempt>/`.
 *
 * Evidence file names come from gates, and gates relay text from agents, so a
 * name is treated as a suggestion: reduced to a basename, stripped to a safe
 * alphabet, de-duplicated, and resolved with a containment check. Job ids come
 * from the app and are validated rather than sanitised — a malformed id is a
 * bug worth surfacing. The root is compared by realpath, so a symlinked job
 * directory cannot redirect writes outside it.
 *
 * SEC-24: directories are 0700 and files 0600, job ids follow the shared SEC-14
 * rule, and every non-screenshot artifact passes through the redactor first.
 */

import { chmod, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createEvidenceRedactor, type EvidenceRedactor } from './evidence-redact';
import type { Evidence, EvidenceInput, EvidenceStore } from './types';

export class EvidencePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidencePathError';
  }
}

/** SEC-14: the shared path-segment rule (no `.`, `..` or `:`). */
const JOB_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MANIFEST = 'manifest.json';
const MAX_NAME = 100;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

function isInside(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/** Resolve `segments` under `root`, throwing if the result escapes it. */
export function resolveInside(root: string, ...segments: string[]): string {
  const base = path.resolve(root);
  const target = path.resolve(base, ...segments);
  if (!isInside(base, target)) {
    throw new EvidencePathError(`path escapes evidence root: ${segments.join('/')}`);
  }
  return target;
}

/** Reduce an untrusted name to a safe basename. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  let safe = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '');
  if (safe.length > MAX_NAME) {
    const ext = path.extname(safe).slice(0, 16);
    safe = safe.slice(0, MAX_NAME - ext.length) + ext;
  }
  return safe.length === 0 ? 'evidence' : safe;
}

/** Creates `dir` (and parents) and makes it private even if it already existed. */
async function privateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: DIR_MODE });
  await chmod(dir, DIR_MODE);
}

interface ManifestEntry {
  kind: Evidence['kind'];
  label: string;
  file: string;
  bytes: number;
  createdAt: string;
}

export interface OpenEvidenceStoreOptions {
  root: string;
  jobId: string;
  attempt: number;
  /** Literal values to redact from text evidence: live Ninebrains tokens, pack secrets. */
  secrets?: Iterable<string>;
}

export class FsEvidenceStore implements EvidenceStore {
  private readonly entries: Evidence[] = [];
  private readonly manifest: ManifestEntry[] = [];
  private readonly taken = new Set<string>([MANIFEST]);
  private writing: Promise<void> = Promise.resolve();

  private constructor(
    readonly dir: string,
    private readonly jobId: string,
    private readonly attempt: number,
    private readonly redact: EvidenceRedactor
  ) {}

  static async open({
    root,
    jobId,
    attempt,
    secrets,
  }: OpenEvidenceStoreOptions): Promise<FsEvidenceStore> {
    if (!JOB_ID.test(jobId)) {
      throw new EvidencePathError(`invalid job id for evidence path: ${JSON.stringify(jobId)}`);
    }
    if (!Number.isInteger(attempt) || attempt < 1) {
      throw new EvidencePathError(`attempt must be a positive integer, got ${attempt}`);
    }
    await privateDir(root);
    const realRoot = await realpath(root);
    // Check the job directory before creating anything beneath it, so a
    // symlinked job directory is refused without writing through it.
    const jobDir = resolveInside(realRoot, jobId);
    await mkdir(jobDir, { recursive: true, mode: DIR_MODE });
    const realJobDir = await realpath(jobDir);
    if (!isInside(realRoot, realJobDir)) {
      throw new EvidencePathError(`job directory resolves outside the root: ${realJobDir}`);
    }
    await chmod(realJobDir, DIR_MODE);
    const dir = resolveInside(realJobDir, String(attempt));
    await privateDir(dir);
    return new FsEvidenceStore(dir, jobId, attempt, createEvidenceRedactor(secrets));
  }

  private claimName(requested: string): string {
    const safe = safeFileName(requested);
    if (!this.taken.has(safe)) {
      this.taken.add(safe);
      return safe;
    }
    const ext = path.extname(safe);
    const stem = safe.slice(0, safe.length - ext.length);
    for (let i = 1; ; i += 1) {
      const candidate = `${stem}-${i}${ext}`;
      if (!this.taken.has(candidate)) {
        this.taken.add(candidate);
        return candidate;
      }
    }
  }

  /** Screenshots are stored as-is; every text artifact is redacted first. */
  private encode(input: EvidenceInput): Uint8Array {
    if (input.kind === 'screenshot') {
      return typeof input.data === 'string' ? Buffer.from(input.data, 'utf8') : input.data;
    }
    const text =
      typeof input.data === 'string' ? input.data : Buffer.from(input.data).toString('utf8');
    return Buffer.from(this.redact(text), 'utf8');
  }

  async put(input: EvidenceInput): Promise<Evidence> {
    const data = this.encode(input);
    let file: string;
    let target: string;
    for (;;) {
      file = this.claimName(input.fileName);
      target = resolveInside(this.dir, file);
      try {
        // 'wx' refuses to follow or clobber anything already at the path.
        await writeFile(target, data, { flag: 'wx', mode: FILE_MODE });
        break;
      } catch (error) {
        // A file left by a crashed run of the same attempt: keep it, take the next name.
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }

    const evidence: Evidence = { kind: input.kind, path: target, label: input.label };
    this.entries.push(evidence);
    this.manifest.push({
      kind: input.kind,
      label: input.label,
      file,
      bytes: data.byteLength,
      createdAt: new Date().toISOString(),
    });
    await this.flushManifest();
    return evidence;
  }

  list(): Evidence[] {
    return [...this.entries];
  }

  private flushManifest(): Promise<void> {
    const body = JSON.stringify(
      { jobId: this.jobId, attempt: this.attempt, evidence: this.manifest },
      null,
      2
    );
    const manifest = path.join(this.dir, MANIFEST);
    const next = this.writing.then(() => writeFile(manifest, body, { mode: FILE_MODE }));
    this.writing = next.catch(() => undefined);
    return next;
  }
}
