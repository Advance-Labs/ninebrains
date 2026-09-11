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

export interface ReviewerMcpServer {
  command: string;
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
}

export interface SpawnReviewerOptions extends CoreSpawnReviewerOptions {
  mcpServers?: Readonly<Record<string, ReviewerMcpServer>>;
}

export type SpawnReviewer = (
  prompt: string,
  opts: SpawnReviewerOptions
) => Promise<{ text: string }>;
