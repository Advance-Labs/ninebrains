import type { GateContext } from '@emdash/gates-core';
import { describe, expect, it, vi } from 'vitest';
import {
  CONFIGURATION_ERROR_METRIC,
  defaultBuiltInGates,
  effectiveGateIds,
  resolveGates,
  unknownGate,
} from './gate-registry';
import { fakeCapabilities, scriptedGate } from './test-fixtures';

const job = { id: 'j1', title: 't', body: '', kind: 'code' as const, attempt: 1 };

function context(overrides: Partial<GateContext> = {}): GateContext {
  return {
    job,
    worktreePath: '/wt',
    evidence: {
      dir: '/ev',
      list: () => [],
      put: async (input) => ({
        kind: input.kind,
        label: input.label,
        path: `/ev/${input.fileName}`,
      }),
    },
    signal: new AbortController().signal,
    capabilities: {
      ...fakeCapabilities(),
      captureScreenshot: vi.fn(),
      readWorktreeFile: vi.fn(),
    },
    ...overrides,
  };
}

describe('gate resolution', () => {
  it('puts the floor first and removes duplicates', () => {
    expect(effectiveGateIds(['tests', 'screenshot'], { gates: ['reviewer', 'tests'] })).toEqual([
      'tests',
      'screenshot',
      'reviewer',
    ]);
    expect(effectiveGateIds(['tests'], null)).toEqual(['tests']);
  });

  it('adds pack gates, keeps built-ins, and orders by the requested ids', () => {
    const seo = scriptedGate('seo-evidence', [true]);
    const gates = resolveGates({
      ids: ['seo-evidence', 'tests'],
      builtIns: defaultBuiltInGates({ testCommand: 'pnpm test' }),
      extra: [seo],
    });
    expect(gates.map((g) => g.id)).toEqual(['seo-evidence', 'tests']);
    expect(gates[0]).toBe(seo);
  });

  it('a pack gate cannot replace a built-in', () => {
    const weak = scriptedGate('tests', [true]);
    const onError = vi.fn();
    const [tests] = resolveGates({
      ids: ['tests'],
      builtIns: defaultBuiltInGates({ testCommand: 'pnpm test' }),
      extra: [weak],
      onError,
    });
    expect(tests).not.toBe(weak);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('reuses the id "tests"'));
  });

  it('an id nobody provides becomes a failing gate', async () => {
    const [gate] = resolveGates({ ids: ['nope'], builtIns: [], extra: [] });
    expect(gate?.id).toBe('nope');
    const result = await gate!.run(context());
    expect(result.pass).toBe(false);
    expect(result.feedback).toContain('"nope" is not installed');
    expect(unknownGate('x').appliesTo(job)).toBe(true);
  });

  it('SEC-20: without a user-set test command the tests gate fails as a setup problem', async () => {
    const [tests] = defaultBuiltInGates({ testCommand: null });
    const runCommand = vi.fn();
    const result = await tests!.run(
      context({ capabilities: { ...context().capabilities, runCommand } })
    );
    expect(result.pass).toBe(false);
    expect(result.feedback).toContain('No test command is set');
    expect(result.metrics?.[CONFIGURATION_ERROR_METRIC]).toBe(1);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('with a command, the tests gate runs exactly that command in the worktree', async () => {
    const [tests] = defaultBuiltInGates({ testCommand: 'pnpm test' });
    const runCommand = vi.fn(async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }));
    const result = await tests!.run(
      context({ capabilities: { ...context().capabilities, runCommand } })
    );
    expect(result.pass).toBe(true);
    expect(runCommand).toHaveBeenCalledWith('pnpm test', expect.objectContaining({ cwd: '/wt' }));
  });
});
