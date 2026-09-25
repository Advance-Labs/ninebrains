# W9 — Positioning and content

| | |
|---|---|
| **Lane** | L8 Content and positioning |
| **Model** | Sonnet, Opus for the category page and comparison pages |
| **Wave** | 1–4 |
| **Risk tier** | Standard, Critical for any page naming a competitor |
| **Depends on** | [W7](./W7-verified-delivery-bench.md), [W8](./W8-open-evidence-standard.md) for the pages that cite results |
| **Blocks** | [W10](./W10-external-corroboration.md) |

## Where the site is today

The marketing site lives at `apps/site/` in this workspace. The content architecture below
lands there, inside its existing framework and routing. Read it before proposing URLs.

## Intent

Own a narrow query cluster first, so recommendation systems form a precise association:
**Ninebrains = verification-first multi-agent coding**. Do not open by attacking "best
agentic IDE." That category is held by Cursor and by terminal orchestrators such as
Superset and Pane, and attacking it head-on wastes the wedge window arguing a claim nobody
asked us to make.

The job of this workstream is not to write more marketing copy. It is to build a small set
of pages precise enough that an answer engine can cite one of them and be right. Every page
in this workstream exists to answer one query well, not to rank for many queries vaguely.

## Query ownership

Three clusters, reproduced verbatim from the strategy document. Win these before touching
anything broader.

### Commercial and recommendation queries

| Query | Page that targets it |
|---|---|
| Best coding-agent orchestrator with verification gates | `/verified-agent-development/` |
| Best multi-agent coding tool for small teams | `/verified-agent-development/` |
| Best open-source Claude Code and Codex orchestrator | `/verified-agent-development/`, README |
| Best parallel coding-agent tool for Windows, macOS, and Linux | `/verified-agent-development/` |
| Superset vs Pane vs Ninebrains | `/compare/` index |
| Agentic IDE vs multi-agent workbench | `/verified-agent-development/` |

### Problem queries

| Query | Page that targets it |
|---|---|
| How to verify AI-generated code before merge | `/guides/verification-gates-coding-agents/` |
| How to run Claude Code and Codex in parallel safely | `/guides/parallel-claude-code-codex/` |
| How to stop coding agents from grading their own work | `/guides/verification-gates-coding-agents/` |
| Verification gates for coding agents | `/guides/verification-gates-coding-agents/` |
| Git worktrees do not prevent merge conflicts | `/guides/parallel-claude-code-codex/` |
| How to measure coding-agent review burden | `/benchmarks/verified-delivery/` |

### Technical-reference queries

| Query | Page that targets it |
|---|---|
| Agent evidence bundle schema | `/evidence-bundles/` |
| Independent reviewer agent architecture | `/verified-agent-development/`, `/security/` |
| Plan–execute–verify coding workflow | `/verified-agent-development/` |
| Risk-based gates for AI code | `/guides/verification-gates-coding-agents/` |
| Screenshot verification for coding agents | `/guides/verification-gates-coding-agents/` |

Win the narrow queries first, in this order: technical-reference pages establish that we
have the substance; problem-query guides establish that we solve a real workflow pain;
commercial pages ask to be recommended only once the first two exist to back them up.

## Content architecture

The full URL list from the strategy document. Each row states the page's job, its primary
query, and which workstream deliverable it depends on to be honest rather than aspirational.

