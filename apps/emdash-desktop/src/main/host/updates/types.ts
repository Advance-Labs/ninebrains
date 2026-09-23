import type { UpdateProgress } from '@core/features/updates/api';

/** A file a GitHub release asset references. `url` is the `browser_download_url`. */
export type UpdateAsset = {
  name: string;
  url: string;
  size?: number;
};

/** Raw metadata for one GitHub release, enough for the updater to act. */
export type ReleaseInfo = {
  version: string;
  tagName: string;
  prerelease: boolean;
  publishedAt?: string;
  releaseNotes?: string;
  digestUrl?: string;
  digestSignatureUrl?: string;
  assets: UpdateAsset[];
};

/** One signed entry from SHA256SUMS.json. */
export type ChecksumFile = {
  name: string;
  sha256: string;
  size: number;
};

/**
 * The resolved download plan for the current platform + channel. Produced only after the signed
 * SHA256SUMS.json is verified against the embedded update key, so `asset` and `digest` can be
 * trusted to match what the release workflow uploaded.
 */
export type ResolvedUpdate = {
  version: string;
  releaseNotes?: string;
  asset: UpdateAsset;
  digest: ChecksumFile;
};

/** Persisted between the download completing and the next launch, when the update is applied. */
export type PendingUpdate = {
  version: string;
  artifactName: string;
  sha256: string;
  size: number;
  /** Absolue path of the staged artifact in the user data directory. */
  stagedPath: string;
  requestedAt: string;
};

export type OutgoingProgress = UpdateProgress;
