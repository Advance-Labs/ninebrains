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

## 2026-09-25 — The word "independent" is a per-run property, never blanket copy

**Context:** the claims audit found "independent" in four places that ship to every install
regardless of configuration: the product descriptor used in metadata and page titles, the
homepage subheadline, the sentence we most want answer engines to repeat, and the
design-partner recruitment email. [W4](./workstreams/W4-independent-review.md) defines four
independence axes and states the UI must not print the word below the `full` level, and
`PROVIDERS` in `packages/brain-core/src/types.ts` is `['claude', 'codex']` — so a
one-provider machine, which is the common case, can never reach `full`.

**Decision:** blanket copy uses the approved phrasings — "blocks completion until configured
checks pass", "separates generation from review". The word "independent" appears only where
the level can be qualified: the evidence bundle, the badge, and the app's review surface,
all rendering W4's canonical level strings from one module.

**Alternatives:** (a) keep the strategy's literal wording, which reads better and would be
false on most installs; (b) print "independent" and footnote it, which is the badge pattern
the strategy explicitly rejects.

**Why:** this is the one claim the entire category position rests on. A product that
overstates it in its own headline has already lost the argument it is trying to win.

**Reversibility:** cheap now, one-way once the copy is indexed and quoted.

**Owners:** L8 for copy, L1 and L3 for the badge and the level strings, R2 at every review.

---

## 2026-09-25 — Branch naming for the founding commit

**Context:** the charter requires lane branches to be named `strategy/<workstream>-<slug>`.
This program's own branch is `strategy/verified-multi-agent-program`, which does not match.

**Decision:** leave it. The rule did not exist when the branch was cut — this commit is what
creates it. Every branch cut after this one is held to the rule.

**Alternatives:** rename the branch, which would invalidate the review record already
attached to it.

**Reversibility:** cheap.

**Owners:** R3 enforces from the next branch onward.

---

## 2026-09-25 — Append-only gate registration is pre-authorised for L4

**Context:** W5 requires L4 to register seventeen new gate ids, which means touching
`GATE_IDS` in `packages/gates-core/src/rigor.ts`, `defaultBuiltInGates` in
`apps/emdash-desktop/src/core/features/gates/node/runner/gate-registry.ts`, and
`apps/emdash-desktop/src/core/features/gates/api/contract.ts` — files the charter assigned
to L2. As written, L4's brief forbade exactly what its workstream required, seventeen times.

**Decision:** Split by operation rather than by file. **Additions** to those three
registration points are pre-authorised for L4. **Changes** to `RIGOR_THRESHOLDS`,
`rigorToGates`, or any existing entry remain L2's and go through L0. Exporting a
module-private helper such as `withSetupFailures` is a contract change request.

**Alternatives:** (a) a contract change request per gate — seventeen serialisation points on
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

**Owners:** L0. Enforced, not merely declared: the mitigations appear as acceptance criteria
in [W7](./workstreams/W7-verified-delivery-bench.md) and
[W8](./workstreams/W8-open-evidence-standard.md), and as a named exception to two-person
approval in [`03-definition-of-done.md`](./03-definition-of-done.md#risk-tiers-for-program-jobs).
A mitigation that lives only in the charter is advisory; these do not.

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
