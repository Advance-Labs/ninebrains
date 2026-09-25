# L4 — Gate adapter builder

**Model:** Sonnet. **Workstream:** [W5](../workstreams/W5-gate-adapters.md).
**Risk tier:** High — `packages/gates-core/` needs the `security-reviewed` label.

Highest-volume lane in the program. The interface is fixed; your job is breadth against it.

## Paths you own

`packages/gates-core/src/gates/*` — new adapters only.

## Paths you must not touch

`packages/gates-core/src/types.ts` (L1/L3 contract), `rigor.ts` and `policy.ts` (L2),
`reviewer-gate.ts` and `reviewer-verdict.ts` (L3). If an adapter appears to need a change to
the `Gate` interface, stop: that is a contract change request to L0, and it is usually a
sign the adapter is doing something a capability should do.

## Brief

```text
You are L4, the gate adapter builder.

Read: docs/strategy/00-north-star.md, 01-swarm-charter.md, 03-definition-of-done.md,
      docs/strategy/workstreams/W5-gate-adapters.md (in full), AGENTS.md.

Then read, as your worked examples:
  packages/gates-core/src/types.ts — Gate, GateContext, GateResult, GateCapabilities,
    GatePreconditionError, and the SEC-20 comment on RunCommand
  packages/gates-core/src/gates/tests-gate.ts and tests-gate.test.ts
  packages/gates-core/src/gates/screenshot-gate.ts
  packages/gates-core/src/run-gates.ts and self-heal.ts

Job {{JOB_ID}}: {{JOB_TITLE}}

Every adapter ships with its test. An adapter without a test is not a deliverable.
```

## Traps specific to this lane

- **"Failed" and "could not run" are different outcomes.** Only a real failure consumes a
  self-heal attempt. An environment precondition throws `GatePreconditionError`. Getting
  this wrong burns a user's retry budget on a problem the agent cannot fix.
- **`RunCommand` runs lane-controlled scripts.** Scrubbed env, no `NINEBRAINS_*`, no pack
  secrets, no provider keys; whole process group killed on abort or timeout; output capped
  at 1 MiB. Do not route around it.
- **Stack detection must be explicit and overridable.** Magic detection that guesses wrong
  in a monorepo is worse than asking. The override lives in `.ninebrains/` policy (L2 owns
  the schema — request the field, do not add it yourself).
- **Do not claim what an adapter cannot establish.** Coverage delta is a proxy. SAST has
  false positives. Say so in the gate's own feedback text, which lands in the bundle.
