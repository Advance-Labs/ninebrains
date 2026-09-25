# PROGRAM-00 — Turn the strategy document into an executable build program

| | |
|---|---|
| **Workstream** | Program setup (produces W1–W11) |
| **Lane** | L0 |
| **Model** | Opus |
| **Risk tier** | Standard (docs-only; no path in the CODEOWNERS security-sensitive block) |
| **Revision** | `de2549e29` |
| **Status** | `verified` |

## What changed

Thirty-two files under `docs/strategy/`, plus section 53 of `docs/UPSTREAM-PATCHES.md`.

The section was numbered 52 when first written and renumbered to 53 on rebase, because #83
took 52 on main first. The commit message of `6b3f18b05` still says 52; that is the standing
cost of the patch-log convention, and the mechanical resolution is to renumber rather than
merge hunks.

- Four program-level pages: north star, swarm charter, execution plan, definition of done.
- Eleven workstream pages (W1–W11), each with intent, a "where the code is today" section
  citing verified paths, deliverables, acceptance criteria, evidence required, declared
  limitations, and follow-ups.
- Twelve dispatch briefs: one per lane plus the R1/R2/R3 reviewer briefs.
- A decision log, a job DAG, and this evidence-record directory.

Related: [issue #84](https://github.com/Advance-Labs/ninebrains/issues/84), the terminal
drop bug, opened and then corrected twice as review disproved its stated mechanism.

## How it was verified

Four rounds of R1/R2/R3, each on a named revision, each reviewer spawned fresh with no
sight of how the work was produced.

| Round | Revision | R1 | R2 | R3 |
|---|---|---|---|---|
| 1 | working tree | fail | fail | fail |
| 2 | `7fdcbedae` / `704cd8740` | fail | fail | fail |
| 3 | `dab15c727` | fail | fail | fail |
| 4 | `d8f2c5f5a` | **pass** | **pass** | **pass** |

Mechanical checks, all green at `de2549e29`: zero broken relative links, zero broken
heading anchors, zero unbalanced code fences, zero doubled blank lines, zero markdown table
column mismatches. `pnpm run check` is unaffected — `.oxfmtrc.json` ignores `**/*.md` and
the diff touches no TypeScript.

Path citations: 80 unique code paths extracted and checked. Every one referring to existing
code exists. The non-resolving entries are declared-new deliverables (`spec/`, `bench/`,
`packages/gates-core/src/policy.ts`) and are marked as such in the text.

## What it does not establish

- **The program has not been executed.** This is a plan that survived review, not evidence
  that the plan works. No workstream has shipped.
- **Reviewer independence here was partial.** All three reviewers ran with fresh context and
  read-only access, which are the mandatory axes. None ran on a different provider. Under
  [W4](../workstreams/W4-independent-review.md)'s ladder that is `context-only`, not `full`,
  and this record does not claim otherwise.
- **The acceptance criteria inside the workstream pages are unvalidated.** They are written
  to be mechanically checkable; whether they actually are will only be known when a lane
  tries to satisfy one.
- **The effort and cost estimates are absent, not conservative.** Nothing here estimates how
  long W1 takes or what the Opus lanes cost.
- **The external citations were not re-fetched.** The Google, Bing, Conductor, and SWE-bench
  links carry a checked-on date of 2026-09-25 from the source strategy's own reference list.
  Re-verify before any of them reaches a public page.

## Residual risks and waivers

No waivers taken.

Three risks are declared in
[`02-execution-plan.md`](../02-execution-plan.md#program-risks-nobody-had-written-down): the
independence discipline collapsing at the human-gated points, unestimated upstream
divergence cost, and a critical path that builds the moat before any of the proof. Each has
a named mitigation and an owner. The first has a stated residual: if a second reviewer never
materialises, the program ships the product work and withholds the comparative claims.

## Follow-ups filed

- L0 expands Wave 2 of [`dag.md`](../dag.md) at the Wave 1 boundary.
- Every external citation is re-verified before it reaches a public page.
- `[cite before publishing]` markers are discharged before the sentences carrying them move
  to customer-readable surfaces.
- Issue #84's mechanism question is answered or explicitly left open in the fixing PR.

## Reviewer verdicts

| Reviewer | Model | Provider | Verdict | Revision | Independence axes that held |
|---|---|---|---|---|---|
| R1 adversarial verifier | Opus | same | pass | `d8f2c5f5a` | fresh context, read-only |
| R2 claims auditor | Opus | same | pass | `d8f2c5f5a` | fresh context, read-only |
| R3 integration reviewer | Sonnet | same | pass | `d8f2c5f5a` | fresh context, read-only, different model |

Level: **`context-only`** for R1 and R2, **`model-only`** for R3. Not `full`. The word
"independent" is not used about them.

Findings raised across four rounds and resolved: 9 blocking, 31 non-blocking. The five
non-blocking findings raised alongside the round-4 pass were fixed in `de2549e29`, after the
verdicts, and are not covered by them.

One finding is worth recording separately because it is the kind the product exists to
catch. Commit `dab15c727` claimed a fix to `briefs/L4-gates.md` that its own diff did not
contain: the edit was attempted against a mis-remembered version of the text, matched
nothing, and the message was written from intent rather than from the diff. All three
reviewers caught it on the next round. The correction is recorded in
[`decisions.md`](../decisions.md), not hidden by a rewrite of history.
