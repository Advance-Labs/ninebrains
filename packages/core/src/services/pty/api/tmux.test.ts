import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '#primitives/exec/api';
// oxlint-disable-next-line emdash/core-module-boundaries -- regression exercises the real execution-error adapter behind IExecutionContext; production PTY code imports only the primitive
import { createBoundExec } from '#services/exec/api/bound-exec';
// oxlint-disable-next-line emdash/core-module-boundaries -- tests distinguish wrapped execution errors from raw execFile errors at the same primitive boundary
import { ExecError } from '#services/exec/api/types';
import {
  listTmuxSessionActivity,
  parseTmuxSessionActivity,
  resolveTmuxSession,
  tmuxIdentityActivityKey,
} from './tmux';
import { buildTmuxShellLine, DEFAULT_TMUX_HISTORY_LIMIT } from './tmux-commands';
import {
  decodeLegacyTmuxSessionName,
  makeLegacyTmuxSessionName,
  makeTmuxSessionName,
} from './tmux-identity';
import { tmuxArgs } from './tmux-socket';

const TMUX_AVAILABLE = spawnSync('tmux', ['-V']).status === 0;

describe('tmux session naming', () => {
  it('creates deterministic readable names while preserving the legacy codec', () => {
    const identity = 'project:task:terminal';
    const name = makeTmuxSessionName(identity, 'Fix login.flow: now');

    expect(name).toBe(makeTmuxSessionName(identity, 'Fix login.flow: now'));
    expect(name).not.toBe(makeTmuxSessionName('other:task:terminal', 'Fix login.flow: now'));
    expect(name).toMatch(/^fix-login-flow-now-[a-f0-9]{10}$/);
    expect(makeTmuxSessionName(identity, ':...:')).toMatch(/^session-[a-f0-9]{10}$/);

    const legacyName = makeLegacyTmuxSessionName(identity);
    expect(decodeLegacyTmuxSessionName(legacyName)).toBe(identity);
    expect(decodeLegacyTmuxSessionName(name)).toBeNull();
  });

  it('keeps the hash suffix when a long label is truncated', () => {
    const identity = 'project:task:terminal';
    const short = makeTmuxSessionName(identity, 'short');
    const long = makeTmuxSessionName(identity, 'x'.repeat(200));

    expect(long.length).toBeLessThanOrEqual(48);
    expect(long.slice(-10)).toBe(short.slice(-10));
  });

  it('keeps readable Unicode while stripping tmux separators', () => {
    expect(makeTmuxSessionName('identity', 'Über café.日本: ready')).toMatch(
      /^über-café-日本-ready-[a-f0-9]{10}$/u
    );
  });
});

describe('resolveTmuxSession', () => {
  it('prefers metadata so a renamed session remains attachable', async () => {
    const identity = 'project:task:terminal';
    const encoded = Buffer.from(JSON.stringify({ version: 1, identity }), 'utf8').toString(
      'base64url'
    );
    const exec = vi.fn(async () => ({
      stdout: `renamed\t42\tv1:${encoded}\n`,
      stderr: '',
    }));

    await expect(
      resolveTmuxSession(stubExecContext(exec), { identity, label: 'new-label' })
    ).resolves.toEqual({
      name: 'renamed',
      exists: true,
      writeIdentity: true,
      serverState: 'running',
      serverPid: null,
    });
  });

  it('falls back to the exact legacy name without backfilling metadata', async () => {
    const identity = 'project:task:terminal';
    const legacyName = makeLegacyTmuxSessionName(identity);
    const exec = vi.fn(async () => ({
      stdout: `${legacyName}\t42\t\n${legacyName}-sibling\t43\t\n`,
      stderr: '',
    }));

    await expect(
      resolveTmuxSession(stubExecContext(exec), { identity, label: 'workspace' })
    ).resolves.toEqual({
      name: legacyName,
      exists: true,
      writeIdentity: false,
      serverState: 'running',
      serverPid: null,
    });
  });
});

