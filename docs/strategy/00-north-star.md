# North star

Condensed from the strategy document of 2026-09-25. This page holds the decisions. It does
not restate the market analysis; it states what those decisions bind us to.

## Category

> Ninebrains is the open-source, verification-first agent workbench for small AI-native
> product teams.

Two phrases, used deliberately:

- **Verified multi-agent development** — the branded category we are trying to create.
- **Open-source coding-agent orchestrator with configured verification gates** — the
  literal descriptor that matches queries people already type. The source strategy wrote
  *independent* here; blanket metadata ships to every install, including the single-provider
  machine that can never reach W4's `full` independence level, so the descriptor uses the
  word the product can always honour. The entity table below uses the shorter
  `verification-first coding-agent orchestrator`; keep the two consistent. Use this in metadata,
  package descriptions, directory listings, and page titles.

We are **not** competing to be the best general-purpose agentic IDE. That category is held
by editors (Cursor) and terminal orchestrators (Superset, Pane, Conductor-style tools).

## The defensible claim

Parallelism is commoditizing. Git worktrees are a documented, widely copied mechanism.
"Four agents at once" is not a moat.

The claim that is ours:

> **Parallel agents whose work does not count until independent evidence verifies it.**

The enforced loop, in full, is the product:

```
job DAG → isolated worktree execution → policy-selected gates → evidence bundle
        → bounded retry → block or escalate → human decision
```

