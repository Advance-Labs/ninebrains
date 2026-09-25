# Program decisions

Newest first. Every entry: the decision, the alternatives considered, and why. L0 maintains
this file. It is the program's own evidence trail — a deliverable, not overhead.

Format:

```markdown
## YYYY-MM-DD — <decision, in one line>
**Context:** why this came up
**Decision:** what we are doing
**Alternatives:** what we are not doing, and why
**Reversibility:** cheap | costly | one-way
```

---

## 2026-09-25 — Append-only gate registration is pre-authorised for L4

**Context:** W5 requires L4 to register sixteen new gate ids, which means touching
`GATE_IDS` in `packages/gates-core/src/rigor.ts`, `defaultBuiltInGates` in
`apps/emdash-desktop/src/core/features/gates/node/runner/gate-registry.ts`, and
`apps/emdash-desktop/src/core/features/gates/api/contract.ts` — files the charter assigned
to L2. As written, L4's brief forbade exactly what its workstream required, sixteen times.

**Decision:** Split by operation rather than by file. **Additions** to those three
registration points are pre-authorised for L4. **Changes** to `RIGOR_THRESHOLDS`,
`rigorToGates`, or any existing entry remain L2's and go through L0. Exporting a
module-private helper such as `withSetupFailures` is a contract change request.

**Alternatives:** (a) a contract change request per gate — sixteen serialisation points on
the highest-volume lane, which would make L4 the program's bottleneck; (b) moving `GATE_IDS`
into L4's surface — but the thresholds that read it are genuinely L2's, and splitting them
across lanes is worse than splitting by operation.

**Reversibility:** cheap.

**Owners:** L0 enforces. R3 checks that L4's diffs to those three files are additions only.

---

## 2026-09-25 — The program names its human dependencies and its own conflict of interest

**Context:** R1 found that seven acceptance criteria across W6, W7, W8 and W10 resolve to a
human, and that every one of them resolves to the *same* human — who is also the strategy's
author, L0's owner, and the party most interested in favourable numbers.

**Decision:** Add an explicit H1 section to the charter listing what only a human can
supply, and bind three mitigations: the benchmark's blind rubric reviewer must not own L0
for that workstream; two-person approval is never one person twice; W7 may not publish a
competitor-naming result on self-review alone.

**Alternatives:** leave it implicit and handle it per item. Rejected — this is the exact
correlated-assumption failure the product exists to prevent, and a category built on
independence cannot be built by a process that quietly lacks it.

**Reversibility:** cheap to change, expensive to have skipped.

**Owners:** L0, with W7 and W8 enforcing at their publication gates.

---

## 2026-09-25 — Personal settings may raise a gate policy, never lower it

**Context:** W6 proposed the precedence `personal > .emdash.json > .ninebrains/ > host
default > built-in`, so that a team policy can never silently override a developer's
personal settings. That is right for ergonomics (worktree roots, shell setup, scripts) and
wrong for verification, where it would let any developer disable a gate the team requires.

**Decision:** Split the precedence by what is being resolved.

- **Ergonomic settings** keep the existing documented order, with the new repo layer
  slotted below the workspace layer: personal > workspace `.emdash.json` > `.ninebrains/` >
  host default > built-in. Arrays replace, not merge.
- **Verification policy** — tiers, required gates, model restrictions, waiver rules — is
  resolved **monotonically**: the effective requirement is the strictest of the layers. A
  personal layer may raise a tier or add a gate. It can never lower a tier, remove a
  required gate, or widen a model restriction.

**Alternatives:** (a) one precedence chain for everything — simple, but makes every gate
advisory; (b) team policy strictly wins everywhere — safe, but breaks personal worktree and
shell ergonomics for no benefit.

**Why:** the repo already enforces exactly this asymmetry for agent-declared gate kinds.
`AGENT_GATE_KINDS` in `packages/brain-core/src/types.ts` lets an agent call `code` work `ui`
and add verification, and never lets it call `ui` work `docs` to drop verification (SEC-08).
Extending that rule from agents to config layers keeps one mental model instead of two.

**Reversibility:** costly — it is a documented precedence users will build on.

**Owners:** L2 writes the rule and its test in W3. L5 conforms W6 to it.

---

## 2026-09-25 — Three terminal verification states become four

**Context:** `VERIFICATION_STATUSES` in `packages/brain-core/src/types.ts` is
`passed | failed | unverified`. The strategy requires `verified`, `verified-with-waiver`,
`blocked`, `inconclusive`.

**Decision:** Replace the enum, migrate persisted data, and keep the derived
`JobVerification.verified` boolean as `status === 'verified' || status ===
'verified-with-waiver'` — with a UI that always distinguishes the two.

**Alternatives:** keep three states and represent waivers as a side flag. Rejected: it makes
a waived job and a clean job structurally identical, which is the misleading-badge failure
the strategy explicitly warns against.

**Reversibility:** one-way once shipped — it is persisted data and a published schema field.

**Owners:** L1 (schema and migration), L2 (policy semantics).

---

## 2026-09-25 — Swarm concurrency capped at five delivery lanes

**Context:** ten delivery lanes exist and could all be dispatched at once.

**Decision:** At most five delivery lanes run concurrently.

**Alternatives:** run everything in parallel to compress the calendar.

**Why:** more lanes do not produce more accepted work; they produce more review backlog.
That is precisely the failure mode this product exists to prevent, and running the program
the way the product argues against would be indefensible in a case study.

**Reversibility:** cheap.

**Owners:** L0.
