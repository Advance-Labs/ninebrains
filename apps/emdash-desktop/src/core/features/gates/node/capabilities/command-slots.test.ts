import type { CommandResult, RunCommand } from '@emdash/gates-core';
import { describe, expect, it } from 'vitest';
import { gateCommandSlots, limitShellCommands } from './command-slots';

const result = { exitCode: 0 } as unknown as CommandResult;

/** A fake runner whose commands finish only when the test says so. */
function controlledRunner() {
  const started: string[] = [];
  const finishers = new Map<string, () => void>();
  const failers = new Map<string, (error: Error) => void>();
  const run: RunCommand = (command) =>
    new Promise<CommandResult>((resolve, reject) => {
      started.push(command);
      finishers.set(command, () => resolve(result));
      failers.set(command, reject);
    });
  return {
    run,
    started,
    finish: (command: string) => finishers.get(command)!(),
    fail: (command: string) => failers.get(command)!(new Error('boom')),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const opts = (signal = new AbortController().signal) => ({ cwd: '/wt', signal });

describe('limitShellCommands', () => {
  it('runs at most `slots` test commands at once and starts the next when one ends', async () => {
    const runner = controlledRunner();
    const limited = limitShellCommands(runner.run, 2);
    const a = limited('pnpm test # a', opts());
    const b = limited('pnpm test # b', opts());
    const c = limited('pnpm test # c', opts());
    await tick();
    expect(runner.started).toEqual(['pnpm test # a', 'pnpm test # b']);

    runner.finish('pnpm test # a');
    await a;
    await tick();
    expect(runner.started).toEqual(['pnpm test # a', 'pnpm test # b', 'pnpm test # c']);
    runner.finish('pnpm test # b');
    runner.finish('pnpm test # c');
    await Promise.all([b, c]);
  });

  it("lets the gates' own argv git calls through without waiting", async () => {
    const runner = controlledRunner();
    const limited = limitShellCommands(runner.run, 1);
    void limited('pnpm test', opts());
    void limited('pnpm test # waits', opts());
    void limited('git', { ...opts(), argv: ['status'] });
    await tick();
    // The slot is full, yet the git call ran; only the second test command waits.
    expect([...runner.started].sort()).toEqual(['git', 'pnpm test']);
  });

  it('runs an aborted waiter at once, so the runner reports the abort, and keeps the count right', async () => {
    const runner = controlledRunner();
    const limited = limitShellCommands(runner.run, 1);
    const first = limited('pnpm test # first', opts());
    const controller = new AbortController();
    void limited('pnpm test # aborted', opts(controller.signal));
    await tick();
    expect(runner.started).toEqual(['pnpm test # first']);

    controller.abort();
    await tick();
    expect(runner.started).toEqual(['pnpm test # first', 'pnpm test # aborted']);

    // The aborted run never held the slot, so finishing it frees nothing extra.
    runner.finish('pnpm test # aborted');
    runner.finish('pnpm test # first');
    await first;
    void limited('pnpm test # next', opts());
    void limited('pnpm test # after', opts());
    await tick();
    expect(runner.started.slice(2)).toEqual(['pnpm test # next']);
  });

  it('frees the slot when a command fails', async () => {
    const runner = controlledRunner();
    const limited = limitShellCommands(runner.run, 1);
    const failing = limited('pnpm test # fails', opts());
    void limited('pnpm test # next', opts());
    await tick();
    runner.fail('pnpm test # fails');
    await expect(failing).rejects.toThrow('boom');
    await tick();
    expect(runner.started).toEqual(['pnpm test # fails', 'pnpm test # next']);
  });
});

describe('gateCommandSlots', () => {
  it('is one per 8 GB of RAM, at least one', () => {
    const GIB = 1024 ** 3;
    expect([4, 16, 64].map((gb) => gateCommandSlots(gb * GIB))).toEqual([1, 2, 8]);
  });
});