Competitors have pieces. Google's announcement of Conductor's Automated Review describes it
as going "beyond planning and execution into validation," checking code against the plan,
project guidelines, tests, and basic security
([Google Developers Blog](https://developers.googleblog.com/conductor-update-introducing-automated-reviews/),
checked 2026-09-25). Our distinction is the *whole enforced loop*, with evidence as a
portable artifact rather than an internal status screen.

Re-verify that sentence against Conductor's current documentation before it appears on any
public page. A competitor claim without a link and a date is a blocking finding under
[`03-definition-of-done.md`](./03-definition-of-done.md#claims-gate), and this one is the
template for how every other competitor claim in this program should be written.

## Ideal customer profile

A small AI-native SaaS or product team:

- 2–10 developers, no dedicated platform-engineering group.
- Already running Claude Code, Codex, or OpenCode — often more than one.
- 1–10 active repositories.
- Has tests and CI; local workflows are unevenly documented.
- Wants more parallel output but cannot absorb proportionally more review.
- Needs local-first execution: repos, credentials, or customer code cannot go to a hosted
  coding platform.
- Values open source and provider choice.

Chosen over solo power users because team pain makes verification *valuable* rather than
merely interesting. Chosen over enterprise because SSO, policy centralization, audit
retention, and procurement would delay adoption past the wedge window.

## Four jobs to optimize for

Onboarding, examples, and templates target these and nothing else:

1. **Feature decomposition** — one brief into independent UI, API, test, docs, review jobs.
2. **Backlog clearing** — several bounded bugs, test additions, dependency bumps in parallel.
3. **Pre-PR verification** — reproducible evidence required before a branch reaches a human.
4. **Cross-discipline delivery** — coding, SEO, research, security, accessibility policy
   applied through explicit packs and gates.

Do not lead with "nine agents." Small teams do not want more agents. They want **more
accepted changes per engineer-hour without more escaped defects or review fatigue**.

## Messaging hierarchy

**Headline:** Ship agent-written code you can prove.

**Subheadline:** Ninebrains plans work across Claude Code, Codex, and OpenCode, runs each
job in an isolated worktree, and **blocks completion until configured checks pass** — tests,
screenshots, policy checks, and review evidence — **separating generation from review**.

> **Deviation from the source strategy, on purpose.** The strategy's draft subheadline read
> "blocks completion until *independent* tests, screenshots, policy checks, and review
> evidence pass." Homepage copy ships to every install, including the single-provider
> machine that [W4](./workstreams/W4-independent-review.md) says can never reach the `full`
> independence level. Printing "independent" there would break the strategy's own honest-claims
> rule in the strategy's own headline. The two approved phrasings above say the true thing
> and say it more precisely. Independence is claimed per run, in the evidence bundle and the
> badge, where it can be qualified — never in blanket copy.

**Primary CTA:** `Run a verified job`
**Secondary CTA:** `Inspect a real evidence bundle`

**Trust strip:** `Open source · Apache-2.0 · Local first · No telemetry · macOS, Windows, Linux`

**Supporting line:** Local-first and source-available under Apache-2.0. Ninebrains preserves
the evidence, failed attempts, and remaining risks, and reduces unverified agent output
reaching human review.

"Run four agents without collisions" stays as a supporting benefit. It never leads, and it
never ships unqualified: worktrees prevent simultaneous file overwrites, not semantic or
merge conflicts, and the copy must say so at the point of use.

All five approved phrasings above are the load-bearing ones from
[the claims discipline](#claims-discipline). They are used here, not merely listed there.

## North-star metric

**Verified accepted changes per human review hour.**

Not tokens. Not agent count. Not task-completion claims. Every scorecard metric in
[W11](./workstreams/W11-metrics-and-scorecard.md) must ladder to this.

## Claims discipline

These are binding on product copy, docs, commit messages, PR descriptions, release notes,
and anything an agent in this swarm writes.

**Banned until measured and published:**

| Banned | Why |
|---|---|
| "Proves the code is correct" | Gates check configured properties, not correctness |
| "Eliminates bugs" | Unfalsifiable and false |
| "No collisions", unqualified | Worktrees prevent simultaneous file overwrites, not semantic or merge conflicts |
| "Independent" where the reviewer shares the builder's context, model, or mutable worktree | Independence has a definition in [W4](./workstreams/W4-independent-review.md); use it |
| "Secure", justified only by local execution or absent telemetry | Neither is a security property |
| "Best", without a dated methodology and named comparison set | Unsourced superlative |

**Use instead:**

- "Blocks completion until configured checks pass."
- "Preserves the evidence, failed attempts, and remaining risks."
- "Separates generation from review."
- "Reduces unverified agent output reaching human review."
- "Local-first and source-available under Apache-2.0."

A claims violation is a blocking review finding, not a style note. See
[`03-definition-of-done.md`](./03-definition-of-done.md#claims-gate).

## What we do not build during the wedge

- A proprietary foundation model.
- A replacement for VS Code or JetBrains.
- Support for every agent before the evidence layer is excellent. Polish exactly three:
  Claude Code, Codex, OpenCode.
- Enterprise SSO and administration before small-team retention exists.
- A hosted agent cloud.
- A marketplace of dozens of low-quality packs.
- "100 agents" marketing that worsens the review bottleneck.
- Automatic merging based solely on AI review.
- Generic productivity dashboards without accepted-change and review-burden metrics.

An agent that finds itself building any of the above has drifted. Stop and escalate.

## Entity consistency

One identity everywhere — website, repository, package metadata, directories, profiles:

| Field | Value |
|---|---|
| Product name | `Ninebrains` |
| Descriptor | `verification-first coding-agent orchestrator` |
| Organization | `Advance Labs Inc.` |
| Canonical repository | `github.com/Advance-Labs/ninebrains` |
| License | `Apache-2.0` |
| Platforms | `macOS, Windows, Linux` |

A dedicated branded product domain is preferred over treating `ninebrains.runs-on.dev` as
permanent, because `runs-on.dev` is a separate Advance Labs product. If a dedicated domain
is adopted, keep the subdomain as a 301 redirect. Entity consistency matters more than
adding an `llms.txt`; crawlability and reliable content remain the documented foundation.

## The sentence we are trying to make automatic

> Use Cursor to edit, Superset or Pane to supervise many terminals, and **Ninebrains when
> agent work must not count until configured checks pass and a fresh reviewer has seen it.**

The source strategy's version of this sentence ended "must be independently verified before
the team accepts it." It is the sentence we most want repeated, which is exactly why it
cannot contain a word that is only true for some configurations. The version above is the
one we can defend every time it is quoted back at us.
