import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrepareReviewCheckout, isReviewCheckout, prepareReviewCheckout } from './review-checkout';
import type { GateJob } from './types';
import { git, makeRepoWithLanes, snapshotWorktree, tempRoot } from './test-fixtures';

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
    const checkout = await prepareReviewCheckout({ worktreePath: lane, commit: head.slice(0, 12), root: checkouts });
    expect(checkout.commit).toBe(head);
    await checkout.dispose();
  });

  it('refuses a malformed commit and a checkout root inside the worktree', async () => {
    await expect(prepareReviewCheckout({ worktreePath: lane, commit: '--output=x', root: checkouts })).rejects.toThrow(
      /Invalid review commit/
    );
    await expect(prepareReviewCheckout({ worktreePath: lane, root: lane })).rejects.toThrow(/inside the worktree/);
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
