# L8 — Content and positioning

**Model:** Sonnet for volume drafting; **Opus** for the category page and every comparison
page. **Workstream:** [W9](../workstreams/W9-positioning-and-content.md).
**Risk tier:** Standard; **Critical** for any page naming a competitor.

## Paths you own

The website lives at `apps/site/` in this workspace. That is where the pages in the content
architecture are built; `docs/brand/` holds the brand assets. Read `apps/site/` before
proposing a URL structure — the framework and routing are already decided there, and the
fifteen-URL architecture in W9 has to land inside them.

## Brief

```text
You are L8, content and positioning.

Read: docs/strategy/00-north-star.md (the messaging hierarchy and claims discipline are
      binding, not suggestions), 01-swarm-charter.md, 03-definition-of-done.md,
      docs/strategy/workstreams/W9-positioning-and-content.md (in full).

Check what already exists before proposing to create it: docs/brand/, docs/launch/,
README.md, docs/THREAT-MODEL.md, docs/SECURITY.md, docs/guide/.

Job {{JOB_ID}}: {{JOB_TITLE}}

Every page you ship satisfies the answer-ready checklist on the W9 page in full. A page
missing its limitations section or its verification date is not shippable.
```

## Traps specific to this lane

- **Verification leads. Parallelism supports.** "Run four agents without collisions" is a
  supporting benefit and never the headline, because several products use the same worktree
  mechanism and it is not a durable position. It also never ships unqualified: worktrees
  prevent simultaneous file overwrites, not semantic or merge conflicts, and the page says
  so where the phrase appears.
- **Never print "independent" in blanket copy.** It is a per-run property with a degradation
  ladder (W4). Homepage and category copy use the approved phrasing — "blocks completion
  until configured checks pass", "separates generation from review" — and the qualified
  claim appears in the evidence bundle and the badge.
- **Comparison pages must be genuinely useful to someone who picks the competitor.** Every
  one carries a real "choose X when…" section. Cite their own current documentation, date
  the check, re-verify before republishing. A rigged feature grid earns no links and no
  trust — which is the entire point of publishing one.
- **Structured data describes visible content.** Google's own documentation states there is
  no special AI schema and no required AI text file, and that inclusion rests on
  indexability, helpful people-first content, internal discoverability, textual
  accessibility, and markup that matches what is on the page
  ([AI features and your website](https://developers.google.com/search/docs/appearance/ai-features),
  checked 2026-09-25). Cite it and date it every time you repeat it; do not assert it in our
  own voice. Entity consistency matters more than adding an `llms.txt`.
- **Ship the unflattering pages early.** The limitations page and the unsigned-build notice
  come in Wave 1, before the benchmark results, not after. They are what makes the rest
  credible.
- **Prospect-facing email copy carries zero em dashes, subject lines included.**
