import { describe, expect, it } from 'vitest';
import { assertSafeSettings, buildClaudeSandboxSettings } from './sandbox-settings';

const base = {
  worktree: '/wt/proj/lane-a',
  ninebrainsDataDir: '/ud/ninebrains',
  siblingWorktrees: ['/wt/proj/lane-b', '/wt/proj/lane-c'],
  homeDir: '/home/u',
};

describe('SEC-11 lane sandbox settings', () => {
  it('enables the sandbox, fails closed and removes the unsandboxed escape hatch', () => {
    const s = buildClaudeSandboxSettings({ ...base, preset: 'worker' });
    expect(s.sandbox).toMatchObject({
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: true,
    });
  });

  it('denies reading siblings, Ninebrains data and credential files, and allows its own worktree', () => {
    const s = buildClaudeSandboxSettings({
      ...base,
      preset: 'worker',
      claudeConfigDir: '/accounts/work',
      codexHome: '/accounts/codex',
    });
    const { denyRead, allowRead, allowWrite } = s.sandbox.filesystem;
    expect(denyRead).toEqual(
      expect.arrayContaining([
        '/ud/ninebrains',
        '/wt/proj/lane-b',
        '/wt/proj/lane-c',
        '/home/u/.ssh',
        '/home/u/.aws',
        '/home/u/.config/gcloud',
        '/home/u/.codex',
        '/home/u/.claude/.credentials.json',
        '/accounts/work/.credentials.json',
        '/accounts/codex',
      ])
    );
    expect(denyRead).not.toContain('/wt/proj/lane-a');
    expect(allowRead).toEqual(['/wt/proj/lane-a']);
    expect(allowWrite).toEqual(['/wt/proj/lane-a']);
  });

  it('writes permission rules with // for absolute paths (a single / is settings-relative)', () => {
    const s = buildClaudeSandboxSettings({ ...base, preset: 'worker' });
    expect(s.permissions.deny).toContain('Read(//wt/proj/lane-b/**)');
    expect(s.permissions.deny).toContain('Edit(//ud/ninebrains/**)');
    expect(s.permissions.deny.every((r) => /^(Read|Edit)\(\/\/[^/]/.test(r))).toBe(true);
  });

  it('gives a reviewer no writes at all, even to its own checkout', () => {
    const s = buildClaudeSandboxSettings({ ...base, preset: 'reviewer' });
    expect(s.sandbox.autoAllowBashIfSandboxed).toBe(false);
    expect(s.sandbox.filesystem.allowWrite).toEqual([]);
    expect(s.sandbox.filesystem.denyWrite).toEqual(['/wt/proj/lane-a']);
    expect(s.permissions.deny).toContain('Edit(//wt/proj/lane-a/**)');
  });

  it('refuses a run directory inside a denied path', () => {
    expect(() =>
      buildClaudeSandboxSettings({ ...base, preset: 'worker', worktree: '/ud/ninebrains/lanes/x' })
    ).toThrow(/inside a denied path/);
  });

  it('adds a network egress allowlist only when one is given (SEC-32)', () => {
    expect(
      buildClaudeSandboxSettings({ ...base, preset: 'worker' }).sandbox.network
    ).toBeUndefined();
    const s = buildClaudeSandboxSettings({
      ...base,
      preset: 'worker',
      egressAllowedDomains: ['registry.npmjs.org'],
    });
    expect(s.sandbox.network).toEqual({ allowedDomains: ['registry.npmjs.org'] });
  });

  it('rejects settings that turn the sandbox off or bypass permissions', () => {
    const s = buildClaudeSandboxSettings({ ...base, preset: 'worker' });
    expect(() =>
      assertSafeSettings({ ...s, sandbox: { ...s.sandbox, enabled: false as true } })
    ).toThrow();
    expect(() =>
      assertSafeSettings({ ...s, permissions: { deny: ['bypassPermissions'] } })
    ).toThrow();
  });
});
