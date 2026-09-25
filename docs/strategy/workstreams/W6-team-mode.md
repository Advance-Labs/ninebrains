# W6 — Team mode

| | |
|---|---|
| **Lane** | L5 Team mode builder |
| **Model** | Sonnet |
| **Wave** | 3 |
| **Risk tier** | Standard, High where it touches `packages/brain-core/` |
| **Depends on** | W3, W4, W5 |
| **Blocks** | W10 |

## Intent

Not enterprise administration. The strategy is explicit about this and it is binding: the
goal is that **a five-person team can clone a repository and inherit the same agent
workflow and quality bar without reading a private setup document.** No SSO, no org
console, no procurement flow. A `git clone` plus one bootstrap command gets a teammate to
the same gates, the same risk tiers, and the same review discipline the rest of the team
already has.

Team mode is what turns an individual's verification habit into a team's default. It is not
where multi-tenant, multi-org, or compliance features live. Those come later, if at all,
and only after small-team retention exists ([`00-north-star.md`](../00-north-star.md#what-we-do-not-build-during-the-wedge)).

## Where the code is today

Read these before writing anything:

- `AGENTS.md`, "Extensibility Hooks" — the settings ownership model this workstream extends.
- `packages/core/src/runtimes/workspace-registry/api/contract.ts` — the `workspaceRegistryContract`.
  `records` is the sole read path for registered workspaces. `projectConfig` (a `liveModel`)
  and `getProjectConfig` (a `fallible`) both resolve one workspace's config and return a
  `projectConfigStateSchema`, described in its own doc comment as **"Resolved personal,
  team, host, and built-in config for one workspace."** That is the precedence order,
  stated in the contract itself, and W6 must not contradict it.
- `packages/core/src/runtimes/workspace-registry/api/schemas/project-config.ts` — each
  resolved field is `{ value, from }` (see the `projectConfigProvenanceSchema`-typed string,
  boolean, string-array, and string-map field schemas). `from` is how the UI and any
  future audit surface can say *which layer* set a value — personal override, this
  workspace's `.emdash.json`, host default, or built-in. W6 does not replace this
  mechanism; it adds a layer to what `from` can name.
- `packages/core/src/runtimes/host-settings/` — per-host defaults (`shellSetup`,
  `worktreeRoot`, `tmux`), stored as JSON in the host's emdash data directory. This is the
  "host default" layer in the precedence chain, and it is per-machine, not per-team. W6
  does not touch it.
- `src/core/features/projects/node/settings/migrations/` (paths relative to
  `apps/emdash-desktop/`) — `migrate-project-settings-on-attachment.ts` and its sibling
  readers run in order when a workspace is attached. Desktop settings migrations are
  centralized here; legacy schemas stay migration-only. Any new source W6 introduces
  (`.ninebrains/` config) needs a migration entry point that follows this same pattern,
  not a parallel one.
- `packages/brain-core/src/types.ts` — `JobKind`, `GateSpec`, `GateKind`, `AGENT_GATE_KINDS`,
  `VERIFICATION_STATUSES` (see [W1](./W1-evidence-bundle-schema.md) for the migration to
  four terminal states). Team-owned gate defaults and model restrictions W6 exposes must
  resolve to the same `GateSpec` shape the app already runs, not a second gate
  configuration format.
- `packages/brain-core/src/store/` (`store.ts`, `sqlite/`, `memory-store.ts`) — where `Job`,
  `Run`, `Note`, and `DoneEntry` persist today. The audit log and waiver history this
  workstream adds are new, additive tables in this store's shape, not a bolt-on database.

Two facts that shape the design:

1. **Precedence splits by what is being resolved.** Settled in
   [`decisions.md`](../decisions.md) on 2026-09-25, because one chain cannot serve both
   cases.

   - **Ergonomic settings** — worktree root, shell setup, scripts, preserve patterns —
     keep the documented chain: personal > that workspace's `.emdash.json` >
     `.ninebrains/` > host default > built-in. Arrays replace rather than merge. A team
     policy must not silently override a developer's personal working setup; that is the
     invisible authority the north star's ICP explicitly does not want.
   - **Verification policy** — tiers, required gates, model restrictions, waiver rules —
     resolves **monotonically**: the effective requirement is the strictest layer, not the
     nearest one. A personal or workspace layer may raise a tier or add a gate. It can
     never lower a tier, remove a required gate, or widen a model restriction.

   The asymmetry is not new. `AGENT_GATE_KINDS` in `packages/brain-core/src/types.ts`
   already lets an agent call `code` work `ui` and add verification, and never lets it call
   `ui` work `docs` to drop verification (SEC-08). W6 extends that rule from agents to
   config layers, so the product has one mental model rather than two. L2 owns the rule and
   its test in [W3](./W3-verification-policy-engine.md); W6 conforms to it.
2. **`projectConfig` already returns provenance per field.** The UI work in this workstream
   is mostly making `.ninebrains/`-sourced values show up as a `from` value the existing
   settings surfaces already know how to render, not building a new settings UI from
   scratch.

## Deliverables

### D1 — Version-controlled project policy in `.ninebrains/`

The repo-level directory, structurally defined by [W3](./W3-verification-policy-engine.md),
checked into the repository. W6's job is not to define the schema — that is W3's — but to
wire it into the resolution chain above at the layer stated in fact 1, add it to the
migration/attachment path in `src/core/features/projects/node/settings/migrations/`, and
surface its resolved values through the existing `projectConfig` live model so a value set
by `.ninebrains/` shows a `from` provenance distinct from personal, workspace, and host.

### D2 — Shared roles, packs, gate definitions, and model restrictions

A team names who may approve what (roles), which discipline packs apply by default, which
gates are required per risk tier, and which providers/models a job may use. All of it
resolves to the existing `GateSpec` and `AGENT_GATE_KINDS` shapes in
`packages/brain-core/src/types.ts` — W6 adds a source for these values, not a second engine
that competes with [W3](./W3-verification-policy-engine.md)'s policy resolution.

### D3 — GitHub App for issues, checks, pull requests, and evidence links

One installable GitHub App, not a personal access token per developer. It posts the
[W2](./W2-evidence-viewer-and-exports.md) evidence-bundle Check and links the bundle from
the PR, and it reads issues the team already tracks. Scope tokens to the minimum the app
needs; do not request org-wide permissions this workstream does not use.

### D4 — Named approvals and waiver history

See the dedicated waivers subsection below.

### D5 — Repository-level audit log

See the dedicated audit-log subsection below.

### D6 — Per-job budgets and team usage visibility

A team sets a wall-clock and retry budget per risk tier (the same `budget.wall_clock` and
`escalate_after_failed_attempts` shape already used in this program's own job envelope, see
[`01-swarm-charter.md`](../01-swarm-charter.md#job-protocol)), and can see, locally, how
many jobs each teammate ran, how many reached `verified`, and how many were waived or
blocked. This is local reporting against the team's own evidence bundles and audit log — it
is not the opt-in exported metrics [W11](./W11-metrics-and-scorecard.md) defines, and it
must not silently become a second telemetry pipe. Nothing here leaves the team's own
machines unless a human explicitly exports it, the same constraint W11 states as a hard
line for its own surface.

### D7 — Standardized environment bootstrap and cleanup

One command, run from a fresh clone, that provisions the workspace, installs the team's
default packs and gates, and tears back down cleanly. This is the mechanism the "ten
minutes" acceptance criterion below is timed against.

### D8 — Merge-queue awareness and stale-base detection

A job whose base branch has moved should be flagged before its evidence bundle is trusted
as still applicable to `main`. This reuses whatever stale-base detection
[W5](./W5-gate-adapters.md) builds for its own gate adapters (see Wave 3 in
[`02-execution-plan.md`](../02-execution-plan.md)); W6's job is team-facing surfacing, not a
second implementation.

### D9 — Team templates

Next.js/Supabase, React/Vite, Node APIs, Python services, and monorepos. Each template is a
pre-filled `.ninebrains/` policy plus a bootstrap script (D7) for that stack — not a
scaffolded application. A template's job is to make the *policy and gate defaults*
reasonable out of the box for that stack, not to generate boilerplate app code.

## Waivers

A waiver is how a team accepts risk instead of pretending it isn't there. It has a fixed
shape, all four fields required:

| Field | Meaning |
|---|---|
| Actor | The named person who took the waiver. Never a service account, never "the system." |
| Reason | Free text, required, non-empty. "Waived because flaky" is a reason; a blank field is not accepted. |
| Scope | What the waiver covers — one job, one gate, one file pattern, or one risk tier on one repo. A waiver is never global by default. |
| Expiry | A hard timestamp. No waiver is open-ended. |

The waiver is recorded in the [W1](./W1-evidence-bundle-schema.md) evidence bundle's `risk`
section — that schema already reserves `waivers (who, why, when)` as a field. W6 does not
invent a second waiver record; it is the UI and approval flow that produces the value W1
already knows how to store, plus the repository-level history of every waiver ever taken
(D5's audit log is the append-only ledger; the bundle is the per-job record).

Two rules are non-negotiable, both stated directly in the strategy and repeated in
[W1](./W1-evidence-bundle-schema.md#d2--four-terminal-states):

- **A waived job is never visually indistinguishable from a clean one.** Every surface that
  shows a `verified` job — the evidence viewer, the GitHub Check, the team usage view in
  D6 — must show `verified-with-waiver` as a visibly distinct state, not a green checkmark
  with a tooltip nobody reads.
- **An expired waiver stops applying rather than silently persisting.** Once the expiry
  timestamp passes, the job it covered reverts to whatever state it would have without the
  waiver for any re-evaluation, and the audit log records the expiry as an event. A waiver
  UI that has no way to show "this waiver has lapsed" does not meet this criterion.

## Audit log

Append-only. One row per named action: waiver taken, waiver expired, approval given,
policy changed, gate override applied, GitHub App action taken on the team's behalf. Each
row carries an actor, a timestamp, and the specific thing that changed — never a vague
"settings updated."

**Deliberately not recorded:**

- Customer code or file contents. The log records that a gate ran and what its verdict was,
  not the diff it evaluated — that lives in the evidence bundle, under the bundle's own
  redaction rules ([W1](./W1-evidence-bundle-schema.md), `evidence-redact.ts`).
- Secrets, tokens, or credentials of any kind, including the GitHub App's own installation
  token.
- Anything that would leave the team's own machines by default. The audit log is local
  data, same as everything else in team mode; it is not a telemetry stream, and it must not
  be built to double as one.

**Where it lives:** an additive table alongside the existing tables in
`packages/brain-core/src/store/` — `Job`, `Run`, `Note`, and `DoneEntry` already establish
the pattern of append-mostly, typed rows keyed by project. The audit log follows the same
shape and the same store, not a parallel database.

## Explicitly out of scope

| Out of scope | Why it waits |
|---|---|
| SSO | Enterprise administration; the strategy names this explicitly as something that delays adoption past the wedge window |
| Centralized org policy (multi-repo, multi-team) | Team mode is repository-scoped by design; org-level policy is the enterprise phase the north star defers |
| Audit retention guarantees | A durability/compliance promise, not a small-team workflow feature; premature before retention itself is proven |
| Managed deployment | Ninebrains stays local-first; a hosted control plane is explicitly listed as a distraction during the wedge |
| Procurement features (seats, billing, contracts) | Small teams clone a repo, they do not procure software; this is a signal the ICP is being abandoned if it appears here |

These all come after small-team retention exists, per the strategy's own ordering, not
never — but not in this workstream.

## Acceptance criteria

- [ ] `.ninebrains/` policy resolves through `getProjectConfig` at the precedence position
      stated above (ergonomic settings resolve nearest-layer-wins; verification policy
      resolves strictest-layer-wins),
      verified by a test that sets conflicting values at each layer and asserts the winner.
- [ ] A value sourced from `.ninebrains/` reports a `from` provenance distinct from
      `personal`, `workspace`, and `host` in `projectConfigStateSchema`.
- [ ] `.ninebrains/`'s array-valued fields replace rather than merge, matching the
      documented rule for every other layer.
- [ ] A repo-owned change to `.ninebrains/` is picked up through the same migration and
      attachment path as existing settings sources, with a test under
      `src/core/features/projects/node/settings/migrations/`.
- [ ] A team's shared gate definitions and model restrictions resolve to the existing
      `GateSpec`/`AGENT_GATE_KINDS` shape in `packages/brain-core/src/types.ts` — no second
      gate-configuration format is introduced.
- [ ] The GitHub App posts a Check referencing a real evidence bundle URL on a real PR in a
      test repository, using only the permissions it declares.
- [ ] A waiver requires actor, reason, scope, and expiry; a waiver missing any of the four
      is rejected at the point of creation, not silently defaulted.
- [ ] A `verified-with-waiver` job is visually distinct from `verified` in every surface
      that renders job state: evidence viewer, GitHub Check, team usage view.
- [ ] A waiver past its expiry no longer applies to re-evaluation of the job it covered, and
      the audit log records the expiry event.
- [ ] The audit log is append-only: no code path updates or deletes an existing row.
- [ ] A scan of audit-log rows and their schema confirms no file contents, diffs, secrets,
      or credentials are ever written to it.
- [ ] Per-job budgets (`wall_clock`, `escalate_after_failed_attempts`) are enforced per risk
      tier and visible in the team usage view.
- [ ] Stale-base detection flags a job whose evidence bundle predates a base-branch move,
      reusing [W5](./W5-gate-adapters.md)'s detection rather than reimplementing it.
- [ ] Each of the five stated templates (Next.js/Supabase, React/Vite, Node API, Python
      service, monorepo) ships a working `.ninebrains/` policy and bootstrap script.
- [ ] Time to first verified job on a fresh clone, using a team template's bootstrap
      command, is under ten minutes on the declared reference machine, excluding model and
      dependency runtime — measured and recorded, not estimated. The reference machine, OS
      version, and network conditions are written into the result; a number recorded without
      them is not comparable to the next one and does not satisfy this criterion.
- [ ] `pnpm run check` passes.
- [ ] `docs/UPSTREAM-PATCHES.md` updated for any changed inherited file.
- [ ] `security-reviewed` label applied for the `packages/brain-core/` changes before merge.

## Evidence required

1. A test run showing the five-layer precedence resolution, including the
   `.ninebrains/`-below-workspace ordering for ergonomic settings, and a second showing
   strictest-layer-wins for verification policy, with conflicting values at each
   layer and the resolved winner.
2. A real GitHub Check posted against a real PR in a throwaway or fixture repository, with
   the bundle link followed and confirmed to open the correct evidence bundle.
3. A waiver created, shown visually distinct while active, then shown as expired after its
   expiry passes, with the audit-log entries for both events.
4. The audit-log schema plus a redaction test confirming no file content or secret pattern
   ever lands in a row.
5. A timed run, on a genuinely fresh clone, from `git clone` to first `verified` job, for at
   least one team template, with the wall-clock time recorded.
6. `pnpm run test:migrations` output covering the new `.ninebrains/` migration path.

## Limitations to declare

- Team mode assumes a single repository and a single GitHub organization context; it makes
  no claim about multi-repo or multi-org consistency.
- The audit log is local to whichever machine reads the team's shared config; it is not a
  centralized, tamper-evident ledger across every teammate's machine, and D5 must not
  describe it as one.
- The "ten minutes" criterion is measured on the machines and network conditions available
  during this workstream's evidence run. It is not a universal SLA across all hardware,
  connection speeds, or template stacks.
- Team templates encode reasonable defaults for their stack at the time they were written;
  they are not continuously validated against every future version of that stack's tooling.
- A waiver's expiry stops the waiver from applying; it does not retroactively re-run gates
  that were skipped under it. A lapsed waiver surfaces as no-longer-waived, not as a new
  verdict.

## Follow-ups this job should file, not do

- Centralized, cross-team audit aggregation (deferred with SSO and org policy).
- Signed, tamper-evident audit-log export (parallels the signing follow-up deferred in
  [W1](./W1-evidence-bundle-schema.md#follow-ups-this-job-should-file-not-do)).
- Additional team templates beyond the five named here.
- A richer team-usage dashboard beyond the local view D6 requires.
