import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  lstat,
  open,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import * as Y from 'yjs';
import { MAX_DOCUMENT_BYTES } from './protocol';

export class CoworkError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

type Document = {
  path: string;
  diskHash: string;
  ydoc: Y.Doc;
  revision: number;
  queue: Promise<void>;
};

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Owns collaborative text for one canonical worktree root. */
export class CoworkDocuments {
  private readonly documents = new Map<string, Document>();
  private readonly loading = new Map<string, Promise<Document>>();

  private constructor(
    readonly root: string,
    private readonly stateDir: string,
    private readonly maxRecordBytes: number
  ) {}

  static async open(
    root: string,
    stateDir: string,
    maxRecordBytes = MAX_DOCUMENT_BYTES * 4
  ): Promise<CoworkDocuments> {
    const canonicalRoot = await realpath(root);
    const rootStat = await lstat(canonicalRoot);
    if (!rootStat.isDirectory()) throw new CoworkError('invalid-root', 'Root must be a directory');
    const canonicalState = await realpath(stateDir);
    const stateStat = await lstat(canonicalState);
    if (
      !stateStat.isDirectory() ||
      (stateStat.mode & 0o077) !== 0 ||
      (process.getuid && stateStat.uid !== process.getuid())
    ) {
      throw new CoworkError(
        'invalid-state',
        'State directory must be private to the server account'
      );
    }
    if (canonicalState === canonicalRoot || inside(canonicalRoot, canonicalState)) {
      throw new CoworkError('invalid-state', 'State directory must be outside the worktree');
    }
    return new CoworkDocuments(canonicalRoot, canonicalState, maxRecordBytes);
  }

  private async canonicalPath(input: string): Promise<string> {
    if (isAbsolute(input) || input.includes('\0')) {
      throw new CoworkError('invalid-path', 'Use a relative file path');
    }
    const lexical = resolve(this.root, input);
    if (!inside(this.root, lexical)) throw new CoworkError('invalid-path', 'Path leaves worktree');
    let canonical: string;
    try {
      canonical = await realpath(lexical);
    } catch {
      throw new CoworkError('missing-file', 'File does not exist');
    }
    if (!inside(this.root, canonical)) {
      throw new CoworkError('invalid-path', 'File resolves outside worktree');
    }
    const stat = await lstat(canonical);
    if (!stat.isFile()) throw new CoworkError('invalid-path', 'Path must name a regular file');
    await access(canonical, constants.R_OK | constants.W_OK);
    return canonical;
  }

  private statePath(path: string): string {
    return resolve(this.stateDir, `${sha256(path)}.json`);
  }

  private async persist(doc: Document, ydoc: Y.Doc, diskHash = doc.diskHash): Promise<void> {
    const output = this.statePath(doc.path);
    const temporary = `${output}.${randomUUID()}.tmp`;
    const encode = (update: Uint8Array) =>
      JSON.stringify({ diskHash, update: Buffer.from(update).toString('base64') });
    let record = encode(Y.encodeStateAsUpdate(ydoc));
    if (Buffer.byteLength(record) > this.maxRecordBytes) {
      // Yjs keeps tombstones forever. The persisted copy is only read when no peer
      // is attached, so it can drop history without touching what connected peers
      // hold: re-encode the current text as a fresh doc. The resident doc keeps its
      // history, so live sessions stay consistent.
      const fresh = new Y.Doc();
      fresh.getText('content').insert(0, ydoc.getText('content').toString());
      record = encode(Y.encodeStateAsUpdate(fresh));
      fresh.destroy();
      if (Buffer.byteLength(record) > this.maxRecordBytes) {
        throw new CoworkError('too-large', 'Shared document is too large');
      }
    }
    try {
      await writeFile(temporary, record, { mode: 0o600 });
      await rename(temporary, output);
    } catch (error) {
      throw new CoworkError('state-write-failed', String(error));
    }
  }

  /**
   * Resolve a client path to its canonical identity without loading the document.
   * Authorization checks need the identity only, and must not make a document
   * resident: a peer that never joins it would never release it either.
   */
  async canonicalize(input: string): Promise<string> {
    return this.canonicalPath(input);
  }

  /** The worktree-relative name every peer uses to refer to a document. */
  relativeName(canonical: string): string {
    return relative(this.root, canonical);
  }

  async join(path: string): Promise<{ update: Uint8Array; revision: number; path: string }> {
    const doc = await this.get(path);
    return { update: Y.encodeStateAsUpdate(doc.ydoc), revision: doc.revision, path: doc.path };
  }

  async release(path: string): Promise<void> {
    const doc = this.documents.get(path);
    if (!doc) return;
    await doc.queue;
    if (this.documents.get(path) !== doc) return;
    this.documents.delete(path);
    doc.ydoc.destroy();
  }

