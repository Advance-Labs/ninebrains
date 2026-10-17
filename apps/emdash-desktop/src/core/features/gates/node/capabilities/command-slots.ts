import { totalmem } from 'node:os';
import type { RunCommand } from '@emdash/gates-core';

/**
 * Ninebrains (#158): at most `slots` tests-gate commands at once across every job. Gates inside one
 * attempt already run two at a time, but separate jobs' attempts had no shared limit, so many lanes
 * verifying together each ran the project's test command side by side and swapped the machine to
 * a halt. Only shell-line commands (the tests gate) wait; the gates' own `argv` git calls are cheap
 * and pass straight through.
 *
 * A command whose job is aborted while it waits runs at once with the aborted signal, so the
 * runner's own abort handling answers, exactly as it would have without the limit. Waiting does
 * not count against the command's timeout, which starts when it actually runs.
 *
 * ponytail: in-process only. The repo's pre-push hook has its own host-wide slots
 * (tooling/scripts/gate-slots.mjs); the two do not see each other.
 */
export function limitShellCommands(run: RunCommand, slots: number): RunCommand {
  let active = 0;
  const waiting: Array<() => void> = [];

  const acquire = (signal: AbortSignal): Promise<boolean> => {
    if (active < slots) {
      active += 1;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const grant = () => {
        signal.removeEventListener('abort', onAbort);
        active += 1;
        resolve(true);
      };
      const onAbort = () => {
        const index = waiting.indexOf(grant);
        if (index >= 0) waiting.splice(index, 1);
        resolve(false);
      };
      waiting.push(grant);
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
  };

  const release = () => {
    active -= 1;
    waiting.shift()?.();
  };

  return async (command, opts) => {
    if (opts.argv) return run(command, opts);
    const held = await acquire(opts.signal);
    try {
      return await run(command, opts);
    } finally {
      if (held) release();
    }
  };
}

const GIB = 1024 ** 3;

/** One tests-gate command per 8 GB of RAM (2 on a 16 GB Mac), at least one. */
export function gateCommandSlots(memoryBytes = totalmem()): number {
  return Math.max(1, Math.floor(memoryBytes / (8 * GIB)));
}
