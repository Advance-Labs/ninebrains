import { UPDATE_CHANNEL } from '@core/primitives/app-identity/api/app-identity';
import { log } from '@main/lib/logger';
import {
  DIGEST_FILE,
  DIGEST_SIGNATURE_FILE,
  parseSignedChecksums,
  verifyChecksumsSignature,
} from './integrity';
import type { ChecksumFile, ReleaseInfo, ResolvedUpdate, UpdateAsset } from './types';
import { compareVersions } from './version';

export type UpdatePlatform = 'mac' | 'win' | 'linux';
export type UpdateArchitecture = 'arm64' | 'x64';

export type FeedFetcher = (url: string, init?: RequestInit) => Promise<Response>;

const REPO = 'Advance-Labs/ninebrains';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases`;
const CANARY_ID = /-canary\.\d+$/;
// The updater checks hourly; page 1 of a sort-by-newest release list is always within these.
const CANARY_SCAN_PAGES = 10;

export function currentUpdatePlatform(): UpdatePlatform {
  if (process.platform === 'darwin') return 'mac';
  if (process.platform === 'win32') return 'win';
  return 'linux';
}

export function currentUpdateArch(): UpdateArchitecture {
  return process.arch === 'arm64' ? 'arm64' : 'x64';
}

export function feedUrlForChannel(channel: string): string {
  return channel === 'canary'
    ? `${RELEASES_API}?per_page=${CANARY_SCAN_PAGES}&exclude_drafts=true`
    : `${RELEASES_API}/latest`;
}

type GitHubAsset = { name: string; browser_download_url: string; size: number };
type GitHubRelease = {
  tag_name: string;
  prerelease: boolean;
  published_at: string | null;
  body: string | null;
  assets: GitHubAsset[];
};

/** Picks the newest release whose tag matches the app's channel (canary prereleases stay mine). */
function selectNewestRelease(releases: GitHubRelease[], channel: string): GitHubRelease | null {
  return (
    releases
      .filter((release) =>
        channel === 'canary' ? CANARY_ID.test(release.tag_name) : !release.prerelease
      )
      .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0] ?? null
  );
}

/**
 * Fetches the newest signed release for the current channel. Returns null when there is none, when
 * GitHub has no release yet, or when the release cannot be installed (no signed digest pair).
 */
export async function fetchLatestRelease(
  fetchImpl: FeedFetcher,
  channel = UPDATE_CHANNEL
): Promise<ReleaseInfo | null> {
  const url = feedUrlForChannel(channel);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ninebrains-updater' },
    });
  } catch (error) {
    throw new Error(
      `Update feed request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Update feed request failed with HTTP ${response.status}`);
  }

  let release: GitHubRelease | null;
  if (channel === 'canary') {
    const releases = (await response.json()) as GitHubRelease[];
    release = selectNewestRelease(releases, channel);
  } else {
    release = (await response.json()) as GitHubRelease;
  }
  if (!release) return null;

  const version = release.tag_name.replace(/^v/, '');
  const digestPair = {
    digestUrl: release.assets.find((asset) => asset.name === DIGEST_FILE)?.browser_download_url,
    digestSignatureUrl: release.assets.find((asset) => asset.name === DIGEST_SIGNATURE_FILE)
      ?.browser_download_url,
  };
  if (!digestPair.digestUrl || !digestPair.digestSignatureUrl) {
    log.warn('Update feed candidate has no signed digest; skipping', {
      version,
      channel: UPDATE_CHANNEL,
    });
    return null;
  }

  return {
    version,
    tagName: release.tag_name,
    prerelease: release.prerelease,
    publishedAt: release.published_at ?? undefined,
    releaseNotes: release.body ?? undefined,
    ...digestPair,
    assets: release.assets.map((asset: GitHubAsset): UpdateAsset => {
      return { name: asset.name, url: asset.browser_download_url, size: asset.size };
    }),
  };
}

/** The installable artifact for this machine: mac uses the .zip, win the NSIS .exe, linux the AppImage. */
export function selectPlatformAsset(
  digestFiles: ChecksumFile[],
  platform: UpdatePlatform,
  arch: UpdateArchitecture
): ChecksumFile | null {
  const marker = platform === 'mac' ? `.zip` : platform === 'win' ? '.exe' : '.AppImage';
  const pattern = `-${platform}-${arch}`;
  const matches = digestFiles.filter((file) => {
    if (platform === 'mac') return file.name.endsWith(marker) && file.name.includes(pattern);
    if (platform === 'win') return file.name.endsWith(marker) && file.name.includes(pattern);
    return file.name.endsWith(marker);
  });
  if (matches.length === 0) return null;
  return matches.sort((a, b) => a.name.localeCompare(b.name))[0];
}

/**
 * Verifies a candidate release's signed digest and resolves the installable artifact for the
 * current machine. Throws when the signature is invalid or the digest does not name an artifact.
 */
export async function resolveInstaller(
  release: ReleaseInfo,
  fetchImpl: FeedFetcher,
  platform = currentUpdatePlatform(),
  arch = currentUpdateArch()
): Promise<ResolvedUpdate> {
  const [digestText, signatureText] = await Promise.all([
    fetchForIntegrity(release.digestUrl!, fetchImpl),
    fetchForIntegrity(release.digestSignatureUrl!, fetchImpl),
  ]);
  if (!verifyChecksumsSignature(Buffer.from(digestText), signatureText.trim())) {
    throw new Error(
      `Release ${release.version} failed signature verification; refusing to install`
    );
  }
  const checksums = parseSignedChecksums(digestText);
  const digest = selectPlatformAsset(checksums.files, platform, arch);
  if (!digest) {
    throw new Error(
      `Release ${release.version} has no ${platform}-${arch} installer for this machine`
    );
  }
  const asset = release.assets.find((candidate) => candidate.name === digest.name);
  if (!asset) {
    throw new Error(`Release ${release.version} names ${digest.name} but does not publish it`);
  }
  return { version: release.version, releaseNotes: release.releaseNotes, asset, digest };
}

async function fetchForIntegrity(url: string, fetchImpl: FeedFetcher): Promise<string> {
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': 'ninebrains-updater' },
  });
  if (response.status === 404) {
    throw new Error(`Missing integrity file: ${url}`);
  }
  if (!response.ok) throw new Error(`Fetching ${url} failed with HTTP ${response.status}`);
  return response.text();
}
