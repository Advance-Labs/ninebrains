# @emdash/gates-core

Verification gates for Ninebrains. A gate runs a second, independent check before a job's work reaches the user.

The package has no framework dependencies: no Electron, no React. Gates depend only on the capabilities injected through `GateContext.capabilities`.

## API

| Export | Purpose |
|---|---|
| `runGates(job, gates, ctx, { timeoutMs, concurrency })` | Runs the gates that apply to the job, each with its own timeout. Returns `{ status, verified, pass, results, skipped, evidence, feedback }`. |
| `decideSelfHeal(verdict, attempt, max = 3)` / `SelfHealLoop` | Pure decision from `{ status, feedback }`: `pass(verified)`, `retry(feedback, nextAttempt)` or `block(reason)`. |
| `rigorToGates({ testing, security }, jobKind)` | Pure. Returns the default gate IDs for a job (table below). |
| `FsEvidenceStore.open({ root, jobId, attempt })` | Stores evidence under `<root>/<jobId>/<attempt>/` with a `manifest.json`. The app passes `root = <userData>/ninebrains/evidence` (SEAMS §3.11), never a path inside the worktree. Re-opening an attempt after a crash is safe: existing files are kept and new ones take the next free name. |
| `pixelDiff(a, b, { threshold })` | Compares two PNGs using pixelmatch (ISC) and pngjs (MIT). |
| `testsGate`, `screenshotGate`, `reviewerGate`, `securityReviewGate`, `factCheckGate` | The built-in gates. |
| `parseReviewerVerdict(text)` | Strict parser for a reviewer's `{ pass, issues[] }` reply. |

### `runGates` semantics

- Every gate that applies must pass.
- A gate that throws, times out, returns a malformed result or is cancelled counts as a fail. Its `status` records which: `error`, `timeout` or `cancelled`.
- When a gate times out, its signal is aborted.
- `status` is `passed`, `failed` or **`unverified`**. A job that no gate applies to (for example rigor 0) is `unverified`: `pass: true` so it still leaves `verifying`, but `verified: false`. Our promise is that no agent grades its own work, so the UI must show an "unverified" badge and must never store or display this as `passed`.

### Self-heal decision table

| Run status | Attempt | Decision |
|---|---|---|
| `passed` | any | `pass`, `verified: true` |
| `unverified` | any | `pass`, `verified: false` (show the badge) |
| `failed` | below 3 | `retry`, `nextAttempt = attempt + 1`, with the feedback |
| `failed` | 3 or more | `block`, with the last feedback |
- `feedback` is written for the worker agent. It covers failures only, in gate order, with at most 1500 characters per gate.

## Rigor mapping

| Gate | Attached when | Job kinds |
|---|---|---|
| `tests` | testing ≥ 3 | code, ui |
| `fact-check` | testing ≥ 3 | research, seo |
| `screenshot` | testing ≥ 5 | ui |
| `security-review` | security ≥ 6 | code, ui |
| `reviewer` | testing ≥ 7 | all |

Levels must be integers from 0 to 10; anything else throws `RangeError`. The thresholds are exported as `RIGOR_THRESHOLDS`.

## Capabilities the app must implement

**This contract is final input for the app.** The app implements these six signatures as written. Future changes are additive only: new *optional* fields on the options objects, never a new required field or a changed type. Adding an optional field to an options interface compiles against existing implementations, so it is not breaking.

**One addition is already planned.** `SpawnReviewerOptions` is expected to gain an optional `mcpServers` field, which the packs agent needs for the SEO red-team gate so the reviewer can re-run the cited GSC/GA4 queries. When it lands, an implementation that cannot honour a set option **must throw** rather than ignore it. A red-team review that silently ran without its data would report a pass it never checked.

| Capability | Contract |
|---|---|
| `captureScreenshot(viewport, { url, signal })` | Returns `{ png, consoleErrors[], failedRequests[{ url, status?, error? }] }`. The gate decides same-origin itself by comparing against `previewUrl`. See the implementation note below. |
| `runCommand(command, { cwd, signal, timeoutMs?, argv? })` | Returns `{ exitCode, stdout, stderr, timedOut? }`. Without `argv`, `command` is a shell line (used only by the tests gate). With `argv`, `command` is the executable and nothing goes through a shell; the reviewer's `git diff` always uses this. **SEC-20:** the tests gate executes scripts the lane controls (a lane can rewrite `package.json`'s `test` script), so the app must run it under the lane sandbox with a scrubbed env (no `NINEBRAINS_*`, no pack secrets, no provider keys), kill the whole process group on abort or timeout, and cap output at 1 MiB. The test command comes only from app config the user set, never from a job record or a worktree file. |
| `spawnReviewer(prompt, { signal, cwd, tools: 'read-only', attachments, purpose })` | Starts a fresh reviewer run and returns `{ text }`. **SEC-18:** `cwd` is always a review checkout, never the lane worktree, and `tools: 'read-only'` means Read/Grep/Glob only, with no Bash, no writes and no network (Claude `--permission-mode plan` with those tools; Codex `exec --sandbox read-only`). The reviewer never runs tests; the tests gate does, and its log reaches the reviewer as evidence. `purpose` is `screenshot`, `reviewer` or `security-review`, so the app can route each to a different model. |
| `prepareReviewCheckout(job, { signal })` | Returns `{ path, dispose() }`: a disposable, detached checkout of the job's result in a temp dir (`git worktree add --detach <tmp> <commit>`, with untracked files copied in). Gates always call `dispose()`, including on failure. |
| `fetchText(url, { signal })` | Returns the response body. **Must be SSRF-safe** (net-guard). |
| `readWorktreeFile(relPath, { signal })` | Reads a file and **must confine reads to the worktree**. |