describe('buildTmuxShellLine', () => {
  it('uses exact targets and POSIX quoting', () => {
    const line = buildTmuxShellLine('workspace-$12', 'printf "$HOME"', 'project:task:leaf');

    expect(line).toContain('has-session -t');
    expect(line).toContain('attach-session -t');
    expect(line).toContain('new-session -d -s');
    expect(line).toContain('=workspace-$12');
    expect(line).not.toContain('"workspace-$12"');
  });

  it('configures the embedded session and hides tmux chrome from the pane', () => {
    const line = buildTmuxShellLine('workspace', 'sleep 1', 'project:task:leaf');

    expect(line).toContain('mouse on');
    expect(line).toContain('history-limit');
    // The status line is tmux naming itself inside a pane the user opened to see an agent.
    expect(line).toContain('status off');
  });

  it("runs every tmux command on the app's own socket, never the user's default server", () => {
    const line = buildTmuxShellLine('workspace-abc', 'agent run', 'project:task:terminal');

    // Every verb in the line is socket-scoped; a bare `tmux ` would address the default
    // server, which is the shared-blast-radius bug this socket exists to end.
    for (const verb of ['has-session', 'new-session', 'set-option', 'attach-session']) {
      expect(line).toContain(`tmux -L ninebrains`);
      expect(line).not.toMatch(new RegExp(`(?<!-L ninebrains )(?<!\\w)tmux ${verb}`, 'u'));
    }
  });

  it('applies the requested scrollback limit, and a sane default when none is given', () => {
    expect(buildTmuxShellLine('w', 'cmd', undefined, 500)).toContain('history-limit 500');
    expect(buildTmuxShellLine('w', 'cmd')).toContain(`history-limit ${DEFAULT_TMUX_HISTORY_LIMIT}`);
  });

  it('clamps a limit tmux could not parse, so the option cannot silently fail', () => {
    // The value lands in the shell line as a bare word under `|| true`, so a NaN would
    // configure nothing and say nothing.
    expect(buildTmuxShellLine('w', 'cmd', undefined, Number.NaN)).toContain(
      `history-limit ${DEFAULT_TMUX_HISTORY_LIMIT}`
    );
    expect(buildTmuxShellLine('w', 'cmd', undefined, -5)).toContain('history-limit 0');
    expect(buildTmuxShellLine('w', 'cmd', undefined, 12.7)).toContain('history-limit 12');
  });

  it.skipIf(!TMUX_AVAILABLE)(
    'creates metadata-backed sessions and reattaches legacy sessions without replacing them',
    async () => {
      const cwd = await mkdtemp('/tmp/emdash-tmux-');
      const env = { ...process.env, TMUX_TMPDIR: cwd };
      const shell = createBoundExec({ file: '/bin/sh', cwd, env });
      const tmux = createBoundExec({ file: 'tmux', cwd, env });
      const ctx = stubExecContext((_file, args) => tmux.exec(args ?? []));
      const identity = 'project:task:terminal';

      try {
        const created = await resolveTmuxSession(ctx, { identity, label: 'Fix login' });
        await shell
          .exec(['-c', buildTmuxShellLine(created.name, 'sleep 30', identity)])
          .catch(() => {});

        await expect(
          resolveTmuxSession(ctx, { identity, label: 'renamed-workspace' })
        ).resolves.toMatchObject({ name: created.name, exists: true });
        await tmux.exec(tmuxArgs(['rename-session', '-t', `=${created.name}`, 'manually-renamed']));
        await expect(
          resolveTmuxSession(ctx, { identity, label: 'renamed-workspace' })
        ).resolves.toMatchObject({ name: 'manually-renamed', exists: true });
        await tmux.exec(tmuxArgs(['kill-session', '-t', '=manually-renamed']));

        const legacyName = makeLegacyTmuxSessionName(identity);
        await tmux.exec(tmuxArgs(['new-session', '-d', '-s', legacyName, 'sleep 30']));
        const before = await tmux.exec(
          tmuxArgs(['display-message', '-p', '-t', `=${legacyName}`, '#{pane_pid}'])
        );
        const legacy = await resolveTmuxSession(ctx, { identity, label: 'Fix login' });
        await shell.exec(['-c', buildTmuxShellLine(legacy.name, 'exit 99')]).catch(() => {});
        const after = await tmux.exec(
          tmuxArgs(['display-message', '-p', '-t', `=${legacyName}`, '#{pane_pid}'])
        );
        const sessions = await tmux.exec(tmuxArgs(['list-sessions', '-F', '#{session_name}']));

        // serverPid is the live server's pid, so match identity rather than exact shape.
        expect(legacy).toMatchObject({
          name: legacyName,
          exists: true,
          writeIdentity: false,
          serverState: 'running',
        });
        expect(after.stdout).toBe(before.stdout);
        expect(sessions.stdout.trim().split('\n')).toEqual([legacyName]);

        await tmux.exec(tmuxArgs(['kill-session', '-t', `=${legacyName}`]));
        const prefixIdentity = 'project:task:prefix-target';
        const prefixName = makeTmuxSessionName(prefixIdentity, 'prefix');
        await tmux.exec(tmuxArgs(['new-session', '-d', '-s', `${prefixName}-sibling`, 'sleep 30']));
        const missingExact = await resolveTmuxSession(ctx, {
          identity: prefixIdentity,
          label: 'prefix',
        });
        await shell
          .exec(['-c', buildTmuxShellLine(missingExact.name, 'sleep 30', prefixIdentity)])
          .catch(() => {});
        const exactSessions = await tmux.exec(tmuxArgs(['list-sessions', '-F', '#{session_name}']));
        expect(exactSessions.stdout.trim().split('\n').sort()).toEqual(
          [prefixName, `${prefixName}-sibling`].sort()
        );
      } finally {
        await tmux.exec(tmuxArgs(['kill-server'])).catch(() => {});
        await rm(cwd, { recursive: true, force: true });
      }
    }
  );
});

