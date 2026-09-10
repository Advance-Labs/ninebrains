# @emdash/gates-core

Verification gates for Ninebrains. A gate runs a second, independent check before a task's work reaches the user.

The package has no framework dependencies: no Electron, no React. Gates depend only on the capabilities injected through `GateContext.capabilities`.

## API

| Export | Purpose |
|---|---|
| `runGates(task, gates, ctx, { timeoutMs, concurrency })` | Runs the gates that apply to the task, each with its own timeout. Returns `{ pass, results, skipped, evidence, feedback }`. |
| `decideSelfHeal(verdict, attempt, max = 3)` / `SelfHealLoop` | Pure decision: `pass`, `retry(feedback, nextAttempt)` or `block(reason)`. |
| `rigorToGates({ testing, security }, taskKind)` | Pure. Returns the default gate IDs for a task (table below). |
| `FsEvidenceStore.open({ root, taskId, attempt })` | Stores evidence under `<root>/<taskId>/<attempt>/` with a `manifest.json`. |
| `pixelDiff(a, b, { threshold })` | Compares two PNGs using pixelmatch (ISC) and pngjs (MIT). |
| `testsGate`, `screenshotGate`, `reviewerGate`, `securityReviewGate`, `factCheckGate` | The built-in gates. |
| `parseReviewerVerdict(text)` | Strict parser for a reviewer's `{ pass, issues[] }` reply. |

### `runGates` semantics

- Every gate that applies must pass.
- A gate that throws, times out, returns a malformed result or is cancelled counts as a fail. Its `status` records which: `error`, `timeout` or `cancelled`.
- When a gate times out, its signal is aborted.
- A task that no gate applies to passes vacuously. The caller decides whether that is acceptable.
- `feedback` is written for the worker agent. It covers failures only, in gate order, with at most 1500 characters per gate.

## Rigor mapping

| Gate | Attached when | Task kinds |
|---|---|---|
| `tests` | testing ≥ 3 | code, ui |
| `fact-check` | testing ≥ 3 | research, seo |
| `screenshot` | testing ≥ 5 | ui |
| `security-review` | security ≥ 6 | code, ui |
| `reviewer` | testing ≥ 7 | all |

Levels must be integers from 0 to 10; anything else throws `RangeError`. The thresholds are exported as `RIGOR_THRESHOLDS`.

## Capabilities the app must implement

| Capability | Contract |
|---|---|
| `captureScreenshot(viewport, { url, signal })` | Returns `{ png, consoleErrors[], failedRequests[{ url, status?, error? }] }` via CDP on the lane webview. The gate decides same-origin itself by comparing against `previewUrl`. |
| `runCommand(command, { cwd, signal, timeoutMs? })` | Runs a shell command line and returns `{ exitCode, stdout, stderr, timedOut? }`. The app owns sandboxing and killing the process tree. |
| `spawnReviewer(prompt, { signal, cwd, readOnly: true, attachments, purpose })` | Starts a fresh, **read-only** reviewer run and returns `{ text }`. `purpose` is `screenshot`, `reviewer` or `security-review`, so the app can route each to a different model. |
| `fetchText(url, { signal })` | Returns the response body. **Must be SSRF-safe** (net-guard). |
| `readWorktreeFile(relPath, { signal })` | Reads a file and **must confine reads to the worktree**. |

## Built-in gates

- **tests.** Passes on exit code 0 (a timed-out run fails). Attaches the last 200 lines of output as `tests.log`. The feedback carries the last 40.
- **screenshot.** Captures at 1440, 768 and 390 px. Console errors, failed same-origin requests and a baseline diff over `maxDiffRatio` (default 1%) each fail the gate *before* any reviewer is spawned. If the page is clean, the gate asks the reviewer for a JSON verdict on the screenshots.
- **reviewer / security-review.** Sends the task, the diff (`git diff --no-color <baseRef|HEAD>`, plus a list of untracked files) and the evidence gathered so far. The reply must be one JSON object, optionally inside a single ```` ```json ```` fence and nothing else.
- **fact-check.** Reads `claims.json` and rejects invented or uncited claims. Imprecise claims pass with a warning.

## Decisions made while blocked

Each of these was a judgement call. Change any of them here if you disagree.

1. **`readWorktreeFile` is a fifth capability.** The brief listed four. The fact-check gate has to read `claims.json`, and reading the file directly with `fs` would bypass the app's worktree confinement.
2. **The fact-check gate defaults to `url` mode and ignores source text pasted into `claims.json`.** An agent can forge pasted text. `sources` mode exists for a retrieved set that the app loads from a trusted place.
3. **A URL that can't be fetched makes its citation `invented`.** A claim we can't verify is not treated as grounded. The fetch error appears in the reasons.
4. **An empty `claims.json` fails the fact-check gate.** A research task that makes no claims most likely skipped the step.
5. **A reviewer reply of `pass: false` with no issues is treated as malformed.** It gives the worker nothing to fix.
6. **A reviewer diff with an unsafe `baseRef` is refused.** The ref must match `^[A-Za-z0-9][A-Za-z0-9._/~^-]*$` and must not contain `..`. This guards against shell injection through the task record.
7. **`GateTask.kind`** is one of `code | ui | research | seo | docs`.
