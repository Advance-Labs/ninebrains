import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildSeatbeltProfile, createRunCommand } from './run-command';
import { tempRoot } from './test-fixtures';

const root = tempRoot('nb-run-command-');
afterAll(() => rmSync(root, { recursive: true, force: true }));
const worktrees = join(root, 'worktrees');
const laneA = join(worktrees, 'lane-a');
const laneB = join(worktrees, 'lane-b');
const outside = join(root, 'outside');
const ninebrains = join(root, 'userData', 'ninebrains');
for (const dir of [laneA, laneB, outside, ninebrains]) mkdirSync(dir, { recursive: true });
writeFileSync(join(ninebrains, 'brain.sqlite'), 'TOP-SECRET-DB');
writeFileSync(join(laneB, 'mcp.json'), 'SIBLING-TOKEN');

const runCommand = createRunCommand({
  allowedRoots: () => [worktrees],
  ninebrainsDataDir: ninebrains,
  siblingWorktrees: () => [laneB],
  parentEnv: {
    ...process.env,
    NINEBRAINS_TOKEN: 'nb-live-token-123456',
    ANTHROPIC_API_KEY: 'sk-ant-api03-parentkey',
    GITHUB_TOKEN: 'ghp_parenttoken',
    CLAUDE_CONFIG_DIR: '/accounts/work',
  },
  killGraceMs: 2000,
});

