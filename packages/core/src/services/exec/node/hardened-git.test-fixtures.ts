/**
 * Ninebrains test helper (T36): a repository whose config plants each code path a lane could use
 * against the app's git calls: fsmonitor, a clean/smudge filter, `core.sshCommand` on an ssh
 * remote, a partial-clone promisor with a blob deleted, and hooks. Each one touches a marker file,
 * so a test sees exactly what ran.
 */
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface HostileRepo {
  root: string;
  repo: string;
  /** For the exec under test and for controls: no global or system config, no ssh override. */
  env: NodeJS.ProcessEnv;
  /** Plain, unhardened git in the repo. */
  git(...args: string[]): string;
  /** The planted paths that have run since the last `clear()`, sorted. */
  ran(): string[];
  clear(): void;
  dispose(): void;
}

export const PLANTED_HOOKS = ['pre-commit', 'post-checkout', 'reference-transaction'] as const;

export function makeHostileRepo(): HostileRepo {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nb-hostile-git-')));
  const repo = join(root, 'repo');
  const markers = join(root, 'markers');
  mkdirSync(repo);
  mkdirSync(markers);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
  for (const key of ['GIT_SSH_COMMAND', 'GIT_SSH', 'GIT_NO_LAZY_FETCH', 'GIT_CONFIG_COUNT']) {
    delete env[key];
  }
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: repo,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const script = (name: string, body: string) => {
    const path = join(root, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
  };

  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'a.txt'), 'base\n');
  writeFileSync(join(repo, 'b.txt'), 'never fetched\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  writeFileSync(join(repo, 'a.txt'), 'change\n'); // a modified file: status and diff read it

  // fsmonitor exits 1 (git falls back); only the filter reads stdin.
  git('config', 'core.fsmonitor', script('fsmonitor.sh', `touch '${markers}/fsmonitor'; exit 1`));
  const filter = script('filter.sh', `touch '${markers}/filter'; cat`);
  git('config', 'filter.evil.clean', filter);
  git('config', 'filter.evil.smudge', filter);
  mkdirSync(join(repo, '.git', 'info'), { recursive: true });
  writeFileSync(join(repo, '.git', 'info', 'attributes'), '* filter=evil\n');
  git('config', 'core.sshCommand', script('ssh.sh', `touch '${markers}/ssh'; exit 1`));
  git('remote', 'add', 'origin', 'ssh://attacker.invalid/x');
  git('config', 'core.repositoryformatversion', '1');
  git('config', 'extensions.partialClone', 'origin');
  const blob = git('rev-parse', 'HEAD:b.txt');
  rmSync(join(repo, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
  mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
  for (const hook of PLANTED_HOOKS) {
    const path = join(repo, '.git', 'hooks', hook);
    writeFileSync(path, `#!/bin/sh\ntouch '${markers}/hook-${hook}'\n`);
    chmodSync(path, 0o755);
  }

  const clear = () => {
    for (const file of readdirSync(markers)) rmSync(join(markers, file));
  };
  clear();
  return {
    root,
    repo,
    env,
    git,
    ran: () => readdirSync(markers).sort(),
    clear,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}
