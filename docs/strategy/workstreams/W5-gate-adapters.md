# W5 — Gate adapters

| | |
|---|---|
| **Lane** | L4 Gate adapter builder |
| **Model** | Sonnet |
| **Wave** | 2–3 |
| **Risk tier** | High (`packages/gates-core/` — `security-reviewed` label required) |
| **Depends on** | [W3](./W3-verification-policy-engine.md) |
| **Blocks** | [W6](./W6-team-mode.md), [W7](./W7-verified-delivery-bench.md) |

## Intent

Today there are five gates: `tests`, `screenshot`, `reviewer`, `security-review`,
`fact-check`. The strategy's policy engine names two full classes — deterministic and
behavioral — that this set barely samples. This workstream closes that gap without touching
the runner. Every new gate is a value that satisfies the existing `Gate` interface and gets
registered; `packages/gates-core/src/run-gates.ts` does not learn about `typecheck` or
`sast` by name, and it must never need to. If a change here requires editing `run-gates.ts`,
the design is wrong, not the runner.

This is the highest-volume lane in the program: one gate id, one deliverable, repeated
sixteen-plus times. The adapter authoring guide below exists so that volume does not become
inconsistency.

## Where the code is today

Read `packages/gates-core/src/types.ts` in full before writing anything. It is short and
every gate in this workstream depends on getting it right.

- **`Gate`** — `{ id: string; title: string; appliesTo(job): boolean; run(ctx): Promise<GateResult> }`.
  `appliesTo` decides stack/job-kind applicability; `run` does the work.
- **`GateContext`** — `{ job, worktreePath, previewUrl?, evidence, signal, capabilities }`.
  Everything a gate is allowed to touch arrives here. A gate that reaches outside this
  object (a bare `fs` call, a bare `child_process.spawn`) is not sandboxed and will fail
  review.
- **`GateResult`** — `{ pass: boolean; evidence: Evidence[]; feedback: string; metrics?: Record<string, number> }`.
  `feedback` is read by the worker agent on its next attempt; lead with what to fix.
- **`GateCapabilities`** — the only way out to the world: `captureScreenshot`, `runCommand`,
  `spawnReviewer`, `prepareReviewCheckout`, `fetchText`, `readWorktreeFile`. A new adapter
  composes these; it does not add a seventh.
- **`GATE_IDS`** in `packages/gates-core/src/rigor.ts`: `tests`, `screenshot`, `reviewer`,
  `security-review` (`securityReview`), `fact-check` (`factCheck`) — today's five, mapped to
  rigor thresholds in `RIGOR_THRESHOLDS` and selected by `rigorToGates()`. New gate ids are
  added the same way: a key in `GATE_IDS`, a selection rule (or a policy-engine rule from
  W3 once risk tiers replace the raw sliders), never a special case in the runner.
- **Reference implementations, read all four:**
  `packages/gates-core/src/gates/tests-gate.ts` — the shape of a `runCommand`-based
  deterministic gate, including the "could not run" vs. "ran and failed" branch.
  `packages/gates-core/src/gates/screenshot-gate.ts` — a behavioral gate: deterministic
  checks first (console errors, failed requests, pixel diff via
  `packages/gates-core/src/pixel-diff.ts`), reviewer verdict second, and the precondition
  short-circuit (`SCREENSHOT_PRECONDITION_METRIC`) when every viewport fails to capture.
  `packages/gates-core/src/gates/fact-check-gate.ts` — a gate that reads a worktree file
  through `readWorktreeFile` and validates it against fetched sources through `fetchText`.
  `packages/gates-core/src/gates/reviewer-gate.ts` — `spawnReviewer` in a disposable
  `prepareReviewCheckout`, never the lane worktree; the pattern any adapter needing an
  agentic verdict (not just a deterministic pass/fail) must follow.
- **`packages/gates-core/src/run-gates.ts`** — the runner. A gate that throws, times out,
  returns a malformed result, or is cancelled counts as `fail`; `GatePreconditionError` is
  the one documented exception (see below). Do not add adapter-specific branches here.