describe('parseTmuxSessionActivity', () => {
  it('parses session activity timestamps as milliseconds', () => {
    const identity = 'project:task:leaf';
    const encoded = Buffer.from(JSON.stringify({ version: 1, identity }), 'utf8').toString(
      'base64url'
    );
    const parsed = parseTmuxSessionActivity(
      `one\t1710000000\tv1:${encoded}\ntwo\t1710000005\t\ninvalid\n`
    );

    expect(parsed).toEqual(
      new Map([
        ['one', 1_710_000_000_000],
        [tmuxIdentityActivityKey(identity), 1_710_000_000_000],
        ['two', 1_710_000_005_000],
      ])
    );
  });
});

describe('listTmuxSessionActivity', () => {
  it('runs one tmux list-sessions command', async () => {
    const exec = vi.fn(async () => ({ stdout: 'name\t42\t\n', stderr: '' }));
    const ctx = stubExecContext(exec);

    const activity = await listTmuxSessionActivity(ctx);

    expect(exec).toHaveBeenCalledWith('tmux', [
      '-L',
      'ninebrains',
      'list-sessions',
      '-F',
      '#{session_name}\t#{session_activity}\t#{@emdash_identity}\t#{pid}',
    ]);
    expect(activity).toEqual(new Map([['name', 42_000]]));
  });

  it('returns an empty map when no tmux server is running', async () => {
    const exec = vi.fn(async () => {
      throw { exitCode: 1, stderr: 'no server running' };
    });

    await expect(listTmuxSessionActivity(stubExecContext(exec))).resolves.toEqual(new Map());
  });

  it('returns an empty map when no tmux server is running (execFile error shape)', async () => {
    const exec = vi.fn(async () => {
      throw Object.assign(new Error('Command failed'), { code: 1, stderr: 'no server running' });
    });

    await expect(listTmuxSessionActivity(stubExecContext(exec))).resolves.toEqual(new Map());
  });

  it('returns an empty map for the macOS missing-socket error', async () => {
    const exec = vi.fn(async () => {
      throw {
        exitCode: 1,
        stderr: 'error connecting to /private/tmp/tmux-501/default (No such file or directory)',
      };
    });

    await expect(listTmuxSessionActivity(stubExecContext(exec))).resolves.toEqual(new Map());
  });

  it('returns an empty map when tmux is not installed (spawn failure)', async () => {
    const exec = vi.fn(async () => {
      throw Object.assign(new Error('spawn tmux ENOENT'), { code: 'ENOENT' });
    });

    await expect(listTmuxSessionActivity(stubExecContext(exec))).resolves.toEqual(new Map());
  });

  it('returns an empty map when BoundExec wraps a missing tmux executable', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'emdash-tmux-missing-'));
    try {
      const bound = createBoundExec({ file: join(cwd, 'missing-tmux'), cwd });
      const ctx = stubExecContext((_file, args) => bound.exec(args ?? []));

      await expect(listTmuxSessionActivity(ctx)).resolves.toEqual(new Map());
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('returns an empty map for a shell command-not-found exit', async () => {
    const exec = vi.fn(async () => {
      throw new ExecError('tmux', [], 127, '', 'tmux: command not found');
    });

    await expect(listTmuxSessionActivity(stubExecContext(exec))).resolves.toEqual(new Map());
  });

  it.each([
    new ExecError('tmux', [], null, '', 'Timed out after 50ms'),
    new ExecError('tmux', [], null, '', 'Timed out: session not found'),
    Object.assign(new Error('spawn tmux EACCES'), { code: 'EACCES' }),
    new ExecError('tmux', [], null, '', 'spawn tmux EACCES', {
      cause: Object.assign(new Error('Permission denied'), { code: 'EACCES' }),
    }),
    Object.assign(new Error('Command failed'), { code: 2, stderr: 'configuration file not found' }),
  ])('rethrows execution failures instead of treating them as missing tmux: %s', async (error) => {
    const exec = vi.fn(async () => {
      throw error;
    });

    await expect(listTmuxSessionActivity(stubExecContext(exec))).rejects.toBe(error);
  });

  it('rethrows unexpected failures', async () => {
    const exec = vi.fn(async () => {
      throw Object.assign(new Error('Command failed'), { code: 2, stderr: 'server crashed' });
    });

    await expect(listTmuxSessionActivity(stubExecContext(exec))).rejects.toThrow('Command failed');
  });
});

