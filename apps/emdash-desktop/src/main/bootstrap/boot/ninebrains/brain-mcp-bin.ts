import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * A bundled brain package bin (`brain-mcp` shim or `brain-cli`). electron-vite
 * copies `packages/<name>/dist` to `out/main/<name>/` and electron-builder unpacks
 * it from the asar, so the app's own Electron can run it as Node (SEAMS §3.6). A
 * dev checkout that has not rebuilt the app falls back to the package's own dist.
 */
export function resolveBrainMcpBin(
  appPath: string,
  name: 'brain-mcp' | 'brain-cli' = 'brain-mcp'
): string {
  const bundled = join(appPath, 'out', 'main', name, 'bin.mjs').replace(
    /app\.asar(?=[\\/])/,
    'app.asar.unpacked'
  );
  const candidates = [bundled, resolve(appPath, `../../packages/${name}/dist/bin.mjs`)];
  return candidates.find((candidate) => existsSync(candidate)) ?? bundled;
}