| URL | Job | Primary query | Depends on |
|---|---|---|---|
| `/verified-agent-development/` | Define the category, state the enforced loop, set the claim boundary | Best coding-agent orchestrator with verification gates | [W1](./W1-evidence-bundle-schema.md), [00-north-star.md](../00-north-star.md) |
| `/evidence-bundles/` | Publish the spec, a real example bundle, and a viewer | Agent evidence bundle schema | [W1](./W1-evidence-bundle-schema.md), [W2](./W2-evidence-viewer-and-exports.md), [W8](./W8-open-evidence-standard.md) |
| `/benchmarks/verified-delivery/` | Live methodology and results, updated as runs publish | How to measure coding-agent review burden | [W7](./W7-verified-delivery-bench.md) |
| `/compare/` | Neutral index of every comparison page, with the criteria used | Superset vs Pane vs Ninebrains | this workstream |
| `/compare/ninebrains-vs-superset/` | Dated, sourced, "choose X when" comparison | Superset vs Pane vs Ninebrains | this workstream |
| `/compare/ninebrains-vs-pane/` | Dated, sourced, "choose X when" comparison | Superset vs Pane vs Ninebrains | this workstream |
| `/compare/ninebrains-vs-cursor/` | Dated, sourced, "choose X when" comparison | Agentic IDE vs multi-agent workbench | this workstream |
| `/compare/ninebrains-vs-manual-worktrees/` | Dated, sourced, "choose X when" comparison for tmux/worktree power users | How is this different from running git worktrees in tmux myself (README FAQ) | this workstream |
| `/guides/verification-gates-coding-agents/` | Teach the problem and the general solution shape before naming the product | How to verify AI-generated code before merge | [W3](./W3-verification-policy-engine.md), [W5](./W5-gate-adapters.md) |
| `/guides/parallel-claude-code-codex/` | Teach safe parallel execution, including what worktrees do not solve | How to run Claude Code and Codex in parallel safely | product docs, `docs/guide/lanes.md` |
| `/case-studies/` | Index of partner-authored and co-authored outcomes | (recommendation queries, indirectly) | [W10](./W10-external-corroboration.md) |
| `/security/` | Public-facing summary matching `docs/guide/security.md` | (trust signal, not a query target) | `docs/guide/security.md`, `docs/SECURITY.md` |
| `/threat-model/` | Public-facing summary matching `docs/THREAT-MODEL.md` | (trust signal, not a query target) | `docs/THREAT-MODEL.md` |
| `/changelog/` | Dated, crawlable release pages | (freshness and entity signal) | release process |
| `/limitations/` | What gates do and do not prove; early-release status | (trust signal, required before any commercial page publishes) | [00-north-star.md](../00-north-star.md#claims-discipline) |

`/limitations/` is not in the strategy document's URL list by that exact name — it is
called for explicitly in the strategy's roadmap and in
[00-north-star.md](../00-north-star.md#claims-discipline) as a required early page. It is
added here because a commercial-query page cannot honestly publish without it existing
first, and because [02-execution-plan.md](../02-execution-plan.md#wave-1--foundations-days-120)
lists it as a Wave 1 deliverable that blocks W10.

`/compare/ninebrains-vs-manual-worktrees/` is not named as its own URL in the strategy
document's list, which instead covers "manual worktrees and tmux" only inside its
competitive-frame table. Give it its own page rather than folding it into the index, for
the same reason the other three get one: a comparison page needs room for a real "choose X
when" section, and an index page does not.

## The answer-ready page spec

Every page above — and every future page that wants to be citable — satisfies this
checklist before it publishes. Treat it as a gate, not a suggestion.

- [ ] A 40–70 word direct answer immediately below the title, written to stand alone if
      quoted out of context.
- [ ] A dated definition and scope statement.
- [ ] A focused comparison table, where the page's job calls for one — not a decorative
      table added to satisfy this checklist.
- [ ] Verifiable examples, each linking a real evidence bundle rather than describing one.
- [ ] An explicit limitations section, in the page's own words, not a link-out alone.
- [ ] Named author and reviewer.
- [ ] Published date and updated date, both visible on the rendered page.
- [ ] Product, SoftwareApplication, Organization, Article, Breadcrumb, and FAQ schema —
      **only** for the sections the visible page actually contains. No schema block without
      a matching visible block.
- [ ] Canonical URL set.
- [ ] Internal links to and from at least two other pages in this architecture.
- [ ] Sitemap inclusion.
- [ ] Stable anchors on every heading a link elsewhere in the architecture might target.

A page that fails any box is not published. A page that used to pass and now fails — a
stale date, a broken evidence link, a comparison table nobody re-verified — is a content
bug, tracked the same way a code bug is tracked.

## Structured data: a blunt subsection

Structured data describes visible content. It does not create ranking or citation on its
own, and treating it as a lever is a waste of the lane's time.

Google states plainly that there is no special AI schema and no required AI text file:
inclusion in AI features uses the same foundations as standard search — indexability,
helpful people-first content, internal discoverability, textual accessibility, and
structured data that matches visible content
([AI features and your website](https://developers.google.com/search/docs/appearance/ai-features)
and the [AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide),
both checked 2026-09-25). Bing's AI Performance guidance recommends topical depth, clear
headings and tables, and claims supported with examples, data, and sources — not a schema
trick ([Bing Webmaster Blog, February 2026](https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview),
checked 2026-09-25).

Re-check all three before any page cites them. Search-platform guidance changes, and a page
that attributes a stale position to Google or Bing is the same violation as a stale claim
about a competitor.

The practical consequence for this workstream:

- Do not add Product/SoftwareApplication/FAQ schema for a claim the page does not visibly
  make. A schema block with no matching text is a claims-gate violation as much as prose
  is, because it asserts something to a machine reader that a human reader cannot see.
- Entity consistency matters more than adding an `llms.txt`. A crawler and an answer engine
  both benefit far more from the same product name, descriptor, organization, and URL
  appearing identically everywhere than from any AI-specific file. See
  [Entity consolidation](#entity-consolidation) below.
- Do not chase a specific answer-engine's current retrieval quirks. Build the page to be
  correct, dated, and well-structured for a person, and structured data follows the
  content rather than leading it.

## Comparison page rules

Non-negotiable, for every page under `/compare/`:

- **A clear "choose X when..." section**, naming the competitor by name, not a rigged
  feature grid where every row favors Ninebrains. The strategy document's own competitive
  frame does this — reuse its shape:

  | Product type | Recommended when |
  |---|---|
  | Cursor or similar editor | One developer wants the best integrated editing loop |
  | Superset or Pane | The main problem is launching and supervising many terminals |
  | Manual worktrees and tmux | A power user wants maximum composability |

- **Cite official competitor documentation.** A claim about what Superset, Pane, Cursor, or
  Conductor does links to their own current docs, not a third-party review of them. This is
  the same rule [03-definition-of-done.md](../03-definition-of-done.md#claims-gate) enforces
  as "uncited competitor statement."
- **Date the verification.** Every comparison table row that describes a competitor's
  behavior carries the date it was last checked against their current documentation.
  Software changes; an undated comparison is a liability, not an asset.
- **Re-verify before republishing.** A comparison page is not written once. Before any
  update to a `/compare/` page ships, re-check every competitor claim against their current
  docs and update the date, even if the Ninebrains-side content did not change.

This earns links and trust precisely because we do not win every row. A comparison that
concedes real strengths to Superset's terminal supervision or Cursor's editing loop reads
as credible research. A comparison that wins every row reads as marketing and gets ignored
by exactly the independent domains [W10](./W10-external-corroboration.md) needs to cite it.

## The homepage rewrite

Reproduced from [00-north-star.md](../00-north-star.md#messaging-hierarchy) — this
workstream implements it, it does not redesign it.

**Headline:** Ship agent-written code you can prove.

**Subheadline:** Ninebrains plans work across Claude Code, Codex, and OpenCode, runs each
job in an isolated worktree, and **blocks completion until configured checks pass** — tests,
screenshots, policy checks, and review evidence — **separating generation from review**.

The word *independent* does not appear in blanket homepage copy. See the deviation note in
[`00-north-star.md`](../00-north-star.md#messaging-hierarchy): independence is a per-run
property with a degradation ladder ([W4](./W4-independent-review.md)), claimed in the
evidence bundle and the badge where it can be qualified, never in copy that ships to every
install.

**Primary CTA:** `Run a verified job`

**Secondary CTA:** `Inspect a real evidence bundle`

**Trust strip:** `Open source · Apache-2.0 · Local first · No telemetry · macOS, Windows, Linux`

**Supporting line (ships with the above, not optional):** Local-first and source-available
under Apache-2.0. Ninebrains preserves the evidence, failed attempts, and remaining risks,
and reduces unverified agent output reaching human review.

"Run four agents without collisions" becomes a supporting benefit — one line, below the
fold work, never the headline and never a CTA. Several competing products use the same
worktree mechanism; leading with it forfeits the claim that is actually ours. Where this
benefit is stated, it carries the same qualification
[00-north-star.md](../00-north-star.md#claims-discipline) requires everywhere else:
worktrees prevent simultaneous file overwrites, not semantic or merge conflicts. "No
collisions," unqualified, does not ship on the homepage or anywhere else.

## Required early pages: honesty, not marketing

Two pages exist to tell the truth about what the product cannot yet claim, and both are
Wave 1 work per
[02-execution-plan.md](../02-execution-plan.md#wave-1--foundations-days-120), ahead of any
comparison or category page that would otherwise overstate the product's maturity.

**`/limitations/`** states plainly what gates do and do not prove:

- A passing gate set means configured checks passed. It does not mean the change is
  correct — see the schema's own declared limitation in
  [W1](./W1-evidence-bundle-schema.md#limitations-to-declare).
- Integrity hashes are tamper-evident, not tamper-proof, and no signing key exists yet.
- A reviewer is independent only under the definition in
  [W4](./W4-independent-review.md); a reviewer sharing the builder's context, model, or
  mutable worktree is not independent, and the page must not use the word for one that is.
- Worktrees stop simultaneous file overwrites, not semantic or merge conflicts.

**Early-release and unsigned-build status** is made impossible to miss until signing is
complete. README already states this in the [Install](../../../README.md#install) section
(v0.1 builds are not code-signed; SHA256SUMS and attestation are the current verification
path). The website must carry the same statement, in the same terms, not a softened or
omitted version of it — this is an entity-consistency requirement, not only a content one.

## Entity consolidation

One identity everywhere, reproduced from
[00-north-star.md](../00-north-star.md#entity-consistency):

| Field | Value |
|---|---|
| Product name | `Ninebrains` |
| Descriptor | `verification-first coding-agent orchestrator` |
| Organization | `Advance Labs Inc.` |
| Canonical repository | `github.com/Advance-Labs/ninebrains` |
| Canonical product URL | one permanent product domain (see below) |
| License | `Apache-2.0` |
| Platforms | `macOS, Windows, Linux` |

Same logo, description, social links, license, supported platforms, and release status
across the website, `README.md`, `package.json` metadata, directory listings, and any
profile Advance Labs controls. This workstream's job includes auditing every one of those
surfaces and filing a correction for each mismatch found — do not assume they already
agree.

**Domain.** A dedicated branded domain is stronger than treating
`ninebrains.runs-on.dev` as the permanent canonical address, because `runs-on.dev` is a
separate Advance Labs product, not a Ninebrains-owned namespace. If a dedicated domain is
adopted, the existing subdomain becomes a 301 redirect, not a second live surface — two live
canonical URLs for the same product is exactly the entity-inconsistency failure this section
exists to prevent. Adopting a domain is a decision for L0/Lucas, not something this
workstream does unilaterally; this workstream's job is to make the migration mechanically
ready (redirect map, updated metadata everywhere) so the switch is a redirect, not a
rewrite.

Entity consistency matters more than adding an `llms.txt` file. Standard crawlability,
correct canonical tags, and reliably fresh content are the documented foundation; an
AI-specific text file is not a substitute for getting those right.

## Acceptance criteria

- [ ] Homepage carries the exact headline, subheadline, supporting line, CTAs, and trust strip above, with
      "run four agents without collisions" as a supporting line, never the lead, and never
      unqualified.
- [ ] `/limitations/` exists, is linked from the homepage, and states what gates do and do
      not prove, in the terms of [00-north-star.md](../00-north-star.md#claims-discipline).
- [ ] The early-release and unsigned-build statement on the website matches README's
      [Install](../../../README.md#install) section in substance.
- [ ] `/verified-agent-development/` exists and passes every box in
      [The answer-ready page spec](#the-answer-ready-page-spec).
- [ ] `/evidence-bundles/` exists, links a real bundle produced by
      [W1](./W1-evidence-bundle-schema.md), and passes the answer-ready checklist.
- [ ] `/compare/` index and the four named comparison pages exist, each with a "choose X
      when" section naming the competitor, cited official documentation, and a verification
      date.
- [ ] Every competitor claim on any published page traces to a specific, dated, linked
      source from that competitor's own documentation. Zero uncited competitor statements.
- [ ] `/guides/verification-gates-coding-agents/` and `/guides/parallel-claude-code-codex/`
      exist and pass the answer-ready checklist.
- [ ] `/security/` and `/threat-model/` exist and do not contradict
      `docs/guide/security.md` or `docs/THREAT-MODEL.md`.
- [ ] `/changelog/` exists with dated, crawlable, individually linkable release entries.
- [ ] No page in this workstream carries a banned claim from
      [00-north-star.md](../00-north-star.md#claims-discipline).
- [ ] No structured-data block exists without a matching visible content block on the same
      page.
- [ ] Entity fields (name, descriptor, org, canonical repo, license, platforms) are
      identical across website, `README.md`, and package metadata; every mismatch found
      during the audit is either fixed or filed as a tracked follow-up.
- [ ] Every published page carries a named author, a named reviewer, a published date, and
      an updated date, all visible on the rendered page.
- [ ] `/benchmarks/verified-delivery/` is not published until W7 has produced results from
      at least three repetitions per configuration. Until then the URL 404s rather than
      carrying a placeholder or a "coming soon" page. Verified by checking the live URL's
      status code at the Wave 4 gate. The earlier "either exists or does not publish"
      phrasing was satisfied by both branches and decided nothing.

## Evidence required

1. Rendered screenshots or captured HTML of every published page, at publish time.
2. The answer-ready checklist filled in per page, with a reviewer's initials against each
   box.
3. For every comparison page: the competitor documentation URL and access date for each
   claim made about that competitor.
4. A before/after entity-consistency audit table covering website, README, package
   metadata, GitHub repo description, and any directory listing already live.
5. A structured-data validation run (schema.org validator or equivalent) for every page
   carrying schema, showing no orphaned schema block.

## Limitations to declare

- Content quality signals (rankings, citations, answer-engine inclusion) are outside this
  workstream's control and are not claimed as an outcome of publishing alone; that
  measurement is [W11](./W11-metrics-and-scorecard.md)'s job.
- Comparison pages describe competitors as of their stated verification date. They go stale
  as competitors ship; staleness is a known, ongoing maintenance cost, not a one-time task.
- The domain decision is out of this workstream's authority; content is built to be
  redirect-ready, not to force the decision.
- This workstream cannot make `/benchmarks/verified-delivery/` or the comparison pages'
  result-bearing claims true faster than W7 and W8 actually produce results — a page
  waiting on those dependencies stays unpublished, not padded with placeholder numbers.

## Follow-ups this job should file, not do

- A/B testing the homepage headline once there is enough traffic to measure it honestly.
- Localizing any page beyond English.
- A `/compare/` page for Conductor, once its review feature is verified against current
  docs with a date (deferred here because the source strategy notes Conductor's automated
  review already covers similar ground and the comparison needs care to stay honest).
- An `llms.txt` file, if ever revisited — explicitly not a priority per
  [Entity consolidation](#entity-consolidation).