### How the app implements `captureScreenshot`

This package stays Electron-free. The app implements the capability in main (SEAMS §3.12), using what upstream already exposes:

- **Lookup.** Find the lane's `WebContents` through `BrowserWebContentsRegistry` in `main/host/browser/browser-webcontents-registry.ts`. That needs the 5-line `getWebContents(browserId)` patch.
- **Pixels.** Capture with `webContents.capturePage()`, the same call `captureScreenshotToClipboard` uses. Set each viewport's size with CDP `Emulation.setDeviceMetricsOverride`.
- **Console and network.** Attach `webContents.debugger` (`attach('1.3')`) and collect `Runtime.consoleAPICalled` / `Log.entryAdded` as `consoleErrors`, and `Network.loadingFailed` as `failedRequests`.
- **Open DevTools.** Attaching the debugger conflicts with DevTools open on the same webview, so the host detaches when that happens. It should then throw from `captureScreenshot`, which this gate reports as a capture failure.
- **Unattended runs.** A lane webview exists only while its pane is mounted, so unattended runs use an offscreen `BrowserWindow` on the same partition.

## Built-in gates

- **tests.** Passes on exit code 0 (a timed-out run fails). Attaches the last 200 lines of output as `tests.log`. The feedback carries the last 40. **This is the only gate that executes the lane's code.** It runs lane-controlled scripts, so the app must sandbox it (SEC-20, see `runCommand`).
- **screenshot.** Captures at 1440, 768 and 390 px. Console errors, failed same-origin requests and a baseline diff over `maxDiffRatio` (default 1%) each fail the gate *before* any reviewer is spawned. If the page is clean, the gate asks the reviewer for a JSON verdict on the screenshots.
- **reviewer / security-review.** Prepares a review checkout and computes the diff there as argv: `git -c core.fsmonitor=false -c diff.external= diff --no-ext-diff --no-textconv <baseRef|HEAD> --`, plus the untracked file names. It then sends the job, the diff and the evidence gathered so far to a reviewer whose cwd is the checkout, and disposes of the checkout afterwards. The `-c` overrides matter because the repo config is lane-writable and could otherwise run a program during the diff. The reply must be one JSON object, optionally inside a single ```` ```json ```` fence and nothing else.

### Prompt injection (SEC-19)

Everything the worker or the web controls goes into reviewer prompts inside per-call nonce blocks from `createFence()`: `<<<DIFF-<16 hex>>>` … `<<<END-DIFF-<same>>>>`. That covers the job title and body, the diff, untracked file names, the evidence list and the preview URL. Any occurrence of the nonce inside the content is escaped, so nothing in the content can close a block. The prompt tells the reviewer that fenced content is untrusted data and never instructions.

Deterministic failures still win whatever the reviewer says, and only a single JSON verdict is accepted.

**Packs must use `createFence` for anything they embed**, including claims, fetched page text and SEO findings in the red-team gate.
- **fact-check.** Reads `claims.json` and rejects invented or uncited claims. Imprecise claims pass with a warning.

## Decisions made while blocked

Each of these was a judgement call. Change any of them here if you disagree.

1. **`readWorktreeFile` is a fifth capability.** The brief listed four. The fact-check gate has to read `claims.json`, and reading the file directly with `fs` would bypass the app's worktree confinement.
2. **The fact-check gate defaults to `url` mode and ignores source text pasted into `claims.json`.** An agent can forge pasted text. `sources` mode exists for a retrieved set that the app loads from a trusted place.
3. **A URL that can't be fetched makes its citation `invented`.** A claim we can't verify is not treated as grounded. The fetch error appears in the reasons.
4. **An empty `claims.json` fails the fact-check gate.** A research job that makes no claims most likely skipped the step.
5. **A reviewer reply of `pass: false` with no issues is treated as malformed.** It gives the worker nothing to fix.
6. **A reviewer diff with an unsafe `baseRef` is refused.** The ref must match `^[A-Za-z0-9][A-Za-z0-9._/~^-]*$` and must not contain `..`. The diff now runs as argv with no shell, so this check guards against git option injection through the job record, such as a ref starting with `-`.
7. **`GateJob.kind`** is one of `code | ui | research | seo | docs`. The Brain's unit of work is a *Job*; in Emdash a "Task" is a worktree session. Worker feedback names the Brain MCP tool through the exported constant `COMPLETE_JOB_TOOL` (`complete_job`), so the name can't drift. Change it there if brain-mcp renames the tool again.
8. **No applicable gates means `unverified`, not a pass.** Decided by the team lead on 2026-09-10. Self-heal returns `pass` with `verified: false`, so the job unblocks and the result stays distinguishable.
