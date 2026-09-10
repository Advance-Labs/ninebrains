---
name: seo-content-decay
description: Find pages quietly losing search traffic before they fall off page one, and decide which are worth refreshing. Use when someone asks which content needs updating, what to refresh, whether pages are declining, or wants a proactive content-maintenance list. Requires the aeo-toolkit ga-gsc MCP server.
---

<!-- Bundled from Advance-Labs/aeo-toolkit skills/seo-content-decay @ dc17e99. Copyright (c) 2026 Advance Labs Inc. Licensed under the Apache License 2.0. Unmodified except for this notice. -->

# Detecting content decay

Pages rarely collapse overnight. They bleed traffic over weeks, and by the time it shows up
in a monthly report the rankings are usually gone. The point of this skill is to catch that
while the page is still on page one, when a refresh still works.

## Finding candidates

1. Call `list_gsc_sites` and confirm the property.
2. Call `gsc_decay`. The defaults (28-day windows, 100 baseline impressions, 20% decline) are
   a reasonable start.

   - **Short windows are noisy.** A 7-day window will surface normal week-to-week variance as
     decay. Prefer 28 days or more unless investigating something specific.
   - **Raise `minDeclinePct` if the list is too long**, rather than cutting it arbitrarily.
     A shorter list of worse cases is more useful than a truncated list of mild ones.

The tool compares the recent window against the equal-length window immediately before it,
with no overlap.

## Reading the results

`lostRank` is the field that matters most:

- **`lostRank: true`** — clicks down *and* position slipped. Competitors are outranking the
  page, or its content has aged out of relevance. This is the actionable case and is where a
  refresh pays.
- **`lostRank: false`** — clicks down at flat rank. The page is still ranking where it was,
  so rewriting it will not help. Look instead at seasonality, a SERP layout change, an AI
  Overview absorbing clicks, or falling demand for the query.
- **`lostRank: null`** — no comparable position, usually because the page drew no impressions
  in one window. Check whether it was deindexed, redirected, or newly published rather than
  treating it as decay.

Confusing the first two wastes the most time. Rewriting a page that never lost rank is work
that cannot possibly fix the problem.

## The seasonality trap

**Search Console cannot distinguish decay from seasonality, and neither can this skill.** A
tax guide declining in May is not decaying. Before recommending work:

- Ask whether the topic has an annual cycle
- Where it might, compare against the *same window last year* instead of the previous window,
  using `gsc_traffic_drop` with explicit year-ago ranges
- If you cannot rule seasonality out, say so and let the user decide

Presenting a seasonal dip as decay is the fastest way to lose trust in the whole report.

## Prioritising

Not every decaying page deserves a refresh. Rank candidates by:

1. **Baseline traffic** — `impressionsBefore` and `clicksBefore`. A page that was worth 800
   clicks/month justifies more work than one worth 20.
2. **How far it has fallen.** A page at position 8 (still page one) is worth more than one at
   40, where recovery means outranking everything in between.
3. **Whether the topic still matters** to the business. The data cannot tell you this; ask.

A page that lost 90% of a tiny number is usually noise. Say so instead of padding the list.

## Recommending

Be specific about *why* a page is likely declining and what the refresh should address.
"Update this post" is not actionable. Useful versions look like:

> /guides/pricing-strategy: 1,240 → 310 clicks (-75%), position 4.1 → 14.8 over the last 28
> days. Rank loss, not seasonality — it declined through a period when the rest of /guides/
> held steady. Worth a refresh; check what now ranks in the top five and what it covers that
> this does not.

If the tool returns nothing, that is a real and useful result. Report it plainly rather than
lowering thresholds until something appears.