const signal = () => new AbortController().signal;
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('SEC-20 tests gate is sandboxed', () => {
  it('env output has no token, no NINEBRAINS_*, no provider secrets', async () => {
    const r = await runCommand('env', { cwd: laneA, signal: signal() });
    expect(r.exitCode).toBe(0);
    for (const needle of [
      'NINEBRAINS',
      'nb-live-token',
      'sk-ant-',
      'ghp_',
      'CLAUDE_CONFIG_DIR',
      'ANTHROPIC',
    ]) {
      expect(r.stdout).not.toContain(needle);
    }
    expect(r.stdout).toMatch(/^PATH=/m);
  });

  it(
    'kills a forked grandchild that ignores SIGTERM within 5 s of abort',
    { timeout: 20_000 },
    async () => {
      const controller = new AbortController();
      const pending = runCommand(
        `trap '' TERM; (trap '' TERM; sh -c 'echo $$ > gc.pid; exec sleep 999') & wait`,
        { cwd: laneA, signal: controller.signal }
      );
      const pidFile = join(laneA, 'gc.pid');
      for (
        let i = 0;
        i < 100 && !(existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim());
        i++
      ) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const pid = Number(readFileSync(pidFile, 'utf8').trim());
      expect(alive(pid)).toBe(true);

      const t0 = Date.now();
      controller.abort();
      await pending;
      while (alive(pid) && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
      expect(alive(pid)).toBe(false);
      expect(Date.now() - t0).toBeLessThan(5000);
      rmSync(pidFile);
    }
  );

  it('times out and reports it', async () => {
    const t0 = Date.now();
    const r = await runCommand('sleep 30', { cwd: laneA, signal: signal(), timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
    expect(Date.now() - t0).toBeLessThan(4000);
  });

  it('caps output, keeping the tail', async () => {
    const small = createRunCommand({
      allowedRoots: () => [worktrees],
      ninebrainsDataDir: ninebrains,
      maxOutputBytes: 1000,
    });
    const r = await small('i=0; while [ $i -lt 2000 ]; do echo line-$i; i=$((i+1)); done', {
      cwd: laneA,
      signal: signal(),
    });
    expect(r.stdout).toMatch(/^\[output truncated/);
    expect(r.stdout).toContain('line-1999');
    expect(r.stdout.length).toBeLessThan(1100);
  });

  it('runs argv without a shell', async () => {
    const r = await runCommand('printf', {
      argv: ['%s|', 'a b', '$HOME', ';id'],
      cwd: laneA,
      signal: signal(),
    });
    expect(r).toMatchObject({ exitCode: 0, stdout: 'a b|$HOME|;id|' });
  });

  it('SEC-16 never executes a binary planted in the worktree', async () => {
    const planted = join(laneA, 'node_modules', '.bin');
    mkdirSync(planted, { recursive: true });
    writeFileSync(join(planted, 'printf'), '#!/bin/sh\necho PWNED\n', { mode: 0o755 });
    const withPlantedPath = createRunCommand({
      allowedRoots: () => [worktrees],
      ninebrainsDataDir: ninebrains,
      parentEnv: { PATH: `${planted}:/usr/bin:/bin`, HOME: process.env.HOME },
    });
    const r = await withPlantedPath('printf', { argv: ['ok'], cwd: laneA, signal: signal() });
    expect(r.stdout).toBe('ok');
    await expect(
      withPlantedPath('node_modules/.bin/printf', { argv: [], cwd: laneA, signal: signal() })
    ).rejects.toThrow(/Relative executable/);
  });

  it('refuses a cwd outside the worktree roots', async () => {
    await expect(runCommand('true', { cwd: outside, signal: signal() })).rejects.toThrow(
      /not inside/
    );
  });

  it('escapes profile paths', () => {
    const profile = buildSeatbeltProfile({
      worktree: '/wt/a',
      tempDir: '/tmp/nb-tests-x',
      deniedPaths: ['/x/we"ird\\path'],
    });
    expect(profile).toContain('(subpath "/x/we\\"ird\\\\path")');
    expect(profile).toContain('(allow default)');
    // Only the worktree, the private temp dir and /dev are writable: not the shared temp dir.
    expect(profile).toContain(
      '(require-any (subpath "/wt/a") (subpath "/tmp/nb-tests-x") (subpath "/dev"))'
    );
  });

  it('skips a denied path that contains the cwd, so a review checkout can read itself', () => {
    const profile = buildSeatbeltProfile({
      worktree: '/checkouts/nb-review-1/checkout',
      tempDir: '/t',
      deniedPaths: ['/checkouts', '/secrets'],
    });
    expect(profile).not.toContain('(subpath "/checkouts")');
    expect(profile).toContain('(subpath "/secrets")');
  });
});

describe.skipIf(process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec'))(
  'SEC-20 macOS seatbelt profile',
  () => {
    it('denies reading Ninebrains data and sibling worktrees', async () => {
      const db = await runCommand(`cat '${join(ninebrains, 'brain.sqlite')}'`, {
        cwd: laneA,
        signal: signal(),
      });
      expect(db.exitCode).not.toBe(0);
      expect(db.stdout).not.toContain('TOP-SECRET-DB');
      const sibling = await runCommand(`cat '${join(laneB, 'mcp.json')}'`, {
        cwd: laneA,
        signal: signal(),
      });
      expect(sibling.exitCode).not.toBe(0);
      expect(sibling.stdout).not.toContain('SIBLING-TOKEN');
    });

    it('denies writes outside the worktree and allows them inside', async () => {
      const escaped = await runCommand(`echo x > '${join(outside, 'w.txt')}'`, {
        cwd: laneA,
        signal: signal(),
      });
      expect(escaped.exitCode).not.toBe(0);
      expect(existsSync(join(outside, 'w.txt'))).toBe(false);
      const local = await runCommand('echo ok > ok.txt && cat ok.txt', {
        cwd: laneA,
        signal: signal(),
      });
      expect(local).toMatchObject({ exitCode: 0, stdout: 'ok\n' });
    });

    it('gives each command a private, writable TMPDIR that is removed afterwards', async () => {
      const r = await runCommand(
        'echo t > "$TMPDIR/t.txt" && cat "$TMPDIR/t.txt" && echo "$TMPDIR"',
        {
          cwd: laneA,
          signal: signal(),
        }
      );
      expect(r.exitCode).toBe(0);
      const [content, dir] = r.stdout.trim().split('\n');
      expect(content).toBe('t');
      expect(dir).toMatch(/nb-tests-/);
      expect(existsSync(dir)).toBe(false);
    });
  }
);
