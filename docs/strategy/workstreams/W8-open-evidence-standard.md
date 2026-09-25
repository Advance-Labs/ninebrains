# W8 — Agent Verification Evidence Specification (AVES)

| | |
|---|---|
| **Lane** | L7 Spec editor |
| **Model** | Opus |
| **Wave** | 2–4 |
| **Risk tier** | Critical at 1.0 (published spec version — two-person approval, human go decision) |
| **Depends on** | W1 |
| **Blocks** | W9 |

## Intent

Publish the **Agent Verification Evidence Specification (AVES)** under a permissive licence: a
JSON schema, a conformance suite, and the prose that makes both implementable by someone who
has never run Ninebrains.

The binding constraint is stated once and never negotiated: **the schema must not require
Ninebrains.** No field named after our product, no enum value that only our runtime can
produce, no semantics that depend on our job model or our storage layout. A GitHub Action, a
CI provider, a review bot, or a competing orchestrator must be able to emit a valid bundle
without importing anything of ours, and a viewer must be able to render one without knowing
which tool produced it.

[W1](./W1-evidence-bundle-schema.md) already carries that constraint for v0.1 —
the schema lives at `spec/evidence-bundle/v0.1/`, does not reference Ninebrains types, and is
required to validate with a standard validator that has no Ninebrains dependency. W8 is the
job that turns that internal discipline into a public contract other people can rely on.