- **App-side registration**, not gates-core itself:
  `apps/emdash-desktop/src/core/features/gates/node/runner/gate-registry.ts` —
  `defaultBuiltInGates`, `resolveGates`, `effectiveGateIds`, `withSetupFailures`,
  `CONFIGURATION_ERROR_METRIC`. This is where a built-in gate becomes part of the app's
  default set, and it is the concrete proof that adding a gate is additive: `resolveGates`
  builds a `Map` from id to `Gate` and looks up whatever `effectiveGateIds` asks for. An id
  nobody provides becomes `unknownGate(id)`, which fails cleanly rather than silently
  passing.

### SEC-20 constraints on `RunCommand`, quoted because they bind every new deterministic gate

From `packages/gates-core/src/types.ts`:

> SEC-20: the tests gate runs lane-controlled scripts through this, so the app must run it
> under the lane sandbox with a scrubbed env (no `NINEBRAINS_*`, pack secrets or provider
> keys), kill the whole process group on abort or timeout, and cap output at 1 MiB.

Every new adapter that shells out — `typecheck`, `lint`, `format`, `build`,
`coverage-delta`, `dependency-audit`, `secret-scan`, `sast`, `license-scan`,
`schema-check`, `migration-dry-run`, and the stack-detection probes themselves — goes
through the injected `RunCommand`, never a direct spawn. That is what gives the app, not the
gate, control over the sandbox, the scrubbed environment, process-group teardown, and the
1 MiB output cap. A gate that shells out on its own bypasses all four in one line and is a
High-tier finding on review, not a style note.

`apps/emdash-desktop/src/core/features/gates/node/runner/gate-registry.ts`'s
`withSetupFailures` wrapper — note it is module-private today, so reuse means asking L0 to
export it, not copying it is the existing pattern for the "the sandbox refused to start
the command" case (Linux without `bwrap`, Windows, tool missing): it distinguishes that from
an ordinary non-zero exit and marks it with `CONFIGURATION_ERROR_METRIC` so the run isn't
charged against the worker's retries. New adapters that shell out should be wrapped the same
way, not reinvent the distinction.

### `GatePreconditionError`, and why it must not consume a self-heal attempt

`GatePreconditionError` (`packages/gates-core/src/types.ts`) is thrown by a **capability**,
not by gate logic, when a gate could not reach a verdict because of an environment
precondition — DevTools open on the lane browser, another debugger attached, a required tool
absent. The screenshot gate's handling is the reference: when every viewport fails on this
error, it returns `pass: false` with `[SCREENSHOT_PRECONDITION_METRIC]: 1` in `metrics` and
feedback that says plainly "this is a setup problem, not your change."

This distinction is the single hardest rule for a new adapter to get right, and it is
non-negotiable: **"the check failed" and "the check could not run" are different outcomes,
and only the first may consume a retry.** A worker that gets told to fix code because
`pytest` was not on `PATH` burns an attempt on something no code change can fix, and the
runner's bounded retry budget (`01-swarm-charter.md`'s two-attempt rule, mirrored in the
product) makes that a real cost, not a cosmetic one. Every new adapter must:

1. Distinguish "the tool could not start / could not be found / the stack could not be
   detected" from "the tool ran and reported failures," using the `withSetupFailures` /
   `CONFIGURATION_ERROR_METRIC` pattern for command-based gates, or throwing
   `GatePreconditionError` from a capability for capability-level failures.
2. Never report a configuration problem as an ordinary `pass: false` with no marker — that
   makes it indistinguishable from a real failure both to the runner's retry accounting and
   to a human reading the bundle later.

## New adapters

Seventeen adapters — the table below is the list, and its row count is the acceptance bar.
Class is `deterministic` (exit-code or structured-output driven,
no agentic judgment) or `behavioral` (exercises running behavior, may involve a reviewer
verdict).

