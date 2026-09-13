/**
 * Global STOP (SEC-30, SEAMS §3.17): one call that
 * 1. latches the dispatcher (no new dispatch until cleared),
 * 2. `supervisor.killAll()` (SIGTERM every run's process group, SIGKILL at 2 s),
 * 3. stops every attended lane that is working on a Brain-dispatched job.
 * It resolves within `deadlineMs` (default 4.5 s) whatever a step does, so the
 * caller always gets an answer inside the 5 s budget.
 */
export interface StopPorts {
  latch(): void;
  killAllRuns(): Promise<void>;
  activeRunCount(): number;
  /** Lanes holding a claimed or running Brain job in attended mode. */
  dispatchedAttendedLanes(): string[];
  stopLane(laneId: string): Promise<void>;
  onError(context: string, error: unknown): void;
  onStopped?(): void;
}

export interface StopResult {
  killedRuns: number;
  stoppedLanes: number;
  /** True when some step was still running at the deadline. */
  timedOut: boolean;
}

export async function stopEverything(ports: StopPorts, deadlineMs = 4_500): Promise<StopResult> {
  ports.latch();
  const killedRuns = ports.activeRunCount();
  const lanes = ports.dispatchedAttendedLanes();
  const work = Promise.allSettled([
    ports.killAllRuns(),
    ...lanes.map((laneId) => ports.stopLane(laneId)),
  ]).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected') ports.onError('brain: STOP step failed', result.reason);
    }
    return false;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), deadlineMs);
  });
  const timedOut = await Promise.race([work, deadline]);
  clearTimeout(timer);
  ports.onStopped?.();
  return { killedRuns, stoppedLanes: lanes.length, timedOut };
}
