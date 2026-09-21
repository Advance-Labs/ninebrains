import { defineContract, eventStream, fallible, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import { RELEASE_PAGE_URL_PATTERN } from './release-links';

export const releaseCheckDomain = 'releaseCheck' as const;

/** Why the most recent check did not produce an answer. Always handled silently. */
export const releaseCheckFailureSchema = z.enum([
  'offline',
  'timeout',
  'rate-limited',
  'http-error',
  'invalid-response',
]);
export type ReleaseCheckFailure = z.infer<typeof releaseCheckFailureSchema>;

export const latestReleaseSchema = z.object({
  /** Normalized `X.Y.Z[-pre]`, no leading `v`. */
  version: z.string(),
  /** GitHub release page, built from `version`; never taken from the response. */
  releaseUrl: z.string().regex(RELEASE_PAGE_URL_PATTERN),
  publishedAt: z.string().nullable(),
});
export type LatestRelease = z.infer<typeof latestReleaseSchema>;

export const releaseCheckStatusSchema = z.object({
  currentVersion: z.string(),
  /**
   * False on canary builds (they track prereleases, which `releases/latest` never returns) and
   * when the running version is not SemVer. Nothing is fetched while false.
   */
  supported: z.boolean(),
  /** The user's "Check for new versions" setting. Off by default (SEC-38). */
  autoCheck: z.boolean(),
  checking: z.boolean(),
  /** The last release GitHub reported. Kept when a later check fails. */
  latest: latestReleaseSchema.nullable(),
  updateAvailable: z.boolean(),
  /** Epoch ms of the last check that got an answer. */
  lastCheckedAt: z.number().nullable(),
  /** Outcome of the most recent attempt; null when it succeeded or none ran. */
  lastFailure: releaseCheckFailureSchema.nullable(),
  /** The version whose notice the user closed. The Settings card still shows it. */
  dismissedVersion: z.string().nullable(),
});
export type ReleaseCheckStatus = z.infer<typeof releaseCheckStatusSchema>;

export const releaseCheckErrorSchema = z.object({
  type: z.enum(['invalid-version', 'persistence']),
  message: z.string(),
});
export type ReleaseCheckError = z.infer<typeof releaseCheckErrorSchema>;

/**
 * "A new Ninebrains release is out" (docs/RELEASING.md). Read-only against GitHub: no procedure
 * downloads or installs anything, and nothing here touches electron-updater.
 */
export const releaseCheckContract = defineContract({
  getStatus: procedure({ input: z.void(), output: releaseCheckStatusSchema }),
  /** A user-initiated check. Rate-limited in main; failures land in `lastFailure`. */
  check: procedure({ input: z.void(), output: releaseCheckStatusSchema }),
  /** Hides the notice for this version only; a newer release shows it again. */
  dismiss: fallible({
    input: z.object({ version: z.string().max(64) }),
    data: z.void(),
    error: releaseCheckErrorSchema,
  }),
  events: eventStream({ key: z.void(), event: releaseCheckStatusSchema }),
});

export type ReleaseCheckContract = typeof releaseCheckContract;

/** The sidebar notice: an update exists and the user has not closed it for this version. */
export function shouldShowReleaseNotice(status: ReleaseCheckStatus | null): boolean {
  if (!status?.updateAvailable || !status.latest) return false;
  return status.latest.version !== status.dismissedVersion;
}
