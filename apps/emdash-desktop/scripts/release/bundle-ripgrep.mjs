// Ninebrains: electron-builder afterPack hook that ships ripgrep inside the app, so repo search
// works without a system `rg` (src/main/core/file-search/ripgrep-path.ts finds it at runtime).
//
// Downloads the pinned upstream release for the arch being packaged, checks it against the SHA-256
// below, and puts `rg` plus its licenses in <Resources>/ripgrep/. afterPack runs before signing,
// so the mac signer signs `rg` with the rest of the app. Plain JavaScript and builtins only, like
// checksums.mjs: the builder configs import nothing that needs an install.
//
// Bumping: change RIPGREP_VERSION and every sha256, taken from the release's *.sha256 assets
// and re-checked locally with `shasum -a 256`.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const RIPGREP_VERSION = '15.2.0';

const ASSETS = {
  'darwin-arm64': {
    target: 'aarch64-apple-darwin',
    ext: 'tar.gz',
    sha256: '3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4',
  },
  'darwin-x64': {
    target: 'x86_64-apple-darwin',
    ext: 'tar.gz',
    sha256: 'af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1',
  },
  // musl: statically linked, so it runs on any glibc the AppImage and deb land on.
  'linux-x64': {
    target: 'x86_64-unknown-linux-musl',
    ext: 'tar.gz',
    sha256: '33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c',
  },
  'win32-x64': {
    target: 'x86_64-pc-windows-msvc',
    ext: 'zip',
    sha256: '71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5',
  },
};

// builder-util's Arch enum, by value. Not imported: that would need electron-builder installed.
const ARCH_NAMES = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'];

const LICENSE_FILES = ['COPYING', 'LICENSE-MIT', 'UNLICENSE'];

export function ripgrepAsset(platform, arch) {
  const asset = ASSETS[`${platform}-${arch}`];
  if (!asset) throw new Error(`No pinned ripgrep build for ${platform}-${arch}`);
  const dir = `ripgrep-${RIPGREP_VERSION}-${asset.target}`;
  const file = `${dir}.${asset.ext}`;
  return {
    ...asset,
    dir,
    file,
    url: `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/${file}`,
    binary: platform === 'win32' ? 'rg.exe' : 'rg',
  };
}

export function verifySha256(bytes, expected, name) {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) {
    throw new Error(`${name}: SHA-256 ${actual} does not match pinned ${expected}`);
  }
}

// Windows' own bsdtar reads zips; Git's GNU tar, often first on PATH under bash, does not.
function tarCommand() {
  return process.platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
}

export async function bundleRipgrep({ platform, arch, destDir }) {
  const asset = ripgrepAsset(platform, arch);
  const response = await fetch(asset.url);
  if (!response.ok) throw new Error(`${asset.url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  verifySha256(bytes, asset.sha256, asset.file);

  const work = mkdtempSync(join(tmpdir(), 'ninebrains-ripgrep-'));
  try {
    const archive = join(work, asset.file);
    writeFileSync(archive, bytes);
    const tar = spawnSync(tarCommand(), ['-xf', archive, '-C', work], { stdio: 'inherit' });
    if (tar.error) throw tar.error;
    if (tar.status !== 0) throw new Error(`tar exited with ${tar.status} on ${asset.file}`);

    mkdirSync(destDir, { recursive: true });
    for (const name of [asset.binary, ...LICENSE_FILES]) {
      copyFileSync(join(work, asset.dir, name), join(destDir, name));
    }
    chmodSync(join(destDir, asset.binary), 0o755);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export default async function afterPack(context) {
  const arch = ARCH_NAMES[context.arch];
  const destDir = join(context.packager.getResourcesDir(context.appOutDir), 'ripgrep');
  await bundleRipgrep({ platform: context.electronPlatformName, arch, destDir });
  console.log(`  • bundled ripgrep ${RIPGREP_VERSION} for ${context.electronPlatformName}-${arch}`);
}
