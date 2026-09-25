# W4 — Independent review: isolation, identity, verdicts

| | |
|---|---|
| **Lane** | L3 Independent review architect |
| **Model** | Opus |
| **Wave** | 2 |
| **Risk tier** | High (SEC-18 reviewer isolation — `security-reviewed` label required) |
| **Depends on** | [W1](./W1-evidence-bundle-schema.md), [W3](./W3-verification-policy-engine.md) |
| **Blocks** | W6, W7 |

## Intent

"Independent" is the load-bearing word in the whole category. It is also the easiest word in
the product to say falsely. This workstream turns it into a property with a definition, an
enforcement point, a recorded level, and a degradation ladder — so that the claim in the
product's copy is the same claim the bundle can substantiate.

The claims discipline in [`00-north-star.md`](../00-north-star.md#claims-discipline) already
bans the word where the reviewer shares the builder's context, model, or mutable worktree,
and points here for the definition. This page has to actually contain one.

The isolation half is largely built and it is good. The identity half — recording *which*
axes held on a given run, and refusing to claim more than held — does not exist yet.

## Where the code is today

| File | What it settles now |
|---|---|
| `packages/gates-core/src/types.ts` | `SpawnReviewerOptions`, `SpawnReviewer`, `PrepareReviewCheckout`, `ReviewCheckout` |
| `packages/gates-core/src/gates/reviewer-gate.ts` | The gate: checkout, hardened diff, fenced prompt, verdict, dispose |
| `packages/gates-core/src/reviewer-verdict.ts` | `parseReviewerVerdict`, `ReviewVerdict`, `ReviewIssue`, `VERDICT_INSTRUCTIONS` |
| `packages/gates-core/src/gates/fact-check-gate.ts` | Claim checking against live sources; the seed of unsupported-claim detection |
| `packages/brain-core/src/dispatch/route.ts` | `pickLane` — review jobs already prefer a different provider |
| `apps/emdash-desktop/.../gates/node/capabilities/spawn-reviewer.ts` | The real read-only run: tool flags, sandbox, denied paths |
| `apps/emdash-desktop/.../gates/node/capabilities/review-checkout.ts` | The disposable checkout, as its own repository |
| `apps/emdash-desktop/.../gates/node/capabilities/types.ts` | The app's `SpawnReviewerOptions` extension (`mcpServers`) |
| `apps/emdash-desktop/src/main/bootstrap/boot/ninebrains/reviewer-route.ts` | `routeReviewer` — which CLI and model route reviews a job |
| `apps/emdash-desktop/.../gates/api/verification.ts` | `AttemptVerdict`, `JobVerificationView` — what the modal shows |

### The constraints, as the code states them

**The reviewer is read-only, and the type says so.** `SpawnReviewerOptions` carries
`signal`, `cwd`, `tools: 'read-only'`, `attachments`, and `purpose`. `tools` is a literal
type with one member; the app's implementation throws on anything else, and throws on an
option it does not recognise rather than ignoring it. The comment on the field is the
policy:

> Read/Grep/Glob only: no Bash, no writes, no network (SEC-18). The reviewer never runs
> tests; the tests gate does, and its log arrives as evidence.

That last clause is the design's spine. The reviewer does not get execution because
execution is what the deterministic gates are for, and a reviewer that could run the tests
could also change what they report.

**The reviewer has no write path to what it grades.** `PrepareReviewCheckout` makes a
disposable detached checkout — "Never the lane worktree: the reviewer must not be able to
touch what it grades." The app's implementation goes further than the contract requires:
the checkout is *its own repository* (`git init` plus `objects/info/alternates`), not a
linked worktree, specifically so a lane process that outlives `complete_job` cannot change
the checkout's config between the reviewer gate's filter-driver listing and its diff (T33).
Every git call runs with `--no-lazy-fetch`, blanked filter drivers, `core.fsmonitor=`,
`core.hooksPath=/dev/null` and `protocol.file.allow=never`. The checkout is disposed however
the gate ends.

**The run is sandboxed at the provider level.** `spawn-reviewer.ts`: Claude gets
`--tools=Read,Grep,Glob` with Bash/Edit/Write disallowed, `--permission-mode=dontAsk`, no
writable path, and the live lane worktree plus sibling lanes denied for *reading*. Codex
gets `exec --sandbox read-only`. Evidence lives under a denied directory, so attachments are
copied into `.ninebrains-evidence/` inside the checkout.

**Fresh context is structural, not requested.** The reviewer is a separate run that receives
a constructed prompt: the job, the diff, the untracked file names and the evidence list,
each inside a per-call nonce fence the content cannot close (SEC-19). It does not see the
builder's conversation.

**The routing preference exists in brain-core and does not yet exist in the app.**
`pickLane` filters review jobs to lanes whose provider differs from `hints.authorProvider`,
when any such lane is eligible, with the reason stated in the file: "A reviewer on the same
model tends to agree with itself." But `routeReviewer` — which picks the CLI that actually
runs the reviewer gate — currently returns a hardcoded `'claude'` behind a
`TODO(Lucas): the cross-provider independence rule`, with `deps.installed` already threaded
through for when it lands. The file also records the tension honestly: containment
(THREAT-MODEL R2, R13 — Codex's sandbox restricts writes, not reads, and has no max-turns
cap) pulls against independence. **Closing that TODO is this workstream's work, and the
containment argument has to be answered, not ignored.**

**`PROVIDERS` is `['claude', 'codex']`.** Two. A one-provider machine is the common case,
not the edge case. The degradation ladder is the main deliverable, not a footnote.

## Deliverables

### D1 — The definition of independence

Four axes. Each is separately satisfiable, separately checkable, and separately recorded.

| Axis | Satisfied when | Checked by |
|---|---|---|
| **Fresh context** | The reviewer run shares no conversation, scratchpad or tool history with the builder | The reviewer is a distinct run with a constructed prompt; assert no builder session id is reachable |
| **Different model** | The reviewer's model id differs from the builder's | Compare the recorded model ids; unknown on either side does not count as satisfied |
| **Different provider** | The reviewer's provider differs from the builder's, where more than one is installed | `routeReviewer` against `deps.installed` and the job's `authorProvider` |
| **No write path** | The reviewer cannot modify the artifact it grades, or the evidence it is shown | `tools: 'read-only'`, the disposable checkout, the provider sandbox, denied lane paths |

**Fresh context and no write path are mandatory at every tier.** They are structural
properties of the current design and there is no acceptable degradation of either. A run
that cannot satisfy both does not produce a review verdict; it produces a gate failure.

**Different model and different provider degrade.** Ladder, highest first:

| Level | Holds | When |
|---|---|---|
| `full` | All four axes | Two providers installed, distinct models, reviewer routed away from the author |
| `model-only` | Fresh context, no write path, different model | One provider installed; a different model within it |
| `context-only` | Fresh context, no write path | One provider, one model available or pinned to the builder's |
| *(none)* | — | Not a level. Fresh context or write isolation missing is a gate failure, not a degraded review |

Rules that make the ladder mean something:

- **The level is computed from what actually happened, not from configuration.** Read the
  reviewer's resolved provider and model id from the run, not from the setting that was
  supposed to apply.
- **The level is recorded in the bundle on every review, including `full`.** A bundle that
  records the level only when degraded teaches readers that silence means full, which is
  exactly the inference we do not want them making from an absent field.
- **The UI must not say "independent" below `full`.** Say what held. These are the canonical
  strings; they live in one module and every surface — the app, the HTML export, the GitHub
  Check, the badge in [W2](./W2-evidence-viewer-and-exports.md) — renders them rather than
  composing its own.

  | Level | String |
  |---|---|
  | `full` | Independently reviewed (fresh context, different provider) |
  | `model-only` | Reviewed by a different model (same provider) |
  | `context-only` | Reviewed in a fresh context (same model and provider) |

  Neither degraded string is dressed up; both are honest and both are still worth something.
  The badge in W2 concatenates the level string, so there is exactly one place to change the
  wording.
- **A policy may require a level.** [W3](./W3-verification-policy-engine.md)'s `models`
  block already carries `require_different_provider` per tier. A tier that requires an axis
  it cannot get **blocks** — it does not silently degrade. This mirrors SEC-42's rule for a
  pinned reviewer profile: missing, disabled, keyless or unhealthy blocks the review rather
  than falling back to a cheaper route.
- **Close the `routeReviewer` TODO with the containment argument on the record.** Prefer a
  different provider when one is installed and the job carries an `authorProvider`; state in
  the code comment what the Codex-reviewer read surface costs (R2, R13) and what bounds it.
  If the answer is that cross-provider review is gated on a containment fix, say that in the
  file and file the follow-up — do not leave a bare TODO for the next reader.

### D2 — Reviewer identity in the bundle

Every review records: reviewer id, provider, model id, tool permissions, checkout mode,
verdict, findings, and which independence axes held.

This is a **[W1](./W1-evidence-bundle-schema.md) schema section** (`review`). Do not define
its shape here and do not add fields to the bundle from this lane. Raise a contract change
request to L0 naming the fields, per the parallelism rules in
[`01-swarm-charter.md`](../01-swarm-charter.md#parallelism-and-collision-rules) — `W1` owns
the schema, `W4` owns what fills it.

What this lane must supply to that contract:

- The axis-level computation and its inputs, as a pure function with a table test.
- `purpose` as the reviewer id, since `SpawnReviewerOptions.purpose` already carries the
  asking gate's id (`reviewer`, `security-review`, a pack gate's id) and routes on it.
- Checkout mode as a closed value: the disposable detached checkout is the only supported
  mode today, and recording it explicitly is what lets a future mode be distinguished rather
  than assumed.
- Tool permissions recorded as what was *granted*, read back from the run, not as the
  constant `'read-only'` copied from the type.

W1's D1 already lists `review` with reviewer identity, provider, model, tool permissions,
checkout mode, verdict and findings. The axis record is the addition this lane asks for.

### D3 — Verdict taxonomy

The reviewer returns one of three, not two.

| Verdict | Meaning | Effect |
|---|---|---|
| `pass` | The reviewer examined the change and found nothing blocking | Gate passes |
| `fail` | The reviewer found at least one blocking problem | Gate fails, findings go to the worker |
| `inconclusive` | The reviewer could not reach a judgement | **Gate fails**, and the job's terminal state is `inconclusive`, not `blocked` |

`parseReviewerVerdict` today accepts exactly `{ "pass": boolean, "issues": [...] }`, requires
a failing verdict to list at least one issue, and treats a malformed reply as a gate failure
on the stated grounds that "a model that rambles instead of answering has not reviewed
anything." Extend it, preserving all of that:

- Add `inconclusive` as a third verdict value with a **required** `reason`. A reviewer that
  says "I cannot tell" without saying why is still rambling.
- Keep strict parsing and keep the malformed-reply failure path. Widening the parser to be
  forgiving would let a hedge parse as a pass.
- Keep `ReviewIssue`'s `severity` of `blocker | major | minor` and the rule that a failing
  verdict must list at least one issue.
- Update `VERDICT_INSTRUCTIONS` in the same commit. The prompt and the parser are one
  contract; a test should assert the instructions describe a shape the parser accepts.

**An inconclusive verdict blocks and is never averaged away.** There is no quorum, no
two-of-three, no "majority passed". `runGates` computes `pass = results.every((r) => r.pass)`
and treats `timeout`, `error` and `cancelled` as failures already, on the principle that a
gate which could not reach a verdict has not verified anything. `inconclusive` is that
principle applied to the reviewer's own words rather than to its process. Assert it in a
test named for the rule.

Distinguish it in the terminal state. `blocked` says the change is wrong. `inconclusive`
says we do not know — a materially different thing for a human deciding what to do next, and
one of the four states [W1](./W1-evidence-bundle-schema.md) D2 establishes.
[`03-definition-of-done.md`](../03-definition-of-done.md) is explicit that inconclusive is a
legitimate outcome and that escalation accuracy is measured. Do not treat it as a failure
mode to engineer away.

### D4 — Anti-self-grading

The epistemic risk the strategy names: **review performed by the same generation loop
preserves correlated assumptions.** A model that misread the requirement while building will
tend to misread it the same way while reviewing, and will then report agreement as
confirmation. This is the failure that makes a green badge worse than no badge, because it
converts an unexamined assumption into recorded evidence.

The `pickLane` comment states the operational version of this in one line: "A reviewer on
the same model tends to agree with itself." Four mitigations, each testable.

**1. Route away from the author.** `pickLane` already does this for review *jobs*;
`routeReviewer` must do it for reviewer *gates*. Thread `authorProvider` — available in
`JobHints` — through to the route decision. Where it cannot be honoured, degrade and record.

**2. Adversarial prompting, not confirmatory prompting.** The general focus text in
`reviewer-gate.ts` currently asks the reviewer to "decide whether the change fully and
correctly satisfies the job" and to look for regressions, missing edge cases and unfinished
work. Strengthen it toward the strategy's adversarial-review gate: ask what the change
claims, then ask what would have to be true for the claim to be false, then ask whether the
evidence shown establishes it. Require the reviewer to name at least one thing the evidence
does **not** establish, as a field, whatever the verdict. A reviewer that can find nothing
unestablished has not looked. Keep this as prompt text inside the existing nonce fence — the
untrusted-content boundary is not relaxed for better prompting.

**3. Issue alignment as a distinct focus.** `ReviewFocus` is `'general' | 'security'` today,
with `securityReviewGate` as a preconfigured instance. Add the strategy's remaining
independent-agent gates the same way — issue alignment, test-quality review — as focuses on
the same hardened path rather than as new gates with new isolation code. Reuse the isolation;
vary the brief. That is what `ReviewerGateOptions` is shaped for.

**4. An unsupported-claim detector for research, SEO and docs jobs.** The mechanism exists:
`fact-check-gate.ts` parses the worker's `claims.json`, fetches each cited URL through the
app's SSRF-safe fetcher, and checks quotes against the live page — explicitly ignoring
source text the agent pasted in, "because an agent can forge it." Invented and uncited
claims fail; imprecise ones pass with a warning. The gap is the claim that is never
*written down*: prose in a deliverable that asserts something and cites nothing. The
detector reads the deliverable, extracts assertions of fact, and fails on assertions absent
from `claims.json`. Reuse `@emdash/citations` rather than building a second claim model, and
keep the "agent-supplied source text is not evidence" rule intact.

### D5 — What independent review does not establish

This belongs in the product UI, next to the verdict, not only in this document. The strategy
is explicit that a badge is meaningful only if an observer can see what it did **not** cover,
and `JobVerificationView` is where a reader looks.

Surface these, in the verification modal, as plain sentences:

- **The reviewer did not run the code.** It read a diff, a read-only copy of the result, and
  the evidence the gates produced. Execution is the deterministic gates' job.
- **A passing review is one model's judgement**, from a fresh context and a read-only
  checkout. It is not a proof, and it is not a substitute for human review of anything that
  matters.
- **The reviewer saw a truncated diff.** `maxDiffChars` defaults to 60,000; the full diff is
  stored as evidence but the prompt is bounded. A large change was reviewed in part. Say the
  truncation happened, in the bundle and in the UI, whenever it did.
- **The reviewer saw the evidence, not the world.** It judged screenshots and logs produced
  by this run. It did not open the app, use the feature, or check production.
- **Independence held to the recorded level and no further.** Whatever level D1 computed,
  render that level's sentence — never a generic "independently verified".
- **Correlated assumptions are reduced, not eliminated.** Different model and different
  provider lower the chance of a shared blind spot. They do not remove it, and on a
  `context-only` review they do not apply at all.

Write these as strings in one module so R2, the claims auditor, can review the whole set at
once and so the wording cannot drift per surface.

## Acceptance criteria

- [ ] An `IndependenceLevel` union of exactly `full`, `model-only`, `context-only` exists,
      computed by a pure function with a table test covering every axis combination.
- [ ] The level is computed from the reviewer run's resolved provider and model, not from
      configuration, asserted by a test where the two disagree.
- [ ] A review with fresh context or write isolation missing produces a gate failure, not a
      degraded level, asserted by a test.
- [ ] `routeReviewer`'s cross-provider TODO is closed: with two providers installed and an
      `authorProvider` on the job, the reviewer runs on the other provider; the containment
      trade-off (R2, R13) is answered in the file, not left as a comment.
- [ ] With one provider installed, the review still runs and records `model-only` or
      `context-only`; a test covers the single-provider machine.
- [ ] A tier whose policy requires `require_different_provider` on a machine that cannot
      supply it **blocks** rather than degrading, asserted by a test.
- [ ] Every emitted bundle's `review` section records reviewer id, provider, model, tool
      permissions, checkout mode, verdict, findings, and the axis record — on `full` runs too.
- [ ] `parseReviewerVerdict` accepts `inconclusive` with a required non-empty `reason`, and
      rejects it without one.
- [ ] `VERDICT_INSTRUCTIONS` and the parser agree, asserted by a test that parses the shape
      the instructions describe.
- [ ] An inconclusive verdict fails the gate and yields the `inconclusive` terminal state,
      distinct from `blocked`, asserted by a test named for the rule.
- [ ] Every reviewer verdict, including a pass, carries at least one stated thing the
      evidence does not establish.
- [ ] Diff truncation is recorded in the bundle and shown in the UI whenever it occurred.
- [ ] The "what this does not establish" strings live in one module and are rendered in the
      job verification modal, not only in docs.
- [ ] `pnpm run check` passes; `docs/UPSTREAM-PATCHES.md` updated if an inherited file
      changed; `security-reviewed` label applied after a real review of the SEC-18 path.

## Evidence required for review

1. Three bundles: one `full`, one `model-only`, one `context-only`, each showing the axis
   record and the verdict.
2. A bundle from a run whose reviewer returned `inconclusive`, showing the terminal state is
   `inconclusive` and not `blocked`.
3. Screenshots of the job verification modal at each independence level, showing the wording
   actually rendered.
4. Test output for the axis-level table, the blocking-policy case, the inconclusive rule, and
   the verdict-parser changes.
5. A transcript demonstrating that the reviewer could not write to the graded artifact —
   ideally a run where a write was attempted and refused.
6. A written note on what independent review does not establish, matching the UI strings
   verbatim.

## Limitations to declare

- Two providers exist (`PROVIDERS` is `['claude', 'codex']`). "Different provider" has one
  alternative, and a user with one CLI installed can never reach `full`.
- A cross-provider reviewer changes the containment posture, not only the independence one.
  The Codex sandbox restricts writes rather than reads and has no turn cap (R2, R13). Whatever
  is shipped, state the read surface it grants.
- Different model and different provider reduce correlated assumptions. Neither is measured
  yet; the measurement belongs to [W7](./W7-verified-delivery-bench.md)'s false-verification
  rate, and no reduction may be quantified in copy before that exists.
- The reviewer reads a bounded diff. On a large change, the review is partial by
  construction.
- Isolation rests on the provider sandboxes and on git's behaviour in the disposable
  checkout. It is defence in depth, verified by tests against specific git versions, not a
  formal guarantee — and the checkout hardening is explicitly version-sensitive (git before
  2.44 fails closed rather than proceeding).
- The unsupported-claim detector finds assertions it can recognise. Absence of a finding is
  not evidence that every claim is supported.

## Follow-ups this job should file, not do

- A third provider, once the evidence layer is excellent — out of scope during the wedge by
  [`00-north-star.md`](../00-north-star.md#what-we-do-not-build-during-the-wedge).
- Reviewer disagreement analysis: when two reviewers on different providers split, which was
  right? Input for [W7](./W7-verified-delivery-bench.md).
- Chunked review for diffs above `maxDiffChars`, so a large change is reviewed whole rather
  than in its first 60,000 characters.
- Test-quality review as its own `ReviewFocus`, including detection of the tempting
  test-cheating shortcut the benchmark task set deliberately contains.
- A measured answer to whether `model-only` review catches materially less than `full`.
