import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Brain, InMemoryBrainStore } from '@ninebrains/brain-core';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { ExecRunSupervisor } from '@core/features/exec-runs/api/node/run-supervisor';
import { APP_IDENTITY, type DispatchLane } from './dispatcher';
import { startBrainEndpoint, type BrainEndpoint } from './endpoint';
import { runJobUnattended } from './unattended';

const repo = (path: string) => fileURLToPath(new URL(`../../../../../../../${path}`, import.meta.url));
const FAKE_CLAUDE = repo('tooling/fake-agent/bin/fake-claude.mjs');
const BRAIN_MCP_BIN = repo('packages/brain-mcp/dist/bin.mjs');

const root = realpathSync(mkdtempSync(join(tmpdir(), 'nb-unattended-')));
const worktrees = join(root, 'worktrees');
afterAll(() => rmSync(root, { recursive: true, force: true }));

const q = (v: string) => `'${v.replaceAll("'", `'\\''`)}'`;

/** The supervisor scrubs env (SEC-13), so the fake's script is baked into a wrapper binary. */
function fakeClaude(steps: unknown[]): string {
  const path = join(root, `claude-${randomUUID()}.sh`);
  writeFileSync(
    path,
    `#!/bin/sh\nexport FAKE_AGENT_SCRIPT=${q(JSON.stringify(steps))}\nexec ${q(process.execPath)} ${q(FAKE_CLAUDE)} "$@"\n`
  );
  chmodSync(path, 0o755);
  return path;
}

let endpoint: BrainEndpoint | null = null;
afterEach(async () => {
  await endpoint?.close();
  endpoint = null;
});

async function setup(steps: (jobId: string) => unknown[]) {
  const brain = new Brain({ store: new InMemoryBrainStore() });
  endpoint = await startBrainEndpoint({ brain, onInternalError: () => {} });
  brain.upsertLane(APP_IDENTITY, { id: 'lane-A', projectId: 'p1', provider: 'claude', status: 'idle' });
  const job = brain.createJob(APP_IDENTITY, { projectId: 'p1', title: 'Write the report' });
  const assigned = brain.assignJob(APP_IDENTITY, job.id, 'lane-A');
  const worktree = join(worktrees, `lane-${randomUUID().slice(0, 8)}`);
  mkdirSync(worktree, { recursive: true });
  const supervisor = new ExecRunSupervisor({
    userDataDir: join(root, 'userData'),
    resolveBinary: async () => fakeClaude(steps(job.id)),
    allowedRoots: () => [worktrees],
    maxConcurrentRuns: 2,
  });
  const lane: DispatchLane = {
    laneId: 'lane-A',
    projectId: 'p1',
    provider: 'claude',
    sessionRunning: false,
    asleep: false,
    worktreePath: worktree,
  };
  const deps = {
    brain,
    supervisor,
    endpoint,
    brainMcp: { execPath: process.execPath, binPath: BRAIN_MCP_BIN },
    pack: async () => undefined,
    siblingWorktrees: () => [],
    budgets: { wallClockMs: 30_000, maxTurns: 10 },
  };
  return { brain, endpoint, job: assigned, lane, deps };
}

describe('unattended run over the real brain-mcp and endpoint', () => {
  it('runs claude -p with a run-scoped token; complete_job lands and the token is revoked', async () => {
    const { brain, endpoint: ep, job, lane, deps } = await setup((jobId) => [
      { callTool: { server: 'brain', tool: 'complete_job', args: { jobId, summary: 'done via -p' } } },
      { say: 'reported' },
    ]);
    const result = await runJobUnattended(deps, lane, job);

    expect(result?.ok).toBe(true);
    const after = brain.getJob(APP_IDENTITY, job.id);
    expect(after.state).toBe('verifying');
    expect(after.result?.summary).toBe('done via -p');
    expect(ep.liveTokens()).toBe(0);
    const [run] = brain.listRuns(APP_IDENTITY, { jobId: job.id });
    expect(run).toMatchObject({ mode: 'unattended', laneId: 'lane-A', exitCode: 0 });
    expect(run!.endedAt).not.toBeNull();
  });

  it('fails the job, never leaves it running, when the agent exits without reporting', async () => {
    const { brain, endpoint: ep, job, lane, deps } = await setup(() => [{ say: 'I forgot' }]);
    await runJobUnattended(deps, lane, job);
    const after = brain.getJob(APP_IDENTITY, job.id);
    expect(after.state).toBe('failed');
    expect(after.reason).toMatch(/without complete_job/);
    expect(ep.liveTokens()).toBe(0);
  });
});
