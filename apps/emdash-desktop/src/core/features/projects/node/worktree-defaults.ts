import { homedir } from 'node:os';
import path from 'node:path';

export const WORKTREE_POOL_DIR_NAME = 'worktrees';
// Ninebrains: never Emdash's `~/emdash` root, so the two apps cannot share worktrees.
export const LOCAL_WORKTREE_ROOT_DIR_NAME = 'ninebrains';

export function getDefaultLocalWorktreeDirectory(homeDirectory: string = homedir()): string {
  return path.join(homeDirectory, LOCAL_WORKTREE_ROOT_DIR_NAME, WORKTREE_POOL_DIR_NAME);
}
