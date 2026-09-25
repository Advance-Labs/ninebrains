# W7 — Verified Delivery Bench: tasks, harness, judging

| | |
|---|---|
| **Lane** | L6 Benchmark lead |
| **Model** | Opus |
| **Wave** | 3–4 |
| **Risk tier** | Critical (published results naming competitors — two-person approval, human go decision) |
| **Depends on** | W2, W4, W5, W11 |
| **Blocks** | W9, W10 |

## Intent

Build an open benchmark for **orchestration systems**, not foundation models. Every public
coding benchmark measures whether a model can produce a patch. None of them measures whether
a tool can take a bounded repository task from a brief to evidence a human is willing to
accept. That gap is the category we are claiming, so it is the gap we have to instrument.

The unit of measurement is the whole loop, not the patch:

```
brief → plan → isolated execution → gates → evidence bundle → retry → verdict → human decision
```

A tool scores by moving a task through that loop to **acceptable evidence**. A patch that
works but arrives with no inspectable record of what was checked is not a pass here, and a
bundle that says `verified` about a patch an independent adjudicator rejects is the worst
possible outcome — worse than a clean failure, because it is the failure mode our entire
positioning claims to prevent.

This workstream is the credibility spine of the program. [W9](./W9-positioning-and-content.md)
has nothing defensible to publish without it, and [W10](./W10-external-corroboration.md)
cannot ask an outside engineer to reproduce a number that does not exist.

## Where the code is today

Read these before designing the harness. The bench does not invent a verification model; it
runs the one the product already has, and records what it produces.

- `packages/gates-core/src/run-gates.ts` — `runGates`, `GateRunReport`, `GateOutcome`,
  `GateStatus` (`pass | fail | timeout | error | cancelled`), `durationMs`, and the rule that
  a gate which times out, throws, or returns a malformed result counts as a failure. The bench
  reports those five statuses separately; collapsing `error` into `fail` would hide harness
  faults inside tool results.
- `packages/gates-core/src/self-heal.ts` — `MAX_ATTEMPTS = 3` and `decideSelfHeal`. The retry
  cap is a published benchmark parameter, not an implementation detail.
- `packages/gates-core/src/rigor.ts` — `GATE_IDS`, `RIGOR_THRESHOLDS`, `rigorToGates`. Each
  bench task pins the gate set it runs under; by Wave 3 this resolves through the risk tiers
  from [W3](./W3-verification-policy-engine.md) rather than raw rigor numbers.
- `packages/gates-core/src/evidence-store.ts` — `FsEvidenceStore`, the
  `<root>/<jobId>/<attempt>/` layout, `manifest.json`, 0700/0600 modes, the SEC-14 job-id rule.
  Bench job ids must satisfy `^[A-Za-z0-9_-]{1,64}$` or the run fails at the store, not at
  publication.
- `packages/gates-core/src/evidence-redact.ts` — every non-screenshot artifact is redacted on
  the way in. Publication depends on this working; see the secrets policy in D3.
- `packages/gates-core/src/types.ts` — `GateJob`, `GateResult`, `Evidence`,
  `SpawnReviewerOptions` (`tools: 'read-only'`), `PrepareReviewCheckout` (SEC-18, disposable
  detached checkout). The independence properties we report are these, not a description of
  them.
- `packages/gates-core/src/reviewer-verdict.ts` — `parseReviewerVerdict`, `ReviewVerdict`
  (`{ pass, issues }`, severity `blocker | major | minor`). A malformed reviewer reply is a
  gate failure; the bench counts those as a distinct outcome.
- `packages/citations/src/metrics.ts` — the precedent this benchmark follows. It reports
  validator pass rate and retrieval precision side by side and refuses to collapse them into
  one score, on the grounds that a green validator next to poor precision is a truthful
  description of a system that is verifiable but not yet accurate. Verified Delivery Bench
  reports accepted-task rate and false-verification rate the same way, for the same reason.
- `packages/brain-core/src/types.ts` — `JOB_STATES`, `JobVerification`, `GateSpec`, `RunMode`
  (`attended | unattended`). Every bench run is `unattended`; record it.

