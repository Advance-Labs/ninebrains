/**
 * `spawnReviewer` (SEC-18): a fresh, read-only, unattended run that never touches the lane.
 *
 * - Runs in a disposable review checkout, never the lane worktree. gates-core passes a checkout
 *   from `prepareReviewCheckout`, which is reused. Anything else in `opts.cwd` (say, a caller that
 *   hands over the lane worktree by mistake) gets its own checkout: defence in depth.
 * - Claude: `--tools=Read,Grep,Glob`, Bash/Edit/Write disallowed, `--permission-mode=dontAsk`,
 *   the sandbox with no writable path, and the live lane worktree plus sibling lanes denied for
 *   reading. Codex: `exec --sandbox read-only`.
 * - Gate evidence lives under `<userData>/ninebrains/evidence`, which every run is denied, so
 *   attachments are copied into the checkout under `.ninebrains-evidence/`.
 * - Options it cannot honour make it throw (gates-core contract): an unknown option, or `tools`
 *   other than `'read-only'`. `mcpServers` is honoured on both providers.
 */
import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ExecRunSupervisor } from '@core/features/exec-runs/api/node/run-supervisor';
import type {
  ExecProvider,
  McpServerSpec,
  ProviderAuthEnv,
  RunBudgets,
} from '@core/features/exec-runs/api/node/types';
import { isReviewCheckout, prepareReviewCheckout } from './review-checkout';
import type { Evidence, SpawnReviewer, SpawnReviewerOptions } from './types';

const KNOWN_OPTIONS = new Set(['signal', 'cwd', 'tools', 'attachments', 'purpose', 'mcpServers']);
const EVIDENCE_DIR = '.ninebrains-evidence';
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const DEFAULT_BUDGETS: RunBudgets = { wallClockMs: 10 * 60_000, maxTurns: 40 };

export interface ReviewerRoute {
  provider: ExecProvider;
  model?: string;
}

export interface SpawnReviewerDeps {
  supervisor: Pick<ExecRunSupervisor, 'run'>;
  /** Picks provider and model per gate `purpose`, e.g. Codex reviews Claude's work. */
  route?: (purpose: string) => ReviewerRoute;
  auth?: (provider: ExecProvider) => ProviderAuthEnv | undefined;
  budgets?: RunBudgets;
  /** Parent dir for review checkouts; must be in the supervisor's allowed roots. */
  checkoutRoot?: string;
  /** Every lane worktree, so the reviewer can't read any of them. */
  laneWorktrees?: () => readonly string[];
}

function assertSupportedOptions(opts: SpawnReviewerOptions): void {
  for (const [key, value] of Object.entries(opts)) {
    if (value !== undefined && !KNOWN_OPTIONS.has(key)) {
      throw new Error(`spawnReviewer cannot honour option "${key}"`);
    }
  }
  if (opts.tools !== 'read-only') {
    throw new Error(`spawnReviewer only runs read-only reviews, got tools: ${JSON.stringify(opts.tools)}`);
  }
  for (const [name, server] of Object.entries(opts.mcpServers ?? {})) {
    const ok =
      typeof server?.command === 'string' &&
      (server.args ?? []).every((a) => typeof a === 'string') &&
      Object.values(server.env ?? {}).every((v) => typeof v === 'string');
    if (!ok) throw new Error(`spawnReviewer: invalid MCP server "${name}"`);
  }
}

interface Attached {
  relPath: string;
  evidence: Evidence;
}

async function copyAttachments(attachments: readonly Evidence[], checkout: string): Promise<Attached[]> {
  if (attachments.length === 0) return [];
  const dir = join(checkout, EVIDENCE_DIR);
  await mkdir(dir, { recursive: true });
  const out: Attached[] = [];
  for (const [i, evidence] of attachments.entries()) {
    const info = await lstat(evidence.path).catch(() => undefined);
    if (!info?.isFile() || info.size > MAX_ATTACHMENT_BYTES) continue;
    const name = `${i}-${basename(evidence.path).replace(/[^A-Za-z0-9._-]/g, '_')}`;
    await copyFile(evidence.path, join(dir, name));
    out.push({ relPath: `${EVIDENCE_DIR}/${name}`, evidence });
  }
  return out;
}

function withAttachments(prompt: string, attached: readonly Attached[]): string {
  if (attached.length === 0) return prompt;
  const lines = attached.map((a) => `- ${a.relPath} (${a.evidence.kind}: ${a.evidence.label})`);
  return `${prompt}\n\n# Evidence files\nThese gate-captured files are in your working directory:\n${lines.join('\n')}`;
}

export function createSpawnReviewer(deps: SpawnReviewerDeps): SpawnReviewer {
  return async (prompt, opts) => {
    assertSupportedOptions(opts);
    opts.signal.throwIfAborted();
    const source = await realpath(opts.cwd);
    const reuse = await isReviewCheckout(source);
    const checkout = reuse
      ? undefined
      : await prepareReviewCheckout({ worktreePath: source, root: deps.checkoutRoot });
    const cwd = checkout?.path ?? source;
    try {
      const attached = await copyAttachments(opts.attachments, cwd);
      const route = deps.route?.(opts.purpose) ?? { provider: 'claude' as const };
      const denied = [...(reuse ? [] : [source]), ...(deps.laneWorktrees?.() ?? [])];
      const result = await deps.supervisor.run(
        {
          runId: `review-${randomUUID().slice(0, 12)}`,
          provider: route.provider,
          model: route.model,
          preset: 'reviewer',
          cwd,
          prompt: withAttachments(prompt, attached),
          budgets: deps.budgets ?? DEFAULT_BUDGETS,
          mcpServers: opts.mcpServers as Readonly<Record<string, McpServerSpec>> | undefined,
          siblingWorktrees: [...new Set(denied)].filter((p) => p !== cwd),
          auth: deps.auth?.(route.provider),
        },
        { signal: opts.signal }
      );
      if (!result.ok) {
        throw new Error(`Reviewer run failed (${result.reason}): ${result.errors.join('; ').slice(0, 1000)}`);
      }
      return { text: result.text ?? '' };
    } finally {
      await checkout?.dispose();
    }
  };
}
