import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ProcessGroupRegistry,
  StopLatchedError,
} from '@core/features/exec-runs/api/node/process-group';
import {
  createPrepareReviewCheckout,
  isReviewCheckout,
  isSafeReviewPath,
  prepareReviewCheckout,
} from './review-checkout';
import { git, makeRepoWithLanes, snapshotWorktree, tempRoot } from './test-fixtures';
import type { GateJob } from './types';

const root = tempRoot('nb-checkout-');
afterAll(() => rmSync(root, { recursive: true, force: true }));
const { repo, lanePaths } = makeRepoWithLanes(root, ['lane-a']);
const [lane] = lanePaths;
const checkouts = join(root, 'checkouts');
mkdirSync(checkouts, { recursive: true });

writeFileSync(join(lane, 'tracked.txt'), 'changed\n');
writeFileSync(join(lane, 'new.txt'), 'untracked\n');
rmSync(join(lane, 'doomed.txt'));
writeFileSync(join(root, 'outside-secret.txt'), 'secret\n');
symlinkSync(join(root, 'outside-secret.txt'), join(lane, 'link-to-secret'));
writeFileSync(join(lane, '.gitignore'), 'ignored.log\n');
writeFileSync(join(lane, 'ignored.log'), 'noise\n');

describe('prepareReviewCheckout', () => {
  it('mirrors the lane working state into a temp checkout without touching the lane', async () => {
    const before = snapshotWorktree(lane);
    const checkout = await prepareReviewCheckout({ worktreePath: lane, root: checkouts });
    try {
      expect(checkout.path.startsWith(checkouts)).toBe(true);
      expect(checkout.path).not.toBe(lane);
      expect(await isReviewCheckout(checkout.path)).toBe(true);
      expect(readFileSync(join(checkout.path, 'tracked.txt'), 'utf8')).toBe('changed\n');
      expect(readFileSync(join(checkout.path, 'new.txt'), 'utf8')).toBe('untracked\n');
      expect(existsSync(join(checkout.path, 'doomed.txt'))).toBe(false);
      // Symlinks are never followed out of the worktree: git stores a link as its target path,
      // and so does the checkout. Ignored files stay out.
      expect(lstatSync(join(checkout.path, 'link-to-secret')).isFile()).toBe(true);
      expect(readFileSync(join(checkout.path, 'link-to-secret'), 'utf8')).toBe(
        join(root, 'outside-secret.txt')
      );
      expect(existsSync(join(checkout.path, 'ignored.log'))).toBe(false);
      expect(git(checkout.path, 'rev-parse', 'HEAD')).toBe(git(lane, 'rev-parse', 'HEAD'));
    } finally {
      await checkout.dispose();
    }
    expect(snapshotWorktree(lane)).toEqual(before);
    expect(readdirSync(checkouts)).toEqual([]);
    expect(await isReviewCheckout(checkout.path)).toBe(false);
    expect(git(repo, 'worktree', 'list')).not.toContain(checkouts);
    await checkout.dispose(); // idempotent
  });

  it('checks out an explicit commit without mirroring', async () => {
    const head = git(lane, 'rev-parse', 'HEAD');
    const checkout = await prepareReviewCheckout({
      worktreePath: lane,
      commit: head.slice(0, 12),
      root: checkouts,
    });
    expect(checkout.commit).toBe(head);
    await checkout.dispose();
  });

  it('refuses a malformed commit and a checkout root inside the worktree', async () => {
    await expect(
      prepareReviewCheckout({ worktreePath: lane, commit: '--output=x', root: checkouts })
    ).rejects.toThrow(/Invalid review commit/);
    await expect(prepareReviewCheckout({ worktreePath: lane, root: lane })).rejects.toThrow(
      /inside the worktree/
    );
  });

  it('backs the gates-core capability: job → lane worktree → checkout, never the lane', async () => {
    const job: GateJob = { id: 'job-1', title: 't', body: 'b', kind: 'code', attempt: 1 };
    const seen: GateJob[] = [];
    const capability = createPrepareReviewCheckout({
      worktreeForJob: (j) => {
        seen.push(j);
        return lane;
      },
      root: checkouts,
    });
    const checkout = await capability(job, { signal: new AbortController().signal });
    expect(seen).toEqual([job]);
    expect(checkout.path).not.toBe(lane);
    expect(readFileSync(join(checkout.path, 'new.txt'), 'utf8')).toBe('untracked\n');
    await checkout.dispose();

    const aborted = new AbortController();
    aborted.abort();
    await expect(capability(job, { signal: aborted.signal })).rejects.toThrow();
    expect(readdirSync(checkouts)).toEqual([]);
  });

  it('does not run repository hooks', async () => {
    const marker = join(root, 'hook-ran');
    const hook = join(repo, '.git', 'hooks', 'post-checkout');
    writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`);
    chmodSync(hook, 0o755);
    const checkout = await prepareReviewCheckout({ worktreePath: lane, root: checkouts });
    await checkout.dispose();
    expect(existsSync(marker)).toBe(false);
    rmSync(hook);
  });
});

const script = (name: string, body: string) => {
  const path = join(root, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
};
const realGit = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();

describe('L4 review checkout runs no repo-controlled code', () => {
  // A separate repo whose committed .gitattributes routes files through a filter the lane
  // configured, plus an fsmonitor and hooks: every one of them would run in main.
  const hostileRoot = join(root, 'hostile');
  mkdirSync(hostileRoot, { recursive: true });
  const { repo: hostileRepo, lanePaths: hostileLanes } = makeRepoWithLanes(hostileRoot, ['lane-h']);
  const [hostileLane] = hostileLanes;
  writeFileSync(join(hostileLane, '.gitattributes'), '*.txt filter=evil\n');
  writeFileSync(join(hostileLane, 'filtered.txt'), 'raw blob\n');
  git(hostileLane, 'add', '.');
  git(hostileLane, 'commit', '-q', '-m', 'attributes');
  const markers = join(hostileRoot, 'markers');
  mkdirSync(markers, { recursive: true });
  const evil = script('evil.sh', `touch '${markers}'/"$(basename "$0")-$$"; cat`);
  git(hostileRepo, 'config', 'filter.evil.smudge', evil);
  git(hostileRepo, 'config', 'filter.evil.clean', evil);
  git(hostileRepo, 'config', 'filter.evil.required', 'true');
  git(hostileRepo, 'config', 'core.fsmonitor', evil);
  writeFileSync(join(hostileLane, 'filtered.txt'), 'uncommitted\n'); // forces a clean on diff

  it('empties filter drivers and disables fsmonitor, hooks and file://', async () => {
    const log = join(hostileRoot, 'git-calls.log');
    const wrapper = script(
      'git-wrapper.sh',
      `printf '%s\\n' "ARGS $*" >> '${log}'; env | sed 's/^/ENV /' >> '${log}'; exec '${realGit}' "$@"`
    );
    const checkout = await prepareReviewCheckout({
      worktreePath: hostileLane,
      root: checkouts,
      gitBinary: wrapper,
      parentEnv: { ...process.env, NINEBRAINS_TOKEN: 'nb-live-token-123', GITHUB_TOKEN: 'ghp_x' },
    });
    try {
      expect(readdirSync(markers)).toEqual([]);
      expect(readFileSync(join(checkout.path, 'filtered.txt'), 'utf8')).toBe('uncommitted\n');
    } finally {
      await checkout.dispose();
    }
    expect(readdirSync(markers)).toEqual([]);
    const calls = readFileSync(log, 'utf8');
    expect(calls).not.toMatch(/NINEBRAINS_TOKEN|nb-live-token|GITHUB_TOKEN/);
    for (const flag of [
      'core.fsmonitor= ',
      'core.hooksPath=/dev/null',
      'protocol.file.allow=never',
      'filter.evil.smudge= ',
      'filter.evil.clean= ',
      'filter.evil.required=false',
    ]) {
      expect(calls).toContain(flag);
    }
  });
});

/** A lane repo turned into a partial clone whose promisor "fetch" runs a command over ssh. */
function makeLazyFetchTrap(repo: string, marker: string): void {
  git(repo, 'config', 'core.repositoryformatversion', '1');
  git(repo, 'config', 'extensions.partialClone', 'evil');
  git(repo, 'config', 'remote.evil.url', 'ssh://attacker.invalid/x');
  git(repo, 'config', 'core.sshCommand', `touch '${marker}'; false`);
}

/** Deletes the loose object for `rev` (say `HEAD:tracked.txt`), so git must fetch it. */
function deleteBlob(repo: string, rev: string): void {
  const blob = git(repo, 'rev-parse', rev);
  rmSync(join(repo, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
}

describe('T32 no lazy fetch from a review checkout', () => {
  // The lane makes its repo a partial clone and deletes a blob HEAD needs. Any git in main that
  // reads that blob would lazy-fetch it and run the lane's core.sshCommand as the user.
  const lazyRoot = join(root, 'lazy');
  mkdirSync(lazyRoot, { recursive: true });
  const { repo: lazyRepo, lanePaths: lazyLanes } = makeRepoWithLanes(lazyRoot, ['lane-l']);
  const [lazyLane] = lazyLanes;
  const marker = join(lazyRoot, 'lazy-fetch-ran');
  writeFileSync(join(lazyLane, 'tracked.txt'), 'lane edit\n');
  git(lazyLane, 'commit', '-q', '-am', 'lane edit');
  makeLazyFetchTrap(lazyRepo, marker);
  deleteBlob(lazyRepo, 'lane-l:tracked.txt'); // the lane's HEAD; the main repo is on `main`

  it('fails closed instead of running the lane repo sshCommand', async () => {
    const log = join(lazyRoot, 'git-calls.log');
    const wrapper = script(
      'git-lazy-wrapper.sh',
      `printf '%s\\n' "ARGS $*" >> '${log}'; env | sed 's/^/ENV /' >> '${log}'; exec '${realGit}' "$@"`
    );
    await expect(
      prepareReviewCheckout({ worktreePath: lazyLane, root: checkouts, gitBinary: wrapper })
    ).rejects.toThrow();
    expect(existsSync(marker)).toBe(false);
    expect(readdirSync(checkouts)).toEqual([]);
    const lines = readFileSync(log, 'utf8').split('\n');
    const argvLines = lines.filter((line) => line.startsWith('ARGS '));
    expect(argvLines.length).toBeGreaterThan(0);
    for (const line of argvLines) expect(line.startsWith('ARGS --no-lazy-fetch ')).toBe(true);
    expect(lines).toContain('ENV GIT_NO_LAZY_FETCH=1');

    // Control: the same checkout without the hardening does run the lane's command.
    const control = join(lazyRoot, 'control-checkout');
    expect(() =>
      execFileSync(realGit, ['-C', lazyLane, 'worktree', 'add', '--detach', control, 'HEAD'], {
        stdio: 'ignore',
      })
    ).toThrow();
    expect(existsSync(marker)).toBe(true);
    rmSync(marker);
    rmSync(control, { recursive: true, force: true });
    git(lazyRepo, 'worktree', 'prune');
  });
});

describe('T33 the review checkout is its own repository', () => {
  const t33 = join(root, 't33');
  mkdirSync(t33, { recursive: true });
  const { repo: t33Repo, lanePaths: t33Lanes } = makeRepoWithLanes(t33, ['lane-t']);
  const [t33Lane] = t33Lanes;
  const markers = join(t33, 'markers');
  mkdirSync(markers, { recursive: true });
  git(t33Lane, 'tag', '-a', '-m', 'base', 'v1', 'main');
  writeFileSync(join(t33Lane, 'tracked.txt'), 'lane change\n');
  writeFileSync(join(t33Lane, 'new.txt'), 'untracked\n');

  it('never reads the lane repo config, attributes or promisor, even when they change mid-review', async () => {
    const checkout = await prepareReviewCheckout({ worktreePath: t33Lane, root: checkouts });
    try {
      // Its git dir is its own, and the lane's refs resolve in it, annotated tags included.
      expect(git(checkout.path, 'rev-parse', '--path-format=absolute', '--git-common-dir')).toBe(
        join(checkout.path, '.git')
      );
      expect(git(checkout.path, 'rev-parse', 'v1^{commit}')).toBe(
        git(t33Lane, 'rev-parse', 'main')
      );
      expect(git(checkout.path, 'diff', '--name-only', 'main', '--')).toBe('tracked.txt');
      expect(git(checkout.path, 'ls-files', '--others', '--exclude-standard')).toBe('new.txt');

      // A lane process that outlived complete_job (R14) adds a filter for every file.
      const evil = script('late-filter.sh', `touch '${markers}'/late-filter; cat`);
      git(t33Repo, 'config', 'filter.late.clean', evil);
      git(t33Repo, 'config', 'filter.late.smudge', evil);
      writeFileSync(join(t33Repo, '.git', 'info', 'attributes'), '* filter=late\n');
      // The reviewer gate's diff runs here after its driver listing; plain git shows the race.
      expect(git(checkout.path, 'diff', '--name-only', 'main', '--')).toBe('tracked.txt');
      expect(readdirSync(markers)).toEqual([]);

      // Then it adds a promisor and deletes the base blob: the diff fails, nothing is fetched.
      makeLazyFetchTrap(t33Repo, join(markers, 'lazy-fetch'));
      deleteBlob(t33Repo, 'main:tracked.txt');
      expect(() => git(checkout.path, 'diff', 'main', '--')).toThrow();
      expect(readdirSync(markers)).toEqual([]);
    } finally {
      await checkout.dispose();
    }
    expect(readdirSync(checkouts)).toEqual([]);
  });
});

describe('T35 mirroring never follows a symlink or a hard link', () => {
  const t35 = join(root, 't35');
  mkdirSync(t35, { recursive: true });
  const { lanePaths: t35Lanes } = makeRepoWithLanes(t35, ['lane-s']);
  const [t35Lane] = t35Lanes;
  const target = join(t35, 'outside-target.txt');
  writeFileSync(target, 'original\n');
  const secretDir = join(t35, 'secret-dir');
  mkdirSync(secretDir);
  writeFileSync(join(secretDir, 'key.txt'), 'SECRET\n');
  mkdirSync(join(t35Lane, 'keys'));
  writeFileSync(join(t35Lane, 'keys', 'key.txt'), 'public\n');
  symlinkSync(target, join(t35Lane, 'file-link'));
  git(t35Lane, 'add', '.');
  git(t35Lane, 'commit', '-q', '-m', 'links');
  // Uncommitted: the committed link becomes a real file, `keys` becomes a link to a secret
  // directory (the index still lists keys/key.txt), and a new file is a hard link to a secret.
  rmSync(join(t35Lane, 'file-link'));
  writeFileSync(join(t35Lane, 'file-link'), 'pwned\n');
  rmSync(join(t35Lane, 'keys'), { recursive: true });
  symlinkSync(secretDir, join(t35Lane, 'keys'));
  linkSync(join(secretDir, 'key.txt'), join(t35Lane, 'hard.txt'));

  it('writes nothing outside the checkout and copies no secret into it', async () => {
    const checkout = await prepareReviewCheckout({ worktreePath: t35Lane, root: checkouts });
    try {
      expect(readFileSync(target, 'utf8')).toBe('original\n');
      expect(readFileSync(join(checkout.path, 'file-link'), 'utf8')).toBe('pwned\n');
      // The lane's link is mirrored the way git stores one: a file holding the target path.
      expect(lstatSync(join(checkout.path, 'keys')).isFile()).toBe(true);
      expect(readFileSync(join(checkout.path, 'keys'), 'utf8')).toBe(secretDir);
      expect(existsSync(join(checkout.path, 'hard.txt'))).toBe(false);
      expect(symlinksUnder(checkout.path)).toEqual([]);
      expect(readFileSync(join(secretDir, 'key.txt'), 'utf8')).toBe('SECRET\n');
    } finally {
      await checkout.dispose();
    }
  });
});

describe('isSafeReviewPath', () => {
  it('refuses .git in any spelling, traversal and absolute paths', () => {
    for (const bad of [
      '.git/config',
      'sub/.GIT/config',
      'sub/.git./hooks/x',
      'sub/.g‌it/config',
      'git~1/config',
      '../x',
      'a/../../x',
      '/etc/passwd',
      'a//b',
      'dir/',
      '',
    ]) {
      expect(isSafeReviewPath(bad, 'linux'), bad).toBe(false);
    }
    expect(isSafeReviewPath('a\\..\\x', 'win32')).toBe(false);
    expect(isSafeReviewPath('a:stream', 'win32')).toBe(false);
    for (const good of ['src/app.ts', '.gitignore', '.github/workflows/ci.yml', 'a.git/x']) {
      expect(isSafeReviewPath(good, 'linux'), good).toBe(true);
    }
  });
});

function symlinksUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isSymbolicLink())
    .map((entry) => join(entry.parentPath, entry.name));
}

describe('SEC-30 kill switch reaches review-checkout git', () => {
  it('killAll stops a hung git and its grandchild, then refuses new checkouts', async () => {
    const pidFile = join(root, 'git-grandchild.pid');
    const hung = script(
      'git-hung.sh',
      `trap '' TERM; sh -c 'echo $$ > "${pidFile}"; exec sleep 999' & wait`
    );
    const groups = new ProcessGroupRegistry();
    const pending = prepareReviewCheckout({
      worktreePath: lane,
      root: checkouts,
      gitBinary: hung,
      groups,
    });
    pending.catch(() => undefined);
    for (let i = 0; i < 100 && !(existsSync(pidFile) && readFileSync(pidFile, 'utf8')); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    const t0 = Date.now();
    await groups.killAll(2000);
    await expect(pending).rejects.toThrow();
    while (alive(pid) && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
    expect(alive(pid)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(5000);
    await expect(
      prepareReviewCheckout({ worktreePath: lane, root: checkouts, groups })
    ).rejects.toBeInstanceOf(StopLatchedError);
    expect(readdirSync(checkouts)).toEqual([]);
  }, 20_000);
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
