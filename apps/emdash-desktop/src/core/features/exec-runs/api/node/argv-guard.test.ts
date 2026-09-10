import { describe, expect, it } from 'vitest';
import { assertSafeArgv, UnsafeArgvError } from './argv-guard';
import { buildClaudePrintArgv } from './claude-print';
import { buildCodexExecArgv } from './codex-exec';
import { spawnInGroup } from './process-group';
import type { ExecRunSpec } from './types';

const spec = (over: Partial<ExecRunSpec> = {}): ExecRunSpec => ({
  runId: 'run-1',
  provider: 'claude',
  preset: 'worker',
  cwd: '/wt/lane-a',
  prompt: 'do the thing',
  budgets: { wallClockMs: 60_000, maxTurns: 10 },
  mcpServers: { brain: { command: '/abs/node', args: ['/abs/brain.js'], env: { T: 'x' } } },
  ...over,
});
const files = { mcpConfigPath: '/d/mcp.json', settingsPath: '/d/settings.json', sessionId: 'sid' };

const BUILDERS: Record<string, string[]> = {
  'claude worker': buildClaudePrintArgv(spec(), files),
  'claude reviewer': buildClaudePrintArgv(spec({ preset: 'reviewer' }), files),
  'codex worker': buildCodexExecArgv(spec({ provider: 'codex' }), '/wt/lane-a'),
  'codex reviewer': buildCodexExecArgv(spec({ provider: 'codex', preset: 'reviewer' }), '/wt/lane-a'),
};

describe('SEC-12 launch argv guard', () => {
  it.each(Object.entries(BUILDERS))('%s argv carries no bypass flag and passes the guard', (_n, argv) => {
    const joined = argv.join(' ');
    for (const banned of [
      '--dangerously-skip-permissions',
      '--allow-dangerously-skip-permissions',
      'bypassPermissions',
      '--dangerously-bypass-approvals-and-sandbox',
      'danger-full-access',
      '--full-auto',
    ]) {
      expect(joined).not.toContain(banned);
    }
    expect(() => assertSafeArgv(argv)).not.toThrow();
  });

  it.each([
    [['--dangerously-skip-permissions']],
    [['--allow-dangerously-skip-permissions']],
    [['--permission-mode=bypassPermissions']],
    [['--permission-mode', 'bypassPermissions']],
    [['exec', '--dangerously-bypass-approvals-and-sandbox']],
    [['exec', '--full-auto']],
    [['exec', '--yolo']],
    [['exec', '--approve-for-me']],
    [['exec', '--sandbox', 'danger-full-access']],
    [['exec', '-s', 'danger-full-access']],
    [['exec', '--sandbox=danger-full-access']],
    [['exec', '-c', 'sandbox_mode="danger-full-access"']],
    [['--settings={"permissions":{"defaultMode":"bypassPermissions"}}']],
    [['--settings', '{"sandbox":{"enabled":false}}']],
    [['--settings={"sandbox":{"allowUnsandboxedCommands":true}}']],
    [['--some-future-bypass-flag']],
    [['-p', 'a\0b']],
  ])('throws on %j', (argv) => {
    expect(() => assertSafeArgv(argv)).toThrow(UnsafeArgvError);
  });

  it('allows a system prompt that merely mentions a disabled sandbox', () => {
    expect(() =>
      assertSafeArgv(['--append-system-prompt={"sandbox":{"enabled":false}} is forbidden'])
    ).not.toThrow();
  });

  it('rejects non-string entries', () => {
    expect(() => assertSafeArgv(['-p', 3 as unknown as string])).toThrow(TypeError);
  });

  it('runs inside the spawn wrapper, so a bad argv never reaches the OS', () => {
    expect(() =>
      spawnInGroup('/bin/echo', ['--dangerously-skip-permissions'], { cwd: '/', env: {} })
    ).toThrow(UnsafeArgvError);
  });

  it('SEC-16 refuses a relative binary', () => {
    expect(() => spawnInGroup('claude', ['-p'], { cwd: '/', env: {} })).toThrow(/absolute/);
  });
});
