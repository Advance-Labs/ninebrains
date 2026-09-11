import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ExecRunSupervisor } from '@core/features/exec-runs/api/node/run-supervisor';
import { prepareReviewCheckout } from './review-checkout';
import { createSpawnReviewer } from './spawn-reviewer';
import {
  ECHO_MCP_SERVER,
  fakeClaudeWrapper,
  git,
  makeRepoWithLanes,
  snapshotWorktree,
  tempRoot,
} from './test-fixtures';
import type { SpawnReviewerOptions } from './types';

const root = tempRoot('nb-reviewer-');
afterAll(() => rmSync(root, { recursive: true, force: true }));
const { repo, worktrees, lanePaths } = makeRepoWithLanes(root, ['lane-a', 'lane-b']);
const [laneA, laneB] = lanePaths;
const checkouts = join(root, 'checkouts');
const userData = join(root, 'userData');
mkdirSync(checkouts, { recursive: true });

// Lane A holds uncommitted work, as a worker would leave it.
writeFileSync(join(laneA, 'tracked.txt'), 'changed by worker\n');
writeFileSync(join(laneA, 'new.txt'), 'untracked\n');
rmSync(join(laneA, 'doomed.txt'));

const VERDICT = '{"pass":true,"issues":[]}';

function reviewerWith(env: Record<string, string>) {
  const supervisor = new ExecRunSupervisor({
    userDataDir: userData,
    resolveBinary: async () => fakeClaudeWrapper(root, env),
    allowedRoots: () => [worktrees, checkouts],
    maxConcurrentRuns: 4,
  });
  return {
    supervisor,
    spawnReviewer: createSpawnReviewer({
      supervisor,
      checkoutRoot: checkouts,
      laneWorktrees: () => lanePaths,
    }),
  };
}

const opts = (over: Partial<SpawnReviewerOptions> = {}): SpawnReviewerOptions => ({
  signal: new AbortController().signal,
  cwd: laneA,
  tools: 'read-only',
  attachments: [],
  purpose: 'reviewer',
  ...over,
});

/** Every write a reviewer might try: relative, absolute into the lane, rm, git commit. */
const hostile = (lane: string) => [
  { writeFile: { path: 'pwned.txt', content: 'x' } },
  { writeFile: { path: join(lane, 'pwned-abs.txt'), content: 'x' } },
  { writeFile: { path: join(lane, 'tracked.txt'), content: 'overwritten' } },
  { bash: 'rm -f tracked.txt new.txt' },
  { bash: 'git add -A && git commit -q --allow-empty -m pwned' },
  {
    bash: `echo x > '${lane}/abs-bash.txt'; rm -f '${lane}/tracked.txt'; git -C '${lane}' commit -q --allow-empty -m pwned`,
  },
  { say: VERDICT },
];

describe('SEC-18 reviewer cannot write the worktree', () => {
  beforeEach(() => {
    expect(readdirSync(checkouts)).toEqual([]);
  });

  it('control: the same hostile script does write when a worker is allowed to', async () => {
    const before = snapshotWorktree(laneB);
    const { supervisor } = reviewerWith({ FAKE_AGENT_SCRIPT: JSON.stringify(hostile(laneB)) });
    const result = await supervisor.run({
      runId: 'control-worker',
      provider: 'claude',
      preset: 'worker',
      cwd: laneB,
      prompt: 'go',
      budgets: { wallClockMs: 20_000 },
    });
    expect(result.ok).toBe(true);
    expect(existsSync(join(laneB, 'pwned.txt'))).toBe(true);
    expect(snapshotWorktree(laneB)).not.toEqual(before);
  });

  it('leaves the lane worktree byte-for-byte unchanged', async () => {
    const argvLog = join(root, 'reviewer-argv.jsonl');
    const before = snapshotWorktree(laneA);
    const { spawnReviewer } = reviewerWith({
      FAKE_AGENT_SCRIPT: JSON.stringify(hostile(laneA)),
      FAKE_AGENT_ARGV_LOG: argvLog,
    });

    await expect(spawnReviewer('review this', opts())).resolves.toEqual({ text: VERDICT });

    expect(snapshotWorktree(laneA)).toEqual(before);
    for (const f of ['pwned.txt', 'pwned-abs.txt', 'abs-bash.txt'])
      expect(existsSync(join(laneA, f))).toBe(false);

    // It ran in a disposable checkout with Read/Grep/Glob only, and the checkout is gone.
    const launch = JSON.parse(readFileSync(argvLog, 'utf8').trim());
    expect(launch.cwd.startsWith(checkouts)).toBe(true);
    expect(launch.argv).toContain('--tools=Read,Grep,Glob');
    expect(launch.argv).toContain('--disallowedTools=Bash');
    expect(launch.argv).toContain('--permission-mode=dontAsk');
    expect(readdirSync(checkouts)).toEqual([]);
    expect(git(repo, 'worktree', 'list')).not.toContain(checkouts);
  });

  it('reuses a checkout it is handed and never returns the lane itself', async () => {
    const checkout = await prepareReviewCheckout({ worktreePath: laneA, root: checkouts });
    expect(checkout.path).not.toBe(laneA);
    const argvLog = join(root, 'reuse-argv.jsonl');
    const { spawnReviewer } = reviewerWith({
      FAKE_AGENT_SCRIPT: JSON.stringify([{ say: VERDICT }]),
      FAKE_AGENT_ARGV_LOG: argvLog,
    });
    await spawnReviewer('p', opts({ cwd: checkout.path }));
    expect(JSON.parse(readFileSync(argvLog, 'utf8').trim()).cwd).toBe(checkout.path);
    await checkout.dispose();
  });
});