  async update(path: string, bytes: Uint8Array): Promise<{ revision: number; path: string }> {
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
      throw new CoworkError('too-large', 'Document update is too large');
    }
    const doc = await this.get(path);
    return this.serial(doc, async () => {
      const next = new Y.Doc();
      Y.applyUpdate(next, Y.encodeStateAsUpdate(doc.ydoc));
      try {
        Y.applyUpdate(next, bytes);
      } catch {
        throw new CoworkError('invalid-update', 'Invalid document update');
      }
      if (Buffer.byteLength(next.getText('content').toString(), 'utf8') > MAX_DOCUMENT_BYTES) {
        throw new CoworkError('too-large', 'Document is too large');
      }
      await this.persist(doc, next);
      doc.ydoc.destroy();
      doc.ydoc = next;
      doc.revision += 1;
      return { revision: doc.revision, path: doc.path };
    });
  }

  async save(path: string): Promise<{ revision: number; path: string; content: string }> {
    const doc = await this.get(path);
    return this.serial(doc, async () => {
      // Existing agents and editors do not honor our lock. This check detects
      // outside writes already visible before Save begins; the final read narrows
      // the race but cannot provide an atomic CAS over an arbitrary file writer.
      const content = doc.ydoc.getText('content').toString();
      if (Buffer.byteLength(content, 'utf8') > MAX_DOCUMENT_BYTES) {
        throw new CoworkError('too-large', 'Document is too large');
      }
      const before = await lstat(doc.path);
      if (!before.isFile() || (await realpath(doc.path)) !== doc.path) {
        throw new CoworkError('external-change', 'File path changed outside the shared editor');
      }
      const dir = dirname(doc.path);
      // doc.path is a canonical realpath of a regular file, so renaming over it
      // replaces that file and never a symlink. A hard-linked file would silently
      // lose its other links, so it is refused rather than rewritten.
      if (before.nlink > 1) {
        throw new CoworkError('unsupported-file', 'Hard-linked files cannot be saved safely');
      }
      const current = await readFile(doc.path);
      if (sha256(current) !== doc.diskHash) {
        throw new CoworkError('external-change', 'File changed outside the shared editor');
      }
      const temporary = join(dir, `.${basename(doc.path)}.${randomUUID()}.cowork-tmp`);
      try {
        const file = await open(temporary, 'wx', before.mode & 0o7777);
        try {
          await file.writeFile(content);
          await file.chmod(before.mode & 0o7777);
          // Keep the group so a group-shared worktree stays shared; best effort.
          await file.chown(before.uid, before.gid).catch(() => {});
          await file.sync();
        } finally {
          await file.close();
        }
        // Re-verify immediately before the swap. This narrows, not closes, the race
        // with an outside writer (SEC-50).
        const after = await lstat(doc.path);
        if (
          !after.isFile() ||
          after.dev !== before.dev ||
          after.ino !== before.ino ||
          (await realpath(dir)) !== dir ||
          sha256(await readFile(doc.path)) !== doc.diskHash
        ) {
          throw new CoworkError('external-change', 'File changed outside the shared editor');
        }
        await rename(temporary, doc.path);
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
      const directory = await open(dir, constants.O_RDONLY).catch(() => undefined);
      await directory?.sync().catch(() => {});
      await directory?.close();
      doc.diskHash = sha256(content);
      await this.persist(doc, doc.ydoc);
      return { revision: doc.revision, path: doc.path, content };
    });
  }

  private async get(input: string): Promise<Document> {
    const path = await this.canonicalPath(input);
    const existing = this.documents.get(path);
    if (existing) return existing;
    const pending = this.loading.get(path);
    if (pending) return pending;
    const load = this.load(path);
    this.loading.set(path, load);
    try {
      return await load;
    } finally {
      this.loading.delete(path);
    }
  }

  private async load(path: string): Promise<Document> {
    if (this.documents.size >= 128) {
      throw new CoworkError('too-many-documents', 'Too many shared documents are open');
    }
    const disk = await readFile(path);
    if (disk.byteLength > MAX_DOCUMENT_BYTES || disk.includes(0)) {
      throw new CoworkError('unsupported-file', 'Only small UTF-8 text files can be shared');
    }
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(disk);
    const ydoc = new Y.Doc();
    const stateFile = this.statePath(path);
    try {
      const raw = JSON.parse(await readFile(stateFile, 'utf8')) as {
        diskHash?: unknown;
        update?: unknown;
      };
      if (typeof raw.diskHash !== 'string' || typeof raw.update !== 'string') {
        throw new Error('Invalid document state');
      }
      if (raw.diskHash !== sha256(disk)) {
        // No peer is attached while a document loads, so nobody holds unsaved text
        // that this would discard. Disk wins; keeping the stale state would make
        // every join fail until someone deleted it by hand.
        process.stderr.write(`[cowork] ${path} changed on disk; discarding persisted state\n`);
        ydoc.getText('content').insert(0, text);
      } else {
        Y.applyUpdate(ydoc, Buffer.from(raw.update, 'base64'));
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new CoworkError('state-read-failed', `Cannot read shared document state: ${error}`);
      }
      ydoc.getText('content').insert(0, text);
    }
    const doc: Document = {
      path,
      diskHash: sha256(disk),
      ydoc,
      revision: 0,
      queue: Promise.resolve(),
    };
    this.documents.set(path, doc);
    return doc;
  }

  private async serial<T>(doc: Document, action: () => Promise<T>): Promise<T> {
    const run = doc.queue.then(action);
    doc.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}
