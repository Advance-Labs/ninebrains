import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createRunCommand, type RunCommandOptions } from './run-command';
import { tempRoot } from './test-fixtures';
import { buildBwrapArgs, buildSeatbeltProfile, TESTS_SANDBOX_REQUIRED } from './tests-sandbox';

const root = tempRoot('nb-tests-sandbox-');
afterAll(() => rmSync(root, { recursive: true, force: true }));
const worktrees = join(root, 'worktrees');
const lane = join(worktrees, 'lane-a');
const userData = join(root, 'userData');
const ninebrains = join(userData, 'ninebrains');
const home = join(root, 'home');
for (const dir of [lane, ninebrains, join(home, '.ssh'), join(home, '.config', 'gcloud')]) {
  mkdirSync(dir, { recursive: true });
}
writeFileSync(join(userData, 'settings.json'), 'USERDATA-SECRET');
writeFileSync(join(home, '.git-credentials'), 'https://u:GITCRED@example.invalid');
writeFileSync(join(home, '.ssh', 'id_ed25519'), 'SSH-KEY');

const signal = () => new AbortController().signal;
const base: RunCommandOptions = {
  allowedRoots: () => [worktrees],
  ninebrainsDataDir: ninebrains,
  homeDir: home,
  parentEnv: { PATH: process.env.PATH, HOME: home },
};

/** Logs its argv, then runs whatever follows `--`, like bwrap would. */
function fakeBwrap(): { path: string; log: string } {
  const path = join(root, 'fake-bwrap.sh');
  const log = join(root, 'bwrap-args.txt');
  writeFileSync(
    path,
    `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n`
  );
  chmodSync(path, 0o755);
  return { path, log };
}

describe('H1 tests gate needs a sandbox on Linux and Windows', () => {
  it('refuses a shell-line command where no sandbox exists', async () => {
    for (const platform of ['linux', 'win32'] as const) {
      // No bwrap on this PATH, so `auto` finds no sandbox on Linux.
      const run = createRunCommand({ ...base, platform, parentEnv: { PATH: '/nonexistent' } });
      await expect(run('echo hi', { cwd: lane, signal: signal() })).rejects.toThrow(
        TESTS_SANDBOX_REQUIRED
      );
    }
  });

  it('runs unsandboxed only with the per-project testsGate.allowUnsandboxed opt-in', async () => {
    const run = createRunCommand({
      ...base,
      platform: 'linux',
      sandbox: 'none',
      projectSettings: () => ({ allowUnsandboxed: true }),
    });
    expect(await run('echo opted-in', { cwd: lane, signal: signal() })).toMatchObject({
      exitCode: 0,
      stdout: 'opted-in\n',
    });
  });

  it('still runs gate-built argv commands (the reviewer git calls)', async () => {
    const run = createRunCommand({ ...base, platform: 'linux', sandbox: 'none' });
    const r = await run('printf', { argv: ['ok'], cwd: lane, signal: signal() });
    expect(r).toMatchObject({ exitCode: 0, stdout: 'ok' });
  });

  it('wraps the command in bubblewrap: read-only root, writable worktree, secrets hidden', async () => {
    const bwrap = fakeBwrap();
    const run = createRunCommand({ ...base, platform: 'linux', bwrapPath: bwrap.path });
    const r = await run('echo inside', { cwd: lane, signal: signal() });
    expect(r).toMatchObject({ exitCode: 0, stdout: 'inside\n' });
    const args = readFileSync(bwrap.log, 'utf8').trim().split('\n');
    const joined = args.join(' ');
    expect(args[0]).toBe('--die-with-parent');
    expect(joined).toContain('--ro-bind / /');
    expect(joined).toContain('--tmpfs /tmp');
    expect(joined).toContain(`--tmpfs ${userData}`);
    expect(joined).toContain(`--tmpfs ${join(home, '.ssh')}`);
    expect(joined).toContain(`--tmpfs ${join(home, '.config', 'gcloud')}`);
    expect(joined).toContain(`--ro-bind /dev/null ${join(home, '.git-credentials')}`);
    expect(joined).not.toContain(join(home, '.aws')); // absent: nothing to hide
    expect(joined).toContain(`--bind ${lane} ${lane}`);
    expect(args).toContain('--unshare-net');
    expect(joined).toMatch(/-- \/bin\/sh -c echo inside$/);
  });

  it('keeps the network only with testsGate.allowNetwork', async () => {
    const bwrap = fakeBwrap();
    const run = createRunCommand({
      ...base,
      platform: 'linux',
      bwrapPath: bwrap.path,
      projectSettings: () => ({ allowNetwork: true }),
    });
    await run('true', { cwd: lane, signal: signal() });
    expect(readFileSync(bwrap.log, 'utf8')).not.toContain('--unshare-net');
  });

  it('binds the worktree after every tmpfs, and never hides an ancestor of the cwd', () => {
    const args = buildBwrapArgs({
      worktree: lane,
      tempDir: root,
      deniedPaths: [worktrees, userData, join(home, '.ssh')],
    });
    const bind = args.lastIndexOf('--bind');
    expect(args.lastIndexOf('--tmpfs')).toBeLessThan(bind);
    expect(args).not.toContain(worktrees);
  });
});