| Gate id | Class | What it runs | Stacks detected | Evidence emitted | Failure semantics |
|---|---|---|---|---|---|
| `typecheck` | deterministic | Project's type checker | JS/TS: `tsc --noEmit`; Python: `mypy`/`pyright` | Command log, error count | Non-zero exit or parsed diagnostics = fail; tool absent = precondition |
| `lint` | deterministic | Configured linter | JS/TS: `oxlint`/`eslint`; Python: `ruff` | Command log, violation count by rule | Non-zero exit = fail; config absent = precondition, not a silent pass |
| `format` | deterministic | Formatter check mode (`--check`, never auto-fix in the gate) | JS/TS: `oxfmt`/`prettier --check`; Python: `ruff format --check` | Command log, list of unformatted files | Non-zero exit = fail |
| `build` | deterministic | Project build/compile step | JS/TS: workspace build script; Python: package build where defined | Command log, artifact size where applicable | Non-zero exit = fail; no build step configured = precondition |
| `coverage-delta` | deterministic | Test run with coverage, diffed against the base commit's coverage | JS/TS: `vitest --coverage`/`jest --coverage`; Python: `pytest --cov` | Coverage report, before/after delta per changed file | Delta below the configured floor = fail; missing baseline = precondition, not fail |
| `dependency-audit` | deterministic | Known-vulnerability scan of the lockfile | JS/TS: `pnpm audit`; Python: `pip-audit` | Structured findings by severity | Any finding at or above the configured severity floor = fail |
| `secret-scan` | deterministic | Pattern/entropy scan of the diff | stack-agnostic | List of matches with file/line, values redacted before evidence is stored | Any match = fail; the match itself is never written unredacted to evidence |
| `sast` | deterministic | Static analysis for common vulnerability classes | JS/TS and Python via a configured SAST tool (e.g. Semgrep) | Structured findings by rule and severity | Findings at or above the configured floor = fail |
| `license-scan` | deterministic | Dependency license check against an allow/deny list | JS/TS: lockfile-derived; Python: package metadata | List of disallowed licenses found | Any disallowed license = fail; unresolvable license = precondition |
| `schema-check` | deterministic | Validates changed schema files (DB, API, config) against their own schema/spec | stack-agnostic, config-declared paths | Validation report per changed schema file | Any invalid file = fail |
| `architecture-fitness` | deterministic | Import/dependency-direction rules from `.ninebrains/` policy | JS/TS primarily; extensible | Violation list with rule id and offending edge | Any violation = fail |
| `playwright-journey` | behavioral | A configured Playwright script against the lane's preview | web UI stacks with a running preview | Trace/video where captured, step log | Any failed step = fail; no preview URL = precondition (same pattern as `screenshot-gate`'s missing-`previewUrl` case) |
| `api-contract` | behavioral | Requests against a running preview, checked against an OpenAPI/contract file | any stack exposing an HTTP API | Request/response log per checked endpoint | Any mismatch against the contract = fail |
| `accessibility` | behavioral | Automated a11y audit (e.g. axe) against the lane's preview at the screenshot gate's viewports | web UI stacks | Violation list by WCAG rule, tied to `DEFAULT_VIEWPORTS` from `screenshot-gate.ts` | Violations at or above the configured severity = fail |
| `visual-diff` | behavioral | Pixel diff against an approved baseline, reusing `pixelDiff` from `packages/gates-core/src/pixel-diff.ts` | web UI stacks | Diff PNGs and ratio per viewport | Ratio over the configured threshold = fail; this gate's diff logic already exists and must be reused, not reimplemented — see `screenshot-gate.ts`'s own baseline path for the calling convention |
| `performance-budget` | behavioral | A configured perf check (bundle size, Lighthouse-style metric, or a timed run) against a budget | stack-agnostic, budget declared in `.ninebrains/` | Metric values vs. budget, per metric | Any metric over budget = fail |
| `migration-dry-run` | deterministic | Applies pending DB migrations against a disposable database and checks for errors | stacks with a migration tool (e.g. Drizzle) | Migration log, schema diff before/after | Any migration error = fail; no disposable DB available = precondition |