describe('spawnReviewer options', () => {
  it('copies attachments into the checkout and lists them in the prompt', async () => {
    const evidenceDir = join(userData, 'ninebrains', 'evidence', 'job-1', '1');
    mkdirSync(evidenceDir, { recursive: true });
    const shot = join(evidenceDir, 'shot 1440.png');
    writeFileSync(shot, 'png-bytes');
    const { spawnReviewer } = reviewerWith({
      FAKE_AGENT_SCRIPT: JSON.stringify([{ say: '{{prompt}}' }]),
    });
    const { text } = await spawnReviewer(
      'review',
      opts({ attachments: [{ kind: 'screenshot', path: shot, label: 'Desktop 1440' }] })
    );
    expect(text).toContain('.ninebrains-evidence/0-shot_1440.png (screenshot: Desktop 1440)');
  });

  it('honours mcpServers', async () => {
    const argvLog = join(root, 'mcp-argv.jsonl');
    const { spawnReviewer } = reviewerWith({
      FAKE_AGENT_SCRIPT: JSON.stringify([
        { callTool: { server: 'echo', tool: 'echo', args: { text: 'gsc rows' } } },
        { say: '{{lastToolResult}}' },
      ]),
      FAKE_AGENT_ARGV_LOG: argvLog,
    });
    const { text } = await spawnReviewer(
      'p',
      opts({ mcpServers: { echo: { command: process.execPath, args: [ECHO_MCP_SERVER] } } })
    );
    expect(text).toContain('gsc rows');
    expect(JSON.parse(readFileSync(argvLog, 'utf8').trim()).argv).toContain(
      '--allowedTools=mcp__echo'
    );
  });

  it('throws on an option it cannot honour, and on tools other than read-only', async () => {
    const { spawnReviewer } = reviewerWith({ FAKE_AGENT_SCRIPT: '[]' });
    const unknown = { ...opts(), network: 'full' } as unknown as SpawnReviewerOptions;
    await expect(spawnReviewer('p', unknown)).rejects.toThrow(/cannot honour option "network"/);
    const legacy = { ...opts(), readOnly: true } as unknown as SpawnReviewerOptions;
    await expect(spawnReviewer('p', legacy)).rejects.toThrow(/cannot honour option "readOnly"/);
    await expect(spawnReviewer('p', opts({ tools: 'all' as 'read-only' }))).rejects.toThrow(
      /read-only/
    );
    await expect(
      spawnReviewer('p', opts({ mcpServers: { bad: { command: 3 as unknown as string } } }))
    ).rejects.toThrow(/invalid MCP server/);
  });

  it('fails loudly when the reviewer run fails, and still disposes the checkout', async () => {
    const { spawnReviewer } = reviewerWith({ FAKE_AGENT_SCRIPT: JSON.stringify([{ exit: 2 }]) });
    await expect(spawnReviewer('p', opts())).rejects.toThrow(
      /Reviewer run failed \(exit-nonzero\)/
    );
    expect(readdirSync(checkouts)).toEqual([]);
  });
});
