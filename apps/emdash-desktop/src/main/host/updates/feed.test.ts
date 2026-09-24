import { describe, expect, it, vi } from 'vitest';
import { UPDATE_CHANNEL as CANARY_UPDATE_CHANNEL } from '@core/primitives/app-identity/api/app-identity.canary';
import * as updateSigningKey from '@core/primitives/app-identity/api/update-signing-key';

vi.mock('@core/primitives/app-identity/api/update-signing-key', async () => {
  const { generateKeyPairSync, sign } = await import('node:crypto');
  const key = generateKeyPairSync('ed25519');
  const __testSign = (bytes: Buffer): string =>
    sign(null, bytes, key.privateKey).toString('base64');
  return {
    UPDATE_SIGNING_PUBLIC_KEY: key.publicKey.export({ type: 'spki', format: 'pem' }),
    __testSign,
  };
});
vi.mock('@main/lib/logger', () => ({
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  currentUpdatePlatform,
  feedUrlForChannel,
  fetchLatestRelease,
  resolveInstaller,
  selectPlatformAsset,
} from './feed';
import { DIGEST_FILE, DIGEST_SIGNATURE_FILE, type SignedChecksums } from './integrity';
import type { ChecksumFile, ReleaseInfo } from './types';

const __testSign = (
  updateSigningKey as unknown as {
    __testSign: (bytes: Buffer) => string;
  }
).__testSign;

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

function releaseAsset(name: string, url: string, size = 10) {
  return { name, browser_download_url: url, size };
}

function stableRelease(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: 'v0.2.2',
    prerelease: false,
    published_at: '2026-01-01T00:00:00Z',
    body: 'notes',
    assets: [
      releaseAsset(DIGEST_FILE, 'https://example.com/SHA256SUMS.json'),
      releaseAsset(DIGEST_SIGNATURE_FILE, 'https://example.com/SHA256SUMS.json.sig'),
      releaseAsset('Ninebrains-0.2.2-mac-arm64.zip', 'https://example.com/mac.zip'),
    ],
    ...overrides,
  };
}

describe('feed URL and platform helpers', () => {
  it('points stable at /releases/latest and canary at a scanned list', () => {
    expect(feedUrlForChannel('stable')).toBe(
      'https://api.github.com/repos/Advance-Labs/ninebrains/releases/latest'
    );
    expect(feedUrlForChannel('canary')).toContain('/releases?per_page=10');
  });

  it('maps the current OS to an update platform', () => {
    expect(['mac', 'win', 'linux']).toContain(currentUpdatePlatform());
  });
});

describe('selectPlatformAsset', () => {
  const files = [
    { name: 'Ninebrains-0.2.2-mac-arm64.zip', sha256: 'a'.repeat(64), size: 1 },
    { name: 'Ninebrains-0.2.2-mac-x64.zip', sha256: 'b'.repeat(64), size: 2 },
    { name: 'Ninebrains-0.2.2-win-x64.exe', sha256: 'c'.repeat(64), size: 3 },
    { name: 'Ninebrains-0.2.2-linux-x86_64.AppImage', sha256: 'd'.repeat(64), size: 4 },
  ];

  it('picks the mac zip for the running arch', () => {
    expect(selectPlatformAsset(files, 'mac', 'arm64')?.name).toBe('Ninebrains-0.2.2-mac-arm64.zip');
    expect(selectPlatformAsset(files, 'mac', 'x64')?.name).toBe('Ninebrains-0.2.2-mac-x64.zip');
  });

  it('picks the nsis exe for Windows', () => {
    expect(selectPlatformAsset(files, 'win', 'x64')?.name).toBe('Ninebrains-0.2.2-win-x64.exe');
  });

  it('picks the AppImage for Linux without arch filtering', () => {
    expect(selectPlatformAsset(files, 'linux', 'arm64')?.name).toBe(
      'Ninebrains-0.2.2-linux-x86_64.AppImage'
    );
  });

  it('returns null when nothing matches the platform', () => {
    expect(selectPlatformAsset(files, 'linux', 'x64')?.name).toBe(
      'Ninebrains-0.2.2-linux-x86_64.AppImage'
    );
    expect(selectPlatformAsset([], 'mac', 'arm64')).toBeNull();
    const winOnly = files.filter((file) => file.name.includes('win'));
    expect(selectPlatformAsset(winOnly, 'mac', 'arm64')).toBeNull();
  });
});

describe('fetchLatestRelease', () => {
  it('returns null when GitHub answers 404', async () => {
    const fetchImpl = vi.fn(async () => textResponse('', 404));
    expect(await fetchLatestRelease(fetchImpl, 'stable')).toBeNull();
  });

  it('throws on other HTTP errors', async () => {
    const fetchImpl = vi.fn(async () => textResponse('', 500));
    await expect(fetchLatestRelease(fetchImpl, 'stable')).rejects.toThrow(/HTTP 500/);
  });

  it('skips a release without a signed digest pair', async () => {
    const fetchImpl = vi.fn(async () =>
      textResponse(JSON.stringify(stableRelease({ assets: [] })))
    );
    expect(await fetchLatestRelease(fetchImpl, 'stable')).toBeNull();
  });

  it('parses the stable release and its digest URLs', async () => {
    const fetchImpl = vi.fn(async () => textResponse(JSON.stringify(stableRelease())));
    const release = await fetchLatestRelease(fetchImpl, 'stable');
    expect(release?.version).toBe('0.2.2');
    expect(release?.tagName).toBe('v0.2.2');
    expect(release?.digestUrl).toBe('https://example.com/SHA256SUMS.json');
    expect(release?.digestSignatureUrl).toBe('https://example.com/SHA256SUMS.json.sig');
    expect(release?.assets).toHaveLength(3);
  });

  it('selects the newest canary release over older canary tags', async () => {
    const releases = [
      stableRelease({ tag_name: 'v0.2.2-canary.3', prerelease: true }),
      stableRelease({ tag_name: 'v0.2.2-canary.17', prerelease: true }),
      stableRelease({ tag_name: 'v0.2.1-canary.9', prerelease: true }),
    ];
    const fetchImpl = vi.fn(async () => textResponse(JSON.stringify(releases)));
    const release = await fetchLatestRelease(fetchImpl, 'canary');
    expect(release?.tagName).toBe('v0.2.2-canary.17');
  });

  it('returns null on canary when no canary-tagged release exists', async () => {
    const releases = [stableRelease()];
    const fetchImpl = vi.fn(async () => textResponse(JSON.stringify(releases)));
    expect(await fetchLatestRelease(fetchImpl, 'canary')).toBeNull();
  });

  // A canary build swaps in app-identity.canary.ts, so this constant is the exact string a real
  // canary install passes — and `fetchLatestRelease` takes it as the default. Every case above
  // passes the bare 'canary' that no shipped build ever sends, which is how a canary checking the
  // stable feed (and offering itself a stable release) went unnoticed.
  it('treats the channel constant a canary build actually ships with as canary', async () => {
    expect(CANARY_UPDATE_CHANNEL).toBe('v1-canary');
    expect(feedUrlForChannel(CANARY_UPDATE_CHANNEL)).toContain('/releases?per_page=10');

    const releases = [
      stableRelease({ tag_name: 'v0.2.2', prerelease: false }),
      stableRelease({ tag_name: 'v0.2.2-canary.4', prerelease: true }),
    ];
    const fetchImpl = vi.fn(async () => textResponse(JSON.stringify(releases)));
    const release = await fetchLatestRelease(fetchImpl, CANARY_UPDATE_CHANNEL);
    expect(release?.tagName).toBe('v0.2.2-canary.4');
  });
});

describe('resolveInstaller', () => {
  function signedDigestText(overrides: ChecksumFile[] = []): {
    digestText: string;
    signature: string;
  } {
    const digest: SignedChecksums = {
      version: 1,
      algorithm: 'sha256',
      files: [
        { name: 'Ninebrains-0.2.2-mac-arm64.zip', sha256: 'a'.repeat(64), size: 9 },
        { name: 'Ninebrains-0.2.2-win-x64.exe', sha256: 'b'.repeat(64), size: 10 },
      ],
    };
    if (overrides.length > 0) digest.files = overrides;
    const bytes = Buffer.from(JSON.stringify(digest));
    return { digestText: bytes.toString('utf8'), signature: __testSign(bytes) };
  }

  function releaseWith(urls: Record<string, string>): ReleaseInfo {
    return {
      version: '0.2.2',
      tagName: 'v0.2.2',
      prerelease: false,
      digestUrl: urls.digest,
      digestSignatureUrl: urls.sig,
      assets: [
        { name: DIGEST_FILE, url: urls.digest },
        { name: DIGEST_SIGNATURE_FILE, url: urls.sig },
        { name: 'Ninebrains-0.2.2-mac-arm64.zip', url: 'https://example.com/asset.zip', size: 9 },
      ],
    };
  }

  function releaseFetcher({ digestText, signature }: { digestText: string; signature: string }) {
    return vi.fn(async (url: string) => {
      if (url.endsWith(DIGEST_SIGNATURE_FILE)) return textResponse(signature);
      if (url.endsWith(DIGEST_FILE)) return textResponse(digestText);
      return textResponse('');
    });
  }

  it('resolves the installable asset after verifying the signed digest', async () => {
    const { digestText, signature } = signedDigestText();
    const fetchImpl = releaseFetcher({ digestText, signature });
    const resolved = await resolveInstaller(
      releaseWith({ digest: 'https://x/SHA256SUMS.json', sig: 'https://x/SHA256SUMS.json.sig' }),
      fetchImpl,
      'mac',
      'arm64'
    );
    expect(resolved.version).toBe('0.2.2');
    expect(resolved.digest.name).toBe('Ninebrains-0.2.2-mac-arm64.zip');
    expect(resolved.asset.url).toBe('https://example.com/asset.zip');
  });

  it('refuses to resolve when the signature does not verify', async () => {
    const { digestText } = signedDigestText();
    const fetchImpl = releaseFetcher({
      digestText,
      signature: Buffer.from('garbage').toString('base64'),
    });
    await expect(
      resolveInstaller(
        releaseWith({ digest: 'https://x/SHA256SUMS.json', sig: 'https://x/SHA256SUMS.json.sig' }),
        fetchImpl,
        'mac',
        'arm64'
      )
    ).rejects.toThrow(/signature verification/);
  });

  it('refuses when the current platform has no installer', async () => {
    const { digestText, signature } = signedDigestText();
    const fetchImpl = releaseFetcher({ digestText, signature });
    await expect(
      resolveInstaller(
        releaseWith({ digest: 'https://x/SHA256SUMS.json', sig: 'https://x/SHA256SUMS.json.sig' }),
        fetchImpl,
        'linux',
        'x64'
      )
    ).rejects.toThrow(/no linux-x64 installer/);
  });

  it('refuses when a digest name is not published as an asset', async () => {
    const { digestText, signature } = signedDigestText([
      { name: 'Ninebrains-0.2.2-win-x64.exe', sha256: 'b'.repeat(64), size: 10 },
    ]);
    const fetchImpl = releaseFetcher({ digestText, signature });
    await expect(
      resolveInstaller(
        releaseWith({ digest: 'https://x/SHA256SUMS.json', sig: 'https://x/SHA256SUMS.json.sig' }),
        fetchImpl,
        'win',
        'x64'
      )
    ).rejects.toThrow(/does not publish it/);
  });
});