`spec/` is L7's sole property after W1 lands its v0.1 directory there, per
[`01-swarm-charter.md`](../01-swarm-charter.md#parallelism-and-collision-rules). Changes to
`spec/evidence-bundle/v0.1/` after the handover go through L7.

## Why we give the shape away

This looks like handing competitors our differentiator. It is the opposite, and the reasoning
should be written down because it will be challenged.

**What a private JSON shape would actually protect.** Nothing durable. A bundle format is
fifteen to thirty fields describing commits, commands, exit codes, gate outcomes, a reviewer
verdict, and a risk section. Any competent team that sees three of our exported bundles can
reproduce the shape in an afternoon. A secret that is reconstructible from the product's own
public output is not a secret; keeping it private only stops other people from writing tools
that consume it.

**What we are actually defending.** The moat is the compound asset, and none of it is the
schema:

| Asset | Why it is hard to copy |
|---|---|
| Policy engine and risk tiers | Judgement about what proof a class of change requires, accumulated from real failures |
| Independent-review isolation | `SpawnReviewerOptions` with `tools: 'read-only'` and the disposable detached checkout of `PrepareReviewCheckout` (SEC-18) are security design, not a data format |
| Gate adapters | Breadth and correctness across real stacks, built once per ecosystem |
| Evidence viewer and UX | Making a bundle legible to a tired reviewer at 6pm is a product, not a parser |
| Benchmark corpus and history | [W7](./W7-verified-delivery-bench.md)'s tasks, frozen criteria, and campaign history cannot be forked into existence |
| Pack ecosystem | Contributed gates and discipline packs accrue to whoever hosts them |
| Reference implementation status | The thing W8 buys |

**What openness buys.** If AVES is the format a CI provider emits and a review tool consumes,
then the question "which orchestrator should we use" is asked inside a vocabulary we authored,
and we are the reference implementation of the answer. Standards authorship is how a small
project becomes the entity a recommendation engine names when the category is named. Hoarding
the shape trades that position for a barrier a competitor clears in a day.

The weaker move, stated plainly: keep the schema private, ship an exporter nobody can consume,
and spend the next year arguing that our status screen is better than someone else's status
screen. That is a feature argument. We would lose it eventually to whoever has more engineers.

## Relationship to W1

Two artifacts, two different promises, and the difference is the whole governance story.

| | Evidence Bundle **v0.1** (W1) | **AVES 1.0** (W8) |
|---|---|---|
| Audience | Ninebrains internals and early adopters | Anyone |
| Stability | May change freely, including breaking changes | Public contract; breaking changes require a major version |
| Migration | We migrate our own data | Deprecation window, migration guide, dual-emit period |
| Owner | L1 evidence architect | L7 spec editor |
| Failure mode | A local migration | A field nobody can remove for years |

v0.1 is deliberately allowed to churn. That is what it is for: it is where we find out which
fields real runs actually populate and which ones we imagined. Every field that survives to
1.0 has to have earned it by appearing in real bundles from real jobs.

**The freeze point.** AVES 1.0 is cut when all of these are true, and not before:

- [W7](./W7-verified-delivery-bench.md)'s full task corpus has produced bundles and **every
  one validates**, including bundles from timed-out, crashed, and `inconclusive` runs.
- Every field in the schema has been populated by at least one real bundle. Fields that no run
  ever filled are **removed before the freeze**, not carried forward optimistically.
- At least one **producer outside Advance Labs** emits valid bundles, and at least one
  **consumer outside Advance Labs** reads them and does something useful with the result.
- The conformance suite (D3) passes against two independent implementations, one of which is
  not ours.
- The four terminal states are stable and their meanings have survived a full benchmark
  campaign without needing a fifth.
- A written v0.1 → 1.0 migration guide exists and has been executed against real v0.1 bundles.
- The prose spec has been read end to end by someone who has never used Ninebrains, who
  implemented a producer from it without asking us a question the spec should have answered.

Until then the published artifact is a **draft**, labelled as one, with a visible statement
that it will change. Calling a draft a standard is the same category of overreach as calling a
passing test suite a correctness proof, and R2 treats it the same way.

## Deliverables

### D1 — The specification document

`spec/aves/` holds the prose. It is a specification, not marketing: normative language
(MUST/SHOULD/MAY with their conventional meanings, stated), a data model section, a section
per top-level object, and a conformance section that is testable rather than aspirational.

Required content beyond field definitions:

- **Scope and non-scope.** AVES describes *what was checked and what was found*. It does not
  describe how to check, which gates to run, or what a passing result means about correctness.
  Say this in the spec, at the top, because implementers will otherwise infer it.
- **The four terminal states** — `verified`, `verified-with-waiver`, `blocked`,
  `inconclusive` — as a closed enum with precise definitions, including that
  `verified-with-waiver` requires a recorded waiver with actor, reason, and timestamp, and MUST
  NOT be presented to a human identically to `verified`.
- **Absence semantics.** `null` and key-absent mean different things and the spec says which,
  per field. A consumer must be able to distinguish "no reviewer ran" from "a reviewer ran and
  reported nothing."
- **What the integrity hashes establish.** Tamper-**evident**, not tamper-proof: anyone who can
  write the bundle can rewrite an artifact and its hash together. The spec states this in
  normative prose so no implementer can honestly ship a "tamper-proof" claim on top of it.
- **Producer honesty requirements.** A producer MUST record commands that failed, MUST record
  every attempt rather than only the successful one, and MUST NOT emit `verified` when a
  required check did not run. These are the properties that make the format worth consuming;
  without them AVES is a container for whatever a vendor wants to assert.
- **Privacy requirements.** A conforming bundle MUST NOT contain absolute host paths, and
  producers MUST apply secret redaction before writing artifacts. Our implementation of this is
  `packages/gates-core/src/evidence-redact.ts` and the path rules in
  `packages/gates-core/src/evidence-store.ts`; the spec states the requirement, not our code.

### D2 — Governance

Published at `spec/aves/GOVERNANCE.md`. Thin on purpose — a governance document longer than the
specification is a warning sign — but explicit about the four things people actually need.

**Versioning.** Semantic versioning over the schema, with the compatibility contract stated in
terms of producers and consumers, not in the abstract:

| Change | Version | Rule |
|---|---|---|
| New optional field | Minor | Always allowed. Consumers MUST ignore unknown fields |
| New enum value in an open enum | Minor | Only where the spec declared that enum extensible, and consumers MUST have a documented fallback |
| New enum value in a closed enum (`status`) | **Major** | Consumers switch exhaustively on it; adding a value breaks them |
| New required field | **Major** | Never in a minor, no exceptions, no "but every producer already emits it" |
| Field removal or type change | **Major** | Preceded by a deprecation cycle |
| Prose clarification, no schema change | Patch | Must not change what validates |

The rule that does the work: **minor versions are additive only.** This is already how the
codebase treats an evolving contract — `SpawnReviewerOptions` in
`packages/gates-core/src/types.ts` documents that it only ever grows by optional fields — and
AVES inherits it. The corollary is that new fields must be optional even when we wish they were
not, so field design has to assume a consumer that ignores it.

**Deprecation.** A field is deprecated by marking it in the schema and the prose with the
version that deprecated it and the earliest major version that may remove it. A deprecated
field keeps working for at least one full major version and at least twelve months, whichever
is longer. Producers SHOULD emit both old and new during the window. Nothing is removed
without a published migration guide that a consumer can act on mechanically.

**Change proposals.** One lightweight process, in the repository, in the open:

1. A proposal is a file in `spec/aves/proposals/`, numbered, from a template.
2. It must contain: the problem, the proposed schema change, a **real bundle** that motivates
   it, a conformance test for the new behaviour, and at least one named consumer that wants it.
   A field with no consumer is not accepted; that is how schemas rot.
3. Status lifecycle: `draft` → `review` → `accepted` | `rejected` → `shipped`. Rejected
   proposals stay in the tree with the reason. The rejection record is the most useful part of
   the process for the next person with the same idea.
4. Minimum review window: fourteen days for a minor, thirty for anything major.

**Who cuts a version.** L7 proposes. A minor or patch requires L7 plus L0. **A major version,
and 1.0 itself, is Critical tier** under
[`03-definition-of-done.md`](../03-definition-of-done.md#risk-tiers-for-program-jobs): two-person
approval including a named human, an explicit go decision, and the conformance suite green on
two independent implementations. No agent in this swarm cuts a major version on its own
authority, and the governance document says so by name.

Governance transfers if AVES succeeds: if implementers outside Advance Labs ship production
producers or consumers, the document commits us to opening a change-proposal review seat to
them. Writing that commitment down now costs nothing and is worth a great deal to the first
outside implementer evaluating whether to depend on us.

### D3 — Conformance

A specification without an executable conformance suite is a set of opinions. `spec/aves/tests/`
holds fixtures and a runner that is independent of our implementation.

**Producer conformance** — can this system emit valid AVES?

| Level | Requirement |
|---|---|
| Structural | Emits bundles that validate against the schema for the declared version |
| Complete | Every field the spec marks required-if-applicable is present when applicable: failed commands recorded, all attempts recorded, waiver fields populated for `verified-with-waiver` |
| Honest | Passes the negative fixtures: a run where a required check did not execute MUST NOT be emitted as `verified`; a run that aborted MUST emit `inconclusive` with whatever it has; no absolute host paths; planted secret patterns absent from the output |

Structural conformance is mechanical. Honest conformance is what the badge is actually about,
and it is tested by scenario fixtures a producer runs against its own runtime, not by
inspecting static files.

**Consumer conformance** — can this system read AVES without lying about it?

| Level | Requirement |
|---|---|
| Structural | Parses every fixture in the corpus, including the largest and the minimal |
| Forward-compatible | Ignores unknown fields and unknown open-enum values without erroring, and does not drop them when re-serialising |
| Faithful | Renders or reports all four terminal states distinguishably; never displays `verified-with-waiver` identically to `verified`; distinguishes key-absent from `null`; surfaces declared residual risks rather than only the status |

The faithful level exists because the realistic misuse of AVES is a vendor consuming a bundle
and rendering a green tick. A consumer that collapses four states into a boolean is not
conformant, and the suite has a fixture that catches exactly that.

**Reference implementations.** Two, both maintained in this repository:

- Producer: the Ninebrains bundle recorder from [W1](./W1-evidence-bundle-schema.md).
- Consumer: the evidence viewer and exporters from
  [W2](./W2-evidence-viewer-and-exports.md), plus a small standalone CLI validator with no
  Ninebrains dependency, so an implementer can check their output without installing the app.

Both run in CI against the conformance suite. A reference implementation that fails its own
conformance suite is a release blocker, and that is the point of having one.

**The badge, and what it does not establish.** A conformance badge states one specific thing:

> `AVES 1.0 producer — structural, complete, honest — suite run <date>, version <suite version>`

It establishes that the named system emitted bundles satisfying the suite on that date. It
establishes **nothing** about whether that system's gates are good, whether its reviews are
independent, whether its verdicts are accurate, or whether its code is correct. That disclaimer
ships **on the badge page itself**, not buried in the spec, because a badge that is read as
"this tool is trustworthy" is worse than no badge. Self-certification is permitted and is
labelled self-certified; the suite run output must be published alongside.

The badge and the names "Ninebrains" and "AVES" are trademarks and are not licensed by the
specification's copyright licence. This is deliberate: it keeps the spec free to implement
while leaving us able to address a badge that is displayed dishonestly. The trademark policy is
a short separate file, and it must not contain any restriction on implementing the spec.

### D4 — Licence

| Artifact | Licence | Reason |
|---|---|---|
| Schema files, conformance suite, reference validator, examples | **Apache-2.0** | Matches the repository (`LICENSE.md`, `NOTICE`), so no new licence boundary inside the tree. The express patent grant matters for something we are asking other companies to implement: a legal reviewer at a CI vendor reads it and stops asking questions |
| Prose specification | **CC BY 4.0** | Apache-2.0 is a software licence and reads awkwardly over a document. CC BY 4.0 permits reproduction and derivative specification text with attribution, which is what a standard needs |
| Trademarks (`Ninebrains`, `AVES`, the badge) | Not licensed by either | See D3 |

No copyleft, no field-of-use restriction, no "non-commercial", no licence that asks an adopter
to open-source their own product. Every one of those converts the adoption question from an
engineering decision into a legal review, and a standard that requires legal review does not
get adopted by a two-person team on a Friday afternoon, which is the adoption we need.

Relation to the repository's Apache-2.0: the specification tree is a subset of an existing
Apache-2.0 repository whose `NOTICE` already attributes the Emdash inheritance. The dual
arrangement adds a document licence over the prose only; it removes nothing. Record the
per-directory licensing in `spec/aves/LICENSE.md` so the boundary is unambiguous to a
downstream packager.

### D5 — Adoption plan

A standard is adopted one implementation at a time, and the first three are the ones that
matter. Targets, in the order we approach them:

| Target class | What we ask for | What it costs them |
|---|---|---|
| CI providers | Emit an AVES bundle as a build artifact; render it on a check summary | A serialiser over data they already have: commit, commands, exit codes, durations |
| Code-review tools | Consume a bundle attached to a PR and surface residual risks alongside their own findings | A parser and three UI states they mostly have |
| Other orchestrators | Emit AVES from their existing run records | The same serialiser, plus the honesty requirements, which is the real work |
| Test and scan tools | Emit a gate-result fragment that a producer can embed | A small object, not a whole bundle |
| Evidence consumers (dashboards, compliance tooling) | Read bundles across tools | A parser |

**What we do to make it cheap.** Cost is the only lever we have; nobody implements a standard
as a favour:

- A single-file JSON Schema with no `$ref` to anything remote.
- A standalone validator CLI with no Ninebrains dependency, plus a GitHub Action wrapping it.
- Producer helper libraries in TypeScript and Python that build a valid bundle from a handful
  of inputs, published independently of the desktop app.
- A fixture corpus of real bundles, including the awkward ones — aborted runs, waived runs,
  runs with a malformed reviewer reply — so implementers hit the hard cases on day one.
- **We write the first adapter ourselves.** Open the PR against their repository, with tests.
  An adapter that already exists is a far easier decision than an adapter someone must
  schedule.
- A public implementer list, so an early adopter gets visible credit for being early.

Sequencing: one producer and one consumer outside Advance Labs before 1.0 is cut, because they
are freeze-point conditions. Approach during the Wave 2 draft period, not after the freeze —
an implementer who finds the flaw before 1.0 is a gift, and one who finds it afterwards is a
major version.

### D6 — The risk that this becomes documentation

**A standard nobody implements is documentation with extra governance overhead.** That is the
realistic failure mode, not a competitor forking it. We should name the signal in advance,
while we can still be honest about it.

**The failure signal, stated concretely:** twelve months after the 1.0 freeze, with the spec
published, the validator shipped, the helper libraries available, and at least eight adapter
approaches made and recorded —

- zero production producers outside Advance Labs, **and**
- zero production consumers outside Advance Labs, **and**
- zero accepted change proposals originating outside Advance Labs.

All three, because any one of them alone is noise. A consumer with no producers means we
approached the wrong side; a proposal with no implementation means interest without commitment.

**What we do then**, decided now so it is not decided defensively later:

1. Say so publicly, on the spec page, with the numbers. We publish our own failures in
   [W7](./W7-verified-delivery-bench.md); this is the same rule applied to the same
   organisation.
2. Stop describing AVES as a standard. Redesignate it as *the Ninebrains evidence export
   format*, documented and permissively licensed, which is what it will in fact be.
3. Retire the governance apparatus. Deprecation windows, proposal review periods, and major
   version ceremony exist to protect implementers. With no implementers they only slow us
   down, and keeping them would be theatre.
4. Keep the permissive licence and the validator. They cost nothing and leave the door open.
5. Move L7's effort to the assets that were the moat regardless: the viewer, the adapters, and
   the benchmark corpus.

The reason to write this down before starting is that the sunk cost of a published
specification makes step 2 very hard to take at the moment it becomes correct.

## Acceptance criteria

- [ ] AVES 1.0 is not cut on a single approver. Two-person approval has no waiver path for
      this action, per
      [`03-definition-of-done.md`](../03-definition-of-done.md#risk-tiers-for-program-jobs)
      and the charter's
      [H1 section](../01-swarm-charter.md#h1--the-human-and-what-only-they-can-supply). If a
      second approver is unavailable, 1.0 waits; the draft stays at 0.x and says so.
- [ ] `spec/aves/` contains a prose specification with normative MUST/SHOULD/MAY language, a
      stated scope and non-scope, and a section per top-level object.
- [ ] The schema validates with a standard draft 2020-12 validator that has **no Ninebrains
      dependency**, asserted in CI.
- [ ] No field name, enum value, or description in the schema references Ninebrains, our job
      model, or our storage layout; asserted by a test that greps the schema.
- [ ] A producer implemented from the prose alone, by someone who has not read our source,
      emits a bundle that passes structural and complete conformance.
- [ ] `spec/aves/GOVERNANCE.md` states the semver contract, the additive-only minor rule, the
      deprecation window, the proposal process, and by name who may cut a major version.
- [ ] The conformance suite defines producer and consumer conformance separately, with the
      three levels each, and runs from `spec/aves/tests/` without installing the desktop app.
- [ ] The negative fixtures pass: a producer that emits `verified` with a required check not
      run fails honest conformance; a consumer that renders `verified-with-waiver` identically
      to `verified` fails faithful conformance.
- [ ] Both reference implementations run against the suite in CI, and a reference
      implementation failing it blocks release.
- [ ] The badge page states, in its own copy, what the badge does and does not establish, and
      labels self-certification as self-certified with the suite output published.
- [ ] Licensing is recorded per directory in `spec/aves/LICENSE.md`, consistent with the
      repository's `LICENSE.md` and `NOTICE`, with the trademark carve-out in a separate file
      that imposes no restriction on implementing the spec.
- [ ] Every freeze-point condition in *Relationship to W1* is individually evidenced before 1.0
      is cut, including at least one outside producer and one outside consumer.
- [ ] Every field in the 1.0 schema is populated by at least one real bundle in the fixture
      corpus; fields with no real population are removed and the removals are listed.
- [ ] The v0.1 → 1.0 migration guide exists and has been executed against real v0.1 bundles,
      with the transcript attached.
- [ ] The failure signal and the response in D6 are published on the spec page, not only in
      this workstream document.

## Evidence required for review

1. The rendered specification and the schema, plus the validator run against the full fixture
   corpus with output attached.
2. The conformance suite run for both reference implementations, and for at least one outside
   implementation, with dates.
3. The independent-producer transcript: what the implementer built from the prose, what they
   had to ask us, and what we changed in the spec as a result.
4. Negative-fixture output showing an intentionally dishonest producer and an intentionally
   lossy consumer both failing.
5. The schema grep test output proving no Ninebrains-specific identifiers remain.
6. The v0.1 → 1.0 migration transcript over real bundles.
7. Written approval records for the 1.0 cut: two people, one of them human, with the go
   decision recorded.

## Limitations to declare

- A conformant bundle establishes that a record has the required shape and the required
  honesty properties in the tested scenarios. It establishes nothing about the quality of the
  gates, the independence of the review, or the correctness of the code. Repeat this wherever
  the badge appears.
- Conformance is tested against fixtures and scenarios we authored. A producer can be
  conformant and still misrepresent its runs in a way our fixtures do not model.
- Self-certification is the default and is not audited. We do not have the standing or the
  resources to audit implementers, and claiming otherwise would be its own dishonesty.
- Integrity hashes are tamper-evident, not tamper-proof; the spec inherits this limit from
  [W1](./W1-evidence-bundle-schema.md) and no signing scheme exists at 1.0.
- Being first to publish a format does not make it a standard. Until the freeze-point adoption
  conditions are met, the honest description is "a draft specification with one reference
  implementation," and that is what the page says.
- We author the spec, the reference implementations, the conformance suite, and the benchmark
  that uses them. That concentration is a real conflict. The governance seat commitment and
  the published failure signal constrain it; they do not remove it.

## Follow-ups this job should file, not do

- Bundle signing and a key-distribution story, which would change the integrity section from
  tamper-evident to something stronger and is a major version.
- A hosted bundle viewer at a stable URL so a bundle can be linked from a PR without a local
  install ([W2](./W2-evidence-viewer-and-exports.md) boundary).
- A gate-result fragment sub-specification so test and scan tools can emit a piece of a bundle
  without producing a whole one.
- Submitting AVES to a neutral standards venue, which is only worth doing after outside
  implementations exist.
- An implementer directory and a public conformance results page
  ([W9](./W9-positioning-and-content.md) content surface).
