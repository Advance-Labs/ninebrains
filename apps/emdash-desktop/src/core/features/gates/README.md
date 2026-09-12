# Gates (plan Phase 4, app side)

When a lane calls `complete_job`, the job moves to `verifying`. The gate runner then runs the
job's gates, a second check independent of the worker, and records the verdict in the Brain.
A failed gate sends the job back to the lane with feedback, up to 3 attempts. After the
third failure the job is blocked and the user is notified. gates-core
(`packages/gates-core`) holds the gates and the policy; this slice wires them into the app.

## Layout

| Path | What |
|---|---|
| `node/runner/gate-runner.ts` | `GateRunnerService`: subscribes to Brain events, runs, decides, records |
| `node/runner/gate-registry.ts` | Built-in gates + pack gates; unknown ids become failing gates |
| `node/runner/ports.ts` | `GateLaneResolver`, `ScreenshotHost`, `GateRunnerCapabilities`, `NotificationPublisher` |
| `node/rigor/` | `RigorResolver` (the sync `resolveGateFloor` brain-core needs) and `ProjectPrefsStore` |
| `node/evidence/evidence.ts` | SEC-24 wrapper over `FsEvidenceStore`, `verdict.json`, history, retention |
| `node/worktree/read-worktree-file.ts` | The `readWorktreeFile` capability (SEC-23) |
| `node/notifications/job-blocked.ts` | Notification on the Brain's `jobBlocked` event |
| `node/verification-service.ts`, `node/wire-controller.ts` | The `gates` wire contract for the modal |
| `node/gates-services.ts` | `createGateRigor` + `createGatesServices`: what the composition root calls |
| `browser/` | "Job verification" modal and Settings → Gates |
| `../../../main/host/ninebrains/` | CDP gate host (`captureScreenshot`) and its Electron adapter |

## The runner

For each job entering `verifying` (and, at `start()`, every job a crash left there):

1. **Gates.** `union(resolveGateFloor(project, kind, spec), gateSpec.gates)`, floor first. The
   floor is re-applied at verify time, so raising rigor also covers jobs already in flight.
   Built-ins come from gates-core and pack gates from `packs.createGates()`. A pack gate may not
   reuse a built-in id. An id nobody provides fails the job rather than passing it.
2. **Context.** The lane comes from `GateLaneResolver` (lane state in main, never the job
   record): worktree, preview URL, browserId. `captureScreenshot` and `readWorktreeFile` are
   bound to that lane. Evidence goes to `<userData>/ninebrains/evidence/<jobId>/<attempt>/`.
   The worker's `artifacts` are left out of `GateJob` (SEC-22).
3. **Run.** gates-core `runGates` with per-gate timeouts, then `decideSelfHeal`.
4. **Record.** `verdict.json` is written first, then
   `brain.recordGateResult({ pass, status, attempt, evidencePath, feedback })`. On a retry the
   Brain posts the feedback to the lane's inbox; it names `COMPLETE_JOB_TOOL`.

**Idempotent per `(jobId, attempt)`**, where attempt = `attempts + 1` (SEAMS §3.11):

- Concurrent triggers for one attempt share a run.
- An interrupted run (shutdown, STOP) records nothing, so no attempt is used; the next sweep
  re-runs it.
- A crash after `verdict.json` but before the Brain write replays the stored verdict without
  re-running the gates. A replay must match the job's `updatedAt`, so a requeued job starts over.
- The Brain's `attempt` compare-and-set refuses a duplicate or stale verdict.

**Setup failures don't use attempts.** Some failures are setup problems the worker can't fix:

- the tests-gate sandbox refusing to run (`runCommand` throws, e.g. Linux without bwrap, or
  Windows);
- no test command configured;
- a gate that isn't installed;
- the lane is gone;
- the evidence root is inside the worktree.

These mark the verdict `nonRetryable`, and the runner calls `blockJob` straight away: attempts
are unchanged, `jobBlocked` fires and the user is notified. A test command that runs and fails
still retries.

## brain-core additions (`packages/brain-core`)

- `recordGateResult` also takes `status` (`passed | failed | unverified`), `attempt` (a
  compare-and-set) and `evidencePath`. The verdict is stored on `result.verification`, with
  `verified: status === 'passed'`. There is no schema migration; `result` is JSON.
- `GateFloorResolver` gets the requested spec as a third argument, so the floor can use the
  gates-core kind in `gateSpec.kind`. brain-core's own `work | review` can't tell UI work apart.
