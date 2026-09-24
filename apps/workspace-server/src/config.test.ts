import type { Result } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import {
  loadWorkspaceServerConfig,
  type WorkspaceServerConfig,
  type WorkspaceServerConfigError,
} from './config';

describe('loadWorkspaceServerConfig', () => {
  it('defaults to the serve command over stdio', () => {
    const config = expectLoaded(loadWorkspaceServerConfig([], {}));

    expect(config).toEqual({
      command: 'serve',
      appVersion: '0.0.0',
      serve: { kind: 'stdio' },
    });
  });

  it('preserves legacy socket serving args', () => {
    const config = expectLoaded(loadWorkspaceServerConfig(['--socket', '/tmp/workspace.sock'], {}));

    expect(config).toEqual({
      command: 'serve',
      appVersion: '0.0.0',
      serve: { kind: 'socket', path: '/tmp/workspace.sock' },
    });
  });

  it('defaults lifecycle commands to socket mode', () => {
    const config = expectLoaded(loadWorkspaceServerConfig(['start'], {}));

    expect(config).toEqual({
      command: 'start',
      appVersion: '0.0.0',
      serve: { kind: 'socket', path: undefined },
    });
  });

  it('parses the serve-cowork role into its four positional paths', () => {
    const config = expectLoaded(
      loadWorkspaceServerConfig(
        [
          'serve-cowork',
          '/srv/repos/project',
          '/srv/ninebrains-cowork/cowork.sock',
          '/srv/ninebrains-cowork/state',
          '/srv/ninebrains-cowork/token',
        ],
        {}
      )
    );

    expect(config).toEqual({
      command: 'serve-cowork',
      appVersion: '0.0.0',
      serve: { kind: 'socket', path: '/srv/ninebrains-cowork/cowork.sock' },
      cowork: {
        root: '/srv/repos/project',
        socketPath: '/srv/ninebrains-cowork/cowork.sock',
        stateDir: '/srv/ninebrains-cowork/state',
        tokenFile: '/srv/ninebrains-cowork/token',
      },
    });
  });

  it('rejects serve-cowork with missing positional paths', () => {
    const result = loadWorkspaceServerConfig(['serve-cowork', '/srv/repos/project'], {});

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'args',
        message: 'serve-cowork expects: <worktree-root> <socket-path> <state-dir> <token-file>',
      },
    });
  });

  it('rejects unknown commands', () => {
    const result = loadWorkspaceServerConfig(['restart'], {});

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'args',
        message: "Unknown command 'restart'",
      },
    });
  });

  it('rejects stdio for lifecycle commands', () => {
    const result = loadWorkspaceServerConfig(['status', '--stdio'], {});

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'args',
        message: 'status only supports socket mode',
      },
    });
  });
});

function expectLoaded(
  result: Result<WorkspaceServerConfig, WorkspaceServerConfigError>
): WorkspaceServerConfig {
  if (!result.success) throw new Error(`Expected config to load: ${String(result.error)}`);
  return result.data;
}
