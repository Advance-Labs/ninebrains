# Job DAG

L0 maintains this file. Regenerated at each wave boundary, never mid-wave — a DAG rewritten
inside a wave is not a plan.

Waves and edges come from [`02-execution-plan.md`](./02-execution-plan.md); this file is the
dispatch-level view, one row per job. Job ids are `<workstream>-<nn>`.

## Legend

| Column | Meaning |
|---|---|
| **State** | `queued` (edges unmet) · `ready` · `running` · `review` · `verified` · `verified-with-waiver` · `blocked` · `inconclusive` |
| **Depends on** | Hard edges. A job does not start until every one is `verified` or `verified-with-waiver` |
| **Tier** | Program risk tier from [`03-definition-of-done.md`](./03-definition-of-done.md#risk-tiers-for-program-jobs) |

Concurrency cap: **five delivery lanes**. Shared-file work (`packages/brain-core/src/types.ts`,
`packages/gates-core/src/types.ts`, `docs/UPSTREAM-PATCHES.md`, `AGENTS.md`) is serialised
through L0 regardless of the cap.

## Wave 1

| Job | Title | WS | Lane | Model | Tier | Depends on | State |
|---|---|---|---|---|---|---|---|
| W1-01 | Evidence Bundle v0.1 JSON schema | W1 | L1 | Opus | high | — | ready |
| W1-02 | Bundle recorder: provenance, commands, exit codes, attempt history | W1 | L1 | Opus | high | W1-01 | queued |
| W1-03 | Four terminal states + Drizzle migration | W1 | L1, L2 | Opus | high | W1-01 | queued |
| W1-04 | Immutability, integrity hashes, `verifyBundle` | W1 | L1 | Opus | high | W1-02 | queued |
| W3-01 | Risk-tier model and `.ninebrains/` policy format | W3 | L2 | Opus | high | W1-03 | queued |
| W3-02 | Deterministic-boundary invariant and its test | W3 | L2 | Opus | high | W3-01 | queued |
| W9-01 | Homepage and category messaging rewrite | W9 | L8 | Opus | standard | — | ready |
| W9-02 | Limitations page: what gates do and do not prove | W9 | L8 | Opus | standard | — | ready |
| W9-03 | Early-release and unsigned-build status made unmissable | W9 | L8 | Sonnet | low | — | ready |
| W9-04 | Entity and metadata consolidation | W9 | L8 | Sonnet | low | — | ready |

## Wave 2 and later

Not yet expanded. L0 expands a wave at its boundary, after re-reading the workstream pages
and the risk review in
[`02-execution-plan.md`](./02-execution-plan.md#program-risks-nobody-had-written-down).

Two jobs are pulled forward from Wave 3 into Wave 2 by the sequencing mitigation recorded
there, because partner recruitment has a long lead time and does not need the finished
evidence layer:

| Job | Title | WS | Lane | Model | Tier | Depends on |
|---|---|---|---|---|---|---|
| W10-01 | Design-partner recruitment brief and ICP filter | W10 | L9 | Sonnet | standard | W9-02 |
| W10-02 | First partner conversations against the product as it exists today | W10 | L9 | Sonnet | standard | W10-01 |

## Human-gated items

Scheduled as scarce capacity, not assumed. Source:
[`01-swarm-charter.md`](./01-swarm-charter.md#h1--the-human-and-what-only-they-can-supply).
None of these can be marked `verified` by an agent.

| Requirement | Blocks | Earliest needed |
|---|---|---|
| Two external engineers review the benchmark design | W7 publication | Wave 4 |
| Blind rubric scoring, ~216 runs | W7 results | Wave 4 |
| Right of reply to named competitors | W7 publication | Wave 4 |
| Outside AVES producer and consumer | W8 1.0 freeze | Wave 4 |
| GitHub App installation consent | W6 D3 | Wave 3 |
| Ten recruited partners | W10 outcomes | Wave 3 |
| Second approver for Critical-tier items | W7, W8 | Wave 4 |