- Tests: `src/brain/verdict.test.ts`.

## CDP host (`main/host/ninebrains/`)

`cdp-gate-host.ts` is Electron-free and tested with a fake debugger. For each viewport it:

1. Attaches the debugger (protocol 1.3) and enables Page, Runtime, Log and Network.
2. Calls `Emulation.setDeviceMetricsOverride`.
3. Navigates to the preview and waits for `load` plus 300 ms.
4. Calls `Page.captureScreenshot`, then clears the override and detaches in `finally`.

It collects console errors, uncaught exceptions, error log entries, and same-origin failed
requests. Error log entries from the Network log source are left out: they duplicate the
Network events and include third-party failures.

What the host refuses:

- **Non-webview targets (SEC-25).** It refuses anything but a lane webview on the lane's
  partition. If DevTools is open, or another debugger holds the webview, it throws
  `gate skipped: …`.
- **Non-local URLs (SEC-24).** The URL must be http/https on loopback.

`electron-gate-host.ts` adapts WebContents from `BrowserWebContentsRegistry.getWebContents`,
a 5-line upstream patch. Its fallback is an offscreen `BrowserWindow` on the lane's partition, or
an ephemeral `nb-gate-<laneId>` one, with downloads and popups denied. `mode: 'offscreen'`
forces the fallback for unattended runs.

## Rigor (plan 4.5)

- The app setting is `ninebrains.gates`: `{ testingRigor, securityRigor }`, default 5/5, plus
  `evidenceRetentionDays` (30). It lives in Settings → Gates, with two sliders and the rigor
  table.
- Per-project overrides and the test command are behind `ProjectPrefsStore`, stored in mementos
  for v0.1. Null means "use the app setting".
- `RigorResolver.resolveGateFloor` is the function to pass to `new Brain({ resolveGateFloor })`.

## Evidence UI

The `jobVerificationModal` modal is opened by `gates.openJobVerification` with `{ jobId }`
(window scope). Other slices open it by command id, or by the modal id through `openModal`,
without importing this slice. It shows:

- per attempt, the status and each gate's result and feedback;
- 1440/768/390 thumbnails, with click-to-enlarge;
- log excerpts (the last 40 lines);
- a Verified or **Unverified** badge;
- worker artifacts, labelled as not evidence;
- a "Delete evidence" action (SEC-24).

## Security requirements

| SEC | Where | Test (`describe`) |
|---|---|---|
| SEC-08 | `RigorResolver.resolveGateFloor` | `SEC-08 caller cannot drop gates (app floor)` (rigor.test.ts) |
| SEC-14 | evidence paths via brain-core `assertId` | `SEC-24 evidence retention and redaction` → "SEC-14: job ids…" |
| SEC-20 | test command from user prefs only; sandbox refusal non-retryable | `SEC-20 a tests-gate sandbox refusal is a non-retryable failure`, gate-registry "SEC-20: without a user-set test command…" |
| SEC-22 | no worker artifacts in `GateJob`; UI label | `SEC-22 worker artifacts are not evidence`; browser "labels worker artifacts…" |
| SEC-23 | `readWorktreeFile` | `SEC-23 symlinked claims.json refused` |
| SEC-24 | 0700/0600, redaction (SEC-35 redactor), retention, delete, root outside worktree, local preview only | `SEC-24 evidence retention and redaction`, `SEC-24 evidence stays out of the worktree`, CDP "SEC-24: captures only the local preview" |
| SEC-25 | CDP host: lane webview, lane partition, DevTools skip | `SEC-25 CDP scope` |

SEC-18, SEC-19 and SEC-21 are enforced by the capabilities (`node/capabilities/`, owned by exec-runs
and the security fixes) and by the gates-core fences.

## Wiring (for the composition root)

This slice does not edit `services.ts` or `wiring.ts`.

