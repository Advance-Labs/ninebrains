# Swarm charter

How the agent swarm that executes this program is organised, dispatched, reviewed, and
stopped. Read with [`03-definition-of-done.md`](./03-definition-of-done.md).

## Shape

One orchestrator (the Brain), ten delivery lanes (L1–L10), three standing reviewers, and
one human whose time is a scheduled resource, not an assumption. Lanes never
talk to each other directly; everything flows through the Brain as jobs with explicit
dependency edges. This is the same DAG-and-gates loop the product implements, run on
itself — deliberately, because the program's credibility depends on us using it.

```
                       ┌───────────────────┐
                       │  L0  Brain        │  Opus — plan, dispatch, adjudicate
                       └─────────┬─────────┘
       ┌─────────────┬───────────┼───────────┬─────────────┐
   ┌───┴───┐     ┌───┴───┐   ┌───┴───┐   ┌───┴───┐     ┌───┴───┐
   │ L1–L5 │     │ L6–L7 │   │  L8   │   │  L9   │     │  L10  │
   │ product│    │ proof │   │content│   │partners│    │metrics│
   └───┬───┘     └───┬───┘   └───┬───┘   └───┬───┘     └───┬───┘
       └─────────────┴───────────┼───────────┴─────────────┘
                       ┌─────────┴─────────┐
                       │ R1 R2 R3 reviewers│  fresh context, read-only
                       └───────────────────┘
```

## Lane roster and model assignment

Model choice is not a preference. It follows one rule:

> **Opus** where a wrong decision is expensive to reverse and cheap to make: schemas,
> security semantics, policy meaning, benchmark judging, category narrative, adjudication.
> **Sonnet** where the decision space is already closed and the work is volume: adapters,
> exporters, CI wiring, tests against a fixed contract, page drafting from an approved
> outline, submissions.

| Lane | Role | Model | Owns | Why that model |
|---|---|---|---|---|
| L0 | Brain / program orchestrator | **Opus** | Plan, dispatch, dependency edges, adjudication of reviewer conflicts, stop conditions | Cross-workstream trade-offs and escalation judgement |
| L1 | Evidence architect | **Opus** for [W1](./workstreams/W1-evidence-bundle-schema.md), **Sonnet** for [W2](./workstreams/W2-evidence-viewer-and-exports.md) | W1, W2 | The bundle schema is a published, versioned contract and mistakes are permanent; the exporters and viewer are volume work against it |
| L2 | Policy engine architect | **Opus** | [W3](./workstreams/W3-verification-policy-engine.md) | Risk-tier semantics decide what is allowed to merge |
| L3 | Independent review architect | **Opus** | [W4](./workstreams/W4-independent-review.md) | Independence and reviewer sandboxing are security-sensitive (SEC-18) |
| L4 | Gate adapter builder | **Sonnet** | [W5](./workstreams/W5-gate-adapters.md) | Many adapters against one fixed `Gate` interface |
| L5 | Team mode builder | **Sonnet** | [W6](./workstreams/W6-team-mode.md) | CRUD, config precedence, templates against an approved design |
| L6 | Benchmark lead | **Opus** | [W7](./workstreams/W7-verified-delivery-bench.md) | Judging design and false-verification measurement decide our credibility |
| L7 | Spec editor | **Opus** | [W8](./workstreams/W8-open-evidence-standard.md) | A public standard other tools implement |
| L8 | Content and positioning | **Sonnet**, Opus for the category page and comparisons | [W9](./workstreams/W9-positioning-and-content.md) | Volume drafting is Sonnet work; category framing and competitor claims are not |
| L9 | Corroboration and partners | **Sonnet** | [W10](./workstreams/W10-external-corroboration.md) | Outreach, tracking, submissions against a fixed brief |
| L10 | Metrics and scorecard | **Sonnet** | [W11](./workstreams/W11-metrics-and-scorecard.md) | Instrumentation against a defined metric list |

