import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createReadWorktreeFile } from './read-worktree-file';

let root: string;
let worktree: string;
const signal = new AbortController().signal;
const SECRET = '-----BEGIN OPENSSH PRIVATE KEY----- very secret key material';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nb-read-wt-'));
  worktree = join(root, 'worktree');
  await mkdir(join(worktree, 'docs'), { recursive: true });
  await mkdir(join(root, 'home', '.ssh'), { recursive: true });
  await writeFile(join(root, 'home', '.ssh', 'id_ed25519'), SECRET);
  await writeFile(join(worktree, 'docs', 'claims.json'), '{"claims":[]}');
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('SEC-23 symlinked claims.json refused', () => {
  it('reads a regular file inside the worktree', async () => {
    const read = createReadWorktreeFile(worktree);
    expect(await read('docs/claims.json', { signal })).toBe('{"claims":[]}');
  });

  it('refuses a symlink that leaves the worktree, without echoing its content', async () => {
    await symlink(join(root, 'home', '.ssh', 'id_ed25519'), join(worktree, 'claims.json'));
    const read = createReadWorktreeFile(worktree);
    const error = (await read('claims.json', { signal }).then(
      () => undefined,
      (e: unknown) => e
    )) as Error;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('outside the worktree');
    expect(error.message).not.toContain('PRIVATE KEY');
  });

  it('refuses absolute paths and ../ traversal', async () => {
    const read = createReadWorktreeFile(worktree);
    await expect(read(join(root, 'home', '.ssh', 'id_ed25519'), { signal })).rejects.toThrow(
      'relative'
    );
    await expect(read('../home/.ssh/id_ed25519', { signal })).rejects.toThrow('outside');
  });

  it('refuses a symlinked directory that leaves the worktree', async () => {
    await symlink(join(root, 'home'), join(worktree, 'home-link'));
    const read = createReadWorktreeFile(worktree);
    await expect(read('home-link/.ssh/id_ed25519', { signal })).rejects.toThrow('outside');
  });

  it('allows a symlink that stays inside the worktree', async () => {
    await symlink(join(worktree, 'docs', 'claims.json'), join(worktree, 'claims.json'));
    const read = createReadWorktreeFile(worktree);
    expect(await read('claims.json', { signal })).toBe('{"claims":[]}');
  });

  it('refuses directories and oversized files', async () => {
    await writeFile(join(worktree, 'big.json'), 'x'.repeat(64));
    const read = createReadWorktreeFile(worktree, { maxBytes: 16 });
    await expect(read('docs', { signal })).rejects.toThrow('not a file');
    await expect(read('big.json', { signal })).rejects.toThrow('larger than 16 bytes');
  });
});