```ts
import { createGateRigor, createGatesServices } from '@core/features/gates/node/gates-services';
import { createMementoProjectPrefsStore } from '@core/features/gates/node/rigor/project-prefs';
import { createElectronCdpGateHost } from '@main/host/ninebrains/electron-gate-host';

const rigor = createGateRigor({
  settings: {
    get: () => appSettings.get('ninebrains.gates'),
    onChange: (fn) => {
      const listener = (key: string) => key === 'ninebrains.gates' && fn();
      appSettings.on('app-settings:changed', listener);
      return () => appSettings.off('app-settings:changed', listener);
    },
  },
  prefs: createMementoProjectPrefsStore(runtimeClients.getMementosRuntimeClient),
});
const brain = new Brain({ store, resolveGateFloor: rigor.resolveGateFloor });
const gates = createGatesServices({
  brain,
  rigor,
  userDataDir: app.getPath('userData'),
  lanes: {
    resolve: async (laneId) => {
      // From LaneService: { laneId, projectId, worktreePath, browserId, previewUrl?, partition? }
    },
  },
  capabilities: {
    runCommand: createRunCommand({ allowedRoots, ninebrainsDataDir, siblingWorktrees, deniedPaths }),
    spawnReviewer: createSpawnReviewer({ supervisor, route, auth, checkoutRoot, laneWorktrees }),
    prepareReviewCheckout: createPrepareReviewCheckout({ worktreeForJob, root: checkoutRoot }),
    fetchText: createFetchText(),
  },
  screenshots: createElectronCdpGateHost(),
  extraGates: () => packs.createGates(),
  notifications: notificationService,
  onError: (context, error) => logger.warn(context, { error: String(error) }),
});
await gates.start();
scope.add(() => gates.dispose());
// DesktopControllerContext: gates: gates.verification
```

**w5/brain-wiring overlap.** Its `startVerification` also listens for `verifying` and records
`{ pass }` without a status or attempt. Run it **only** when `createGatesServices` isn't
wired, or the two race. Read "verified" from `job.result.verification`, not from the
`[gates] verified:` notes. Its `GateRunnerPort` would drop the attempt check, the
non-retryable blocks and the evidence path, so prefer this runner over that port.

## Screenshots

`docs/screenshots/gates-*.png` come from `src/renderer/tests/browser/gates-screenshots.test.tsx`.
It is opt-in, and the thumbnails in it are canvas-drawn stand-ins for real captures. Run from
`apps/emdash-desktop`:

1. Compile `src/renderer/index.css` with `@tailwindcss/node` `compile` and
   `@tailwindcss/oxide` `Scanner` over the compiler's sources plus `src/**/*.{ts,tsx}`. Write
   it to `src/renderer/tests/browser/__generated__/gates-tailwind.css`, which is gitignored.
2. `VITE_GATES_SCREENSHOTS=1 pnpm exec vitest run --project browser src/renderer/tests/browser/gates-screenshots.test.tsx`

## Tests

- Node: the runner (verdicts, setup failures, idempotency, self-heal with the real built-ins),
  the registry, rigor, evidence, the worktree reader, the verification service, the rigor-table
  parity with gates-core, and the CDP host with a fake debugger.
- Browser: `browser/job-verification.browser.test.tsx`, through the wire seam with `seedSliceWire`.
- e2e: `e2e/self-heal.e2e.mjs` **skips**, naming the missing precondition: the Brain
  composition root, `createGatesServices` being wired, `--use-mock-keychain` in the harness, and
  four Brain hooks in the file. `node/runner/self-heal.test.ts` proves the same loop at service
  level in CI.

## Decisions made while blocked

1. **The gates-core job kind lives in `gateSpec.kind`**, defaulting to `code`. Because it's
   declared by the job's creator, a Brain session could label a UI job `code` and skip the
   screenshot gate. The kind is shown in the modal. Deriving the kind from the lane's role is
   left for later.
2. **Setup failures block without using an attempt**, rather than letting the worker retry
   three times at something it can't fix.
3. **`readWorktreeFile` lives in `node/worktree/`**, not `node/capabilities/`, which the
   security fixes own.
4. **`evidenceRetentionDays`** is a third field on the app setting (SEC-24 asks for a setting).
   There's no UI control for it yet; the page states the current value.
5. **No Slider primitive exists**, so the sliders are native range inputs with the
   primary-button accent.
6. **The modal composes Dialog parts directly.** `ModalLayout`'s animated height broke the
   dialog's flex column.
7. **The runner has its own Brain identity** (`brain:gate-runner`).

## Risks

- **The `browser.*` agent-facing MCP (plan 4.2) is not built.** Neither is SEC-25's "lane B's
  token cannot drive lane A's browser".
- **Preview URL source.** The lane resolver needs one. Port leases (plan 1.4) or
  preview-server detection must supply it, or the screenshot gate fails with "No preview URL".
- **Evidence file modes.** Evidence files are chmod-ed to 0600 right after `FsEvidenceStore`
  writes them. The parent directory is 0700, so there is no cross-user window. The security
  fixes are moving the modes into gates-core.
- **Untested against a real webview.** The CDP host has only been run against a fake debugger;
  the e2e is the real check.
