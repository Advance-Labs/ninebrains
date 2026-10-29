import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WireComponentDefinition } from './component';
import { runWireComponentWorker } from './run-component-worker';

describe('runWireComponentWorker parent watchdog', () => {
  afterEach(() => vi.useRealTimers());

  it('exits on its own when the parent dies without a disconnect event', async () => {
    vi.useFakeTimers();
    let alive = true;
    const exit = vi.fn();
    const component = { id: 'test', requirements: {} } as unknown as WireComponentDefinition<
      string,
      never,
      never,
      never
    >;
    void runWireComponentWorker(component, {
      port: { send: () => {}, onMessage: () => () => {}, onDisconnect: () => () => {} },
      isParentAlive: () => alive,
      exit,
    });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(exit).not.toHaveBeenCalled();
    alive = false;
    await vi.advanceTimersByTimeAsync(6_000);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
