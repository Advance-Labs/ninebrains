# W3 — Verification policy engine: gate classes, risk tiers, `.ninebrains/`

| | |
|---|---|
| **Lane** | L2 Policy engine architect |
| **Model** | Opus |
| **Wave** | 1–2 |
| **Risk tier** | High (`packages/gates-core/`, `packages/brain-core/` — `security-reviewed` label required) |
| **Depends on** | [W1](./W1-evidence-bundle-schema.md) (four terminal states) |
| **Blocks** | [W4](./W4-independent-review.md), W5, W6 |

## Intent

Today the question "which gates run?" is answered by two integers. `testingRigor` and
`securityRigor`, each 0..10, are compared against five thresholds and a job kind, and out
comes a list of gate ids. That is a policy — it is just an implicit one, expressed as
arithmetic, stored in app settings, invisible to the repository, and impossible for a
teammate to review in a pull request.

Make it explicit, version-controlled, and risk-aware. The output of this workstream is a
policy model a team can read, diff, and argue about, and that a stranger can inspect in a
bundle to understand *why* those particular checks ran.

Two things must survive the change intact:

1. **The gate floor.** An agent can add verification. It can never drop it. That is SEC-08
   and it is not negotiable.
2. **Deterministic CI as the immovable boundary.** An AI verdict never overrides a failed
   executable check. See [the hard rule](#the-hard-rule-deterministic-ci-is-the-immovable-boundary).

## Where the code is today

Read all of these before writing anything.

| File | What it settles now |
|---|---|
| `packages/gates-core/src/rigor.ts` | `GATE_IDS`, `RIGOR_THRESHOLDS`, `Rigor`, `rigorToGates(rigor, jobKind)` |
| `packages/gates-core/src/policy.test.ts` | The rigor table as a table test, plus `decideSelfHeal` |
| `packages/gates-core/src/run-gates.ts` | `runGates`, `RunStatus`, `GateStatus`, how a report is computed |
| `packages/gates-core/src/self-heal.ts` | `MAX_ATTEMPTS = 3`, `decideSelfHeal`, pass/retry/block |
| `packages/gates-core/src/types.ts` | `Gate`, `GateJob`, `JobKind`, `GateResult`, `GateContext` |
| `packages/brain-core/src/types.ts` | `GateSpec`, `GATE_KINDS`, `AGENT_GATE_KINDS`, `JobHints`, `Provider` |
| `packages/brain-core/src/brain/context.ts` | `GateFloorResolver` and `withGateFloor` — the SEC-08 union |
| `packages/brain-core/src/brain/gate-floor.test.ts` | The SEC-08 tests: `gates: []` still yields the floor |
| `packages/brain-core/src/protocol/scope.ts` | `checkGateKind` — agents may declare `code` or `ui` only |
| `apps/emdash-desktop/src/core/features/gates/node/rigor/rigor.ts` | `RigorResolver`, project-over-app precedence, `resolveGateFloor` |
| `apps/emdash-desktop/src/core/features/gates/contributions/settings.ts` | `ninebrains.gates`: the two sliders and evidence retention |
| `apps/emdash-desktop/src/core/features/gates/api/rigor-table.ts` | The renderer's copy of the table. **Nothing currently keeps it in step with gates-core** — there is no `rigor-table.test.ts` |
| `apps/emdash-desktop/src/core/features/gates/node/runner/gate-registry.ts` | `resolveGates`, `effectiveGateIds`, `CONFIGURATION_ERROR_METRIC` |

### The five facts that constrain the design

**1. There are five gate ids and two dials.** `GATE_IDS` is `tests`, `screenshot`,
`reviewer`, `security-review`, `fact-check`. `RIGOR_THRESHOLDS` attaches each to a level:
tests and fact-check at 3, screenshot at 5, security-review at 6 (on the *security* dial),
reviewer at 7. The strategy names roughly thirty gates across four classes. Two integers
cannot express that selection, and adding a third and fourth dial is not the fix.

**2. Job kind already gates gate selection.** `rigorToGates` splits on `CODE_KINDS`
(`code`, `ui`) and `CLAIM_KINDS` (`research`, `seo`); `docs` gets only the reviewer. The
tier model must keep this dimension, not replace it. Kind says *what kind of proof is
meaningful*; tier says *how much of it is required*.

**3. The floor is a union, computed in brain-core, and it holds.** `withGateFloor` returns
`union(floor, requested)`, floor first, deduplicated. `gateSpec: { gates: [] }` still yields
the floor. Only a project whose floor is genuinely empty — rigor 0 — can run no gates at
all. `gate-floor.test.ts` asserts each of these, including through the agent-facing
`create_job` op.

**4. SEC-08 is enforced in two places, and both matter.** `withGateFloor` stops a caller
subtracting gates. `checkGateKind` in `protocol/scope.ts` stops a caller subtracting the
*floor itself* by relabelling the work: a token may declare `AGENT_GATE_KINDS`
(`code`, `ui`) and nothing else, because every other kind has a weaker floor. The refusal
is explicit rather than a silent coercion. The comment on `AGENT_GATE_KINDS` states the
invariant precisely: "an agent can add verification by calling work UI, never drop it by
calling code work docs."

**5. A missing gate fails.** `gate-registry.ts` turns an id nobody provides into a gate
that fails, so a job can never pass — or slip to `unverified` — because a gate it asked for
was not registered. Whatever the policy file can name, the registry must be able to refuse
by name.

The policy engine is a richer way to *compute* a floor. It is not a way around one.

## Deliverables

### D1 — Four gate classes

Classify every gate. The class is not decoration: it decides what a failure means, whether a
human can waive it, and whether the result is admissible as proof of anything.

| Class | Gates | Failure means | Waivable |
|---|---|---|---|
| **Deterministic** | tests, build, typecheck, lint, format, coverage delta, SAST, dependency audit, secret scan, license scan, schema checks, architectural fitness | An executable check exited non-zero | Never by an AI; by a named human only, recorded as a waiver |
| **Behavioral** | Playwright journeys, API contract checks, a11y, screenshots, visual diffs, performance budgets, migration dry runs | An observed behaviour differed from the expected one | Human, with the artifact attached to the waiver |
| **Independent agent** | issue alignment, adversarial review, security reasoning, test-quality review, unsupported-claim detection | A separate reviewer found a blocking problem | Human, and the reviewer's findings stay in the bundle |
| **Human** | architecture approval, risk acceptance, merge approval, production release | A person has not yet decided | Not applicable; it *is* the decision |

Represent the class on the `Gate` interface in `packages/gates-core/src/types.ts` as a new
required field on new gates and an optional one during migration. Today's five map as:
`tests` deterministic; `screenshot` behavioral; `reviewer`, `security-review` and
`fact-check` independent agent. Human gates have no `Gate` implementation yet — they are a
state a job waits in, not a process that runs, and W6 owns the approval surface.

Rules that follow from the classes:

- **A deterministic gate must not call `spawnReviewer`.** Assert it in a test over the
  registry, not in a code comment.
- **An independent-agent gate's result is never the sole basis for `verified`** on a tier
  that also requires deterministic gates. The tier table, not the gate, enforces this.
- **A class is recorded per gate in the bundle.** A reader must be able to tell, without
  knowing our gate ids, which passes were executable and which were judgements. This is a
  [W1](./W1-evidence-bundle-schema.md) schema field; ask for it as a contract change, do
  not invent it here.

### D2 — Four risk tiers

Exactly the strategy's four. Do not add a fifth, do not rename them.

| Tier | Example work | Required proof |
|---|---|---|
| **Low** | Copy, docs, isolated tests | Scope check, build, lint, link/citation check |
| **Standard** | UI or API feature | Tests, type check, screenshots or API checks, independent review |
| **High** | Auth, billing, permissions, migrations | Standard gates plus SAST, secrets, threat review, rollback proof, mandatory human approval |
| **Critical** | Production infrastructure or regulated data | Custom policy, isolated environment, two-person approval, deployment controls |

Tier and kind are orthogonal. Tier sets the required classes and the human requirement;
kind decides which gates within a class are meaningful. A `docs` job at High tier does not
get screenshots — it gets the citation check, the reviewer, and the human approval.

#### How a tier resolves

Four inputs, evaluated in this order, taking the **maximum** tier any of them yields:

1. **File-path rules** from the policy file. Glob to tier. `src/auth/**` → High.
2. **Job kind.** A default tier per `GATE_KINDS` value, from the policy file.
3. **Changed-file heuristics.** Built-in signals that raise, never lower: a migration
   directory, a lockfile, a CI workflow, a file matching a secret-bearing name pattern, a
   dependency manifest, a change to the policy file itself. Each heuristic names itself in
   the bundle so a reader can see which one fired.
4. **Explicit override** on the job (`gateSpec`), or from the dispatching human.

Resolution happens once, before the gates are selected, and the resolved tier plus the rule
that produced it are recorded. "Why did this run SAST?" must be answerable from the bundle
alone.

#### Monotonicity

> **A job may raise its own tier. It may never lower one.**

This is the same argument as SEC-08 and it should be implemented as the same shape.
`withGateFloor` computes `union(floor, requested)`; tier resolution computes
`max(pathTier, kindTier, heuristicTier, requestedTier)` over a total order
`low < standard < high < critical`. A caller that asks for `low` on a path the policy calls
`high` gets `high`, silently and without error, exactly as `gates: []` silently gets the
floor.

The agent-facing surface needs the `checkGateKind` treatment too. An agent that could
declare its own tier could relabel an auth change as Low and lose SAST, the secret scan and
the human approval in one field. Two defensible options — pick one and write down why:

- **Refuse** a tier declaration from a lane token, as `checkGateKind` refuses a weak kind.
- **Accept it as a floor-raiser only**, discarding any value below the resolved tier.

The second is friendlier and equally safe under `max`. Whichever is chosen, add the case to
a test file that sits beside `gate-floor.test.ts` and reads the same way: a table of
"caller asked for X, policy said Y, effective tier is Z."

### D3 — The `.ninebrains/` policy file

Version-controlled, in the repository, reviewable in a pull request. This is the artifact
that makes a quality bar a team property rather than a per-laptop setting, and it is the
thing [W6](./W6-team-mode.md) builds on.

Location: `.ninebrains/policy.yaml`, with `.ninebrains/policy.json` accepted equivalently.
YAML for humans; the loader normalises both to the same validated object.

```yaml
version: 1

defaults:
  tier: standard

tiers:
  low:
    require:
      deterministic: [build, lint, format]
      independent: [fact-check]      # only where the job kind makes it meaningful
    human: none
  standard:
    require:
      deterministic: [tests, typecheck, lint]
      behavioral: [screenshot]
      independent: [reviewer]
    human: none
  high:
    require:
      deterministic: [tests, typecheck, lint, sast, secret-scan, dependency-audit]
      behavioral: [screenshot, migration-dry-run]
      independent: [reviewer, security-review]
    human: approval            # a named person must approve before `verified`
  critical:
    require:
      deterministic: [tests, typecheck, lint, sast, secret-scan, dependency-audit, license-scan]
      behavioral: [screenshot, migration-dry-run, performance-budget]
      independent: [reviewer, security-review, test-quality]
    human: two-person

resolve:
  paths:
    - { match: 'src/auth/**', tier: high }
    - { match: 'src/billing/**', tier: high }
    - { match: 'drizzle/**', tier: high }
    - { match: 'infra/**', tier: critical }
    - { match: 'docs/**', tier: low }
  kinds:
    docs: low
    seo: low
    research: standard
    code: standard
    ui: standard

models:
  # Restrictions, not preferences. A tier that cannot meet these blocks.
  reviewer:
    high: { require_different_provider: true }
    critical: { require_different_provider: true, require_pinned_profile: true }

waivers:
  allowed_tiers: [low, standard, high]   # `critical` is never waivable
  allowed_classes: [behavioral, independent]
  # Deterministic gates are absent on purpose. See "the hard rule" below.
  require_reason: true
  require_actor: true
  expires_after_days: 30
```

Binding rules on the loader:

- **Resolution splits by what is being resolved.** Settled in
  [`decisions.md`](../decisions.md); do not re-litigate it here, and do not collapse the two
  cases into one chain.

  - *Ergonomic settings* — worktree root, shell setup, scripts, preserve patterns — resolve
    **nearest layer wins**, extending the chain the repo already documents for
    `projectConfig` with the new repo layer slotted below the workspace layer:
    **personal > workspace `.emdash.json` > `.ninebrains/` > host default > built-in.**
    Note that the existing chain has a *personal* layer at the top; a policy design that
    omits it is not "the same precedence as `projectConfig`."
  - *Verification policy* — tiers, required gates, model restrictions, waiver rules —
    resolves **strictest layer wins**. There is no nearest-layer rule here at all. A lower
    layer may raise a tier or add a gate; nothing at any layer may lower a tier, remove a
    required gate, or widen a model restriction.

  The asymmetry is deliberate and it already exists in this codebase: `AGENT_GATE_KINDS` and
  `checkGateKind` let an agent add verification and never drop it (SEC-08). W3 extends that
  from agents to config layers.
- **Arrays replace, they do not merge — for ergonomic settings.** A layer that sets a scripts
  array replaces it. For verification policy, the resolved requirement is the union of every
  layer's requirements, because union is what "strictest wins" means for a set. Say both
  rules in the file's own documentation; the intuitive expectation is the opposite in each
  case, and a silent merge or a silent replace would quietly weaken a tier.
- **Precedence never lowers the floor.** A lower-precedence layer that requires *more* still
  contributes its gates. Layering picks the *values*; the SEC-08 union and the tier `max`
  then apply on top. A host default cannot be used to strip a repo policy's gates. Assert
  this with a test whose name says exactly that.
- **An unknown gate id is a load error, not a warning.** The registry already turns an
  unprovided id into a failing gate; the policy loader should catch the typo earlier and
  name the file and line.
- **An invalid policy file blocks, it does not fall back.** Falling back to a built-in
  default on a parse error silently downgrades a team that thought it had a High floor.
  Report the error and refuse to dispatch, the way `prepareReviewerRoute` refuses rather
  than downgrading under SEC-42.
- **Every resolved value carries its source.** Like `projectConfig`'s `{ value, from }`
  results, the resolver returns which layer supplied each field, and the bundle records it.

### D4 — Migration from rigor sliders

Existing users have two integers in `ninebrains.gates` and possibly per-project overrides in
`project-prefs`. None of that may break.

- **`rigorToGates` stays, exported, behaviour-identical.** Mark it `@deprecated` with the
  replacement named in the tag. Keep `policy.test.ts`'s table passing unchanged — a
  migration that edits the old test's expectations is not a migration.
- **Add `rigorToTier(rigor, jobKind): Tier`**, a pure function beside it, with its own table
  test. A defensible mapping, to be confirmed against the thresholds rather than guessed:

  | Condition | Tier |
  |---|---|
  | `testing < RIGOR_THRESHOLDS.tests && security < RIGOR_THRESHOLDS.securityReview` | `low` |
  | `security >= RIGOR_THRESHOLDS.securityReview` | `high` |
  | `testing >= RIGOR_THRESHOLDS.reviewer` | `high` |
  | otherwise | `standard` |

  `critical` is never reached from a slider. It requires an explicit policy file. That is
  the point: a tier with two-person approval should not be reachable by dragging a control.
- **No policy file means slider behaviour, unchanged.** A repository without `.ninebrains/`
  keeps today's gate selection exactly. The tier is derived for display and for the bundle,
  and the *effective gate set is asserted identical* to `rigorToGates` in a test that runs
  the full 0..10 × 0..10 × five-kinds cross-product. That test is the compatibility
  contract.
- **A policy file supersedes the sliders for that project, and the UI must say so.** A
  slider that silently does nothing is worse than a slider that is disabled with a line of
  text naming the file that now decides.
- **`RigorResolver` keeps its shape.** It already caches an app setting and per-project
  overrides and exposes `resolveGateFloor` synchronously, because brain-core calls it inside
  a transaction. The policy loader must be able to satisfy the same synchronous contract:
  load and validate at boot and on file change, never read the disk inside
  `resolveGateFloor`.
- **`apps/emdash-desktop/src/core/features/gates/api/rigor-table.ts` is an unguarded renderer
  copy.** Verified: no `rigor-table.test.ts` exists anywhere in the repo, so nothing stops it
  drifting from `packages/gates-core/src/rigor.ts` today. This is a latent bug, not a
  property to preserve. D4 either deletes the duplication outright — preferred — or adds the
  equality test that was assumed to exist. Do not leave it as it is.

## The hard rule: deterministic CI is the immovable boundary

> **An AI verdict never overrides a failed executable check.**

Not "should not." Cannot. This is the single claim the product's category rests on, and it
is what separates an evidence bundle from a green badge.

**Where it is enforced today.** `runGates` in `packages/gates-core/src/run-gates.ts` computes
`pass = results.every((r) => r.pass)`. There is no weighting, no quorum, no override path,
and `GateStatus` makes every non-verdict outcome — `timeout`, `error`, `cancelled` — a
failure, on the stated principle that a gate which could not reach a verdict has not
verified anything. A reviewer gate is one entry in `results`. It cannot reach the others.

**What this workstream must not do.** The tier model introduces required-class lists, and a
required-class list is exactly the shape that invites a "satisfied by any of" rule. Do not
add one across classes. Within a class, a tier may require a subset. Across classes, the
conjunction is absolute.

**What this workstream must add.**

- A test named for the invariant — `deterministic-boundary.test.ts` — asserting that a run
  with a failing deterministic gate and a passing independent-agent gate yields
  `status: 'failed'`, at every tier, and that no policy file can express otherwise.
- A loader rejection: a policy that places a deterministic gate under `waivers.allowed_classes`
  fails validation with an error naming the rule. The example above omits it on purpose.
- A policy-fuzz test: generated policy files may not produce a configuration in which a
  failing deterministic gate yields anything other than `failed`.

**What a human can still do.** A named person may record a *waiver* on a behavioral or
independent-agent gate. The job then reaches `verified-with-waiver`, never `verified`, with
the actor, reason and timestamp in the bundle ([W1](./W1-evidence-bundle-schema.md) D2). A
waiver is a recorded human decision to accept a risk. It is not an override, it is not
issuable by an agent, and the two states must never render identically.

## Acceptance criteria

- [ ] Every gate carries a class of `deterministic`, `behavioral`, `independent`, or
      `human`, and the class is asserted in a registry test rather than stated in a comment.
- [ ] A test asserts that no gate classed `deterministic` reaches `spawnReviewer`.
- [ ] `Tier` is a closed union of exactly `low`, `standard`, `high`, `critical`, with a total
      order, and a consumer can switch on it exhaustively.
- [ ] Tier resolution takes the maximum over path rules, job kind, changed-file heuristics,
      and explicit override, and a table test covers each input winning.
- [ ] A caller requesting a tier below the resolved one gets the resolved one, asserted in a
      test that reads like `gate-floor.test.ts`.
- [ ] The agent-facing path cannot lower a tier; the chosen behaviour (refuse, or accept as
      floor-raiser only) is tested and its rationale written down.
- [ ] `.ninebrains/policy.yaml` loads, validates, and produces an identical result from the
      equivalent `.json`.
- [ ] Ergonomic settings resolve personal > workspace `.emdash.json` > `.ninebrains/` > host
      default > built-in, with arrays replacing rather than merging.
- [ ] Verification policy resolves as the union of every layer's requirements, and a test
      asserts that **no** layer — personal, workspace, project override or repo — can lower a
      tier, remove a required gate, or widen a model restriction.
- [ ] An unknown gate id, an unknown tier name, or a malformed policy blocks dispatch with an
      error naming the file; it never falls back to a built-in default.
- [ ] `rigorToGates` is unchanged, still exported, marked deprecated, and `policy.test.ts`
      passes without edits to its expectations.
- [ ] With no policy file present, effective gates equal `rigorToGates` across the full
      0..10 × 0..10 × five-kind cross-product, asserted by a test.
- [ ] `deterministic-boundary.test.ts` asserts that a failing deterministic gate plus a
      passing reviewer yields `failed` at every tier.
- [ ] A policy file listing a deterministic gate as waivable fails validation with an error
      naming the rule.
- [ ] The resolved tier, the rule that produced it, each gate's class, and each policy field's
      source layer are all present in the emitted bundle.
- [ ] `pnpm run check` passes; `docs/UPSTREAM-PATCHES.md` updated if an inherited file changed;
      `security-reviewed` label applied after a real review of the SEC-08 interaction.

## Evidence required for review

1. The policy file used, and the resolver's output for five jobs: one per tier plus one where
   a changed-file heuristic raised the tier above the path rule.
2. Test output for the monotonicity table, the precedence test, and the compatibility
   cross-product against `rigorToGates`.
3. Test output for `deterministic-boundary.test.ts` and the waiver-class rejection.
4. A bundle from a High-tier job showing the resolved tier, the rule that fired, and each
   gate's class.
5. A written note on what a tier does **not** establish.

## Limitations to declare

- A tier selects which checks run. It does not establish that the change is correct, only
  that the configured checks for that tier passed.
- Changed-file heuristics are pattern matching. They will miss a security-relevant change in
  a file nobody thought to glob, and they will over-tier a harmless rename. They raise only,
  which makes the second failure mode the cheap one.
- The policy file is as trustworthy as the repository it lives in. Anyone who can commit to
  the repository can commit a weaker policy. This is a code-review property, not a
  cryptographic one, and the docs must not imply otherwise.
- Human gates are modelled here but implemented in [W6](./W6-team-mode.md). Until then, a
  `high` or `critical` tier can require an approval that nothing in the app can yet collect.
  Decide whether that blocks or warns, and say which.
- The tier mapping from rigor sliders is a judgement call, not a derivation. It is documented
  and testable, not provably right.

## Follow-ups this job should file, not do

- Policy packs: shared, versioned tier definitions per stack ([W6](./W6-team-mode.md)).
- A `ninebrains policy explain <job>` command that prints the resolution trace.
- Tier-aware retry budgets: `MAX_ATTEMPTS` is a flat 3 in `self-heal.ts` and probably should
  not be flat across `low` and `critical`.
- Architectural fitness and license-scan gate adapters ([W5](./W5-gate-adapters.md)).
- A policy linter that flags a tier whose required set is weaker than the tier below it.
