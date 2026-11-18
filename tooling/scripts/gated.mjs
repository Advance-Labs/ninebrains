/**
 * Runs one command inside a host-wide gate slot (gate-slots.mjs, #158), so heavy work from many
 * agents and worktrees takes turns instead of swapping a 16 GB Mac until Ninebrains is killed.
 *
 *   node tooling/scripts/gated.mjs pnpm run typecheck
 *   node tooling/scripts/gated.mjs sh -c 'pnpm install && pnpm exec vitest run x.test.ts'
 *
 * The child gets NINEBRAINS_GATE_HELD=<this pid>, so a pre-push hook or nested gated.mjs inside it reuses
 * this slot rather than waiting on a second one.
 *
 * The child runs in its own process group. SIGINT/SIGTERM/SIGHUP sent to this process (a tool
 * timeout, a closed terminal) are forwarded to that group, and the slot is released only after the
 * child has exited, so a killed gate never leaves heavy work running without a slot.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireGateSlot } from './gate-slots.mjs';

const FORWARDED = ['SIGINT', 'SIGTERM', 'SIGHUP'];

function killGroup(child, signal, kill) {
  try {
    kill(-child.pid, signal); // the whole group: `sh -c` and everything it started
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}

/** Resolves to the exit code: the child's, or 128 + signal number when a signal ended it. */
export function runGated(
  argv,
  {
    env = process.env,
    acquire = acquireGateSlot,
    spawn = nodeSpawn,
    proc = process,
    kill = process.kill,
  } = {}
) {
  if (argv.length === 0) {
    console.error('usage: node tooling/scripts/gated.mjs <command> [args...]');
    return Promise.resolve(2);
  }
  const release = acquire({ env, log: console.error });
  return new Promise((resolve) => {
    const handlers = FORWARDED.map((sig) => [sig, () => child && killGroup(child, sig, kill)]);
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      for (const [sig, fn] of handlers) proc.removeListener(sig, fn);
      release();
      resolve(code);
    };
    let child;
    for (const [sig, fn] of handlers) proc.on(sig, fn);
    try {
      child = spawn(argv[0], argv.slice(1), {
        stdio: 'inherit',
        detached: true,
        env: { ...env, NINEBRAINS_GATE_HELD: String(process.pid) },
      });
    } catch (error) {
      console.error(`gated: ${error.message}`);
      return finish(127);
    }
    child.on('error', (error) => {
      console.error(`gated: ${error.message}`);
      finish(127);
    });
    child.on('close', (code, signal) =>
      finish(signal ? 128 + (os.constants.signals[signal] ?? 0) : (code ?? 1))
    );
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await runGated(process.argv.slice(2)));
}
