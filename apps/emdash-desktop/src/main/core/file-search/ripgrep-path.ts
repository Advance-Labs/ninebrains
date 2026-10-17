import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * The ripgrep that packaging puts in the app's Resources (scripts/release/bundle-ripgrep.mjs).
 * Undefined in dev and tests, where no such file exists, so file search falls back to `rg` on PATH.
 */
export function resolveBundledRipgrepPath(
  resourcesPath: string | undefined = process.resourcesPath,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  if (!resourcesPath) return undefined;
  const candidate = path.join(resourcesPath, 'ripgrep', platform === 'win32' ? 'rg.exe' : 'rg');
  return existsSync(candidate) ? candidate : undefined;
}
