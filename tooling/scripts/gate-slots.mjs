/**
 * Host-wide gate slots (#158): at most N heavy check runs (typecheck, tests) at once across every
 * worktree on this machine. Each `nx affected -t lint typecheck test` costs about 1 GB of swap on a
 * 16 GB Mac (tsgo alone reaches 3.5 GB), and with many agents pushing at the same time they pushed
 * swap to 14 GB and hung the app. Waiting for a slot is cheaper than all of them thrashing.
 *
 * A slot is a file, created exclusively, holding its owner's pid and worktree. A slot whose owner
 * is gone is reclaimed, so a crashed or interrupted push never wedges the others.
 *
 * ponytail: polling every 2 s, no queue order. Fairness only matters if waits get long.
 */
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GIB = 1024 ** 3;

/** NINEBRAINS_GATE_SLOTS, else one slot per 8 GB of RAM (2 on a 16 GB Mac), at least 1. */
export function slotCount(env = process.env, totalMem = os.totalmem()) {
  const fromEnv = Number.parseInt(env.NINEBRAINS_GATE_SLOTS ?? '', 10);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  return Math.max(1, Math.floor(totalMem / (8 * GIB)));
}

export function defaultSlotDir() {
  return path.join(os.tmpdir(), 'ninebrains-gate-slots');
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readOwner(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Blocks until a slot is free, then returns a function that frees it. Never throws: if the slot
 * directory cannot be used, it returns a no-op release and the checks run unlimited, as before.
 */
export function acquireGateSlot({
  slots = slotCount(),
  dir = defaultSlotDir(),
  owner = { pid: process.pid, cwd: process.cwd() },
  isAlive = pidAlive,
  sleep = sleepSync,
  log = console.error,
  pollMs = 2_000,
  maxWaitMs = 30 * 60_000,
  now = Date.now,
} = {}) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return () => {};
  }
  const started = now();
  let announced = false;
  for (;;) {
    const holders = [];
    for (let i = 0; i < slots; i += 1) {
      const file = path.join(dir, `slot-${i}`);
      try {
        const fd = openSync(file, 'wx');
        writeSync(fd, JSON.stringify({ ...owner, startedAt: now() }));
        closeSync(fd);
        if (announced) log(`pre-push: got a gate slot after ${Math.round((now() - started) / 1000)}s.`);
        return () => {
          // Only free the slot if it is still ours: a reclaimed slot belongs to someone else.
          if (readOwner(file)?.pid === owner.pid) {
            try {
              unlinkSync(file);
            } catch {
              // Already gone.
            }
          }
        };
      } catch (error) {
        if (error.code !== 'EEXIST') return () => {};
        const held = readOwner(file);
        if (!held || !isAlive(held.pid)) {
          // The owner died mid-run (crash, Ctrl-C): reclaim and try this slot again next pass.
          try {
            unlinkSync(file);
          } catch {
            // Someone else reclaimed it first.
          }
          continue;
        }
        holders.push(held);
      }
    }
    if (holders.length < slots) continue; // a slot was just reclaimed
    if (now() - started >= maxWaitMs) {
      log(`pre-push: waited ${Math.round(maxWaitMs / 60_000)} min for a gate slot; running anyway.`);
      return () => {};
    }
    if (!announced) {
      announced = true;
      const who = holders.map((h) => `pid ${h.pid} in ${path.basename(h.cwd ?? '?')}`).join(', ');
      log(
        `pre-push: all ${slots} gate slot(s) busy (${who}); waiting so checks don't run side by side. ` +
          `NINEBRAINS_GATE_SLOTS=<n> changes the limit.`
      );
    }
    sleep(pollMs);
  }
}
