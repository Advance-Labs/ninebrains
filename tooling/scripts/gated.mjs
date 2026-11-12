/**
 * Runs one command inside a host-wide gate slot (gate-slots.mjs, #158), so heavy work from many
 * agents and worktrees takes turns instead of swapping a 16 GB Mac until Ninebrains is killed.
 *
 *   node tooling/scripts/gated.mjs pnpm run typecheck
 *   node tooling/scripts/gated.mjs sh -c 'pnpm install && pnpm exec vitest run x.test.ts'
 *
 * The child gets NINEBRAINS_GATE_HELD=<this pid>, so a pre-push hook or nested gated.mjs inside it reuses
 * this slot rather than waiting on a second one.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireGateSlot } from './gate-slots.mjs';

export function runGated(argv, { env = process.env, acquire = acquireGateSlot, run = spawnSync } = {}) {
  if (argv.length === 0) {
    console.error('usage: node tooling/scripts/gated.mjs <command> [args...]');
    return 2;
  }
  const release = acquire({ env, log: console.error });
  try {
    const result = run(argv[0], argv.slice(1), { stdio: 'inherit', env: { ...env, NINEBRAINS_GATE_HELD: String(process.pid) } });
    if (result.error) {
      console.error(`gated: ${result.error.message}`);
      return 127;
    }
    return result.status ?? 1;
  } finally {
    release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runGated(process.argv.slice(2)));
}
