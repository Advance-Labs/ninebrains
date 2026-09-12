/**
 * Capability contracts from `@emdash/gates-core` and `@emdash/citations`, plus the one planned
 * additive field (`mcpServers`, gates-core README) the app already honours for the SEO red-team
 * gate. gates-core only ever grows by optional fields, so the extension stays compatible.
 */
import type { SpawnReviewerOptions as CoreSpawnReviewerOptions } from '@emdash/gates-core';

export type {
  CommandResult,
  Evidence,
  GateJob,
  JobKind,
  PrepareReviewCheckout,
  ReviewCheckout,
  RunCommand,
} from '@emdash/gates-core';
export type { FetchText } from '@emdash/citations';

/** One reviewer MCP server, keyed by name in the record form. */
export type ReviewerMcpServer =
  | {
      type?: 'stdio';
      command: string;
      args?: readonly string[];
      env?: Readonly<Record<string, string>>;
    }
  | { type: 'http'; url: string; headers?: Readonly<Record<string, string>> };

/** The packs' `McpServerEntry` shape: the same server with its name inside. */
export type ReviewerMcpServerEntry = ReviewerMcpServer & { name: string };

/** Either the record form or the packs' `McpServerEntry[]` (what the SEO gate passes). */
export type ReviewerMcpServers =
  | Readonly<Record<string, ReviewerMcpServer>>
  | readonly ReviewerMcpServerEntry[];

export interface SpawnReviewerOptions extends CoreSpawnReviewerOptions {
  mcpServers?: ReviewerMcpServers;
}

export type SpawnReviewer = (
  prompt: string,
  opts: SpawnReviewerOptions
) => Promise<{ text: string }>;
