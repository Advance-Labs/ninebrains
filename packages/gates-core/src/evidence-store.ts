/**
 * Filesystem evidence store: `<root>/<jobId>/<attempt>/`.
 *
 * Evidence file names come from gates, and gates relay text from agents, so a
 * name is treated as a suggestion: reduced to a basename, stripped to a safe
 * alphabet, de-duplicated, and resolved with a containment check. Job ids come
 * from the app and are validated rather than sanitised — a malformed id is a
 * bug worth surfacing. The root is compared by realpath, so a symlinked job
 * directory cannot redirect writes outside it.
 */

import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Evidence, EvidenceInput, EvidenceStore } from './types';

export class EvidencePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidencePathError';
  }
}

const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MANIFEST = 'manifest.json';
const MAX_NAME = 100;

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
}

export class FsEvidenceStore implements EvidenceStore {
  private readonly entries: Evidence[] = [];
  private readonly manifest: ManifestEntry[] = [];
  private readonly taken = new Set<string>([MANIFEST]);
  private writing: Promise<void> = Promise.resolve();

  private constructor(
    readonly dir: string,
    private readonly jobId: string,
    private readonly attempt: number
  ) {}

  static async open({ root, jobId, attempt }: OpenEvidenceStoreOptions): Promise<FsEvidenceStore> {
    if (!JOB_ID.test(jobId) || jobId.includes('..')) {
      throw new EvidencePathError(`invalid job id for evidence path: ${JSON.stringify(jobId)}`);
    }
    if (!Number.isInteger(attempt) || attempt < 1) {
      throw new EvidencePathError(`attempt must be a positive integer, got ${attempt}`);
    }
    await mkdir(root, { recursive: true });
    const realRoot = await realpath(root);
    // Check the job directory before creating anything beneath it, so a
    // symlinked job directory is refused without writing through it.
    const jobDir = resolveInside(realRoot, jobId);
    await mkdir(jobDir, { recursive: true });
    const realJobDir = await realpath(jobDir);
    if (!isInside(realRoot, realJobDir)) {
      throw new EvidencePathError(`job directory resolves outside the root: ${realJobDir}`);
    }
    const dir = resolveInside(realJobDir, String(attempt));
    await mkdir(dir, { recursive: true });
    return new FsEvidenceStore(dir, jobId, attempt);
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

  async put(input: EvidenceInput): Promise<Evidence> {
    const data = typeof input.data === 'string' ? Buffer.from(input.data, 'utf8') : input.data;
    let file: string;
    let target: string;
    for (;;) {
      file = this.claimName(input.fileName);
      target = resolveInside(this.dir, file);
      try {
        // 'wx' refuses to follow or clobber anything already at the path.
        await writeFile(target, data, { flag: 'wx' });
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
    const next = this.writing.then(() => writeFile(path.join(this.dir, MANIFEST), body));
    this.writing = next.catch(() => undefined);
    return next;
  }
}
