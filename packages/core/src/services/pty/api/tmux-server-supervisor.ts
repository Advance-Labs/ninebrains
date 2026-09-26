import type { IExecutionContext } from '#primitives/exec/api';
import { inspectTmuxSessions, type TmuxInventory } from './tmux-commands';
import { isTmuxSessionLoss, TmuxServerWatch, type TmuxServerChange } from './tmux-server-watch';

/** Why a tmux-backed pty exited, as far as the tmux server can explain it. */
export type TmuxExitDiagnosis =
  /** The server was replaced. The session was destroyed with it; scrollback is gone. */
  | { kind: 'server-replaced'; previousServerPid: number | null; serverPid: number | null }
  /** The server is gone and nothing replaced it yet. Same loss, no successor. */
  | { kind: 'server-gone'; previousServerPid: number | null }
  /** The server outlived the pty, so the session ended on its own terms. */
  | { kind: 'session-ended' }
  /** tmux could not be asked. Never treated as a crash. */
  | { kind: 'unknown' };

type SupervisorDeps = {
  /**
   * Runs an operation against an execution context, resolving undefined when the host
   * has none to give.
   *
   * A runner rather than a plain context: a runtime that has to build a context does so
   * per call and disposes it afterwards, so a context handed out here would already be
   * disposed by the time the supervisor used it. Keeping the probe inside the callback
   * is what makes the lifetime the host's to manage.
   */
  exec: <T>(operation: (exec: IExecutionContext) => Promise<T>) => Promise<T | undefined>;
  /**
   * Reported once per server generation change, not once per orphaned session — a
   * dead server exits every pty it hosted at the same moment, and six copies of the
   * same news is noise. Logged at `warn` deliberately: the desktop file logger keeps
   * `warn` and above, so this survives into the log a user can actually send back.
   */
  onServerChange?: (change: TmuxServerChange) => void;
  /** Coalescing window for concurrent probes, in ms. */
  probeWindowMs?: number;
  now?: () => number;
};

const DEFAULT_PROBE_WINDOW_MS = 250;

/**
 * Attributes tmux-backed pty exits to the tmux server's own lifecycle.
 *
 * The app spawns agent sessions through `tmux has-session || tmux new-session`, which is
 * fail-open: it cannot tell a dead server from a name that missed, and it reports neither.
 * This supervisor supplies the missing evidence. It records the server generation each
 * session was spawned into, and on exit compares it against the live server, so a session
 * can say whether it was destroyed underneath the app or simply finished.
 *
 * A tmux server death exits every attached client at once, so `diagnose` is called in a
 * burst. Probes inside one window share a single `tmux list-sessions`, and the change
 * report fires once for the generation rather than once per session.
 */
export class TmuxServerSupervisor {
  private readonly watch = new TmuxServerWatch();
  private readonly generations = new Map<string, number | null>();
  /** tmux session name per tracked key, so a loss can name what went with it. */
  private readonly sessionNames = new Map<string, string>();
  private readonly probeWindowMs: number;
  private readonly now: () => number;
  private inFlight: { at: number; promise: Promise<TmuxInventory | null> } | null = null;

  constructor(private readonly deps: SupervisorDeps) {
    this.probeWindowMs = deps.probeWindowMs ?? DEFAULT_PROBE_WINDOW_MS;
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * Remember which server generation a session was spawned into, and tell the watch the
   * server was alive at that moment.
   *
   * The seeding is not incidental: without it the watch never sees a running server, so
   * the first loss is dropped instead of reported (see `noteRunningServer`).
   */
  recordSpawn(key: string, serverPid: number | null, sessionName?: string): void {
    this.generations.set(key, serverPid);
    if (sessionName !== undefined) this.sessionNames.set(key, sessionName);
    this.watch.noteRunningServer(serverPid, [...this.sessionNames.values()]);
  }

  /** Drop a session the runtime no longer tracks. */
  forget(key: string): void {
    this.generations.delete(key);
    this.sessionNames.delete(key);
  }

  /**
   * Explain a tmux-backed pty exit. Returns `unknown` rather than guessing whenever
   * tmux cannot be reached or the session's generation was never recorded.
   */
  async diagnose(key: string): Promise<TmuxExitDiagnosis> {
    const inventory = await this.probe();
    if (!inventory || inventory.server === 'unavailable') return { kind: 'unknown' };

    const change = this.watch.observe(inventory);
    if (change && isTmuxSessionLoss(change)) this.deps.onServerChange?.(change);

    if (!this.generations.has(key)) return { kind: 'unknown' };
    const spawnedInto = this.generations.get(key) ?? null;

    if (inventory.server === 'absent') {
      return { kind: 'server-gone', previousServerPid: spawnedInto };
    }
    // An unknown generation on either side is not evidence of a replacement.
    if (spawnedInto === null || inventory.serverPid === null) return { kind: 'unknown' };
    if (spawnedInto !== inventory.serverPid) {
      return {
        kind: 'server-replaced',
        previousServerPid: spawnedInto,
        serverPid: inventory.serverPid,
      };
    }
    return { kind: 'session-ended' };
  }

  /** Last observed server generation, for diagnostics and tests. */
  snapshot(): ReturnType<TmuxServerWatch['snapshot']> {
    return this.watch.snapshot();
  }

  private probe(): Promise<TmuxInventory | null> {
    const at = this.now();
    if (this.inFlight && at - this.inFlight.at < this.probeWindowMs) return this.inFlight.promise;
    // A probe that throws must not poison the window or reject every caller in the burst.
    const promise = this.deps
      .exec((exec) => inspectTmuxSessions(exec))
      .then((inventory) => inventory ?? null)
      .catch(() => null);
    this.inFlight = { at, promise };
    return promise;
  }
}

/** True for the diagnoses that mean the session was destroyed, not finished. */
export function isTmuxServerLoss(diagnosis: TmuxExitDiagnosis): boolean {
  return diagnosis.kind === 'server-replaced' || diagnosis.kind === 'server-gone';
}
