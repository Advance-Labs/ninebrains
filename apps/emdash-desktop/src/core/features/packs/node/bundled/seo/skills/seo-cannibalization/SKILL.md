---
name: seo-cannibalization
description: Find queries where two or more of a site's own pages compete against each other in search, splitting clicks and suppressing rankings. Use when someone asks about keyword cannibalization, overlapping or duplicate content, which of two similar pages to keep, or why similar pages both rank poorly. Requires the aeo-toolkit ga-gsc MCP server.
---

<!-- Bundled from Advance-Labs/aeo-toolkit skills/seo-cannibalization @ dc17e99. Copyright (c) 2026 Advance Labs Inc. Licensed under the Apache License 2.0. Unmodified except for this notice. -->

# Finding and resolving keyword cannibalization

Two pages ranking for one query is **not automatically a problem.** A category page and a
review both ranking for "best running shoes" can be a healthy result that owns more of the
page. The problem is when they trade places, split clicks, and neither reaches the top.

Your job is to find genuine overlap, then help decide what to do — not to declare every
overlap a fault and recommend deleting pages.

## Finding it

1. Call `list_gsc_sites` and confirm the property.
2. Call `gsc_cannibalization`. Start with the default 28 days and `minImpressions: 50`.

   Raise `minImpressions` on a large site until the list is reviewable. Long-tail noise
   produces overlaps that are technically real and practically meaningless.

3. Work down the returned groups. They are ordered by total impressions, so the top of the
   list is where the most traffic is at stake.

## Judging each group

For each group, look at the competing pages' positions and CTR together:

**Probably real cannibalization**
- Both pages sit in a similar position range (say 5-15) and neither breaks through
- The pages serve the same intent — two blog posts answering one question
- CTR is poor on both relative to their position

**Probably fine, leave it alone**
- One page clearly dominates and the other picks up a small tail
- The pages serve *different* intents for one ambiguous query (a product page and a support
  article for a query that means both things)
- One is deliberately targeting a different audience or funnel stage

**Say when you are not sure.** The data shows overlap; it cannot show intent. If the URLs do
not make the intent obvious, ask the user what each page is for rather than guessing.

## Choosing what to keep

`strongestPage` is the **best-ranking** page, and `strongestPageReason` states that. That is
deliberate: rank is the harder half to earn back, so a page at position 4 with fewer clicks
is usually a better consolidation target than one at position 28 with more.

Override this when you have a reason, and say why. Common legitimate overrides:

- The lower-ranking page is more useful, more current, or better converting
- The higher-ranking page is thin and ranks on domain strength alone
- One page has backlinks the other does not (which this data does not show — check with the
  backlink MCP server if it is connected)

## Recommending a fix

In rough order of preference:

1. **Consolidate** — merge the weaker page into the stronger one, 301 redirect the old URL.
   Best when both pages genuinely serve one intent.
2. **Differentiate** — rewrite one page to target a clearly different query. Best when both
   pages should exist but currently overlap.
3. **Deliberately de-target** — remove the competing terms from the weaker page, keep the
   page. Best when the weaker page has a non-search purpose.
4. **Do nothing** — a legitimate outcome, and often the right one.

Never recommend deleting a page outright without a redirect. Whatever equity it has is worth
keeping, and dropping a URL that has backlinks or is linked internally causes a worse problem
than the one being fixed.

## Reporting

Name the query, the pages, and the stakes:

> "running shoes" (4,200 impressions/28d) is split between /blog/best-running-shoes
> (position 11, 62 clicks) and /shop/running (position 6, 140 clicks). Both sit outside the
> top five. /shop/running ranks better and is the natural target; the blog post reads as
> the same intent rather than a genuinely different one.

Then the recommendation, and what you would want to confirm before acting on it.