describe('M1 macOS seatbelt profile', () => {
  const profile = (allowNetwork?: boolean) =>
    buildSeatbeltProfile({
      worktree: '/wt/a',
      tempDir: '/t',
      deniedPaths: ['/ud', '/home/u/.git-credentials'],
      allowNetwork,
    });

  it('denies all network except loopback by default', () => {
    const p = profile();
    expect(p).toContain('(deny network*)');
    expect(p).toContain('(allow network-bind network-inbound (local ip "localhost:*"))');
    expect(p).toContain('(allow network-outbound (remote ip "localhost:*"))');
    // `(allow network* (local ip …))` would reopen outbound connections.
    expect(p).not.toMatch(/allow network\* \(local/);
    expect(p.indexOf('(deny network*)')).toBeLessThan(p.indexOf('(allow network-outbound'));
  });

  it('leaves the network open only with testsGate.allowNetwork', () => {
    expect(profile(true)).not.toContain('network');
  });

  it('denies reading the secrets list and all of <userData>', () => {
    expect(profile()).toContain(
      '(deny file-read* file-write* (subpath "/ud") (subpath "/home/u/.git-credentials"))'
    );
  });
});

describe.skipIf(process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec'))(
  'M1 seatbelt under real sandbox-exec',
  () => {
    const run = createRunCommand(base);
    const node = (script: string, r = run) =>
      r(process.execPath, { argv: ['-e', script], cwd: lane, signal: signal() });
    const connect = (host: string) =>
      `require('net').connect(443,'${host}').on('connect',()=>{console.log('OPEN');process.exit(0)}).on('error',e=>{console.log('ERR '+e.code);process.exit(0)})`;

    it('denies reading <userData> outside ninebrains/ and home secrets', async () => {
      for (const file of [
        join(userData, 'settings.json'),
        join(home, '.git-credentials'),
        join(home, '.ssh', 'id_ed25519'),
      ]) {
        const r = await run(`cat '${file}'`, { cwd: lane, signal: signal() });
        expect(r.exitCode).not.toBe(0);
        expect(r.stdout).toBe('');
      }
    });

    it('blocks outbound network but serves and reaches loopback', async () => {
      expect((await node(connect('1.1.1.1'))).stdout.trim()).toBe('ERR EPERM');
      const loop =
        "const h=require('http');const s=h.createServer((q,r)=>r.end('loop-ok')).listen(0,'127.0.0.1',()=>h.get('http://127.0.0.1:'+s.address().port,r=>r.on('data',d=>{console.log(String(d));process.exit(0)})))";
      expect((await node(loop)).stdout.trim()).toBe('loop-ok');
    });

    it('allows outbound network with testsGate.allowNetwork', async () => {
      const open = createRunCommand({ ...base, projectSettings: () => ({ allowNetwork: true }) });
      // Offline machines get ENETUNREACH or a timeout, never the sandbox's EPERM.
      const r = await node(connect('1.1.1.1'), open);
      expect(r.stdout.trim()).not.toBe('ERR EPERM');
    });
  }
);