function stubExecContext(exec: IExecutionContext['exec']): IExecutionContext {
  return {
    root: undefined,
    supportsLocalSpawn: false,
    exec,
    async execStreaming() {
      return { exitCode: 0 };
    },
    dispose() {},
  };
}

describe('end-to-end against a real tmux server', () => {
  it.skipIf(!TMUX_AVAILABLE)('applies the history limit on the app socket', async () => {
    const cwd = await mkdtemp('/tmp/nb-e2e-');
    const env = { ...process.env, TMUX_TMPDIR: cwd };
    const shell = createBoundExec({ file: '/bin/sh', cwd, env });
    const tmux = createBoundExec({ file: 'tmux', cwd, env });
    try {
      await shell
        .exec(['-c', buildTmuxShellLine('e2e-probe', 'sleep 60', 'p:t:e2e', 4321)])
        .catch(() => {});
      const limit = await tmux.exec(
        tmuxArgs(['show-options', '-t', '=e2e-probe:', 'history-limit'])
      );
      const names = await tmux.exec(tmuxArgs(['list-sessions', '-F', '#{session_name}']));
      expect(limit.stdout.trim()).toBe('history-limit 4321');
      expect(names.stdout.trim()).toBe('e2e-probe');
      // The socket really is separate: the default server in this TMUX_TMPDIR has nothing.
      const onDefault = await tmux
        .exec(['list-sessions'])
        .then(() => ({ stderr: '<unexpectedly succeeded>' }))
        .catch((error: { stderr?: string }) => error);
      expect(onDefault.stderr ?? '').toMatch(
        /no server running|failed to connect|error connecting/iu
      );
    } finally {
      await tmux.exec(tmuxArgs(['kill-server'])).catch(() => {});
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
