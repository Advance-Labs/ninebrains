import { describe, expect, it } from 'vitest';
import { assertSafeArgv, decodeToml, UnsafeArgvError, type ArgvGuardOptions } from './argv-guard';
import { buildClaudePrintArgv } from './claude-print';
import { buildCodexExecLaunch } from './codex-exec';
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
const claudeTrusted: ArgvGuardOptions = {
  provider: 'claude',
  trusted: [files.mcpConfigPath, files.settingsPath],
};
const codex = (preset: ExecRunSpec['preset']) =>
  buildCodexExecLaunch(spec({ provider: 'codex', preset }), '/wt/lane-a');

const BUILDERS: Record<string, [string[], ArgvGuardOptions]> = {
  'claude worker': [buildClaudePrintArgv(spec(), files), claudeTrusted],
  'claude reviewer': [buildClaudePrintArgv(spec({ preset: 'reviewer' }), files), claudeTrusted],
  'codex worker': [codex('worker').argv, { provider: 'codex', trusted: codex('worker').trusted }],
  'codex reviewer': [
    codex('reviewer').argv,
    { provider: 'codex', trusted: codex('reviewer').trusted },
  ],
};

const refuses = (argv: string[], options?: ArgvGuardOptions) =>
  expect(() => assertSafeArgv(argv, options)).toThrow(UnsafeArgvError);

describe('SEC-12 launch argv guard', () => {
  it.each(Object.entries(BUILDERS))(
    '%s argv carries no bypass flag and passes the guard',
    (_n, [argv, options]) => {
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
      expect(() => assertSafeArgv(argv, options)).not.toThrow();
    }
  );

  it.each(Object.entries(BUILDERS))(
    '%s argv is refused without its trusted config values',
    (_n, [argv, options]) => {
      refuses(argv, { provider: options.provider });
    }
  );

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
    refuses(argv);
  });

  it('allows a system prompt that merely mentions a disabled sandbox', () => {
    expect(() =>
      assertSafeArgv(['--append-system-prompt={"sandbox":{"enabled":false}} is forbidden'], {
        provider: 'claude',
      })
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

/** Every bypass from the security review's argv repro, plus neighbours of each. */
describe('M2 argv guard normalises before matching', () => {
  it('attached short values: -sdanger-full-access and -s=danger-full-access', () => {
    refuses(['exec', '-sdanger-full-access'], { provider: 'codex' });
    refuses(['exec', '-s=danger-full-access'], { provider: 'codex' });
    refuses(['exec', '-sdanger-full-access']); // unknown provider reads it the same way
  });

  it('combined short flags expand to their value flag', () => {
    refuses(['exec', '-m', 'gpt-5', '-as', 'danger-full-access'], { provider: 'codex' });
    expect(() => assertSafeArgv(['-pc'], { provider: 'claude' })).not.toThrow();
  });

  it('decodes TOML escapes in -c overrides, even a trusted one', () => {
    const escaped = 'sandbox_mode="danger\\u002dfull-access"';
    expect(decodeToml(escaped)).toBe('sandbox_mode=danger-full-access');
    refuses(['exec', '-c', escaped], { provider: 'codex' });
    refuses(['exec', '-c', escaped], { provider: 'codex', trusted: [escaped] });
    for (const variant of [
      "sandbox_mode='danger-full-access'",
      'sandbox_mode="danger\\x2dfull-access"',
      '"sandbox_mode"="""danger-full-access"""',
      'sandbox_mode="DANGER-FULL-ACCESS"',
    ]) {
      refuses(['exec', '-c', variant], { provider: 'codex', trusted: [variant] });
    }
  });

  it('parses inline --settings JSON: nesting before "enabled" and JSON escapes', () => {
    const nested = '{"sandbox":{"network":{"allowedDomains":[]},"enabled":false}}';
    const escaped = '{"permissions":{"defaultMode":"bypass\\u0050ermissions"}}';
    refuses(['--settings', nested], { provider: 'claude' });
    refuses([`--settings=${escaped}`], { provider: 'claude' });
    // Even if a caller wrongly trusted the inline value, the decoded content is still refused.
    refuses(['--settings', nested], { provider: 'claude', trusted: [nested] });
    refuses([`--settings=${escaped}`], { provider: 'claude', trusted: [escaped] });
    refuses(['--settings={"sand\\u0062ox":{"enabled":false}}'], {
      provider: 'claude',
      trusted: ['{"sand\\u0062ox":{"enabled":false}}'],
    });
    refuses(['--settings={not json'], { provider: 'claude', trusted: ['{not json'] });
  });

  it('refuses a settings file path Ninebrains did not write', () => {
    refuses(['--settings', '/tmp/evil-settings.json'], { provider: 'claude' });
    refuses(['--settings=/tmp/evil-settings.json'], {
      provider: 'claude',
      trusted: ['/d/settings.json'],
    });
    expect(() =>
      assertSafeArgv(['--settings', '/d/settings.json'], {
        provider: 'claude',
        trusted: ['/d/settings.json'],
      })
    ).not.toThrow();
  });

  it('gates every config-bearing flag on the trusted list', () => {
    refuses(['--mcp-config=/tmp/evil.json'], { provider: 'claude' });
    refuses(['--mcp-config', '/d/mcp.json', '/tmp/evil.json'], {
      provider: 'claude',
      trusted: ['/d/mcp.json'],
    });
    refuses(['--add-dir=/'], { provider: 'claude' });
    refuses(['--add-dir', '/home/u/.ssh'], { provider: 'claude' });
    refuses(['exec', '--profile', 'yolo-profile'], { provider: 'codex' });
    refuses(['exec', '-p', 'yolo-profile'], { provider: 'codex' });
    refuses(['exec', '--config=model="o3"'], { provider: 'codex' });
    refuses(['exec', '-cmodel="o3"'], { provider: 'codex' });
  });

  it('matches flag names and values case-insensitively', () => {
    refuses(['--Dangerously-Skip-Permissions']);
    refuses(['--PERMISSION-MODE=BYPASSPERMISSIONS']);
    refuses(['--permission-mode', 'BypassPermissions']);
    refuses(['exec', '--SANDBOX', 'Danger-Full-Access']);
  });

  it('reads -c and -p per provider, and strictly when the provider is unknown', () => {
    expect(() => assertSafeArgv(['-c'], { provider: 'claude' })).not.toThrow();
    expect(() =>
      assertSafeArgv(['-p', '--output-format=stream-json'], { provider: 'claude' })
    ).not.toThrow();
    refuses(['-p', '--output-format=stream-json']); // `any`: -p is Codex --profile
    refuses(['-c', 'x=1']);
  });
});
