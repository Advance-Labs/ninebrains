import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
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
      // Symlinks are never followed out of the worktree, and ignored files stay out.
      expect(existsSync(join(checkout.path, 'link-to-secret'))).toBe(false);
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
    const pid = await waitForPid(pidFile, 5_000);
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

/**
 * Waits for the hung git's grandchild to write its pid. On the deadline it fails with a named
 * setup error: reading the missing file used to surface as a bare ENOENT, which looked like a
 * SEC-30 regression when the host was only too loaded to spawn. An empty file is still "not yet",
 * so a half-written pid can never become `0` (which `process.kill` reads as the process group).
 */
async function waitForPid(file: string, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
    if (text) return Number(text);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    `SEC-30 setup: the hung git never started its grandchild (no pid in ${file} after ` +
      `${timeoutMs} ms). The host was too loaded to spawn; this is not a kill-switch failure.`
  );
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
