---
title: Verification gates
description: >-
  Gates are a second, independent check before an agent's work counts as done. The built-in gates,
  how rigor settings choose them, what "unverified" means, and how failed work is sent back.
---

A **gate** is a check that runs after a lane says its job is finished, and before the work reaches
you. The promise is simple: **no agent grades its own work.** Gates run tests, look at the page,
check citations, or hand the diff to a separate reviewer that cannot change anything.

> **Before your first job:** at the default settings, every job the Brain creates gets the tests
> gate, and the tests gate needs a test command for the project. Set one in **Settings → Gates →
> Tests**. Without one, the job is blocked straight away. See [Test command](#test-command).

## What happens when a lane finishes

1. The lane calls `complete_job`. The job moves to **verifying**.
2. The gate runner runs every gate that applies to the job, each with its own timeout.
3. If all pass, the job is **done**.
4. If any fails, the feedback goes to the lane's inbox and the job goes back to **running**. The
   lane fixes the problem and completes again.
5. On the third failure, the job is **blocked** and you are notified.

If a gate cannot run because of your setup (no test command, or no sandbox for the tests gate),
the job is blocked at once and **no attempt is used**. The lane cannot fix a setup problem, so
Ninebrains does not ask it to try.

Evidence (logs, screenshots, reviewer replies) is stored under
`ninebrains/evidence/<jobId>/<attempt>/` in the app data folder, never inside the worktree. It is
kept for 30 days.

The retry rule:

| Result | Attempt | Decision |
|---|---|---|
| passed | any | done, verified |
| unverified | any | done, **not** verified |
| failed | 1 or 2 | retry, with the feedback |
| failed | 3 | blocked, with the last feedback |
| setup problem | any | blocked, attempt not counted |

Feedback is written for the agent. It covers only the failures, in gate order, up to 1,500
characters per gate.

## Passed, failed and unverified

- Every gate that applies must pass.
- A gate that throws, times out, returns a malformed result or is cancelled counts as a **failure**.
- A job that no gate applies to (for example, rigor set to 0) is **unverified**. It still leaves
  verifying, but it is never shown or stored as passed. The app marks it with an "unverified"
  badge.

## Rigor

Two settings, each 0 to 10, decide which gates attach to a job by default. Both start at 5.

| Gate | Attached when | Job kinds |
|---|---|---|
| `tests` | testing ≥ 3 | code, ui |
| `fact-check` | testing ≥ 3 | research, seo |
| `screenshot` | testing ≥ 5 | ui |
| `security-review` | security ≥ 6 | code, ui |
| `reviewer` | testing ≥ 7 | all |

A job names its kind with `gateKind` when it is created. A job that does not name one is treated
as **code**. The Brain declares a page or other visible UI as `"ui"`, which adds the screenshot
gate. An agent (a Brain session or a lane) may declare only `code` or `ui`: every other kind has a
weaker floor, so an agent asking for one is refused, not quietly downgraded.

This is the floor. A job's creator can add gates on top; neither a lane nor the Brain can take
them away. Packs add their own defaults, such as the SEO pack's `seo-evidence` gate.

Set rigor in **Settings → Gates**. To override it for one project, pick the project under
**Settings → Gates → Tests** and choose a **Rigor override** level; it sets testing and security
rigor together.

## Test command

The tests gate runs one command, which you set per project. It never takes a command from a job or
from a file in the worktree.

Set it in **Settings → Gates → Tests**: pick the project, type the command (for example
`pnpm test`) and click **Save test command**. It runs in the lane's worktree. Saving an empty
command clears it.

At the default rigor (testing 5), every code and ui job gets the tests gate. A project with no test
command has every such job blocked with "No test command is set for this project: set one in
Settings → Gates → Test command", and no attempt is used. Lowering **Testing rigor** below 3 also
lets jobs finish, but they finish **unverified**.

## The built-in gates

### tests

Runs the project's test command in the worktree. It passes on exit code 0 and fails on a timeout.
The last 200 lines are kept as evidence, and the last 40 go into the feedback.

This is the only gate that runs the lane's own code, and a lane can rewrite its test script. So
the command comes only from the project setting you chose. It runs with a scrubbed environment (no
Ninebrains tokens, pack secrets or provider keys), its whole process group is killed on timeout,
and output is capped at 1 MiB.

It also runs in an OS sandbox. The sandbox denies reads of the app data folder, other lanes'
worktrees and credential folders, allows writes only to the worktree and a private temp folder,
and allows network to localhost only:

- **macOS:** `sandbox-exec`.
- **Linux:** bubblewrap (`bwrap`), if it is installed.
- **Windows, and Linux without bubblewrap:** there is no sandbox, and the gate refuses to run. See
  [Troubleshooting](troubleshooting.md#the-tests-gate-says-it-needs-a-sandbox).

Two per-project switches in **Settings → Gates → Tests** loosen this, and both are off by default.
**Allow network** lets the test command reach any address, not only localhost. **Allow
unsandboxed** lets the gate run where there is no sandbox; the command then runs as you, with only
the scrubbed environment and the timeout. Remember that the test command runs code the lane wrote.
See [Configuration](configuration.md#tests-gate-options).

### screenshot

Captures the lane's preview at 1440, 768 and 390 px wide. Console errors, failed same-origin
requests, or a difference from the baseline above 1% fail the gate before any reviewer is asked.
If the page is clean, a separate reviewer looks at the screenshots and gives a JSON verdict.

The app captures the lane's own browser through the Chrome DevTools Protocol, attached only to that
lane's registered browser. If DevTools is open on that browser (or another debugger is attached),
the capture fails with "gate skipped: devtools open", and the job is blocked as a setup problem
instead of spending a self-heal attempt on something the worker can't fix. Unattended runs use an
offscreen window on the same browser partition.

The gate needs the lane's preview URL. If no dev server is running for the lane, the gate fails
with "No preview URL for this lane". See
[Troubleshooting](troubleshooting.md#the-screenshot-gate-says-no-preview-url).

### reviewer and security-review

The app makes a **disposable checkout** of the job's result, computes the diff there, and sends the
job, the diff and the evidence so far to a fresh reviewer run whose working directory is that
checkout. The reviewer has Read, Grep and Glob only: no shell, no writes and no network. It does
not run tests itself; the tests gate's log reaches it as evidence. The checkout is deleted
afterwards, whatever the result.

The reply must be a single JSON object of the form `{ pass, issues[] }`. A reply of `pass: false`
with no issues counts as malformed, because it gives the worker nothing to fix.

In this build the reviewer always runs on Claude Code, whichever agent did the work. A reviewer
from a different provider is not available yet, but which model backs that Claude Code run can be
pinned to one of your own model profiles instead of your subscription; see
[Reviewer model](models.md#reviewer-model-optional-pin) in the Models guide.

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
