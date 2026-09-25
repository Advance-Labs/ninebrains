# Dispatch briefs

One file per lane. Each file is the **exact text handed to a spawned agent** — copy it,
substitute the `{{...}}` slots, send it. Nothing else should be needed for the lane to start.

Briefs are derived from the workstream pages. When a brief and a workstream page disagree,
**the workstream page wins** and the brief is stale — fix it.

| File | Lane | Model | Workstreams |
|---|---|---|---|
| [`L0-brain.md`](./L0-brain.md) | Brain / orchestrator | Opus | all |
| [`L1-evidence.md`](./L1-evidence.md) | Evidence architect | Opus | W1, W2 |
| [`L2-policy.md`](./L2-policy.md) | Policy engine architect | Opus | W3 |
| [`L3-review.md`](./L3-review.md) | Independent review architect | Opus | W4 |
| [`L4-gates.md`](./L4-gates.md) | Gate adapter builder | Sonnet | W5 |
| [`L5-team.md`](./L5-team.md) | Team mode builder | Sonnet | W6 |
| [`L6-bench.md`](./L6-bench.md) | Benchmark lead | Opus | W7 |
| [`L7-spec.md`](./L7-spec.md) | Spec editor | Opus | W8 |
| [`L8-content.md`](./L8-content.md) | Content and positioning | Sonnet / Opus | W9 |
| [`L9-corroboration.md`](./L9-corroboration.md) | Corroboration and partners | Sonnet | W10 |
| [`L10-metrics.md`](./L10-metrics.md) | Metrics lead | Sonnet | W11 |
| [`reviewers.md`](./reviewers.md) | R1, R2, R3 | Opus / Opus / Sonnet | all |

## The shared preamble

Every delivery brief opens with this block. It is reproduced in each file so a brief can be
copied whole, but it is defined once here.

```text
You are {{LANE}} in the Ninebrains verified-multi-agent-development build program.

Repository: /Users/zordhalo/ninebrains/worktrees/... (this worktree only; never cd out of it)
Your workstream: docs/strategy/workstreams/{{WORKSTREAM}}.md
Your job: {{JOB_ID}} — {{JOB_TITLE}}

Read before doing anything:
  1. docs/strategy/00-north-star.md      — what we are building and what we refuse to build
  2. docs/strategy/01-swarm-charter.md   — how this swarm works, and the repo mechanics
  3. docs/strategy/03-definition-of-done.md — the bar, including the claims gate
  4. Your workstream page, in full
  5. AGENTS.md                            — repo conventions, commands, guardrails

Then read every file listed under "Where the code is today" on your workstream page
before writing a line. Do not invent a file, function or constant name; grep first.

Rules you cannot break:
  - Deterministic checks are the boundary. `pnpm run check` failing means blocked.
  - The claims gate applies to code comments, docs, commits and PR bodies alike.
  - You own only the paths assigned to your lane in 01-swarm-charter.md. To change a
    shared file (packages/brain-core/src/types.ts, packages/gates-core/src/types.ts,
    docs/UPSTREAM-PATCHES.md, AGENTS.md) you file a contract change request to L0 and wait.
  - Two failed attempts is an escalation, not a third attempt. Write the blocked report.
  - Never bare `git stash` — the stash stack is shared across worktrees.
  - Branch `strategy/{{WORKSTREAM}}-{{slug}}` from main. Conventional Commits. `git commit -s`.

Deliver:
  - The change, on its branch.
  - Every item under "Evidence required" on your workstream page.
  - The handoff report, using the six headings in 03-definition-of-done.md.
  - A declared limitations section. A deliverable with none is rejected on sight.
```

## Slot reference

| Slot | Meaning | Example |
|---|---|---|
| `{{LANE}}` | Lane id and role | `L2, the policy engine architect` |
| `{{WORKSTREAM}}` | Workstream page basename | `W3-verification-policy-engine` |
| `{{JOB_ID}}` | Workstream id plus step number | `W3-04` |
| `{{JOB_TITLE}}` | One line, imperative | `Risk tier resolution order` |
| `{{slug}}` | Kebab-case branch suffix | `risk-tier-resolution` |
