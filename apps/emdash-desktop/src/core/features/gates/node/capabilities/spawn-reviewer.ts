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
import type { LaunchRouting } from '@core/features/routing/api/node/launch-env';
import { isReviewCheckout, prepareReviewCheckout } from './review-checkout';
import type { Evidence, ReviewerMcpServers, SpawnReviewer, SpawnReviewerOptions } from './types';

const KNOWN_OPTIONS = new Set(['signal', 'cwd', 'tools', 'attachments', 'purpose', 'mcpServers']);
const EVIDENCE_DIR = '.ninebrains-evidence';
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const DEFAULT_BUDGETS: RunBudgets = { wallClockMs: 10 * 60_000, maxTurns: 40 };

export interface ReviewerRoute {
  provider: ExecProvider;
  model?: string;
  /**
   * The reviewer's pinned model profile route (SEC-42), from `reviewer-route.ts`'s app setting.
   * Undefined: the reviewer runs on the user's subscription login, unchanged from before this
   * field existed. Becomes `ExecRunSpec.reviewerRoute`, never `.routing` (that field's own
   * contract says reviewers never set it).
   */
  routing?: LaunchRouting;
}

export interface SpawnReviewerDeps {
  supervisor: Pick<ExecRunSupervisor, 'run'>;
  /** Picks provider, model and route per gate `purpose`, e.g. Codex reviews Claude's work. */
  route?: (purpose: string) => ReviewerRoute | Promise<ReviewerRoute>;
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
    throw new Error(
      `spawnReviewer only runs read-only reviews, got tools: ${JSON.stringify(opts.tools)}`
    );
  }
}

const isStringRecord = (value: unknown): boolean =>
  value === undefined ||
  (typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((v) => typeof v === 'string'));

const isHttpUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

function toSpec(name: string, server: unknown): McpServerSpec {
  const s = (server ?? {}) as Record<string, unknown>;
  const invalid = () => new Error(`spawnReviewer: invalid MCP server "${name}"`);
  if (s.type === 'http') {
    if (!isHttpUrl(s.url) || !isStringRecord(s.headers)) throw invalid();
    return { type: 'http', url: s.url, headers: { ...(s.headers as Record<string, string>) } };
  }
  const args = s.args ?? [];
  const ok =
    (s.type ?? 'stdio') === 'stdio' &&
    typeof s.command === 'string' &&
    Array.isArray(args) &&
    args.every((a) => typeof a === 'string') &&
    isStringRecord(s.env);
  if (!ok) throw invalid();
  return {
    type: 'stdio',
    command: s.command as string,
    args: [...(args as string[])],
    env: { ...(s.env as Record<string, string> | undefined) },
  };
}

/**
 * Accepts both the record form and the packs' `McpServerEntry[]` (named stdio and http entries),
 * which the SEO red-team gate passes. Each becomes one entry in the reviewer's per-run config.
 */
export function normalizeMcpServers(
  servers: ReviewerMcpServers | undefined
): Record<string, McpServerSpec> | undefined {
  if (servers === undefined) return undefined;
  const entries: Array<readonly [string, unknown]> = Array.isArray(servers)
    ? servers.map((entry, i) => {
        const name = (entry as { name?: unknown } | null)?.name;
        if (typeof name !== 'string' || name.length === 0) {
          throw new Error(`spawnReviewer: MCP server #${i} has no name`);
        }
        return [name, entry] as const;
      })
    : Object.entries(servers);
  const out: Record<string, McpServerSpec> = {};
  for (const [name, server] of entries) {
    if (Object.hasOwn(out, name)) throw new Error(`spawnReviewer: duplicate MCP server "${name}"`);
    out[name] = toSpec(name, server);
  }
  return out;
}

interface Attached {
  relPath: string;
  evidence: Evidence;
}

async function copyAttachments(
  attachments: readonly Evidence[],
  checkout: string
): Promise<Attached[]> {
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
    const mcpServers = normalizeMcpServers(opts.mcpServers);
    opts.signal.throwIfAborted();
    const source = await realpath(opts.cwd);
    const reuse = await isReviewCheckout(source);
    const checkout = reuse
      ? undefined
      : await prepareReviewCheckout({ worktreePath: source, root: deps.checkoutRoot });
    const cwd = checkout?.path ?? source;
    try {
      const attached = await copyAttachments(opts.attachments, cwd);
      const requestedRoute = deps.route ? await deps.route(opts.purpose) : undefined;
      const route: ReviewerRoute = requestedRoute ?? { provider: 'claude' };
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
          mcpServers,
          siblingWorktrees: [...new Set(denied)].filter((p) => p !== cwd),
          auth: deps.auth?.(route.provider),
          reviewerRoute: route.routing,
        },
        { signal: opts.signal }
      );
      if (!result.ok) {
        throw new Error(
          `Reviewer run failed (${result.reason}): ${result.errors.join('; ').slice(0, 1000)}`
        );
      }
      return { text: result.text ?? '' };
    } finally {
      await checkout?.dispose();
    }
  };
}
