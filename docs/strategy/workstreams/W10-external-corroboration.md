# W10 — External corroboration

| | |
|---|---|
| **Lane** | L9 Corroboration and partners |
| **Model** | Sonnet |
| **Wave** | 3–5 |
| **Risk tier** | Standard, Critical for anything published under a partner's name |
| **Depends on** | [W6](./W6-team-mode.md), [W7](./W7-verified-delivery-bench.md), [W9](./W9-positioning-and-content.md) |
| **Blocks** | nothing — this is the terminal workstream |

## Intent

State it plainly: the largest current weakness is not feature depth. It is independent
evidence. Public search currently surfaces Ninebrains' own website, its GitHub repository,
and Advance Labs' own pages more readily than any independent review. A recommendation
engine cannot responsibly rank a product first on first-party claims alone, and it should
not — that is the same standard the product itself applies to a coding agent's own claim
that its work is done.

This workstream's job is to make independent, verifiable, third-party evidence exist. It
does not write that evidence itself where a first-party voice would undermine it; it
creates the conditions — partners, kits, permission, events — for other people to write it.

## The design-partner program

Recruit **ten teams** matching the ICP in
[00-north-star.md](../00-north-star.md#ideal-customer-profile): 2–10 developers, already
running Claude Code, Codex, or OpenCode, 1–10 active repositories, tests and CI in place,
local-first requirements. Run each for **30 days**. Optimize for repeat usage and
publishable evidence, not revenue — a partner that pays nothing but publishes a detailed,
honest account is worth more to this workstream than one that pays and stays silent.

### Recruitment brief

Use for outreach to prospective partners. CASL rules in
[CASL and outreach compliance](#casl-and-outreach-compliance) below apply to every contact.

> Subject: Design partner for a verification-first coding-agent workbench
>
> Hi [name]. I am building Ninebrains, an open-source tool that runs Claude Code and Codex
> in parallel worktrees and blocks a job from counting as done until independent gates and
> a fresh reviewer verify it. I am looking for ten small engineering teams to run it for 30
> days, tell me honestly where it breaks, and let me publish what you found, good or bad.
> No cost, no obligation to keep using it. If your team runs Claude Code or Codex and has
> more parallel work than review capacity, I would like to talk.

Zero em dashes in that copy, subject line included, as with every prospect-facing example
in this document.

### Metrics each partner agrees to provide

| Metric | What it establishes |
|---|---|
| Tasks attempted and accepted | Real usage, not a demo |
| Gate-failure distribution | Whether gates catch real problems or just add friction |
| Reviewer time before and after Ninebrains | The north-star metric's human-side input |
| Defects found before PR | Whether verification moves left, not just adds a step |
| Jobs escalated instead of incorrectly completed | Escalation accuracy in a real environment |
| Agent/model combinations used | Coverage beyond our own testing matrix |
| Quotes explaining why the team continued or stopped | The only qualitative signal that reads as honest |

### 30-day cadence

| Day | Action |
|---|---|
| 0 | Onboarding call. Confirm ICP fit, set up the repo, agree what may be published. |
| 3 | Check that at least one job has completed a full gate cycle; unblock if not. |
| 7 | First metrics check-in: tasks attempted, gate-failure distribution so far. |
| 14 | Midpoint interview: what changed about their review workflow, what broke. |
| 21 | Second metrics check-in; flag candidates for a co-authored case study. |
| 30 | Exit interview (below) and a decision on continuing, unprompted. |

### Exit interview structure

Same six questions for every partner, asked the same way, so answers are comparable and so
a partner who stopped using Ninebrains is not asked softer questions than one who
continued:

1. What did you accept from Ninebrains that you would not have accepted without it?
2. What did a gate block that should have been blocked, and what did a gate block that
   should not have been?
3. How did reviewer time change, in your own estimate, not ours?
4. Will you keep using it after this program ends? Why or why not?
5. What would you tell another team in your position, in your own words?
6. May we publish your metrics, your quotes, and your name? Which of those specifically?

Record the answer to question 6 explicitly, in writing, before publishing anything. A team
that declines being named is still counted in the aggregate scorecard metrics, anonymized;
their quotes are not used even unattributed unless they separately agree to that.

## The hard rule: partner-authored case studies

At least **three** case studies must be authored or co-authored by the users, not only by
Advance Labs. This is non-negotiable because independent reports and hands-on walkthroughs
matter precisely because the current category leaders already appear in third-party
recommendation articles and Ninebrains does not yet.

What we may and may not edit in a partner-authored piece:

**May do:**

- Fix factual errors about Ninebrains' own behavior, with the partner's sign-off on the fix.
- Suggest structure (a beginning, the metrics, a plain verdict) if asked.
- Offer the evidence bundle, benchmark, or metrics data as source material.
- Ask clarifying questions that help the partner write a clearer piece.
- Copyedit for grammar, with the partner's final approval before anything publishes.

**May not do:**

- Add a claim the partner did not make.
- Remove a criticism because it is unflattering.
- Change the partner's verdict, quote, or framing of whether they would keep using it.
- Publish before the partner has approved the final text.
- Present Advance Labs' edits as the partner's own words without their review.

A partner-authored piece that Advance Labs edited past what this section allows is not a
case study. It is first-party content wearing a partner's name, and it is exactly the kind
of evidence a recommendation engine is right to discount.

## Corroboration channels

Each channel from the strategy document, with a concrete action and how success is
measured. A channel with no defined success signal is not tracked, and untracked work does
not count toward the acceptance criteria below.

| Channel | Concrete action | Success signal |
|---|---|---|
| Curated agent-orchestrator repositories and open-source directories | Submit Ninebrains with accurate, dated metadata to lists such as `awesome-agent-orchestrators`-style directories | Listing accepted and live, checked monthly for accuracy |
| A launch with reproducible demo repositories | Publish at least three demo repos with a real brief, an intentionally failing first attempt, and the evidence bundle that shows the retry, rather than a polished video alone | A stranger can clone the repo and reproduce the same gate failure and retry |
| Independent reviewers with a benchmark kit | Give reviewers the Verified Delivery Bench kit from [W7](./W7-verified-delivery-bench.md) and explicit written permission to publish failures | At least one published independent review includes a failure or limitation we did not choose to highlight |
| Guest technical articles | Pitch articles about the evidence specification and the plan–execute–verify architecture, not promotional listicles | Article published on a domain we do not own, with no editorial control retained by Advance Labs |
| Talks and community presence | Present the benchmark and schema at engineering communities, podcasts, meetups, newsletters | A recording, transcript, or write-up exists on a host-controlled channel, linkable and dated |
| Partners publishing their own evidence | Ask design partners to publish their own configuration and a real evidence bundle from their repo | At least one partner-hosted page or repo containing a Ninebrains evidence bundle they authored the surrounding context for |
| Integration examples | Working, documented examples with GitHub Actions, CodeRabbit, Playwright, Semgrep, Snyk, Supabase branches, and common CI providers | Each integration has a runnable example repo and a doc page, not just a claim that it "works with" the tool |
| Answering technical discussions | Respond to relevant threads (forums, issue trackers, Q&A sites) with useful methodology first, mentioning Ninebrains only where it is the honest answer | The response would still be useful if every mention of Ninebrains were deleted from it |

The last row is a hard filter on quality, not a suggestion: if a response reads as an ad
with the product name removed, it is not published under this workstream.

## The quality bar

Ten substantive technical references from independent domains are worth more than one
hundred near-duplicate "best tools" posts Advance Labs generates itself. This is stated
explicitly and it is binding: **generating near-duplicate "best coding agent tools" posts
under Advance Labs' own byline, on Advance Labs' own domains, is forbidden** for this
workstream. That volume of first-party content is exactly the pattern that currently makes
Ninebrains over-represented by its own sources and under-represented by anyone else's, and
more of it does not fix that — it makes the imbalance worse.

A "substantive technical reference" for the purpose of this workstream's targets means:

- Published on a domain Advance Labs does not control.
- Written by someone who used the product, read the spec, or evaluated the benchmark —
  not someone summarizing our own marketing copy.
- Specific enough to cite a real behavior, number, or limitation, not a generic feature
  list.

## Agent Verification Week

A public event, described in the strategy's 61–90 day roadmap.

**What a participant does:** brings a real repository and a real bounded task (their own,
not a Ninebrains-supplied demo), runs it through Ninebrains with gates on, and lets the run
produce whatever evidence bundle results — verified, blocked, or inconclusive.

**What they publish:** the evidence bundle, unedited, alongside their own short account of
what happened. Participants are told up front that the bundle publishes regardless of
outcome; that condition is part of registering, not a surprise afterward.

**How we handle a submission that makes us look bad:** we publish it. A blocked run, a
false-positive gate, an inconclusive result caused by a Ninebrains bug — all of it
publishes with the same visibility as a clean run. This is the same rule
[03-definition-of-done.md](../03-definition-of-done.md#what-verified-means-for-a-program-deliverable)
applies internally: `inconclusive` is a legitimate, respectable outcome, and a swarm or an
event that never surfaces one is not being careful, it is curating. Suppressing an
unflattering submission would be a claims-gate violation applied to an entire event, and it
would destroy exactly the corroboration credibility this workstream exists to build.

## CASL and outreach compliance

Every outreach action under this workstream follows Advance Labs' standing CASL rule:
harvest contacts only from a company's own website or their own listing (a GitHub profile,
a company directory entry they control, a public conference speaker page), never from a
scraped or purchased list. Log where each contact was found, when, and why it is relevant
to Ninebrains — the design-partner ICP match, a relevant public talk, an open-source
maintainer role. This log is part of the evidence for this workstream's own acceptance
criteria, not a separate compliance side-task.

Prospect-facing email copy carries zero em dashes, subjects included. This applies to every
draft this workstream writes for outreach — the recruitment brief above, follow-ups,
introductions to press or podcast hosts, and anything else sent to a person who has not
already opted in to Ninebrains communication. Internal prose, including this document, is
not subject to that restriction.

## Outcome targets versus lane criteria

Ten recruited partners, five independent reviews, and three partner-authored case studies
are **outcome targets**. They depend on other people saying yes. A lane cannot be held to
them, and a program that treats them as pass/fail criteria will either stall or start
counting weak participants to clear a number.

L9's lane criteria are the things L9 controls: the briefs sent, the kits shipped, the
permissions granted, the cadence held, the compliance log kept. The outcomes are tracked on
the scorecard in [W11](./W11-metrics-and-scorecard.md) and reported honestly, including when
they are missed.

## Acceptance criteria

- [ ] Ten design partners recruited, matching the ICP in
      [00-north-star.md](../00-north-star.md#ideal-customer-profile), each with a logged
      recruitment source (site or listing, date, reason).
- [ ] Each active partner has completed at least the day-0 onboarding and day-30 exit
      interview; partners who drop out mid-program are recorded with why, not silently
      dropped from the count.
- [ ] The seven metrics in
      [Metrics each partner agrees to provide](#metrics-each-partner-agrees-to-provide) are
      collected for every partner who completes the program, anonymized by default per
      their exit-interview answer to question 6.
- [ ] At least three case studies are authored or co-authored by partner users, published
      with their explicit sign-off, and satisfy every rule in
      [The hard rule: partner-authored case studies](#the-hard-rule-partner-authored-case-studies).
- [ ] At least three published demo repositories exist with a real brief, a failing first
      attempt, and the evidence bundle showing the retry, independently reproducible by a
      stranger.
- [ ] At least five independent technical reviews or livestreams are arranged and at least
      one includes a published failure or limitation not chosen by us.
- [ ] Submissions are filed to relevant curated agent-orchestrator repositories and
      open-source directories, with listing status tracked monthly.
- [ ] At least one partner has published their own configuration and a real evidence
      bundle from their own repository, hosted by them.
- [ ] Working, documented integration examples exist for at least four of: GitHub Actions,
      CodeRabbit, Playwright, Semgrep, Snyk, Supabase branches, and common CI providers.
- [ ] "Agent Verification Week" runs at least once, publishes every submitted evidence
      bundle regardless of outcome, and at least one published bundle is `blocked` or
      `inconclusive`.
- [ ] Zero posts of the "best AI coding tools" listicle form published under any Advance
      Labs byline or domain during the program, counted across the whole organisation rather
      than scoped to this workstream. Verified by listing every URL published on
      `advancelabs.dev` and the Ninebrains product domain in the period and checking each
      against the form. "Scoped to this workstream's counted output" was self-scoping and
      unfalsifiable; this is not.
- [ ] Every prospect-facing email draft produced by this workstream contains zero em
      dashes, subjects included, verified by a text scan before send.
- [ ] Outreach contact log exists and every entry names the source site or listing, the
      date, and the relevance reason, per the CASL rule above.
- [ ] The strategy's recommendation-metric targets — 10 substantive independent domains
      describing Ninebrains as verification-first, 5 independent hands-on reviews, 25
      public repositories containing Ninebrains evidence — are tracked with a running
      count and a citation list, not asserted as met without one.
- [ ] No published corroboration content claims a single AI answer as a stable ranking; any
      recommendation-query audit this workstream feeds records exact query, mode, location,
      and date, per the claims gate.

## Evidence required

1. The partner recruitment log: ten rows, each with ICP-fit notes, recruitment source, and
   date.
2. Collected metrics per partner, with the anonymization state (public, anonymized,
   withheld) recorded per their own exit-interview answer.
3. The three-plus case studies, each with the partner's written sign-off on the final text
   attached or linked.
4. A running citation list of independent domains, reviews, directory listings, and
   repositories containing Ninebrains evidence, each with a URL and the date it was
   checked.
5. The Agent Verification Week submission set, including at least one non-`verified`
   outcome, published unedited.
6. The CASL outreach log covering every contact made under this workstream.

## Limitations to declare

- **Self-selection bias in partners.** Ten teams who agreed to a 30-day design-partner
  program are not a random sample of the ICP. They are likelier to be curious, tolerant of
  early-release rough edges, and favorably disposed to begin with. Report this alongside
  every partner metric; do not present partner results as representative of the broader
  ICP without saying so.
- **We cannot control what reviewers conclude, and must not try.** An independent review
  arranged through this workstream is independent only if its conclusions are not shaped by
  us beyond providing the benchmark kit and permission to publish failures. A review whose
  outcome we influenced is not evidence of anything except our own influence, and using it
  as if it were would be exactly the kind of first-party-disguised-as-third-party content
  this workstream exists to move away from.
- Aggregate scorecard targets (10 domains, 5 reviews, 25 repositories) are counts we can
  report honestly at any point in time; they are not guarantees this workstream can force
  to a specific number by a specific date, because the content that satisfies them is, by
  definition, written by people outside our control.
- Case-study and review recruitment depends on [W7](./W7-verified-delivery-bench.md) having
  real benchmark results and [W6](./W6-team-mode.md) having a usable team surface; a partner
  onboarded before either exists has a materially worse experience, which is itself a
  reason this workstream sits in Wave 3–5, not earlier.

## Follow-ups this job should file, not do

- A paid or incentivized reviewer program, if unpaid recruitment does not reach the review
  target — a decision for L0, not this lane.
- A recurring (not one-time) Agent Verification Week cadence.
- Translated or localized outreach for non-English-speaking prospective partners.
- A formal partner advisory group beyond the initial ten, once the program's value is
  established.
