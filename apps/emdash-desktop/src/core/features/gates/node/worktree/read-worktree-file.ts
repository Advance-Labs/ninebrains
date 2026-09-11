/**
 * `readWorktreeFile` (SEC-23). The fact-check gate reads `claims.json` through
 * it, and a lane controls that file, so a lane could make it a symlink to
 * `~/.ssh/id_ed25519` and hope the content comes back in gate feedback.
 *
 * - The path must be relative and resolve inside the worktree's realpath.
 * - Symlinks are followed, and the target's realpath must still be inside.
 * - The file is opened with O_NOFOLLOW and re-checked with fstat, so a swap
 *   between the check and the read can't redirect it.
 * - Regular files only, at most 5 MB. Errors never include file content.
 */
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { ReadWorktreeFile } from '@emdash/gates-core';

export const MAX_WORKTREE_READ_BYTES = 5 * 1024 * 1024;

const isInside = (root: string, target: string) => {
  const rel = relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

export class WorktreeReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorktreeReadError';
  }
}

export function createReadWorktreeFile(
  worktreePath: string,
  options: { maxBytes?: number } = {}
): ReadWorktreeFile {
  const maxBytes = options.maxBytes ?? MAX_WORKTREE_READ_BYTES;
  return async (relativePath, { signal }) => {
    signal.throwIfAborted();
    if (relativePath.length === 0 || relativePath.includes('\0') || isAbsolute(relativePath)) {
      throw new WorktreeReadError('refused: the path must be relative to the worktree');
    }
    const root = await realpath(worktreePath);
    const target = resolve(root, relativePath);
    if (!isInside(root, target)) {
      throw new WorktreeReadError(`refused: ${relativePath} is outside the worktree`);
    }
    let real: string;
    try {
      real = await realpath(target);
    } catch {
      throw new WorktreeReadError(`${relativePath} does not exist in the worktree`);
    }
    if (!isInside(root, real)) {
      throw new WorktreeReadError(`refused: ${relativePath} resolves outside the worktree`);
    }
    const handle = await open(real, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) throw new WorktreeReadError(`refused: ${relativePath} is not a file`);
      if (stats.size > maxBytes) {
        throw new WorktreeReadError(`refused: ${relativePath} is larger than ${maxBytes} bytes`);
      }
      signal.throwIfAborted();
      const buffer = await handle.readFile();
      if (buffer.byteLength > maxBytes) {
        throw new WorktreeReadError(`refused: ${relativePath} is larger than ${maxBytes} bytes`);
      }
      return buffer.toString('utf8');
    } finally {
      await handle.close();
    }
  };
}