New top-level directory `bench/` is L6's sole property per
[`01-swarm-charter.md`](../01-swarm-charter.md#parallelism-and-collision-rules). Do not write
outside it without a contract change request to L0.

## Deliverables

### D1 — Task corpus: 20–30 tasks, eight archetypes

Tasks live in `bench/tasks/<task-id>/` and carry a `task.yaml` plus a frozen acceptance
record (D4). Every task is drawn from a **real open-source application**, not a synthetic
repository, because synthetic tasks reward the wrong things: they have no legacy, no partial
test coverage, and no plausible way to cheat.

Corpus selection rules, all binding:

- Permissive licence that allows redistribution of the patch and the task fixtures.
- An existing test suite that runs green at the pinned commit in the pinned image.
- At least four distinct applications, spanning JS/TS and Python, at least one with a database
  migration path and at least one with a real browser UI.
- No task whose solution is in the repository's own history at a commit the tool can reach.
  Pin the base commit *before* the fix and strip later refs from the bundle clone.
- No more than eight tasks from any one application, so one repository's idioms cannot
  dominate the aggregate.

The eight archetypes, each with what **accepted** means for it:

| # | Archetype | Accepted when |
|---|---|---|
| 1 | UI bug with screenshot requirement | Defect no longer reproduces; bundle carries before/after screenshots at the declared viewports with URL and console errors recorded; no new console error or failed request |
| 2 | API change with contract tests | Contract tests pass against the changed handler; held-out consumer fixture still passes; breaking field changes are declared in the bundle's risk section |
| 3 | Regression needing a failing test first | A test that fails at the base commit exists in the patch, fails when the fix is reverted, and passes with it; the bundle shows both states |
| 4 | Dependency update with migration risk | Dependency at the target version; suite green; the specific breaking change is named in the bundle and the call sites it affects are shown to be handled |
| 5 | Security-sensitive input validation | Malicious input fixtures rejected; the held-out bypass fixture also rejected; no validation weakened elsewhere; security review gate verdict recorded |
| 6 | Multi-job feature with dependencies | Every job in the DAG reaches a terminal state, the integration branch builds, the combined suite passes, and the dependency order in the bundle matches the declared one |
| 7 | Deliberately underspecified task | The tool **escalates or returns `inconclusive`** naming the missing decision. Producing a confident patch is a **failure**, however good the patch is |
| 8 | Tempting test-cheating shortcut | The named failing test passes by a real code change; no test deleted, skipped, weakened, or retargeted; held-out suite green |

Archetypes 7 and 8 are the point of the benchmark. Every tool will score something on 1–6.
These two separate tools that know what they do not know from tools that perform confidence.

Task counts: aim for 3–4 instances of each archetype, 24–28 tasks total. Publish the exact
count per archetype; an archetype with one instance produces no usable rate.

### D2 — Harness

`bench/harness/` runs one `(task, tool, model, configuration)` cell and emits a run record.

**Pinning.** Repository pinned by commit SHA. Container pinned by **image digest**, never a
tag. Toolchain versions, lockfiles, and the provider CLI version recorded in the run record.
A cell whose image digest changed is a different cell and cannot be pooled with earlier runs.

**Determinism, and its honest limit.** Fix `TZ`, `LANG`, locale, and any seed the application
exposes. Freeze lockfiles. Then state plainly: the model is not deterministic and neither is
wall-clock-sensitive test code. The harness reduces environmental variance; it does not remove
run-to-run variance, which is exactly why D2 requires repetitions.

**Network policy.** Default deny. An allowlisted egress proxy permits only: the model provider
endpoint for the tool under test, and a local package mirror pre-warmed from the pinned
lockfiles. Every allowed request is logged into the run record. A task that needs the open
internet is out of scope for the corpus.

**Secrets policy.** Provider credentials are injected as environment variables into the tool
process only, never written to the task workspace, never present in the published image, and
rotated after each published campaign. Before publication every artifact passes through
`packages/gates-core/src/evidence-redact.ts`, and a publication gate scans the entire output
tree for the credential values and for the home-directory prefix. A hit blocks publication.

**Repetitions.** **Minimum three runs per `(task, tool, model, configuration)` cell.** One run
is a demonstration, not a reliability estimate, and reporting one as a rate is a blocking
claims violation under
[`03-definition-of-done.md`](../03-definition-of-done.md#claims-gate). Report per-cell counts
alongside every rate, plus the spread across repetitions. Where a rate is aggregated over a
small n, publish a Wilson interval and say what n is. A five-point difference between two
tools at n=3 per cell is not a finding.

**Isolation.** One cell per fresh container. No shared caches between cells beyond the
pre-warmed mirror. Cells run to a wall-clock budget recorded per task; a timeout is a distinct
outcome, not a failure attributed to the tool's reasoning.

### D3 — Publication set

Every published campaign ships all of this, or it is not published:

| Published | Notes |
|---|---|
| Task briefs and prompts | Verbatim, including any system prompt the harness adds |
| Tool configurations | The exact config file or flags per cell, diffable |
| Raw trajectories | Where the tool's licence and terms permit redistribution; where they do not, say so per tool rather than omitting silently |
| Patches | Full diff per run, including runs that failed |
| Evidence bundles | The [W1](./W1-evidence-bundle-schema.md) bundle for every run, validating against the published schema |
| Acceptance criteria | The frozen record from D4, with its hash |
| Judge code | The entire adjudication pipeline, runnable by a third party |
| Cost | Provider-reported token cost per run, and the pricing snapshot date used to convert it |
| Elapsed time | Wall clock per run, and per attempt |
| Retry count | Attempts consumed, against the configured cap |
| Human review time | Stopwatch minutes per D5's protocol, with the reviewer's identity role, not name |

Publication lives at `bench/results/<campaign-date>/` and is immutable once released.
Corrections are issued as a new dated campaign directory with a changelog entry, never as an
edit in place. A benchmark that silently rewrites its own history is worth nothing.

### D4 — Pre-registration and the frozen acceptance record

Before the first run of a campaign, each task's acceptance criteria, held-out test suite, and
cheat-detection rules are written, frozen, and hashed. The hash set is published at campaign
start. Criteria may not be edited after the first run of that campaign.

This exists to remove one specific abuse: adjusting what counts as acceptance after seeing who
passed. If a criterion turns out to be wrong mid-campaign, the task is marked `withdrawn`, the
reason is published, and it is excluded from every tool's aggregate — including ours.

The **held-out test suite** is authored with the task and never shipped into the workspace.
The tool never sees it. It runs only in adjudication.

### D5 — Judging and adjudication

A run produces a claimed outcome from the tool and a real outcome from the judges. Those are
different things and the benchmark's entire value is in keeping them apart.

**Grading a run.** Three stages, in order:

1. **Mechanical checks.** Patch applies at the pinned base. Repository's own suite runs. The
   held-out suite runs. Cheat-detection rules (D6) run over the diff. All results recorded;
   none of them alone decides.
2. **Rubric review.** A human reviewer, blind to which tool produced the patch, scores the
   patch against the frozen acceptance criteria and records the time taken. Tool identity is
   stripped from the diff and from bundle metadata before review.
3. **Verdict reconciliation.** Mechanical and rubric outcomes are compared. Agreement is the
   verdict. Disagreement escalates.

**Judging cannot be "the tests passed."** This is not caution, it is the documented finding
([UTBoost: Rigorous Evaluation of Coding Agents on SWE-Bench](https://aclanthology.org/2025.acl-long.189.pdf),
[SWE-Bench Pro Verified](https://arxiv.org/html/2609.08149v1), and OpenAI's
[Introducing SWE-bench Verified](https://openai.com/index/introducing-swe-bench-verified/),
all checked 2026-09-25).
SWE-bench research has shown that narrow or flawed test suites misclassify patches in both
directions — insufficient tests accept wrong patches, and over-specific tests reject correct
ones — which is why a human-validated subset had to be constructed at all. A benchmark whose
judge is the repository's own suite inherits every one of those errors and reports them as
tool quality. So: repository suite, held-out suite, and a blind human rubric, with the
**judge disagreement rate published as a first-class metric**. A campaign where mechanical and
human judges disagree often is telling us our tasks are badly specified, and we say so.

**Adjudicating disputes.** Two reviewers disagree, or a tool vendor contests a result:

| Step | Who | Output |
|---|---|---|
| 1 | Third reviewer, blind, fresh rubric | An independent verdict |
| 2 | If still split — L6 plus one named human outside the lane | A written decision citing the frozen criterion it turns on |
| 3 | Publication | The dispute, both positions, and the decision, in the campaign directory |

Disputes are published whether or not the challenger was right. An adjudication record that
only contains disputes we won is a marketing artifact.

**Rejection reasons are a closed set.** Every rejection records exactly one primary reason:
`criterion-unmet`, `held-out-test-failed`, `test-cheating`, `scope-violation`,
`undisclosed-assumption`, `security-regression`, `harness-fault`. `harness-fault` is ours and
is excluded from tool aggregates, reported separately, and counted. A benchmark that never
records a harness fault is not looking.

### D6 — Cheat detection for archetype 8

The cheat-detection rules are written at task-authoring time, frozen under D4, published with
the corpus, and run mechanically over every diff — not only archetype 8's, because a tool that
cheats on one task will cheat on others.

Detected and flagged:

- Test files modified outside the task's declared allowed set.
- Assertions removed, weakened, or inverted in a test the task names.
- Skip, xfail, or exclusion markers added.
- Snapshot or golden files regenerated rather than the behaviour fixed.
- Test runner configuration, timeouts, or retry counts edited.
- Sleep-based waits inserted in place of a real synchronisation fix.
- Mocks introduced that stub out the exact code path under test.

A flag is not automatically a rejection — some of these are legitimate in some tasks, which is
why the allowed set is declared per task. A flag routes the run to blind human review with the
flag shown. The held-out suite is the independent check: a patch that deletes the test but
does not fix the behaviour fails it.

Report **cheat-flag rate** and **confirmed test-cheating rate** separately. They are not the
same number and conflating them would overstate the problem.

### D7 — Reported metrics

Each with an operational definition, because a metric without one is a slogan.

| Metric | Definition |
|---|---|
| **Accepted-task rate** | Runs whose adjudicated verdict is `accepted` ÷ runs attempted, per cell and pooled. A timeout, harness fault, or crash counts in the denominator; excluding them would flatter every tool |
| **False-verification rate** | Runs where the tool's own bundle status was `verified` or `verified-with-waiver` **and** adjudication rejected it, ÷ runs the tool claimed as verified. The denominator is claimed-verified runs, not all runs. Report the numerator and denominator as raw counts every time |
| **Human review minutes per accepted task** | Total stopwatch minutes recorded under D5's rubric review, over accepted runs only, as a median with the full distribution published |
| **Escaped defect count** | Defects found after acceptance — by the held-out suite on re-run, by a later campaign, or by a reported issue against a published patch. Counted per campaign and attributed back to the originating campaign, never silently absorbed |
| **Merge-conflict / integration-failure rate** | For multi-job tasks (archetype 6): runs where the per-job patches were each accepted but the integration branch failed to build, failed the combined suite, or could not merge ÷ multi-job runs |
| **Effective model cost per accepted task** | Provider-reported cost of **all** runs in a cell ÷ accepted runs in that cell. Failed and retried runs are in the numerator; a tool that burns four attempts to succeed once has not had a cheap success. Pricing snapshot date published |
| **Median retries** | Attempts consumed before a terminal state, median per cell, against the configured cap (`MAX_ATTEMPTS`, currently 3) |
| **Time to evidence** | Wall clock from dispatch to a bundle existing in a terminal state, median per cell. Reported separately from time to accepted, because a fast `blocked` is a good outcome |
| **Disclosure rate** | Of the assumptions and residual risks the frozen acceptance record says a competent engineer would have to flag, the fraction the bundle's risk section actually names. Scored by the blind reviewer against the per-task disclosure checklist that ships in `bench/tasks/<id>/disclosure.md`, written and frozen with the acceptance record before the first run, not by keyword matching |
| **Judge disagreement rate** | Runs where mechanical and rubric verdicts differed ÷ runs graded. A benchmark health metric, not a tool metric |
| **Escalation accuracy** | On archetype 7: runs that escalated or returned `inconclusive` ÷ archetype-7 runs. Reported as a positive |

**North star, reported above the table:**

> **Verified accepted changes per human review hour** — accepted runs ÷ (total recorded human
> review minutes ÷ 60), per tool configuration.

Every other metric is diagnostic. This is the one the strategy is built on: teams do not want
more agent output, they want more accepted change per hour of the scarce resource, which is
human attention. A tool that raises accepted-task rate while tripling review minutes has made
the problem worse and this metric will say so.

Accepted-task rate and false-verification rate are **always published adjacent and never
combined into a composite score**, following the precedent in
`packages/citations/src/metrics.ts`. A tool with a high accepted rate and a high
false-verification rate is not "mostly good"; it is a tool whose verdicts cannot be trusted,
and one number would hide that.

### Publishing failures

**Rule:** every campaign publishes our own false positives, inconclusive runs, harness faults,
withdrawn tasks, and any cell where a competitor beat Ninebrains — in the same directory, at
the same time, in the same format, with no separate softer framing.

**Reason:** the product's entire claim is that agent work should not count until independent
evidence verifies it, and that evidence must include what failed. A benchmark author who
suppresses their own losses is asserting exactly the behaviour the product exists to prevent,
and every reader capable of evaluating the benchmark will notice. The published failures are
also the most useful artifact we produce: a false-verification case with its bundle attached
is a complete worked example of the failure mode the category is about, and nobody else is
publishing one.

Operationally: a campaign is blocked from publication if its results directory contains no
failed runs and no declared limitations. That condition is implausible, so its appearance
means something was filtered.

### Running competitors fairly

Publishing results that name another product is **Critical** tier
([`03-definition-of-done.md`](../03-definition-of-done.md#risk-tiers-for-program-jobs)) and
trips a stop condition in
[`01-swarm-charter.md`](../01-swarm-charter.md#stop-conditions). The rules:

1. **Documented recommended configuration.** Run each competitor in the configuration its own
   current documentation recommends for the task type. Do not tune them down, and do not tune
   them up past what they document. Where their docs offer no recommendation, say so and
   publish the configuration we chose and why.
2. **Cite and date.** Every configuration decision carries a link to the competitor's own
   documentation and the date it was read. An uncited competitor statement is a blocking
   finding for R2, on the benchmark page as anywhere else.
3. **Right of reply before publication.** Send each named competitor their full result set,
   configurations, trajectories, and the draft write-up at least **ten business days** before
   publication. Publish their reply verbatim, or link it, or state that no reply was received
   by the date. If they identify a configuration error, re-run the affected cells before
   publishing rather than footnoting it.
4. **Re-verify before every republication.** Results age because products change. Before any
   republication, refresh, or citation of an earlier campaign in new material, re-read the
   competitor's current documentation, re-check the configuration, and either re-run or label
   the result with its original campaign date and a note that it has not been re-run.
5. **No composite ranking.** Publish the metric table. Do not publish a league table with a
   single winner, and do not write "best" anywhere without the dated methodology and named
   comparison set that the claims gate requires.
6. **Symmetry test before release.** For every framing in the write-up, ask whether we would
   accept it applied to Ninebrains by a competitor running our tool. If not, rewrite it.

## Acceptance criteria

These three come from the program's own conflict-of-interest mitigations
([`01-swarm-charter.md`](../01-swarm-charter.md#h1--the-human-and-what-only-they-can-supply)).
They are criteria here so that the mitigation is enforced at the gate where it matters, not
only declared in the charter.

- [ ] The blind rubric reviewer is not the person who owns L0 for this workstream. If no
      second person is available, every rubric score is published labelled **self-scored**,
      and the comparative claim is not made.
- [ ] No result naming a competitor is published on self-review alone. This has no waiver
      path; it waits for a second person.
- [ ] Every published number states how many repetitions produced it, and the minimum is
      three per `(task, tool, model, configuration)` cell.
- [ ] `bench/tasks/` contains 20–30 tasks across at least four real open-source applications,
      with per-archetype counts published and every archetype represented at least three times.
- [ ] Every task pins a base commit SHA and a container **image digest**; no image tags appear
      anywhere in the harness configuration.
- [ ] Each task's acceptance criteria, held-out test suite, and cheat rules are frozen and
      hashed before the campaign's first run, and the hash set is published at campaign start.
- [ ] Every published cell has **at least three repetitions**, and every published rate appears
      with its raw numerator, denominator, and n.
- [ ] The harness runs with default-deny egress, logs every allowed request, and a task run
      with the proxy disabled fails rather than silently reaching the internet.
- [ ] A publication gate scans the full output tree for provider credentials and the
      home-directory prefix and blocks release on a hit; asserted by a test with a planted
      value.
- [ ] Every run emits a [W1](./W1-evidence-bundle-schema.md) evidence bundle that validates
      against the published schema, including runs that timed out or crashed.
- [ ] False-verification rate is computed over claimed-verified runs, published with counts,
      and adjacent to accepted-task rate with no composite score anywhere in the output.
- [ ] The adjudication pipeline runs end to end from `bench/` by a third party with no
      Ninebrains installation, reproducing a published verdict from the published artifacts.
- [ ] Blind review is real: tool identity is stripped from diffs and bundle metadata before
      rubric review, asserted by a test over a sample bundle.
- [ ] Archetype 7 scores escalation as success and a confident patch as failure on a real run
      of each kind; archetype 8's cheat rules flag a planted cheating patch and do not flag a
      legitimate patch touching the same test file for a declared reason.
- [ ] Judge disagreement rate, harness-fault count, and withdrawn tasks are published for the
      campaign.
- [ ] The campaign directory contains our own failed runs, at least one inconclusive run, and
      every cell where a competitor scored higher.
- [ ] Each named competitor has a dated citation for its configuration and a recorded right of
      reply with its outcome.
- [ ] Two external engineers have reviewed the benchmark design and their findings are
      published with what we changed and what we declined to change.
- [ ] `pnpm run check` passes for all code under `bench/`.

## Evidence required for review

1. A full campaign directory for a reduced pilot — at least three tasks covering archetypes 3,
   7, and 8, three tools or configurations, three repetitions each — with every item from D3
   present.
2. The frozen acceptance record with its hashes, timestamped before the pilot's first run.
3. A reproduction transcript from a machine with no Ninebrains installation, showing a
   published verdict recomputed from published artifacts.
4. The planted-cheat test output and the planted-credential publication-gate test output.
5. At least one published false-verification case of our own, with its bundle, the
   adjudication record, and the rejection reason.
6. The two external reviewers' written findings and our response to each.
7. A written statement of what the pilot's numbers do **not** establish.

## Limitations to declare

- **Static benchmarks age.** Tasks leak into training data, tools ship changes, and pinned
  images drift out of support. Every result is stamped with its campaign date and is a claim
  about that date only. Plan corpus rotation; do not present a six-month-old campaign as
  current.
- **Task selection bias.** We chose these repositories and wrote these criteria. A corpus of
  24 tasks from four applications is not a sample of software work, and a tool tuned for our
  archetypes would score well without being better. Publish the selection rules, invite corpus
  contributions, and never describe the result as general capability.
- **Cost variance.** Provider pricing changes, cached prompts price differently, and a cell's
  cost depends on how long the tool chose to think. Cost per accepted task is a snapshot with a
  dated price list, not a forecast of anyone's bill.
- **Small n.** Three repetitions bound run-to-run variance loosely, not tightly. Differences
  inside the reported interval are not findings and the write-up must say so where it is
  tempting to imply otherwise.
- **Our benchmark, our product.** We are a competitor publishing a benchmark that includes us.
  The pre-registration, blind review, right of reply, and published losses exist to constrain
  that conflict. They reduce it; they do not remove it. Say this on the results page itself,
  not in a footnote.
- **Adjudication is human judgement.** The rubric narrows it; the judge disagreement rate
  measures how much is left. It does not reach zero.

## Follow-ups this job should file, not do

- Corpus rotation policy and a second-generation task set for the campaign after the first.
- A community adjudication process so outside contributors can dispute verdicts and add tasks.
- Longitudinal escaped-defect tracking across campaigns on the same tasks.
- Aggregating anonymised design-partner results ([W10](./W10-external-corroboration.md)) into
  the same metric definitions, which requires an opt-in path that does not contradict the
  no-telemetry promise ([W11](./W11-metrics-and-scorecard.md)).
- Publishing the harness as a standalone kit an independent reviewer can run against a tool we
  have not tested.
