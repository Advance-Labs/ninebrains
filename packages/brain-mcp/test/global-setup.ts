import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The stdio round-trip test runs the real built bin, so build what it bundles first: gates-core
 * (its `untrusted` fence entry), brain-core, then brain-mcp.
 */
export default function setup(): void {
  const build = (dir: string) =>
    execFileSync('pnpm', ['exec', 'tsdown', '--logLevel', 'warn'], {
      cwd: dir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  build(path.resolve(packageDir, '..', 'gates-core'));
  build(path.resolve(packageDir, '..', 'brain-core'));
  build(packageDir);
}
