/**
 * Filesystem evidence store: `<root>/<taskId>/<attempt>/`.
 *
 * Evidence file names come from gates, and gates relay text from agents, so a
 * name is treated as a suggestion: reduced to a basename, stripped to a safe
 * alphabet, de-duplicated, and resolved with a containment check. Task ids come
 * from the app and are validated rather than sanitised — a malformed id is a
 * bug worth surfacing. The root is compared by realpath, so a symlinked task
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

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
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
  taskId: string;
  attempt: number;
}

export class FsEvidenceStore implements EvidenceStore {
  private readonly entries: Evidence[] = [];
  private readonly manifest: ManifestEntry[] = [];
  private readonly taken = new Set<string>([MANIFEST]);
  private writing: Promise<void> = Promise.resolve();

  private constructor(
    readonly dir: string,
    private readonly taskId: string,
    private readonly attempt: number
  ) {}

  static async open({ root, taskId, attempt }: OpenEvidenceStoreOptions): Promise<FsEvidenceStore> {
    if (!TASK_ID.test(taskId) || taskId.includes('..')) {
      throw new EvidencePathError(`invalid task id for evidence path: ${JSON.stringify(taskId)}`);
    }
    if (!Number.isInteger(attempt) || attempt < 1) {
      throw new EvidencePathError(`attempt must be a positive integer, got ${attempt}`);
    }
    await mkdir(root, { recursive: true });
    const realRoot = await realpath(root);
    // Check the task directory before creating anything beneath it, so a
    // symlinked task directory is refused without writing through it.
    const taskDir = resolveInside(realRoot, taskId);
    await mkdir(taskDir, { recursive: true });
    const realTaskDir = await realpath(taskDir);
    if (!isInside(realRoot, realTaskDir)) {
      throw new EvidencePathError(`task directory resolves outside the root: ${realTaskDir}`);
    }
    const dir = resolveInside(realTaskDir, String(attempt));
    await mkdir(dir, { recursive: true });
    return new FsEvidenceStore(dir, taskId, attempt);
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
    const file = this.claimName(input.fileName);
    const target = resolveInside(this.dir, file);
    const data = typeof input.data === 'string' ? Buffer.from(input.data, 'utf8') : input.data;
    // 'wx' refuses to follow or clobber anything already at the path.
    await writeFile(target, data, { flag: 'wx' });

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
      { taskId: this.taskId, attempt: this.attempt, evidence: this.manifest },
      null,
      2
    );
    const next = this.writing.then(() => writeFile(path.join(this.dir, MANIFEST), body));
    this.writing = next.catch(() => undefined);
    return next;
  }
}
