---
name: seo-traffic-drop
description: Diagnose why organic search traffic dropped, using the site's own Google Search Console data. Use when someone reports traffic is down, asks what caused a drop, wants to know which pages lost clicks, or asks whether a decline is a ranking problem. Requires the aeo-toolkit ga-gsc MCP server.
---

<!-- Bundled from Advance-Labs/aeo-toolkit skills/seo-traffic-drop @ dc17e99. Copyright (c) 2026 Advance Labs Inc. Licensed under the Apache License 2.0. Unmodified except for this notice. -->

# Diagnosing a search traffic drop

The goal is a specific, evidenced answer: **which pages lost the clicks, and what kind of
problem it is.** "Traffic is down 20%" is not an answer. "Four pages are 80% of the loss and
all four slipped from page one" is.

## Before you start

Call `list_gsc_sites` and confirm which property to use. Do not guess the URL format —
`https://example.com/` and `sc-domain:example.com` are different properties with different
data, and picking the wrong one silently returns an empty or partial answer.

Ask for the two periods if the user has not given them. If they say something vague like
"since last month", propose two concrete equal-length ranges and confirm before running.

**Windows must be equal length and should align on weekdays.** Comparing 30 days to 28 days
manufactures a 7% drop out of nothing. Comparing a period containing five Mondays to one
containing four does the same, more subtly.

## The diagnosis

1. **Attribute the change.** Call `gsc_traffic_drop` with the two ranges, `dimension: 'page'`.

   Read `totalClicksLost` and `totalClicksGained` before the contributor list. If both are
   large, the site did not simply decline — traffic moved, and that is a different story
   with a different fix.

2. **Find the shape.** Look at `shareOfDecline` across the contributors.

   - A few pages carrying most of the decline is a **page-level problem**: those specific
     pages lost rankings, were changed, or were deindexed.
   - The decline spread thinly across many pages is a **site-level problem**: an algorithm
     update, a technical regression, or a manual action.

   These lead to completely different investigations. Establish which one you are in before
   going further.

3. **Separate ranking loss from demand loss.** For the top contributors, compare
   `impressionsDelta` against `positionDelta`.

   | Impressions | Position | Reading |
   |---|---|---|
   | Down | Worse (positive delta) | Lost rankings — competitors, or a content problem |
   | Down | Flat | Fewer people searching, or the SERP changed above you |
   | Flat | Flat, clicks down | An AI Overview or a new SERP feature is absorbing the clicks |

   The third row is increasingly the answer and is invisible if you only look at clicks.

4. **Check the queries, but only for the affected pages.** Re-run `gsc_traffic_drop` with
   `dimension: 'query'`. If the lost queries are all one topic, that is a content or intent
   problem. If they are scattered, it is more likely technical or sitewide.

## Reporting

Lead with the shape and the evidence:

> Clicks fell 2,400 (-31%) between the two periods. Four pages account for 78% of that.
> All four lost rank (average position 4.2 → 11.6), and impressions fell with them, so this
> is lost rankings rather than lost demand. The affected pages are all in /guides/.

Then give the next step, and be honest about what the data cannot tell you.

## What this data cannot answer

Search Console shows what happened, never why. It does not know about algorithm updates,
your deploys, your competitors' publishing, or seasonality. Two things follow:

- **Always check whether the drop lines up with a known event** — a release, a migration, a
  redesign, a robots.txt change. Ask the user; the data will not volunteer it.
- **Never assert a cause you cannot see in the numbers.** "This correlates with a rankings
  loss on these four pages" is supportable. "Google's update hit you" is a guess unless the
  dates line up and you say so as a hypothesis.

Position is a **weighted average across every impression**, so a page ranking 3rd for one
query and 40th for another does not "rank at 21". Treat large position swings on
low-impression pages with suspicion — they are usually a change in which queries matched,
not a change in ranking.
