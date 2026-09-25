# Definition of done

Applies to every job in every workstream. A workstream page may add criteria. It may never
remove one from this page.

## The universal bar

A deliverable is done when **all** of the following hold.

### 1. Acceptance criteria met, literally

Each criterion on the workstream page is satisfied as written, not as reinterpreted. A
criterion the lane believes is wrong gets escalated to L0 and changed on the page first.
Silently satisfying a different, easier criterion is the single most common failure mode in
agent work and it is treated as a blocking finding.

### 2. Deterministic checks pass

```bash
pnpm run check      # the merge gate
```

`AGENTS.md` describes it as "format, lint, typecheck, test". The script itself
(`tooling/scripts/check.mjs`) runs seven steps in sequence: `format:check`, `lint`,
`typecheck`, `licenses`, `brand:check`, `test:tooling`, `test`. Budget for the three that
the short description omits — `licenses` and `brand:check` in particular fail on changes
that look unrelated to them.

Run focused checks while iterating; run the full gate before handoff. Known flake: the
installation-overrides browser tests fail only in a full browser-suite run. Confirm in
isolation before claiming it is unrelated, and say so explicitly in the handoff.

**No reviewer verdict overrides a failed deterministic check.** This is the product's rule
and it is the program's rule.

### 3. Evidence exists and is inspectable

Not "tests were run." The actual artifact:

- Command transcripts with exit codes.
- For UI work, screenshots with viewport and URL recorded.
- For schema work, a validation run against real bundles, with the bundles attached.
- For content work, the rendered page and every competitor claim's source URL with the date
  it was verified.
- For benchmark work, raw trajectories, patches, costs, elapsed time, retry counts.

If a criterion cannot be evidenced, the deliverable is `inconclusive`, not `done`.

### 4. Limitations declared

Every deliverable ships with an explicit statement of what it does **not** establish. This
is not modesty; it is the product thesis applied to our own work. A deliverable with no
declared limitations is rejected by R1 on the grounds that no real change has none.

Record, at minimum:

- Untested areas.
- Assumptions the work depends on.
- Residual risks.
- Any waiver taken, who took it, and why.

### 5. Three standing reviewers pass on the same revision

R1 adversarial verifier, R2 claims auditor, R3 integration reviewer — all `pass`, all on
the revision being merged. See
[`01-swarm-charter.md`](./01-swarm-charter.md#standing-reviewers). One `inconclusive`
blocks. Re-running a reviewer until it passes is fabrication, and the verdict record makes
it visible.

### 6. Docs updated at the smallest applicable level

Prefer updating the smallest relevant `agents/` page over expanding `AGENTS.md`. A change
to a file inherited from Emdash needs a `docs/UPSTREAM-PATCHES.md` entry, numbered into the
next free section.

### 7. Handoff report written

Six headings, no prose padding:

```markdown
## What changed
## How it was verified
## What it does not establish
## Residual risks and waivers
## Follow-ups filed
## Reviewer verdicts (R1/R2/R3, revision SHA)
```

## Claims gate

R2's remit, enforced on code comments, docs, commit messages, PR bodies, release notes,
website copy, and benchmark write-ups alike.

**Blocking violations:**

| Violation | Example |
|---|---|
| Correctness claim | "proves the code is correct", "guarantees", "eliminates bugs" |
| Unqualified collision claim | "no collisions" without saying worktrees prevent simultaneous file overwrites, not semantic or merge conflicts |
| Independence claim without independence | calling a reviewer independent when it shares the builder's context, model, or mutable worktree |
| Security claim from the wrong premise | "secure" justified only by local execution or absent telemetry |
| Undated superlative | "best" with no methodology, date, or named comparison set |
| Uncited competitor statement | any claim about Superset, Pane, Cursor, Conductor, or CodeRabbit without a link to their own current documentation and the date it was checked |
| Benchmark overreach | reporting a single run as a reliability estimate; minimum three repetitions per configuration |
| One-off AI answer as ranking | citing a single answer-engine response as a stable position, without query, mode, location, and date |

**Approved phrasings** are in
[`00-north-star.md`](./00-north-star.md#claims-discipline). Use them verbatim where they
fit; they are load-bearing, not boilerplate.

## Risk tiers for program jobs

The same four tiers the product applies to user jobs, applied to our own.

| Tier | Program work that lands here | Required before done |
|---|---|---|
| **Low** | Docs pages, examples, directory submissions, changelog entries | Scope check, build, lint, link and citation check |
| **Standard** | Gate adapters, exporters, viewer, templates, content pages | Full merge gate, screenshots or transcripts, R1–R3 |
| **High** | Evidence schema, policy engine, reviewer isolation, anything under `packages/gates-core/` or `packages/brain-core/` | Standard plus SAST, secret scan, threat review, rollback proof, `security-reviewed` label, human approval |
| **Critical** | Release pipeline, updater, signing, published spec version 1.0, published benchmark results naming competitors | Custom policy, isolated environment, two-person approval, and an explicit human go decision |

A lane may raise its own job's tier. A lane may never lower one.

## What "verified" means for a program deliverable

The four states the product exposes, used here too:

| State | Meaning |
|---|---|
| `verified` | Every configured check passed and all three reviewers passed |
| `verified-with-waiver` | A check failed or was skipped, a named person accepted the risk, and the waiver is recorded in the bundle with its reason |
| `blocked` | A required check failed and no waiver was taken |
| `inconclusive` | The checks could not establish the claim — environment failure, missing evidence, or a criterion that turned out to be unfalsifiable |

`inconclusive` is a legitimate, respectable outcome. A swarm that never returns it is not
being careful; it is guessing. Escalation accuracy is measured in
[W11](./workstreams/W11-metrics-and-scorecard.md), and correctly refusing an
underspecified job counts in a lane's favour.
