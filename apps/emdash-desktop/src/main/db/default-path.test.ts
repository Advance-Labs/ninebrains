import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDefaultLocalWorktreeDirectory } from '@core/features/projects/node/worktree-defaults';
import { USER_DATA_DIR_NAME } from '@core/primitives/app-identity/api/app-identity';
import { builtInWorktreeRootFor } from '@core/primitives/project-settings/api/worktree-root';
import { workspaceServerLayout } from '@core/services/hosts/node/workspace-server/layout';
import { defaultDbFilePath, resolveDefaultUserDataPath } from './default-path';

// Ninebrains must never share state with an installed Emdash (docs/UPSTREAM-PATCHES.md).
describe('Ninebrains state locations', () => {
  it('resolves the default userData and database directory under ninebrains, not emdash', () => {
    const userData = resolveDefaultUserDataPath();
    expect(path.basename(userData)).toBe('ninebrains');
    const dbDirectory = path.dirname(defaultDbFilePath(userData));
    expect(dbDirectory).toContain('ninebrains');
    expect(dbDirectory).not.toMatch(/emdash/i);
  });

  it('names the Electron userData directory after Ninebrains', () => {
    expect(USER_DATA_DIR_NAME).toMatch(/^ninebrains/);
    expect(USER_DATA_DIR_NAME).not.toMatch(/emdash/i);
  });

  it('keeps worktrees and the remote workspace server under ninebrains roots', () => {
    expect(getDefaultLocalWorktreeDirectory('/home/dev')).toBe('/home/dev/ninebrains/worktrees');
    expect(builtInWorktreeRootFor('/home/dev')).toBe('/home/dev/ninebrains/worktrees');
    expect(workspaceServerLayout('/home/dev').currentLauncher).toContain(
      '/home/dev/.ninebrains/workspace-server/'
    );
  });
});