Every row's evidence goes through `ctx.evidence.put()`, the same `EvidenceStore` every
existing gate uses (`packages/gates-core/src/evidence-store.ts`) — 0700/0600, redacted on
the way in for anything not a screenshot. A new adapter does not get its own storage path.

## Stack detection

Detection decides which command a deterministic gate runs; it never decides whether the
gate applies to the job (`appliesTo` still governs that, same as `tests-gate.ts`'s
`job.kind === 'code' || job.kind === 'ui'`).

**JavaScript/TypeScript.** Package manager from lockfile presence (`pnpm-lock.yaml` →
`pnpm`, `package-lock.json` → `npm`, `yarn.lock` → `yarn`). Test runner, type checker, and
linter from `package.json` `devDependencies` and config file presence
(`vitest.config.*`/`jest.config.*`, `tsconfig.json`, `.oxlintrc.json`/`.eslintrc.*`). This
repository's own root is the reference case: `pnpm`, `vitest` via `apps/emdash-desktop/vitest.config.ts`,
`oxlint` via `.oxlintrc.json`, `oxfmt` via `.oxfmtrc.json`.

**Python.** Test runner, type checker, and linter from config presence (`pytest.ini`/
`pyproject.toml`'s `[tool.pytest]`, `mypy.ini`/`pyproject.toml`'s `[tool.mypy]` or a
`pyrightconfig.json`, `ruff.toml`/`pyproject.toml`'s `[tool.ruff]`).

**Detection must be explicit and overridable, never magic.** Every detected tool and
command is a value the `.ninebrains/` policy file (owned by [W3](./W3-verification-policy-engine.md))
can set directly, and an explicit setting always wins over a detected one. A gate that picks
a tool silently and cannot be told "no, use this one instead" is not acceptable — this
mirrors `tests-gate.ts`'s own rule that its command "must come from app config the user set,
never from a job record or a worktree file." Detected values populate a default; they are
never the only path to a working gate.

## Adapter authoring guide

Copy-paste steps for a new gate. Follow `tests-gate.ts` as the deterministic template and
`screenshot-gate.ts` as the behavioral template.

1. **Add the file.** `packages/gates-core/src/gates/<id>-gate.ts`. Export one factory
   function, `<id>Gate(options): Gate`, matching the naming in `tests-gate.ts`
   (`testsGate`), `screenshotGate`, `factCheckGate`, `reviewerGate`.
2. **Define `id` and `title` as literals.** `id` becomes the `GATE_IDS` key; do not let it
   be computed or configurable — every other gate's `id` is a fixed string.
3. **Write `appliesTo(job)`.** Default from job kind, overridable via an `appliesTo` option
   in the gate's options interface — every existing gate takes this same escape hatch.
4. **Write `run(ctx)` using only `ctx.capabilities`.** No bare `fs`, `child_process`, or
   `fetch`. If the adapter needs a capability not in `GateCapabilities`, that is a contract
   change request to L0 (per `01-swarm-charter.md`'s shared-file rule for `types.ts`), not a
   local workaround.
5. **Separate "could not run" from "ran and failed."** Wrap command execution the way
   `withSetupFailures` does, or throw `GatePreconditionError` for capability-level
   preconditions. Write the test for this branch first — it is the rule most likely to be
   skipped under volume pressure, and it is the one this page states as a hard rule above.
6. **Emit evidence via `ctx.evidence.put()`** for at least: a log or structured report of
   what ran, and, on failure, enough detail in `feedback` for the worker to act without
   opening the evidence store. Follow `tests-gate.ts`'s pattern: full output to evidence,
   a truncated tail (`tailLines`) in `feedback`.
7. **Add metrics.** At minimum whatever number the gate's row in the table above implies
   (violation count, coverage delta, findings by severity). Metrics are what
   `coverage-delta` and similar gates use to report a number, not just a boolean.
8. **Register the id** in `GATE_IDS` (`packages/gates-core/src/rigor.ts`) and wire its
   selection rule — a rigor threshold today, a risk-tier rule once
   [W3](./W3-verification-policy-engine.md) lands. Do not hand-pick where a gate applies by
   editing `run-gates.ts`.

   > **Ownership.** `rigor.ts` is L2's file. Steps 8, 9 and 10 are the one exception: the
   > charter pre-authorises L4 to make **append-only additions** to `GATE_IDS`,
   > `defaultBuiltInGates` and `apps/emdash-desktop/src/core/features/gates/api/contract.ts`.
   > Changing `RIGOR_THRESHOLDS`, `rigorToGates`, or any existing entry is a contract change
   > request to L0. See
   > [`01-swarm-charter.md`](../01-swarm-charter.md#parallelism-and-collision-rules) and the
   > decision entry of 2026-09-25.
9. **Register the built-in** in
   `apps/emdash-desktop/src/core/features/gates/node/runner/gate-registry.ts`'s
   `defaultBuiltInGates`, following the existing array shape. If the gate needs project
   config (a command, a budget, a severity floor), extend
   `apps/emdash-desktop/src/core/features/gates/api/contract.ts`'s
   `gatesProjectPrefsViewSchema` the same way `testCommand` and `rigorLevel` are modeled
   there, additive only.
10. **Ship a test that proves both branches**: the gate fails the job when the check
    genuinely fails, and the gate reports a precondition (not a fail charged to the worker)
    when the tool or stack could not be reached. `packages/gates-core/src/gates/*.test.ts`
    are the existing examples to mirror.
11. **Update the rigor/policy table reference** (the README this repository already keeps in
    step with `rigor.ts`, per that file's own header comment) so the new gate's selection
    rule is documented where a human will actually look for it.

## Integration examples

The strategy names these explicitly; each is a thin adapter over the injected capabilities,
not a new capability of its own:

- **GitHub Actions** — the `dependency-audit`, `sast`, and `secret-scan` gates are natural
  candidates to also run as a GitHub Actions step for defense in depth; the local gate and
  the Action should read the same configuration so they cannot silently diverge.
- **CodeRabbit** — a PR-level review layer that runs after Ninebrains's own `reviewer` gate,
  not a replacement for it; document the ordering, do not build an adapter that pretends
  CodeRabbit's verdict is a Ninebrains reviewer verdict.
- **Playwright** — `playwright-journey`, directly.
- **Semgrep** — a concrete backing tool for `sast`.
- **Snyk** — a concrete backing tool for `dependency-audit` and, for license terms,
  `license-scan`.
- **Supabase branches** — a concrete backing mechanism for `migration-dry-run`'s disposable
  database, where a project uses Supabase.

An integration example is documentation plus, at most, a thin option on the relevant
adapter's factory (e.g. which SAST backend `sastGate` shells out to). It is not a reason to
add a bespoke gate per vendor; the gate id stays generic (`sast`, `dependency-audit`), the
backing tool is configuration.

## Acceptance criteria

- [ ] Each of the seventeen adapters exists as `packages/gates-core/src/gates/<id>-gate.ts`,
      exporting a factory matching the existing naming convention.
- [ ] Every adapter's `run` reaches the outside world only through `ctx.capabilities`; a
      grep for bare `child_process`, `fs.` (outside `ctx.evidence`), or `fetch(` in any new
      adapter file returns nothing.
- [ ] Every command-based adapter routes execution through `RunCommand`, inheriting the
      SEC-20 sandbox, scrubbed environment, process-group teardown, and 1 MiB output cap —
      never a direct spawn.
- [ ] Every adapter has a test proving the "check failed" path reports an ordinary gate
      failure, and a separate test proving the "check could not run" path reports a
      configuration/precondition outcome that a retry-accounting test asserts does not
      consume a self-heal attempt.
- [ ] JS/TS stack detection correctly identifies this repository's own tooling (`pnpm`,
      `vitest`, `tsc`, `oxlint`) when run against a fixture matching this repo's layout.
- [ ] Python stack detection correctly identifies `pytest`, `mypy` or `pyright`, and `ruff`
      against a fixture Python project.
- [ ] Every detected tool/command is overridable through `.ninebrains/` policy, and a test
      proves an explicit override wins over detection.
- [ ] `secret-scan` evidence never contains an unredacted matched value; a test scans the
      evidence store output for the seeded test secret and asserts it is absent.
- [ ] `coverage-delta` correctly reports "no baseline" as a precondition, not a failure, on a
      base commit with no prior coverage data.
- [ ] `playwright-journey` and `accessibility` correctly report "no preview URL" as a
      precondition, following `screenshot-gate.ts`'s existing pattern for the same case.
- [ ] `visual-diff` reuses `pixelDiff` from `packages/gates-core/src/pixel-diff.ts` rather
      than reimplementing pixel comparison.
- [ ] All seventeen gate ids in the table above are registered in `GATE_IDS`
      (`packages/gates-core/src/rigor.ts`) and in
      `apps/emdash-desktop/src/core/features/gates/node/runner/gate-registry.ts`'s
      `defaultBuiltInGates`, with no edits to `packages/gates-core/src/run-gates.ts`.
- [ ] The adapter authoring guide in this page is itself followed by at least the last
      adapter built in this workstream, verified by the reviewer walking that adapter
      against the eleven numbered steps.
- [ ] `pnpm run check` passes.
- [ ] `docs/UPSTREAM-PATCHES.md` updated if any inherited file changed.
- [ ] `security-reviewed` label applied after a real review of sandboxing, env scrubbing,
      and redaction across all seventeen adapters — not a per-adapter rubber stamp.

## Evidence required for review

1. Test output for all seventeen adapters, both branches (failed check, could-not-run) each.
2. A run of the full default gate set against this repository itself, showing `typecheck`,
   `lint`, `format`, and `build` passing against the repo's real `pnpm`/`oxlint`/`oxfmt`
   toolchain.
3. A run against a fixture Python project showing `pytest`, `mypy`/`pyright`, and `ruff`
   detected and run correctly.
4. The `secret-scan` redaction test output, showing the seeded secret present in the raw
   diff fixture and absent from stored evidence.
5. A grep-based check (command and output) confirming no adapter bypasses
   `ctx.capabilities`.
6. `pnpm run test:migrations` output if any project-prefs schema changes were needed for new
   adapter configuration.

## Limitations

- A passing gate set does not establish correctness. Sixteen more gates check sixteen more
  configured properties; none of them, individually or together, prove the change does what
  it was meant to do.
- `coverage-delta` is a proxy for test thoroughness, not a measure of it. A delta can rise
  while testing the wrong things, and it can be gamed by a worker padding trivial coverage.
- `sast` has false positives, will sometimes miss real vulnerabilities, and its findings
  require human judgment to triage; a passing `sast` gate is "no flagged pattern," not
  "secure."
- Stack detection covers JavaScript/TypeScript and Python only. Other stacks fall through to
  a precondition/unavailable state, not a silent pass.
- `dependency-audit`, `license-scan`, and `sast` are only as current as their underlying
  vulnerability/license databases at run time; a clean result reflects what was knowable at
  that moment, not a permanent guarantee.

## Follow-ups this job should file, not do

- Additional stack support (Go, Rust, Ruby) once JS/TS and Python coverage is proven out.
- A shared "stack detection" utility extracted for reuse if adapters start duplicating
  detection logic rather than sharing it.
- Wiring these adapters into risk-tier defaults once
  [W3](./W3-verification-policy-engine.md)'s policy engine replaces the raw rigor sliders.
- The GitHub Actions / CodeRabbit / Snyk / Supabase integration examples as published,
  user-facing guides (content work, tracked under
  [W9](./W9-positioning-and-content.md) and [W10](./W10-external-corroboration.md)).
