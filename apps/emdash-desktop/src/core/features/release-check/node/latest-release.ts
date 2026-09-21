import { err, ok, type Result } from '@emdash/shared';
import { z } from 'zod';
import type { LatestRelease, ReleaseCheckFailure } from '../api/contract';
import { RELEASE_REPO, releasePageUrl } from '../api/release-links';
import { normalizeVersion } from '../api/version';

/** The same public endpoint `main/host/updates/update-service.ts` reads release notes from. */
export const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
export const RELEASE_CHECK_TIMEOUT_MS = 10_000;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const latestReleaseResponseSchema = z.object({
  tag_name: z.string().max(64),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  published_at: z.string().max(64).nullable().optional(),
});

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/**
 * One unauthenticated GET, no cookies, no token. Every failure is an expected outcome (offline,
 * GitHub's 60/hour anonymous limit, a 404 before the first release, a bad body) and comes back
 * as an `err`, never a throw.
 */
export async function fetchLatestRelease(
  fetchImpl: FetchLike,
  timeoutMs: number = RELEASE_CHECK_TIMEOUT_MS
): Promise<Result<LatestRelease, ReleaseCheckFailure>> {
  let response: Response;
  try {
    response = await fetchImpl(LATEST_RELEASE_API_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Ninebrains-release-check',
      },
      credentials: 'omit',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return err(isTimeout(error) ? 'timeout' : 'offline');
  }

  if (response.status === 403 || response.status === 429) return err('rate-limited');
  if (!response.ok) return err('http-error');

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return err(isTimeout(error) ? 'timeout' : 'invalid-response');
  }

  const parsed = latestReleaseResponseSchema.safeParse(body);
  if (!parsed.success || parsed.data.draft || parsed.data.prerelease) {
    return err('invalid-response');
  }
  const version = normalizeVersion(parsed.data.tag_name);
  if (!version) return err('invalid-response');

  return ok({
    version,
    releaseUrl: releasePageUrl(version),
    publishedAt: parsed.data.published_at ?? null,
  });
}
