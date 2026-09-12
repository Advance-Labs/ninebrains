import { describe, expect, it } from 'vitest';
import {
  assertSafeSettings,
  buildClaudeSandboxSettings,
  SECRET_HOME_PATHS,
  secretDenyPaths,
} from './sandbox-settings';

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

  it('M4 denies every listed home secret and all of <userData>, not just ninebrains/', () => {
    const s = buildClaudeSandboxSettings({ ...base, preset: 'worker', userDataDir: '/ud' });
    const { denyRead } = s.sandbox.filesystem;
    for (const secret of [
      '.git-credentials',
      '.config/git/credentials',
      '.netrc',
      '.pypirc',
      '.cargo/credentials',
      '.cargo/credentials.toml',
      '.azure',
      '.aws',
      '.config/gcloud',
      '.kube',
      '.docker/config.json',
      '.npmrc',
      '.gnupg',
      '.ssh',
    ]) {
      expect(SECRET_HOME_PATHS).toContain(secret);
      expect(denyRead).toContain(`/home/u/${secret}`);
    }
    expect(denyRead).toContain('/ud');
    expect(s.permissions.deny).toContain('Read(//ud/**)');
    expect(secretDenyPaths({ homeDir: '/home/u', userDataDir: '/ud' })).toEqual([
      '/ud',
      ...SECRET_HOME_PATHS.map((p) => `/home/u/${p}`),
    ]);
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

  it("T36 denies writes to the lane repo's config, attributes and hooks, not objects or refs", () => {
    const s = buildClaudeSandboxSettings({
      ...base,
      preset: 'worker',
      git: { gitDir: '/repo/.git/worktrees/lane-a', commonDir: '/repo/.git' },
    });
    expect(s.sandbox.filesystem.denyWrite).toEqual([
      '/repo/.git/config',
      '/repo/.git/config.worktree',
      '/repo/.git/worktrees/lane-a/config.worktree',
      '/repo/.git/info/attributes',
      '/repo/.git/hooks',
    ]);
    expect(s.sandbox.filesystem.allowWrite).toEqual(['/wt/proj/lane-a']);
    expect(s.permissions.deny).toEqual(
      expect.arrayContaining([
        'Edit(//repo/.git/config)',
        'Edit(//repo/.git/info/attributes)',
        'Edit(//repo/.git/hooks/**)',
      ])
    );
    const denied = JSON.stringify([s.sandbox.filesystem.denyWrite, s.permissions.deny]);
    expect(denied).not.toMatch(/objects|refs|\/index|\/HEAD/);
    // A reviewer keeps its own checkout write-denied as well.
    const reviewer = buildClaudeSandboxSettings({
      ...base,
      preset: 'reviewer',
      git: { gitDir: '/wt/proj/lane-a/.git', commonDir: '/wt/proj/lane-a/.git' },
    });
    expect(reviewer.sandbox.filesystem.denyWrite).toEqual([
      '/wt/proj/lane-a',
      '/wt/proj/lane-a/.git/config',
      '/wt/proj/lane-a/.git/config.worktree',
      '/wt/proj/lane-a/.git/info/attributes',
      '/wt/proj/lane-a/.git/hooks',
    ]);
  });

  it("T36 denies rewriting a linked worktree's .git gitfile", () => {
    const s = buildClaudeSandboxSettings({
      ...base,
      preset: 'worker',
      git: {
        gitDir: '/repo/.git/worktrees/lane-a',
        commonDir: '/repo/.git',
        gitFile: '/wt/proj/lane-a/.git',
      },
    });
    expect(s.sandbox.filesystem.denyWrite[0]).toBe('/wt/proj/lane-a/.git');
    expect(s.permissions.deny).toContain('Edit(//wt/proj/lane-a/.git)');
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
