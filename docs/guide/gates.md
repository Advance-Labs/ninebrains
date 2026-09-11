---
title: Verification gates
description: >-
  Gates are a second, independent check before an agent's work counts as done. The built-in gates,
  how rigor settings choose them, what "unverified" means, and how failed work is sent back.
---

A **gate** is a check that runs after a lane says its job is finished, and before the work reaches
you. The promise is simple: **no agent grades its own work.** Gates run tests, look at the page,
check citations, or hand the diff to a separate reviewer that cannot change anything.

The gate logic ships in [`@emdash/gates-core`](../../packages/gates-core/README.md).

## What happens when a lane finishes

<!-- VERIFY-AFTER-P2 -->
1. The lane calls `complete_job`. The job moves to **verifying**.
2. The gate runner runs every gate that applies to the job, each with its own timeout.
3. If all pass, the job is **done**.
4. If any fails, the feedback goes to the lane's inbox and the job goes back to **running**. The
   lane fixes the problem and completes again.
5. On the third failure, the job is **blocked** and you are notified.

Evidence (logs, screenshots, reviewer replies) is stored under
`<userData>/ninebrains/evidence/<jobId>/<attempt>/`, never inside the worktree.
<!-- /VERIFY -->

The retry rule:

| Result | Attempt | Decision |
|---|---|---|
| passed | any | done, verified |
| unverified | any | done, **not** verified |
| failed | 1 or 2 | retry, with the feedback |
| failed | 3 | blocked, with the last feedback |

Feedback is written for the agent. It covers only the failures, in gate order, up to 1,500
characters per gate.

## Passed, failed and unverified

- Every gate that applies must pass.
- A gate that throws, times out, returns a malformed result or is cancelled counts as a **failure**.
- A job that no gate applies to (for example, rigor set to 0) is **unverified**. It still leaves
  verifying, but it is never shown or stored as passed. The app marks it with an "unverified"
  badge.

## Rigor

Two settings, each 0 to 10, decide which gates attach to a job by default:

| Gate | Attached when | Job kinds |
|---|---|---|
| `tests` | testing ≥ 3 | code, ui |
| `fact-check` | testing ≥ 3 | research, seo |
| `screenshot` | testing ≥ 5 | ui |
| `security-review` | security ≥ 6 | code, ui |
| `reviewer` | testing ≥ 7 | all |

This is the floor. A job's creator can add gates on top; neither a lane nor the Brain can take
them away. Packs add their own defaults, such as the SEO pack's `seo-evidence` gate.

<!-- VERIFY-AFTER-P2 -->
Set rigor globally in Settings, and override it per project.
<!-- /VERIFY -->

## The built-in gates

### tests

Runs the project's test command in the worktree. It passes on exit code 0 and fails on a timeout.
The last 200 lines are kept as evidence, and the last 40 go into the feedback.

This is the only gate that runs the lane's own code, and a lane can rewrite its test script. So
the command comes only from the project setting you chose, never from the job or a worktree file.
It runs with a scrubbed environment (no Ninebrains tokens, pack secrets or provider keys), its
whole process group is killed on timeout, and output is capped at 1 MiB. On macOS it also runs in
a sandbox.

### screenshot

Captures the lane's preview at 1440, 768 and 390 px wide. Console errors, failed same-origin
requests, or a difference from the baseline above 1% fail the gate before any reviewer is asked.
If the page is clean, a separate reviewer looks at the screenshots and gives a JSON verdict.

<!-- VERIFY-AFTER-P2 -->
The app captures the lane's own browser through the Chrome DevTools Protocol, attached only to that
lane's registered browser. If DevTools is open on the same browser, the capture fails and the gate
reports it. Unattended runs use an offscreen window on the same browser partition.
<!-- /VERIFY -->

### reviewer and security-review

The app makes a **disposable checkout** of the job's result, computes the diff there, and sends the
job, the diff and the evidence so far to a fresh reviewer run whose working directory is that
checkout. The reviewer has Read, Grep and Glob only: no shell, no writes and no network. It does
not run tests itself; the tests gate's log reaches it as evidence. The checkout is deleted
afterwards, whatever the result.

The reply must be a single JSON object of the form `{ pass, issues[] }`. A reply of `pass: false`
with no issues counts as malformed, because it gives the worker nothing to fix.

<!-- VERIFY-AFTER-P2 -->
When both CLIs are installed, the reviewer can use a different provider from the author, for
example Codex reviewing Claude's work.
<!-- /VERIFY -->

### fact-check

For research and SEO jobs. The lane writes `claims.json` in its worktree:

```json
{
  "claims": [
    {
      "text": "The API allows 100 requests per minute.",
      "citations": [
        { "sourceId": "https://example.com/docs/limits", "quote": "100 requests per minute" }
      ]
    }
  ]
}
```

The gate fetches each cited URL through an SSRF-safe fetcher and checks the quote against the
page's text. Each claim comes out:

| Verdict | Meaning |
|---|---|
| grounded | The quote is on the page |
| imprecise | Something real was cited, but not exactly. Passes with a warning |
| invented | Nothing fetched backs it, including a URL that could not be fetched |
| uncited | The claim has no citation |

Any invented or uncited claim fails the gate. An empty `claims.json` fails too, because a research
job with no claims most likely skipped the step. Source text pasted into `claims.json` is ignored,
since an agent could forge it.

## Why a reviewer cannot be talked into a pass

Everything the worker or the web controls (the job text, the diff, file names, page text, claims)
goes into the reviewer's prompt inside a block with a random delimiter made for that call. The
content cannot close the block, and the prompt says the block is data, not instructions.
Deterministic failures, such as console errors, failing tests or invented citations, fail the gate
whatever the reviewer replies.
