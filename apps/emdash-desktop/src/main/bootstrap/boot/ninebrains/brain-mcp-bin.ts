import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The bundled brain-mcp shim. electron-vite copies `packages/brain-mcp/dist`
 * to `out/main/brain-mcp/` and electron-builder unpacks it from the asar, so
 * the app's own Electron can run it as Node (SEAMS §3.6). A dev checkout that
 * has not rebuilt the app falls back to the package's own dist.
 */
export function resolveBrainMcpBin(appPath: string): string {
  const bundled = join(appPath, 'out', 'main', 'brain-mcp', 'bin.mjs').replace(
    /app\.asar(?=[\\/])/,
    'app.asar.unpacked'
  );
  const candidates = [bundled, resolve(appPath, '../../packages/brain-mcp/dist/bin.mjs')];
  return candidates.find((candidate) => existsSync(candidate)) ?? bundled;
}
