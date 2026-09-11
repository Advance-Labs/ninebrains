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
} from '@emdash/gates-core';
import type { GateSpec } from '@ninebrains/brain-core';

export interface BuiltInGateInput {
  /** SEC-20: the project's test command, set by the user. Null when unset. */
  testCommand: string | null;
}

export type BuiltInGates = (input: BuiltInGateInput) => Gate[];

const isCodeLike = (job: GateJob) => job.kind === 'code' || job.kind === 'ui';

/** The tests gate when no command is configured: fails, and says it is a setup problem. */
function missingTestCommandGate(): Gate {
  return {
    id: 'tests',
    title: 'Tests',
    appliesTo: isCodeLike,
    run: async () => ({
      pass: false,
      evidence: [],
      feedback:
        'No test command is set for this project, so the tests gate cannot run. This is a ' +
        'configuration problem for the user (Settings → Gates), not something to change in ' +
        'the worktree.',
    }),
  };
}

export const defaultBuiltInGates: BuiltInGates = ({ testCommand }) => [
  testCommand && testCommand.trim().length > 0
    ? testsGate({ command: testCommand })
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
