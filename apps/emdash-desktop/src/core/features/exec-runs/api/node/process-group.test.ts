import { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { terminateGroup } from './process-group';

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('SEC-30 terminateGroup never throws, even when its failure hook does', () => {
  it.skipIf(process.platform === 'win32')(
    'settles cleanly when every SIGKILL fails and the onSignalFailure hook throws each time',
    async () => {
      // SIGTERM is let through, so the leader exits and `terminateGroup` can settle. Every SIGKILL
      // to this group fails with EIO, a code `signalGroup` reports rather than swallows, and the
      // hook throws on every report. With graceMs = 1 the grace-period SIGKILL fires from its
      // `setTimeout` and the final SIGKILL runs after exit, so both throw paths are exercised: an
      // unguarded hook would crash from the timer (an uncaught exception, which vitest reports as
      // an error) or reject the returned promise.
      const child = spawn('sh', ['-c', 'sleep 30'], { detached: true, stdio: 'ignore' });
      const pid = child.pid;
      expect(pid).toBeTypeOf('number');

      const realKill = process.kill.bind(process);
      const killSpy = vi.spyOn(process, 'kill').mockImplementation((target, signal) => {
        if (target === -(pid as number) && signal === 'SIGKILL') {
          throw Object.assign(new Error('kill EIO'), { code: 'EIO' });
        }
        return realKill(target, signal);
      });
      const hook = vi.fn((_failure: { signal: NodeJS.Signals }) => {
        throw new Error('hook boom');
      });
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        let pending: Promise<void> | undefined;
        expect(() => {
          pending = terminateGroup(child, 1, process.platform, hook);
        }).not.toThrow();
        await expect(pending).resolves.toBeUndefined();
        // Let the grace timer and the final SIGKILL both run before checking the hook's calls.
        await new Promise((r) => setTimeout(r, 100));
        expect(hook).toHaveBeenCalled();
        expect(hook.mock.calls.every(([failure]) => failure.signal === 'SIGKILL')).toBe(true);
        expect(isAlive(pid as number)).toBe(false);
      } finally {
        killSpy.mockRestore();
        consoleError.mockRestore();
        if (isAlive(pid as number)) process.kill(-(pid as number), 'SIGKILL');
      }
    }
  );
});
