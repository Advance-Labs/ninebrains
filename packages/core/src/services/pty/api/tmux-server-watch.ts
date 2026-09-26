import type { TmuxInventory } from './tmux-commands';

/**
 * What the watch saw happen to the tmux server between two observations.
 *
 * `server-restarted` is the crash case this exists for: the server the app's sessions
 * lived in was replaced, so every pane's scrollback is gone (tmux keeps history only in
 * the server's memory, which is why `history-limit` buys nothing here) and every session
 * that had been running is no longer backed by anything.
 */
export type TmuxServerChange =
  | { type: 'server-started'; serverPid: number | null }
  | {
      type: 'server-restarted';
      previousServerPid: number | null;
      serverPid: number | null;
      lostSessions: readonly string[];
    }
  | { type: 'server-lost'; previousServerPid: number | null; lostSessions: readonly string[] };

type WatchState = {
  /** Pid of the last server observed running, or null when tmux would not report one. */
  serverPid: number | null;
  /** True while the last observation found a live server. */
  running: boolean;
  /** Session names observed under the last live server. */
  sessionNames: readonly string[];
};

/**
 * Tracks tmux server generations across observations and names the transitions.
 *
 * This is deliberately a pure state machine over {@link TmuxInventory}: it performs no
 * I/O and owns no timer, so it can be driven from whatever the caller already has — a
 * pty exit, a spawn-time resolve, or a poll — and asserted directly in tests.
 *
 * It is conservative by construction. An unknown pid never manufactures a restart, and
 * a missing tmux binary is treated as an absence of information rather than a death,
 * because a PATH that momentarily lacks tmux must not be reported to the user as a crash.
 */
export class TmuxServerWatch {
  private state: WatchState = { serverPid: null, running: false, sessionNames: [] };

  /**
   * Fold one inventory into the watch and report the transition, if any.
   * Returns null when nothing user-visible changed.
   */
  observe(inventory: TmuxInventory): TmuxServerChange | null {
    if (inventory.server === 'unavailable') return null;

    const previous = this.state;

    if (inventory.server === 'absent') {
      if (!previous.running) return null;
      this.state = { serverPid: previous.serverPid, running: false, sessionNames: [] };
      return {
        type: 'server-lost',
        previousServerPid: previous.serverPid,
        lostSessions: previous.sessionNames,
      };
    }

    const sessionNames = inventory.sessions.map((session) => session.name);
    // Knowledge of the generation is monotonic: a server that declines to report its pid
    // tells us nothing new, and must not erase the pid we already hold — otherwise the
    // next successful read would look like a first sighting and re-announce a start.
    const serverPid = inventory.serverPid ?? previous.serverPid;
    this.state = { serverPid, running: true, sessionNames };

    // A pid we cannot compare proves nothing; report a restart only on evidence.
    const replaced =
      previous.serverPid !== null &&
      inventory.serverPid !== null &&
      previous.serverPid !== inventory.serverPid;

    if (replaced) {
      return {
        type: 'server-restarted',
        previousServerPid: previous.serverPid,
        serverPid: inventory.serverPid,
        lostSessions: previous.sessionNames,
      };
    }

    // Coming back on the same pid is not a restart, and a first sighting is not a crash.
    if (previous.serverPid !== null) return null;
    return { type: 'server-started', serverPid: inventory.serverPid };
  }

  /** Last observed server generation, for diagnostics and tests. */
  snapshot(): WatchState {
    return { ...this.state, sessionNames: [...this.state.sessionNames] };
  }
}

/** True for the changes that mean live sessions were destroyed underneath the app. */
export function isTmuxSessionLoss(change: TmuxServerChange): boolean {
  return change.type === 'server-restarted' || change.type === 'server-lost';
}
