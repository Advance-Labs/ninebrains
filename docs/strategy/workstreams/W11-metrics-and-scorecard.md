# W11 — Metrics and scorecard

| | |
|---|---|
| **Lane** | L10 Metrics lead |
| **Model** | Sonnet |
| **Wave** | 2–4 |
| **Risk tier** | High (privacy surface) |
| **Depends on** | W1 |
| **Blocks** | W7 |

## Intent

Make recommendation leadership a measurable system, not a feeling. Every metric this
workstream defines ladders to the [north-star metric](../00-north-star.md#north-star-metric):
**verified accepted changes per human review hour.** A metric that does not visibly connect
to that ratio does not belong on the scorecard, no matter how easy it is to collect.

## The hard constraint — read this before writing any collection code

This repository cut telemetry deliberately. Read
`apps/emdash-desktop/src/main/lib/telemetry.ts` before touching anything in this
workstream. The facts, from the code and from `docs/UPSTREAM-PATCHES.md` section 1:

- `initialize()` sets `this.apiKey = undefined` and `this.host = undefined`
  unconditionally, with the comment *"telemetry is pointed at nothing. No PostHog key or
  host is read from the build or the environment, so `isEnabled()` stays false and no
  request is ever made."*
- `this.userOptOut = storedEnabled !== 'true'` — telemetry defaults to **off**, and stays
  off until a user explicitly turns it on. `docs/UPSTREAM-PATCHES.md` states the upstream
  code failed this case and this fork fixed it: opt-in, not opt-out.
- `TELEMETRY_ENABLED` remains a build-time kill switch in
  `src/main/bootstrap/core/config.ts`, tested in `src/main/bootstrap/core/config.test.ts`.
- `src/main/lib/telemetry.test.ts` exists specifically to assert that a fresh profile is
  opted out and that nothing is fetched, **even with PostHog keys in the env and the user
  opted in** — the test guards against a regression that would re-enable network calls.

This is not incidental. It is a fork identity choice, restated in the north star's trust
strip: `Open source · Apache-2.0 · Local first · No telemetry · macOS, Windows, Linux`.

**Binding rule for this workstream:** every metric defined here is computed from data that
already exists on the user's own machine — evidence bundles ([W1](./W1-evidence-bundle-schema.md)),
the [W6](./W6-team-mode.md) audit log, and local store tables. Nothing is collected by
default. Nothing is sent anywhere without an explicit, separate opt-in action, described
below, that a user can inspect before it leaves their machine. **Any instrumentation that
would re-introduce always-on, or default-on, or silently-on data collection is a stop
condition for this workstream, not a design trade-off to weigh against convenience.** If a
metric cannot be computed locally and shown to the user before any export, it does not ship
in this form; escalate to L0 rather than build around the constraint.

## Product metrics

Each metric below states its operational definition, where the number comes from, and the
failure mode it exists to catch. "Store" references are to `packages/brain-core/src/store/`
tables; "bundle field" references are to the [W1](./W1-evidence-bundle-schema.md) schema at
`spec/evidence-bundle/v0.1/evidence-bundle.schema.json`.

| Metric | Operational definition | Data source | Failure mode it catches |
|---|---|---|---|
| Weekly teams completing ≥3 verified jobs | Count of teams (by [W6](./W6-team-mode.md) team identity) with ≥3 bundles at `status: verified` or `verified-with-waiver` in a trailing 7-day window | Bundle `status` field, aggregated per team, local to that team's own store | Distinguishes real repeated workflow adoption from a one-time trial |
| Verified-job acceptance rate | Of jobs reaching `verified` or `verified-with-waiver`, the share whose branch a human actually merged (no later revert-and-redo within a defined window) | Bundle `status` + `provenance.finalCommit`, cross-referenced against the repo's own merge history | Whether passed work actually survives human review, not just passes gates |
| False-verification rate | Of jobs marked `verified`, the share later found incorrect by a human, an independent reviewer re-check, or a subsequent bug tied back to that commit | Bundle `status` at time of verification vs. a later-recorded correction event in the [W6](./W6-team-mode.md) audit log | The core trust metric — see below |
| Median human review minutes per accepted task | Wall-clock time from a job's evidence bundle reaching `verified`/`verified-with-waiver` to the PR's human-approval timestamp | Bundle `bundle.createdAt` vs. GitHub PR approval event (via the [W6](./W6-team-mode.md) GitHub App) | Whether gates actually reduce the review bottleneck, or just move it |
| Escalation accuracy | Of jobs that reached `inconclusive` or were escalated rather than guessed at, the share where escalation was the objectively correct call (an unforced retry would not have produced a valid result) | Bundle `status: inconclusive` + [W1](./W1-evidence-bundle-schema.md) `attempts` history, judged against the job's own acceptance criteria | Rewards the system for admitting uncertainty instead of guessing — see below |
| Jobs with inspectable evidence bundles | Share of completed jobs (any terminal `JobState`) that produced a bundle a human can open, not just a pass/fail log line | Presence of a `JobVerification.evidencePath` resolving to a valid bundle vs. total completed `Job` rows in the store | Ensures the differentiator — the bundle itself — is actually being produced, not just built |
| 4-week retained teams | Teams with ≥1 verified job in each of 4 consecutive weeks | Same team-scoped bundle aggregation as the first row, extended across weeks | Separates curiosity from real workflow value |
| Time to first verified job | Wall-clock from first workspace attachment (or repo clone, for the [W6](./W6-team-mode.md) template flow) to the first bundle reaching `verified` | Workspace-registry attachment timestamp vs. first bundle `bundle.createdAt` | Captures onboarding friction; this is the same measurement the [W6](./W6-team-mode.md) "ten minutes" acceptance criterion uses for a single run, aggregated here across teams |

**False-verification rate is the core trust metric and must be minimised aggressively.** A
tool that claims verification and is regularly wrong is worse than a tool that makes no
claim at all — it spends the team's trust and, once spent, recommendation systems have no
reason to repeat the claim either. This number should be published even when it is
unflattering; the strategy is explicit that Wave 4 requires exactly that.

**Escalation accuracy deliberately rewards the system for admitting uncertainty.** A lane —
in the product or in this program — that correctly returns `inconclusive` on an
underspecified job is doing its job well, not failing one
([`03-definition-of-done.md`](../03-definition-of-done.md#what-verified-means-for-a-program-deliverable)).
This metric must not be structured so that `inconclusive` counts against the system; it
should be judged on whether the escalation was *correct*, independent of whether escalating
felt like a failure to complete the job.

## Recommendation metrics

Initial targets, copied from the strategy without softening:

| Metric | Initial target |
|---|---|
| Independent domains describing Ninebrains as verification-first | 10 substantive domains |
| Independent hands-on reviews | 5 |
| Public repositories containing Ninebrains evidence | 25 |
| Non-branded pages ranking for verification-gate queries | 10 indexed pages with impressions |
| Bing AI citations and grounding queries | Tracked weekly through the AI Performance report in Bing Webmaster Tools, [announced as a public preview in February 2026](https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview) (checked 2026-09-25). Confirm the report still exposes these fields before relying on it |
| Recommendation-query inclusion | Monthly test set across major answer engines, with exact query, mode, date, cited URLs, and output captured |

A seventh row from the strategy — share of recommendation answers naming Ninebrains — has no
initial numeric target; establish a baseline first, then set a leadership target within the
narrow query set defined in
[`00-north-star.md`](../00-north-star.md#the-sentence-we-are-trying-to-make-automatic).

These are not local metrics. They are collected by deliberately querying public search
surfaces and answer engines, not by instrumenting Ninebrains users, so the no-telemetry
constraint does not apply to this table — no user data is involved in gathering it.

## Methodology — recommendation-query audit

A one-off AI answer is not a stable ranking. Retrieval and citation vary by query
reformulation, model, mode, location, and date. An audit that does not record its exact
conditions produces a claim R2 will reject under the claims gate's "one-off AI answer as
ranking" rule (see
[`03-definition-of-done.md`](../03-definition-of-done.md#claims-gate)).

Every audited query records, at minimum:

| Field | What it captures |
|---|---|
| Exact query text | Verbatim, not paraphrased after the fact |
| Engine | Which answer engine or search surface (e.g., a named AI search product, a named chat product) |
| Mode | The specific mode used, where the engine has more than one (e.g., web search vs. an agentic or deep-research mode) |
| Location | Locale/region setting used for the query, since answer engines localise |
| Date | The exact date the query was run |
| Cited URLs | Every URL the answer surfaced as a citation, in the order shown |
| Output captured | The full text of the answer, saved verbatim, not summarised |

The audit must distinguish three separate things a single answer can conflate:

- **Source retrieval** — did the engine's index or retrieval step surface a Ninebrains page
  at all, for this query, on this date?
- **Answer use** — did the engine's generated answer actually draw on that page's content,
  as opposed to retrieving and discarding it?
- **Visible citation** — did the rendered answer show a citation or link the end user would
  actually see and could click?

A page can be retrieved without being used, and used without being visibly cited. Reporting
only "cited" collapses three different signals into one number and overstates what was
actually measured. Record all three per query, not just the citation count.

## Opting in to exported metrics

A team exports metrics only through an explicit, separate action — never a byproduct of
running jobs, and never enabled by any default state of the app.

- **How a team opts in.** A team lead runs an explicit export action in team mode
  ([W6](./W6-team-mode.md)) or a CLI equivalent. This is a distinct action from the
  per-user telemetry toggle in `telemetry.ts` — that toggle covers app usage telemetry to
  Ninebrains, which stays pointed at nothing regardless; this is a team choosing to hand
  its own aggregated, anonymized product metrics to Advance Labs or to a design-partner
  program, as described in the strategy's design-partner section.
- **What exactly is in the export.** Only the aggregated product-metric values from the
  table above — counts, rates, and durations — computed per team, never per individual
  bundle, never file paths, never diffs, never brief text, never commands, never anything
  that could reconstruct a customer's code. No field from a bundle's `changes`, `commands`,
  `screenshots`, or `review.findings` sections is ever included in an export payload.
- **How to inspect it before sending.** The export writes a JSON file to disk first. The
  team reviews that file — the same file that would be sent — before any network action
  occurs. There is no direct-to-network export path that skips the on-disk step. This
  mirrors the audit-log discipline in [W6](./W6-team-mode.md): what would leave the
  machine is inspectable, in full, before it leaves.

## Acceptance criteria

- [ ] `telemetry.ts` and `telemetry.test.ts` are unmodified by this workstream, or any
      change to them is reviewed against the specific guarantee they encode (opted-out by
      default, pointed at nothing) and does not weaken it.
- [ ] No metric-collection code path runs by default; every one requires the explicit
      team-level export action described above.
- [ ] The on-disk export file is byte-identical to what would be sent — there is no
      separate "send" payload that differs from the "inspect" payload.
- [ ] Every product metric in the table above is computed from a named, real source: a
      bundle field, a store table, or the [W6](./W6-team-mode.md) audit log — no metric is
      backed by new always-on collection.
- [ ] False-verification rate is computed and, once real data exists, published even when
      unflattering, per the Wave 4 exit criterion in
      [`02-execution-plan.md`](../02-execution-plan.md).
- [ ] Escalation accuracy is scored on correctness of the escalation decision, not
      penalized for the raw count of `inconclusive` outcomes, and the adjudicator is named:
      the same blind-rubric reviewer W7 uses for the benchmark, applying the same frozen
      criteria. A metric with no named adjudicator is a number, not a measurement.
- [ ] A recommendation-query audit run records, per query, all seven fields: text, engine,
      mode, location, date, cited URLs, output captured.
- [ ] A recommendation-query audit distinguishes source retrieval, answer use, and visible
      citation as separate recorded observations per query, not one combined signal.
- [ ] No single-run answer-engine result is reported as a stable ranking without the
      recorded conditions above attached.
- [ ] The scorecard dashboards (Wave 4, [`02-execution-plan.md`](../02-execution-plan.md))
      render both tables — product and recommendation — from the sources named above, not
      from hand-maintained numbers.
- [ ] `pnpm run check` passes.
- [ ] `docs/UPSTREAM-PATCHES.md` updated for any changed inherited file.
- [ ] `security-reviewed` label applied for any change that reads or aggregates evidence
      bundles across jobs, given the privacy surface this workstream touches.

## Evidence required

1. A test or transcript showing that with telemetry left at its default (opted out, no
   key/host), no network call occurs anywhere in this workstream's new code paths.
2. A generated export file plus a diff showing it is exactly what a subsequent "send"
   action would transmit.
3. A worked example computing each of the eight product metrics from real or fixture
   evidence bundles and store rows, with the source field cited per metric.
4. One completed recommendation-query audit entry, in full, showing all seven fields and
   the three-way retrieval/use/citation distinction.
5. The false-verification rate calculation applied to at least one real or fixture dataset,
   including a case where it is unflattering, with a note confirming it was not filtered
   out of the published number.

## Limitations

- Recommendation metrics rely on self-reported and partner-reported data for case studies
  and design-partner numbers; Advance Labs cannot independently verify a partner's internal
  review-time or defect counts beyond what the partner discloses.
- Answer-engine query results vary by reformulation, session state, and rollout — a monthly
  cadence smooths some of this variance but does not eliminate it; single-month swings
  should be read cautiously, not as a trend, until several months of the same fixed query
  set exist.
- Small-n effects apply to both tables in the early wedge phase: with few design partners
  and few teams, per-team metrics like 4-week retention are not statistically stable and
  should be reported as counts, not as percentages implying a larger population.
- Local computation of false-verification rate depends on a human or a later re-check
  actually recording a correction; a false verification nobody ever notices is invisible to
  this metric by construction, and that gap should be stated wherever the rate is
  published.

## Follow-ups this job should file, not do

- A hosted, opt-in aggregation service for teams that want cross-team benchmarking beyond
  local computation (explicitly not built in the wedge phase — see
  [`00-north-star.md`](../00-north-star.md#what-we-do-not-build-during-the-wedge)).
- Automated, scheduled recommendation-query audits beyond the manual monthly cadence
  described here.
- A public scorecard page that renders the aggregated, opted-in design-partner numbers
  (belongs to [W9](./W9-positioning-and-content.md)/[W10](./W10-external-corroboration.md),
  not to this workstream's local instrumentation).
