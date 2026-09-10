import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EvidencePathError, FsEvidenceStore, resolveInside, safeFileName } from './evidence-store';

let tmp: string;
let root: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'gates-evidence-'));
  root = path.join(tmp, 'evidence');
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('FsEvidenceStore', () => {
  it('writes files under <root>/<jobId>/<attempt>/ with a JSON manifest', async () => {
    const store = await FsEvidenceStore.open({ root, jobId: 'job-42', attempt: 2 });
    const evidence = await store.put({
      kind: 'log',
      label: 'Test log',
      fileName: 'tests.log',
      data: 'ok\n',
    });

    expect(store.dir.endsWith(path.join('job-42', '2'))).toBe(true);
    expect(evidence).toEqual({
      kind: 'log',
      label: 'Test log',
      path: path.join(store.dir, 'tests.log'),
    });
    expect(await readFile(evidence.path, 'utf8')).toBe('ok\n');

    const manifest = JSON.parse(await readFile(path.join(store.dir, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({
      jobId: 'job-42',
      attempt: 2,
      evidence: [{ kind: 'log', label: 'Test log', file: 'tests.log', bytes: 3 }],
    });
  });

  it('keeps traversal attempts in file names inside the attempt directory', async () => {
    const store = await FsEvidenceStore.open({ root, jobId: 't', attempt: 1 });
    const a = await store.put({
      kind: 'text',
      label: 'x',
      fileName: '../../../etc/passwd',
      data: 'x',
    });
    const b = await store.put({ kind: 'text', label: 'x', fileName: '..\\..\\win.ini', data: 'x' });
    expect(path.dirname(a.path)).toBe(store.dir);
    expect(path.basename(a.path)).toBe('passwd');
    expect(path.dirname(b.path)).toBe(store.dir);
    expect(await readdir(path.join(root, '..'))).toEqual(['evidence']);
  });

  it('re-opening an attempt after a crash keeps old files and writes beside them', async () => {
    const crashed = await FsEvidenceStore.open({ root, jobId: 'j', attempt: 1 });
    const old = await crashed.put({ kind: 'log', label: 'old', fileName: 'tests.log', data: 'a' });
    const rerun = await FsEvidenceStore.open({ root, jobId: 'j', attempt: 1 });
    const fresh = await rerun.put({ kind: 'log', label: 'new', fileName: 'tests.log', data: 'b' });
    expect(path.basename(fresh.path)).toBe('tests-1.log');
    expect(await readFile(old.path, 'utf8')).toBe('a');
    expect(await readFile(fresh.path, 'utf8')).toBe('b');
  });

  it('de-duplicates names and never overwrites the manifest', async () => {
    const store = await FsEvidenceStore.open({ root, jobId: 't', attempt: 1 });
    const one = await store.put({ kind: 'json', label: 'a', fileName: 'report.json', data: '{}' });
    const two = await store.put({ kind: 'json', label: 'b', fileName: 'report.json', data: '{}' });
    const three = await store.put({
      kind: 'json',
      label: 'c',
      fileName: 'manifest.json',
      data: '{}',
    });
    expect([one, two, three].map((e) => path.basename(e.path))).toEqual([
      'report.json',
      'report-1.json',
      'manifest-1.json',
    ]);
    expect(store.list()).toHaveLength(3);
  });

  it('rejects job ids that could escape the root', async () => {
    for (const jobId of ['../escape', 'a/b', '..', '.hidden', '', 'a..b']) {
      await expect(FsEvidenceStore.open({ root, jobId, attempt: 1 })).rejects.toThrow(
        EvidencePathError
      );
    }
  });

  it('rejects a non-positive or fractional attempt', async () => {
    await expect(FsEvidenceStore.open({ root, jobId: 't', attempt: 0 })).rejects.toThrow(
      EvidencePathError
    );
    await expect(FsEvidenceStore.open({ root, jobId: 't', attempt: 1.5 })).rejects.toThrow(
      EvidencePathError
    );
  });

  it('refuses a job directory that is a symlink out of the root', async () => {
    const outside = path.join(tmp, 'outside');
    await mkdir(outside);
    await mkdir(root, { recursive: true });
    await symlink(outside, path.join(root, 'job-link'), 'dir');
    await expect(FsEvidenceStore.open({ root, jobId: 'job-link', attempt: 1 })).rejects.toThrow(
      /outside the root/
    );
    expect(await readdir(outside)).toEqual([]);
  });
});

describe('resolveInside', () => {
  it('resolves nested paths and rejects anything outside the root', () => {
    expect(resolveInside('/r', 'a', 'b.txt')).toBe(path.resolve('/r/a/b.txt'));
    expect(resolveInside('/r', '..foo')).toBe(path.resolve('/r/..foo'));
    expect(() => resolveInside('/r', '../x')).toThrow(EvidencePathError);
    expect(() => resolveInside('/r', 'a/../../x')).toThrow(EvidencePathError);
    expect(() => resolveInside('/r', '/etc/passwd')).toThrow(EvidencePathError);
    expect(() => resolveInside('/r', '.')).toThrow(EvidencePathError);
  });
});

describe('safeFileName', () => {
  it('reduces untrusted names to a safe basename', () => {
    expect(safeFileName('shot 1440.png')).toBe('shot_1440.png');
    expect(safeFileName('../../x')).toBe('x');
    expect(safeFileName('...')).toBe('evidence');
    expect(safeFileName(`${'a'.repeat(300)}.png`)).toMatch(/^a{96}\.png$/);
  });
});
