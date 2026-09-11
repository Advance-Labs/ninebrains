/**
 * Which `Gate` objects run for a job.
 *
 * The ids are `union(floor, gateSpec.gates)`, floor first. Built-ins come from
 * gates-core; packs add their own (e.g. `seo-evidence`). A pack gate may not
 * reuse a built-in id, so a pack can't replace `tests` with something weaker.
 * An id nobody provides becomes a gate that fails: a job must never pass, or
 * turn `unverified`, because a gate it asked for is missing.
 */
import {
  factCheckGate,
  reviewerGate,
  screenshotGate,
  securityReviewGate,
  testsGate,
  type Gate,
  type GateJob,
  type RunCommand,
} from '@emdash/gates-core';
import type { GateSpec } from '@ninebrains/brain-core';

/**
 * A failing gate sets this metric to 1 when the failure is the user's setup,
 * not the worker's change (no test command, the tests sandbox refusing to run,
 * a missing gate). The runner blocks such a job at once instead of spending
 * the worker's attempts on something it can't fix.
 */
export const CONFIGURATION_ERROR_METRIC = 'configurationError';

export interface BuiltInGateInput {
  /** SEC-20: the project's test command, set by the user. Null when unset. */
  testCommand: string | null;
}

export type BuiltInGates = (input: BuiltInGateInput) => Gate[];

const isCodeLike = (job: GateJob) => job.kind === 'code' || job.kind === 'ui';
const configurationError = { [CONFIGURATION_ERROR_METRIC]: 1 };

/** The tests gate when no command is configured: fails, and says it is a setup problem. */
function missingTestCommandGate(): Gate {
  return {
    id: 'tests',
    title: 'Tests',
    appliesTo: isCodeLike,
    run: async () => ({
      pass: false,
      evidence: [],
      metrics: configurationError,
      feedback:
        'No test command is set for this project, so the tests gate cannot run. This is a ' +
        'configuration problem for the user (Settings → Gates), not something to change in ' +
        'the worktree.',
    }),
  };
}

/**
 * `runCommand` throwing (rather than exiting non-zero) means the command never
 * ran: the SEC-20 sandbox refused it (Linux without bwrap, Windows), or the
 * tool is missing. That is setup, so the failure is marked non-retryable.
 */
function withSetupFailures(gate: Gate): Gate {
  return {
    ...gate,
    async run(ctx) {
      let refused = false;
      const runCommand: RunCommand = async (command, opts) => {
        try {
          return await ctx.capabilities.runCommand(command, opts);
        } catch (error) {
          refused = !opts.signal.aborted;
          throw error;
        }
      };
      const result = await gate.run({ ...ctx, capabilities: { ...ctx.capabilities, runCommand } });
      if (!refused || result.pass) return result;
      return {
        ...result,
        metrics: { ...result.metrics, ...configurationError },
        feedback: `${result.feedback}\nThe command could not start, so this is a setup problem for the user, not your change.`,
      };
    },
  };
}

export const defaultBuiltInGates: BuiltInGates = ({ testCommand }) => [
  testCommand && testCommand.trim().length > 0
    ? withSetupFailures(testsGate({ command: testCommand }))
    : missingTestCommandGate(),
  screenshotGate(),
  reviewerGate(),
  securityReviewGate(),
  factCheckGate(),
];

export function unknownGate(id: string): Gate {
  return {
    id,
    title: id,
    appliesTo: () => true,
    run: async () => ({
      pass: false,
      evidence: [],
      metrics: configurationError,
      feedback:
        `Gate "${id}" is not installed, so this job cannot be verified. The user must ` +
        'enable the pack that provides it.',
    }),
  };
}

export function effectiveGateIds(floor: readonly string[], spec: GateSpec | null): string[] {
  return [...new Set([...floor, ...(spec?.gates ?? [])])];
}

export function resolveGates(input: {
  ids: readonly string[];
  builtIns: readonly Gate[];
  extra: readonly Gate[];
  onError?: (message: string) => void;
}): Gate[] {
  const byId = new Map(input.builtIns.map((gate) => [gate.id, gate] as const));
  for (const gate of input.extra) {
    if (byId.has(gate.id)) {
      input.onError?.(`gates: a pack gate reuses the id "${gate.id}"; ignored`);
      continue;
    }
    byId.set(gate.id, gate);
  }
  return [...new Set(input.ids)].map((id) => byId.get(id) ?? unknownGate(id));
}
