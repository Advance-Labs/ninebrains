# Verified Multi-Agent Development — build program

This directory turns [`Ninebrains: Strategy to Own Verified Multi-Agent Development`](./00-north-star.md)
into an executable program: eleven workstreams, a fixed agent roster, a dependency-ordered
schedule, and a shared definition of done.

It is written to be executed by an agent swarm with minimal human arbitration. Every
workstream page is self-contained: an agent can be handed one page plus
[`03-definition-of-done.md`](./03-definition-of-done.md) and produce mergeable work.

## Read in this order

| # | Page | What it settles |
|---|---|---|
| 0 | [`00-north-star.md`](./00-north-star.md) | Category, ICP, positioning, what we refuse to build |
| 1 | [`01-swarm-charter.md`](./01-swarm-charter.md) | Agent roster, model assignment, handoff protocol, escalation |
| 2 | [`02-execution-plan.md`](./02-execution-plan.md) | Dependency DAG, five waves, 30/60/90 mapping |
| 3 | [`03-definition-of-done.md`](./03-definition-of-done.md) | Universal DoD, claims discipline, evidence expectations |

## Workstreams

Engineering (the product moat):

| ID | Workstream | Owner lane | Wave |
|---|---|---|---|
| [W1](./workstreams/W1-evidence-bundle-schema.md) | Evidence Bundle v0.1 schema and recorder | L1 Evidence Architect | 1 |
| [W2](./workstreams/W2-evidence-viewer-and-exports.md) | Evidence viewer, HTML/JSON export, GitHub Check | L1 Evidence Architect | 2–3 |
| [W3](./workstreams/W3-verification-policy-engine.md) | Policy engine, risk tiers, `.ninebrains/` config | L2 Policy Architect | 1–2 |
| [W4](./workstreams/W4-independent-review.md) | Independent reviewer isolation and verdicts | L3 Review Architect | 2 |
| [W5](./workstreams/W5-gate-adapters.md) | Deterministic and behavioral gate adapters | L4 Gate Builder | 2–3 |
| [W6](./workstreams/W6-team-mode.md) | Shared policy, waivers, approvals, audit, templates | L5 Team Builder | 3 |

Proof (the credibility layer):

| ID | Workstream | Owner lane | Wave |
|---|---|---|---|
| [W7](./workstreams/W7-verified-delivery-bench.md) | Verified Delivery Bench: tasks, harness, judging | L6 Benchmark Lead | 3–4 |
| [W8](./workstreams/W8-open-evidence-standard.md) | Agent Verification Evidence Specification (AVES) | L7 Spec Editor | 2–4 |
| [W11](./workstreams/W11-metrics-and-scorecard.md) | Opt-in local metrics, scorecard instrumentation | L10 Metrics Lead | 2–4 |

Distribution (the recommendation layer):

| ID | Workstream | Owner lane | Wave |
|---|---|---|---|
| [W9](./workstreams/W9-positioning-and-content.md) | Homepage rewrite, category hub, comparisons, guides | L8 Content Lead | 1–4 |
| [W10](./workstreams/W10-external-corroboration.md) | Design partners, case studies, directories, reviews | L9 Corroboration Lead | 3–5 |

## Agent briefs

[`briefs/`](./briefs/) holds one copy-paste dispatch brief per lane. A brief is the exact
text handed to a spawned agent. Briefs are derived from the workstream pages; when the two
disagree, the workstream page wins.

## The one rule that governs this program

Ninebrains is a verification-first product. This program is executed verification-first.
No workstream deliverable counts as done because an agent says it is done. It counts when
the evidence named in its acceptance criteria exists, is inspectable, and has survived the
three standing reviewers in [`01-swarm-charter.md`](./01-swarm-charter.md#standing-reviewers).

Program decisions are logged in [`decisions.md`](./decisions.md). Per-job evidence records,
including the R1/R2/R3 verdicts and the revision each was run against, live in
[`evidence/`](./evidence/).

Source strategy document: `Ninebrains  Strategy to Own Verified Multi-Agent Development.md`
(dated 2026-09-25). Summarized without loss of decisions in
[`00-north-star.md`](./00-north-star.md).
