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
import {
  closeSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GIB = 1024 ** 3;
/** An unreadable slot file is someone mid-write, not a dead owner, until it is this old. */
const UNREADABLE_GRACE_MS = 10_000;
/** No check run holds a slot this long; past it the owner's pid has likely been reused. */
const MAX_HOLD_MS = 2 * 60 * 60_000;

/** NINEBRAINS_GATE_SLOTS, else one slot per 8 GB of RAM (2 on a 16 GB Mac), at least 1. */
export function slotCount(env = process.env, totalMem = os.totalmem()) {
  const fromEnv = Number.parseInt(env.NINEBRAINS_GATE_SLOTS ?? '', 10);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  return Math.max(1, Math.floor(totalMem / (8 * GIB)));
}

/** Per user: on Linux `os.tmpdir()` is the shared /tmp, and another user must not own our slots. */
export function defaultSlotDir() {
  return path.join(os.tmpdir(), `ninebrains-gate-slots-${process.getuid?.() ?? 'user'}`);
}

/** Ours, a real directory, and writable by nobody else. Anything else could be planted. */
function slotDirIsSafe(dir) {
  try {
    const st = lstatSync(dir);
    if (!st.isDirectory() || st.isSymbolicLink()) return false;
    if (process.getuid && st.uid !== process.getuid()) return false;
    return (st.mode & 0o022) === 0;
  } catch {
    return false;
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readOwner(file) {
  try {
    const owner = JSON.parse(readFileSync(file, 'utf8'));
    return owner && typeof owner === 'object' ? owner : null;
  } catch {
    return null;
  }
}

function fileAgeMs(file, now) {
  try {
    return now - statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/** For the wait message only: digits for the pid, a plain basename for the worktree. */
const showPid = (pid) => String(pid).replace(/[^\d]/g, '') || '?';
const showDir = (cwd) => path.basename(String(cwd ?? '?')).replace(/[^\w.-]/g, '?').slice(0, 60) || '?';

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

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
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    return () => {};
  }
  if (!slotDirIsSafe(dir)) {
    log(`pre-push: ${dir} is not a private directory; running the checks without a gate slot.`);
    return () => {};
  }
  const started = now();
  const mine = { ...owner, startedAt: started };
  let announced = false;
  for (;;) {
    // First, every pass: whatever happens below, no push waits longer than this.
    if (now() - started >= maxWaitMs) {
      log(`pre-push: waited ${Math.round(maxWaitMs / 60_000)} min for a gate slot; running anyway.`);
      return () => {};
    }
    const holders = [];
    let reclaimed = false;
    for (let i = 0; i < slots; i += 1) {
      const file = path.join(dir, `slot-${i}`);
      // Written whole to a private temp name, then linked into place: the slot file is never
      // visible empty, so no waiter can mistake a slot being taken for a dead owner's.
      const temp = path.join(dir, `.slot-${i}-${process.pid}-${started}`);
      try {
        const fd = openSync(temp, 'wx', 0o600);
        writeSync(fd, JSON.stringify(mine));
        closeSync(fd);
      } catch {
        return () => {};
      }
      try {
        linkSync(temp, file);
        unlinkSync(temp);
        if (announced) log(`pre-push: got a gate slot after ${Math.round((now() - started) / 1000)}s.`);
        return () => {
          // Only free the slot if it is still ours: a reclaimed slot belongs to someone else.
          const held = readOwner(file);
          if (held?.pid === mine.pid && held?.startedAt === mine.startedAt) {
            try {
              unlinkSync(file);
            } catch {
              // Already gone.
            }
          }
        };
      } catch (error) {
        try {
          unlinkSync(temp);
        } catch {
          // Nothing to clean.
        }
        if (error.code !== 'EEXIST') return () => {};
      }
      const held = readOwner(file);
      const stale = held
        ? !isAlive(held.pid) ||
          (typeof held.startedAt === 'number' && now() - held.startedAt > MAX_HOLD_MS)
        : fileAgeMs(file, now()) > UNREADABLE_GRACE_MS;
      if (stale) {
        try {
          unlinkSync(file);
          reclaimed = true;
          continue;
        } catch (error) {
          // Gone already counts as reclaimed; anything else (not ours to delete) counts as held,
          // so this pass still sleeps and the maximum wait still applies.
          if (error.code === 'ENOENT') {
            reclaimed = true;
            continue;
          }
        }
      }
      holders.push(held ?? { pid: '?', cwd: '?' });
    }
    if (reclaimed) continue; // try the freed slot straight away
    if (!announced) {
      announced = true;
      const who = holders.map((h) => `pid ${showPid(h.pid)} in ${showDir(h.cwd)}`).join(', ');
      log(
        `pre-push: all ${slots} gate slot(s) busy (${who}); waiting so checks don't run side by side. ` +
          `NINEBRAINS_GATE_SLOTS=<n> changes the limit.`
      );
    }
    sleep(pollMs);
  }
}
