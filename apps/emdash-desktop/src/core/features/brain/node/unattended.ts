import type { Brain, Job } from '@ninebrains/brain-core';
import type {
  ExecRunResult,
  ExecRunSpec,
  McpServerSpec,
  RunBudgets,
} from '@core/features/exec-runs/api/node/types';
import type { PackLaunch } from '@core/features/packs/api/launch';
import type { DispatchLane } from './dispatcher';
import { APP_IDENTITY } from './dispatcher';
import { runLaunchKey, type BrainEndpoint } from './endpoint';
import { buildJobPrompt } from './job-prompt';
import { brainServerEntry, usablePackServers, type BrainMcpRuntime } from './launch-config';

export const DEFAULT_UNATTENDED_BUDGETS: RunBudgets = {
  wallClockMs: 30 * 60_000,
  maxTurns: 60,
};

export interface UnattendedDeps {
  brain: Brain;
  supervisor: { run(spec: ExecRunSpec): Promise<ExecRunResult> };
  endpoint: Pick<BrainEndpoint, 'url' | 'mint' | 'revoke'>;
  brainMcp: BrainMcpRuntime;
  pack(projectId: string): Promise<PackLaunch | undefined>;
  siblingWorktrees(laneId: string): string[];
  budgets?: RunBudgets;
}

/**
 * Runs one job with `claude -p` through the exec supervisor (SEAMS §3.8).
 * The run gets its own token, scoped to the lane and bound to the run id, and
 * the token is revoked when the run ends, however it ends. If the agent exits
 * without reporting, the job fails with the reason; it is never left running.
 * HTTP pack servers are skipped: the supervisor's MCP config is stdio-only.
 */
export async function runJobUnattended(
  deps: UnattendedDeps,
  lane: DispatchLane,
  job: Job
): Promise<ExecRunResult | undefined> {
  const { brain } = deps;
  if (!lane.worktreePath) {
    brain.releaseJob(APP_IDENTITY, job.id);
    return undefined;
  }
  const run = brain.startRun(APP_IDENTITY, {
    jobId: job.id,
    laneId: lane.laneId,
    mode: 'unattended',
  });
  const launchKey = runLaunchKey(run.id);
  let result: ExecRunResult | undefined;
  let failure: string | null = null;
  try {
    const token = deps.endpoint.mint(launchKey, {
      identity: { role: 'lane', laneId: lane.laneId, projectId: lane.projectId },
      projectId: lane.projectId,
      attachmentRoots: [lane.worktreePath],
      runId: run.id,
    });
    const pack = await deps.pack(lane.projectId);
    const mcpServers: Record<string, McpServerSpec> = {
      brain: brainServerEntry(deps.brainMcp, deps.endpoint.url, token, lane.laneId),
    };
    for (const server of usablePackServers(pack)) {
      if (server.type === 'stdio') mcpServers[server.name] = server;
    }
    result = await deps.supervisor.run({
      runId: run.id,
      provider: lane.provider,
      preset: 'worker',
      cwd: lane.worktreePath,
      prompt: buildJobPrompt(job),
      budgets: deps.budgets ?? DEFAULT_UNATTENDED_BUDGETS,
      mcpServers,
      appendSystemPrompt: pack?.appendSystemPrompt,
      siblingWorktrees: deps.siblingWorktrees(lane.laneId),
    });
    if (!result.ok) failure = `unattended run ended: ${result.reason}`;
  } catch (error) {
    failure = `unattended run could not start: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    deps.endpoint.revoke(launchKey);
    brain.endRun(APP_IDENTITY, run.id, { exitCode: result?.exitCode ?? null });
  }
  const after = brain.getJob(APP_IDENTITY, job.id);
  if (after.state === 'claimed' || after.state === 'running') {
    brain.failJob(APP_IDENTITY, job.id, failure ?? 'the run ended without complete_job');
  }
  return result;
}