Escalation the other way is allowed and expected: a Sonnet lane that hits a genuine design
fork **stops and asks L0**, which either decides or spawns an Opus lane for that decision
only. A Sonnet lane must never invent a schema field, a risk-tier rule, or a competitor
claim.

## Standing reviewers

Three reviewers, spawned fresh per deliverable. They are the program's own verification
gates, and they mirror the product's independence rules.

| ID | Reviewer | Model | Refuses the deliverable when |
|---|---|---|---|
| R1 | **Adversarial verifier** | **Opus** | The acceptance criteria are not actually met, the evidence does not show what it claims, or a test passes for the wrong reason |
| R2 | **Claims auditor** | **Opus** | Any banned claim from [`00-north-star.md`](./00-north-star.md#claims-discipline) appears, a superlative lacks a dated method, or a competitor statement lacks a cited and dated source |
| R3 | **Integration reviewer** | **Sonnet** | The change breaks repo conventions, the merge gate, `docs/UPSTREAM-PATCHES.md`, or another lane's contract |

Rules that make the review meaningful, taken from the product's own design:

- A reviewer receives a **fresh context**. It does not see the builder's reasoning, only
  the brief, the acceptance criteria, and the diff or artifact.
- A reviewer must not be the same model instance that produced the work, and for L1–L3 and
  L6–L7 deliverables it should be a **different provider** where available.
- A reviewer reads. It does not edit. Findings go back to the lane.
- **A reviewer verdict never overrides a failed deterministic check.** If `pnpm run check`
  fails, the deliverable is blocked regardless of what three reviewers think.

**Sign-off rule.** A deliverable is accepted when R1, R2, and R3 each return `pass` on the
same revision, recorded in the deliverable's evidence record. Two passes and one fail is a
fail. A reviewer that returns `inconclusive` blocks; L0 must resolve the ambiguity rather
than average the verdicts away.

## H1 — the human, and what only they can supply

The roster above is eleven agents. Several acceptance criteria in this program cannot be met
by any of them, and the program previously failed to say so. They are listed here so L0 can
schedule them as real, scarce capacity rather than discovering them at a wave boundary.

| Requirement | Where | Why no agent can supply it |
|---|---|---|
| Two external engineers review the benchmark design | [W7](./workstreams/W7-verified-delivery-bench.md) | The point is that they are not us |
| Blind human rubric scoring, with stopwatched review minutes | [W7](./workstreams/W7-verified-delivery-bench.md) | Roughly 24 tasks × 3 configurations × 3 repetitions. Budget it in hours, not as a checkbox |
| Ten business days' right of reply to a named competitor | [W7](./workstreams/W7-verified-delivery-bench.md) | A commitment to a third party |
| An outside producer and an outside consumer of AVES | [W8](./workstreams/W8-open-evidence-standard.md) | The freeze gate is adoption by someone else |
| A real GitHub App on a real PR | [W6](./workstreams/W6-team-mode.md) | Account ownership and installation consent |
| Ten recruited design partners, three user-authored case studies | [W10](./workstreams/W10-external-corroboration.md) | Other people's time and their own words |
| Two-person approval on every Critical-tier item | [`03-definition-of-done.md`](./03-definition-of-done.md#risk-tiers-for-program-jobs) | Two people |

**The conflict of interest, stated plainly.** Advance Labs is a single operator. Without
deliberate effort, the same person is the strategy's author, L0's owner, the sole approver
of every Critical item, the blind rubric reviewer, and the party with the strongest interest
in the numbers looking good. That is the exact correlated-assumption failure this product
exists to prevent, reproduced in the program that builds it.

Mitigations, all of which are binding:

- The benchmark's blind rubric reviewer must not be the person who owns L0 for that
  workstream. If no second person is available, the rubric scores are published as
  **self-scored** and the comparative claim is not made.
- "Two-person approval" is never satisfied by one person twice. Where a second person is
  genuinely unavailable, the item ships as `verified-with-waiver` with the waiver naming the
  missing approval — never as `verified`.
- W7 may not publish a result that names a competitor on self-review alone. That is a stop
  condition, not a judgement call.

If these three cannot be honoured, the honest move is to publish the product work and
withhold the comparative claims, not to publish comparative claims with a thin process
behind them.

## Where verdicts and decisions are recorded

Two artifacts, both in the repository, both part of the deliverable:

- **`docs/strategy/decisions.md`** — L0's decision log. One entry per decision: context,
  decision, alternatives, reversibility, owners. Newest first.
- **`docs/strategy/evidence/<job-id>.md`** — one file per completed job. It holds the
  handoff report's six headings, the R1/R2/R3 verdicts with the revision SHA each was run
  against, and links to the evidence artifacts. This is what
  [`03-definition-of-done.md`](./03-definition-of-done.md) means by "recorded in the
  deliverable's evidence record."

L0 maintains the job DAG itself in `docs/strategy/dag.md`, regenerated at each wave
boundary and never mid-wave.

## Job protocol

Every dispatched job carries exactly this envelope. Lanes that receive anything less should
ask for the missing field rather than guess.

```yaml
job:
  id: W3-04                    # workstream id + step number
  title: Risk tier resolution order
  workstream: W3
  lane: L2
  model: opus
  depends_on: [W3-03, W1-02]   # hard edges; do not start until done
  brief: |
    One paragraph of intent, in the lane's own terms.
  inputs:                      # files to read before starting
    - docs/strategy/workstreams/W3-verification-policy-engine.md
    - packages/gates-core/src/rigor.ts
  acceptance:                  # copied verbatim from the workstream page
    - ...
  evidence_required:           # what must exist for review
    - test output showing ...
    - a screenshot of ...
  risk_tier: standard          # low | standard | high | critical
  budget:
    wall_clock: 90m
    escalate_after_failed_attempts: 2
```

## Retry and escalation

Bounded, not infinite. This mirrors the product's own retry policy.

1. **Attempt 1** — lane executes, self-checks against acceptance criteria.
2. **Attempt 2** — on failure, lane gets the reviewer findings and retries **once**.
3. **Escalate** — a second failure does not trigger attempt 3. The lane writes a blocked
   report naming what it could not establish and hands the job back to L0.

L0 then does exactly one of: re-scope the job, split it, raise the model tier, or mark it
`inconclusive` and move it out of the critical path. L0 must not simply re-dispatch the
same brief to the same lane.

**Escalation accuracy is a tracked metric** ([W11](./workstreams/W11-metrics-and-scorecard.md)).
A lane that correctly refuses an underspecified job is doing its job well, not failing.

## Repository mechanics every lane must follow

These are this repository's real constraints. Getting them wrong wastes a full review cycle.

- **Branch per job.** `strategy/<workstream>-<slug>`, cut from `main`, never from another
  lane's branch.
- **Conventional Commits**, with scope: `feat(evidence): add bundle v0.1 schema`.
- **DCO sign-off** on every commit (`git commit -s`).
- **Attribution.** End commit messages with the session's configured `Co-Authored-By` line
  and PR descriptions with the configured generation line. Do not add attribution the repo
  has not configured.
- **`docs/UPSTREAM-PATCHES.md` is the one file that conflicts on every parallel PR.** Any
  change to a file inherited from Emdash needs an entry there. Resolve conflicts in that
  file **mechanically** — renumber your own section to the next free number, keep everyone
  else's hunks — never by merging hunks line by line.
- **`security-reviewed` label.** `pnpm run merge` (`tooling/scripts/merge-pr.mjs`) reads the
  block between the `# BEGIN security-sensitive` and `# END security-sensitive` markers in
  `.github/CODEOWNERS` and refuses to merge a PR touching any path listed there without the
  label. **Read that block; do not work from a copy.** It is wider than the package list you
  might expect — it also covers `apps/emdash-desktop/src/core/features/{gates,brain,lanes,packs,exec-runs}/`,
  `src/main/bootstrap/boot/ninebrains/`, `.github/`, `tooling/scripts/`, `docs/THREAT-MODEL.md`
  and `docs/SECURITY.md`, among others. W1–W6 will touch these constantly. Plan for the
  label, and treat it as a real review, not a checkbox.
- **A conflicting PR gets no CI run at all.** Check `mergeStateStatus` via
  `gh pr view --json mergeStateStatus`, not the Actions tab, before concluding CI is stuck.
- **Never bare `git stash`.** The stash stack is shared across worktrees. Use a WIP commit,
  or `git stash push -u -m "<unique-tag>"` and `apply` by SHA.
- **Focused checks while iterating, full gate before handoff.** `pnpm run check` is the
  merge gate: format, lint, typecheck, test. Do not run it on every edit.
- Known flake: the installation-overrides browser tests fail in a full browser-suite run
  and pass in isolation. That is pre-existing. Confirm isolation before blaming your change.

## Parallelism and collision rules

The swarm runs many lanes at once, so file ownership is assigned, not negotiated.

| Path | Sole owner |
|---|---|
| `packages/gates-core/src/evidence-*`, new `packages/evidence-*`; `spec/evidence-bundle/v0.1/` until it lands | L1 |
| `packages/gates-core/src/rigor.ts` (structure), new `packages/gates-core/src/policy.ts`, the `.ninebrains/` schema | L2 |
| `packages/gates-core/src/gates/reviewer-gate.ts`, `packages/gates-core/src/reviewer-verdict.ts`; `apps/emdash-desktop/src/main/bootstrap/boot/ninebrains/reviewer-route.ts` | L3 |
| `packages/gates-core/src/gates/*` (new adapters); **append-only** registration entries (see below) | L4 |
| `packages/brain-core/src/store/`, team config surfaces | L5 |
| `bench/` (new top-level) | L6 |
| `spec/` (new top-level), and `spec/evidence-bundle/` after L1 hands it over at the end of W1 | L7 |
| website content under `apps/site/`, `docs/brand/` | L8 |
| `docs/strategy/partners/` | L9 |
| metrics export surfaces | L10 |

**Append-only registration is pre-authorised for L4.** Adding a gate means adding an id to
`GATE_IDS` in `packages/gates-core/src/rigor.ts`, an entry to `defaultBuiltInGates` in
`apps/emdash-desktop/src/core/features/gates/node/runner/gate-registry.ts`, and, **only when the gate
needs project config**, an additive field on `gatesProjectPrefsViewSchema` in
`apps/emdash-desktop/src/core/features/gates/api/contract.ts` — that file is a Wire zod
contract, not a switch, so most gates touch it not at all. W5's authoring guide is the
detailed version; this table is the summary. L4 may make those three
**additions** without a contract change request. L4 may not change `RIGOR_THRESHOLDS`,
`rigorToGates`, or any existing entry — those are L2's, and they go through L0. Exporting a
currently module-private helper such as `withSetupFailures` is a contract change request,
not an addition.

`packages/gates-core/src/policy.ts` does not exist yet; L2 creates it. Today only
`policy.test.ts` is present.

Shared, therefore coordinated through L0 only: `packages/brain-core/src/types.ts`,
`packages/gates-core/src/types.ts`, `docs/UPSTREAM-PATCHES.md`, `AGENTS.md`.

A lane that needs to change a shared file opens a **contract change request** to L0 first:
the proposed diff, who else depends on it, and the migration for existing data. L0
serialises these. Two lanes editing `types.ts` concurrently is the single most likely way
this program produces a week of merge pain.

## Stop conditions

The swarm halts and waits for a human when any of these is true:

- A change would weaken shell quoting, spawn behaviour, env allowlists, path validation, or
  secret redaction.
- A change touches the updater, SSH, PTY, or database migration code beyond what its
  workstream authorises.
- A deliverable would require publishing a claim the claims gate rejects and the lane
  believes the gate is wrong.
- Benchmark results would be published where a competitor is named and the comparison has
  not been re-verified against their current documentation, with a date.
- Any action would send repository content, credentials, or customer code to a third-party
  service that the ICP definition says must never receive it.
- Two reviewers disagree and L0 cannot resolve it from the evidence.

Everything else, the swarm decides itself and records the decision.
