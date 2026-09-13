---
title: Dogfood test matrix
description: >-
  Every user-facing feature and flow from the user guide, with a priority and how it is covered
  today. Used to decide what needs an automated check before Ninebrains is safe as a daily IDE,
  and what stays a manual check.
---

**Priority**

- **P0** — daily use breaks without it (data loss, a stuck queue, a security control that fails
  open, the app not starting).
- **P1** — annoying, but there is a workaround or it only affects one feature.
- **P2** — rare path, or a v0.1 known-gap the guide already documents.

**Coverage** cites real files found by grep in this worktree (`w7/dogfood-matrix`, based on
`origin/main` at `e74ae2541`). "e2e" names a suite in `apps/emdash-desktop/e2e/`. "manual only"
means no automated check exists and one is not planned here. "none" means an actual gap.

## Lanes

| Feature | Flow | Priority | Coverage today |
|---|---|---|---|
| Add a lane | Pick project + agent, lane launches in its own worktree | P0 | e2e `lanes-smoke` (4 lanes, screenshots); unit `lanes/node/lane-service.test.ts` |
| Add a lane from a pack role | Role picker appears once a pack is enabled; role's prompt and provider/model defaults apply | P0 | **e2e `lane-from-pack-role` (new, this PR)**; unit coverage of `rolesOfEnabledPacks`/`resolve-launch` in `packs/node/resolve-launch.test.ts` |
| 2×2 grid, multiple tabs | Four lanes side by side, `+` for another tab | P1 | e2e `lanes-smoke`; component `lanes/browser/grid/lanes-grid.browser.test.tsx` |
| Status lights (idle/running/waiting/verifying/blocked/asleep) | Lights come only from agent hooks, `verifying`/`blocked` come from job state | P0 | unit `lanes/node/lane-status.test.ts`; e2e `self-heal` exercises `verifying` → `blocked` → retry indirectly through gate failure |
| Lane controls: run mode, editor, browser, side panel, sleep, maximize, more | Each header control does its one thing | P1 | component `lanes/browser/grid/lane-side-panel.browser.test.tsx`; maximize/sleep/screenshot path in e2e `lanes-smoke` (⌘⇧Enter maximize, min-size screenshot); browser toggle and "more" menu: manual only |
| Switching a lane attended ⇄ unattended | Hand icon → confirm → Unattended badge; click badge to revert, no confirm | P0 | **e2e `lane-run-mode` (new, this PR)**; component the control itself has no dedicated test — `brain/browser/lane-run-mode.tsx` is covered only by this e2e |
| Dev server ports (`EMDASH_PORT`) and lane browser | Each lane's terminal gets a port; lane browser needs the task opened once first | P2 (documented limit) | manual only |
| Keyboard shortcuts (⌘1–4, ⌘⇧Enter, lane focus while terminal has focus) | Global shortcuts work even with terminal focus | P1 | e2e `lanes-smoke` exercises ⌘⇧Enter maximize; the rest: manual only, see `docs/guide/keyboard-shortcuts.md` |
| What persists (tabs, slots, sleep, run mode, role, split sizes) across restart | Restart the app, layout survives | P1 | none — no e2e restarts the app mid-suite |

## Brain and jobs

| Feature | Flow | Priority | Coverage today |
|---|---|---|---|
| Start a Brain session, brief it | Brain drawer → Start Brain → a Claude Code session with Brain tools | P0 | e2e `brain-fanout`, `self-heal`; unit `brain/node/brain-service.test.ts`, `brain/node/launch-config.test.ts` |
| Job graph and dependency-gated dispatch | `create_job`/`link_jobs`; a job only becomes ready once its deps are done | P0 | e2e `brain-fanout` (5 jobs, 2 dependencies, verified dispatch order); unit `brain/node/dispatcher.test.ts` |
| Job states incl. verifying/blocked/requeue | Full state machine | P0 | unit `brain/node/dispatcher.test.ts`, `gates/node/runner/gate-runner.test.ts`; e2e `self-heal` (fail → feedback → retry → pass) |
| Lane choice heuristic (idle → cross-provider review → context → least-loaded) | The Brain picks a sensible lane | P1 | unit `brain/node/dispatcher.test.ts`; e2e only proves *a* lane gets picked, not the heuristic order |
| Identity/role enforcement (a lane can't act as another lane or the Brain) | Per-launch tokens gate every tool call | P0 (security) | unit `brain/node/endpoint.test.ts`; e2e `brain-fanout` SEC-05 case (an in-app web page with a real lane token is rejected) |
| Several Brain sessions (`+ Brain`) | Multiple tabs, replies route to the right one | P1 | manual only |
| STOP (latch, kill runs, stop dispatched attended lanes) | Global STOP; Clear STOP; a stopped lane needs manual restart | P0 | **e2e `stop-halts-lanes` (new, this PR)**; unit `brain/node/stop.test.ts` (fake ports only — this e2e is the only place SIGTERM/requeue/UI round-trip is proven against the real app) |
| Brain database location/permissions | `ninebrains-brain.db`, 0600/0700 | P1 (security) | unit — see the account/security test suites below; not re-checked at e2e level |

## Verification gates

| Feature | Flow | Priority | Coverage today |
|---|---|---|---|
| tests gate | Runs the project's test command in a sandbox, fails on timeout/nonzero | P0 | unit `gates/node/capabilities/{run-command,tests-sandbox}.test.ts`; e2e `brain-fanout` (every job passes it), `self-heal` |
| screenshot gate | 3 widths, console/network/diff checks, then a reviewer verdict | P0 | e2e `self-heal` (deliberately broken UI job, fixed, attempt 2 passes with 3 screenshots); unit `gates/node/runner/self-heal.test.ts` |
| reviewer / security-review gate | Disposable checkout, read-only reviewer, JSON verdict | P0 | unit `gates/node/capabilities/{review-checkout,spawn-reviewer}.test.ts`; e2e `brain-fanout` uses the approving-reviewer path but never exercises a `pass:false` verdict end to end |
| fact-check gate | `claims.json`, SSRF-safe fetch, grounded/imprecise/invented/uncited | P1 | unit `gates/node/capabilities/{fetch-text,ip-policy}.test.ts`; no e2e (needs the research pack, not in the candidate list) |
| Retry/attempt/feedback rules (3 strikes → blocked) | Feedback in inbox, third failure blocks | P0 | e2e `self-heal` (one retry cycle only, not the third-strike block); unit `gates/node/runner/gate-runner.test.ts` covers the full state table |
| No test command → job blocked at once | Setup problem, no attempt used | P0 | unit `gates/node/project-prefs-service.test.ts`; manual check: `docs/guide/troubleshooting.md#every-job-is-blocked-with-no-test-command-is-set-for-this-project` |
| Rigor settings (testing/security 0–10) | Which gates attach by default | P1 | unit `gates/node/rigor/rigor.test.ts` |
| Evidence storage/retention | `ninebrains/evidence/<jobId>/<attempt>/`, 30 days | P2 | unit `gates/node/evidence/evidence.test.ts` |

## Packs

| Feature | Flow | Priority | Coverage today |
|---|---|---|---|
| Enable/disable a pack per project | Settings → Packs → switch | P0 | **e2e `lane-from-pack-role` (new, this PR)** exercises enabling the coding pack; component `packs/browser/packs-slice.browser.test.tsx` |
| Disclosure step for a pack that sends data elsewhere (SEO pack) | "Enable and send this data" confirmation | P0 (privacy) | component `packs/browser/packs-disclosure.browser.test.tsx`; no e2e (would need real AEO Toolkit MCP servers or a stub) |
| Roles reach a lane's launch (system prompt, MCP servers, gates) | `--append-system-prompt`, pack's MCP servers in the launch config | P0 | **e2e `lane-from-pack-role` (new, this PR)** (asserts the real `claude` argv carries the role's prompt); unit `packs/node/resolve-launch.test.ts` |
| Secrets: set/clear via keychain, write-only | Settings → Packs → paste a value → Save; never read back | P0 (security) | unit `packs/node/packs-secrets.test.ts` |
| Missing-secret servers left out with a warning | A server that needs an unset secret doesn't launch | P1 | unit `packs/node/resolve-launch.test.ts` |
| SEO pack self-hosting (`AEO_MCP_BASE_URL` scheme check) | Only `https`, or `http` on localhost | P1 (security) | unit `packs/node/aeo-settings.test.ts` |
| Skills install/uninstall with a pack (`nb-` prefix reserved) | Enabling a pack installs its skills globally | P1 | unit `packs/node/skills-sync.test.ts` |

## Unattended runs and STOP internals

| Feature | Flow | Priority | Coverage today |
|---|---|---|---|
| Budgets (wall clock, turns, spend, tokens, concurrency cap) | Supervisor enforces, persists counters in the transcript | P0 | unit `exec-runs/api/node/run-budgets.test.ts`, `run-supervisor.test.ts` |
| Sandbox + folder allow-list for a run's working directory | Claude sandbox / Codex `--sandbox`; symlink escapes refused | P0 (security) | unit `exec-runs/api/node/{sandbox-settings,lane-git-paths}.test.ts` |
| Environment allow-list (no `GITHUB_TOKEN`, `AWS_*`, etc.) | Only login vars, `PATH`, `HOME`, locale, proxy | P0 (security) | unit `exec-runs/api/node/run-env.test.ts`, `run-env-routing.test.ts` |
| Permission-bypass guard | No `--dangerously-skip-permissions` etc. can ever be built | P0 (security) | unit `exec-runs/api/node/argv-guard.test.ts` |
| Transcript redaction | Keys/tokens stripped before writing | P0 (security) | unit `exec-runs/api/node/redact.test.ts` |
| Actually running a job unattended end to end (`claude -p`) | A lane switched to unattended completes a real Brain job headless | P0 | **none at e2e level** — see "Known app/test gaps" below; the interactive lane path is covered (`brain-fanout`), the headless path is not |
| Codex unattended runs (experimental) | `codex exec --json` | P2 (documented experimental) | unit `exec-runs/api/node/codex-exec.test.ts`; no e2e (fake agent stands in for `claude` only) |

## Model routing and accounts

| Feature | Flow | Priority | Coverage today |
|---|---|---|---|
| Subagent model (Lever A) | `CLAUDE_CODE_SUBAGENT_MODEL` set from the lane header badge or add-lane form | P1 | unit `routing/api/node/launch-env.test.ts`; component `routing/browser/lane-routing.browser.test.tsx` |
| Model profiles (Lever B), behind a build flag | Vendor allow-list, write-only keys, test connection | P1 (off by default) | unit `routing/node/{routing-service,vendors,test-connection,profiles-repo.db}.test.ts`; component `routing/browser/models-settings.browser.test.tsx` |
| SEC-39 (subscription lanes never get a gateway URL/token) | Blanked `ANTHROPIC_*` vars even if the shell sets them | P0 (security) | unit `routing/api/node/launch-env.test.ts` |
| SEC-41 (run-start credential/model mismatch check) | Unattended run stops immediately on mismatch | P0 (security) | unit under `exec-runs`/`routing` node tests (`launch-env.test.ts`); no e2e (would need a real credential-mismatch scenario) |
| Per-account config directories (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) | Multiple accounts, per-directory trust and hooks | P2 | unit `account/node/provider-token-registry.test.ts`, `account/node/services/emdash-account-service.test.ts`; manual only for the actual two-account workflow (needs two real logins) |
| Hooks auto-installed on first session | `SessionStart`/`Notification`/etc. added to `~/.claude/settings.json` | P0 | exercised implicitly by every e2e suite (the harness's fake `claude` fires the same hooks); no standalone check that a *second* real account also gets hooks |

## Planner

| Feature | Flow | Priority | Coverage today |
|---|---|---|---|
| Open Planner (command palette / Lanes titlebar / Brain drawer) | Opens the current project's canvas | P0 | unit `planner/contributions/commands.test.ts`; component `planner/browser/planner-canvas.browser.test.tsx`; **no e2e** |
| Build a plan (jobs, notes, modules, edges) | Toolbar add + drag to connect | P1 | component `planner/browser/planner-canvas.browser.test.tsx`; unit `planner/api/schema.test.ts` |
| Run plan → compiles to Brain jobs, idempotent, cycle refusal | ⌘Enter/Ctrl+Enter compiles the canvas | P0 | unit `planner/node/planner-service.test.ts` (idempotency, cycle refusal, archiving removed nodes); **no e2e** proves a plan reaching the Brain drawer as live jobs |
| Draft from brief | Not available in v0.1 | P2 (documented not-built) | n/a |
| Canvas persistence (viewport 90 days, damaged canvas loads empty) | Per-project save/load | P1 | unit `planner/node/planner-service.test.ts` |

This was one of the task's likely e2e candidates (open the Planner, build a small plan, Run plan,
jobs appear in the Brain). It is not implemented in this PR: driving the canvas (React Flow-style
drag-to-connect) reliably through Playwright needs its own investigation into stable drag targets,
and `planner-canvas.browser.test.tsx` already exercises the compile logic at the component level.
Left as a **P0 gap** — see "Known app/test gaps" below.

## Security controls (cross-cutting)

| Feature | Flow | Priority | Coverage today |
|---|---|---|---|
| Brain endpoint hardening (localhost only, Host check, no Origin/Referer/Sec-Fetch, body cap, rate limit) | | P0 | unit `brain/node/endpoint.test.ts` |
| Per-lane MCP config file permissions (0600/0700, deleted on stop) | | P0 | unit under `brain/node` (`launch-config.test.ts`) and `main/host/ninebrains` |
| Reviewer isolation (disposable checkout, worktree untouched byte-for-byte) | | P0 | unit `gates/node/capabilities/review-checkout.test.ts` |
| SSRF-safe fetch (fact-check and seo-evidence gates) | | P0 | unit `gates/node/capabilities/{fetch-text,ip-policy}.test.ts` |
| Mock keychain in e2e / no real Keychain prompt | | P1 (test infra) | every e2e suite (`NINEBRAINS_E2E=1`, `--use-mock-keychain`) |

## First run, accounts, everyday workflow (inherited from Emdash)

Tasks, the editor, diffs, commit/push, pull requests, terminals, MCP/skills settings,
automations and issue-tracker integration (`docs/guide/ide-workflow.md`) are Emdash's own
workbench, inherited wholesale. They are out of this matrix's scope except where Ninebrains
patches them (see `docs/UPSTREAM-PATCHES.md`); upstream carries its own test suite for these.
First run (import step, hook installation, folder trust) is **P1, manual only** here — it needs a
first-launch profile, which every e2e suite already gets from `harness.mjs`'s fresh `HOME`, but
none of them assert on the import screen or the trust prompt specifically.

## Manual dogfood checklist

These P0 flows need a real Claude or Codex login (D5 forbids handling logins in this repo's tests)
or a real multi-day machine, so they stay manual:

- [ ] Install from a release build (not `pnpm run dev`), verify the SHA256SUMS checksum, open past
      Gatekeeper/SmartScreen. See `docs/guide/verify-download.md`.
- [ ] First run on a machine with `claude` and/or `codex` already logged in: confirm Settings →
      Agents shows them installed, hooks move from "Configured on first session" to "Configured".
- [ ] Run a real coding job end to end with the real `claude` CLI: add a lane, give the Brain a
      brief, watch a job go through tests → screenshot → reviewer gates with real (not fake) agent
      output.
- [ ] Switch a lane to unattended and let a real `claude -p` run complete a real Brain job headless
      (the e2e suite only proves the UI toggle; see the gap above).
- [ ] Two Claude Code accounts (`CLAUDE_CONFIG_DIR`): confirm each has independent trust, hooks and
      login status, and that a lane launched from a terminal with one account set actually uses it.
- [ ] Enable the SEO pack for real against the hosted AEO Toolkit endpoint (or a self-hosted one),
      set a Google access token, and confirm the disclosure banner and `seo-evidence` gate behave as
      documented.
- [ ] Restart the app mid-session: confirm lane tabs, slots, sleep state, run mode/role and split
      sizes survive, and that an in-flight run is marked killed rather than silently lost.
- [ ] `pnpm run dev` on a machine with no prior Ninebrains data: confirm the Emdash-import step (if
      any old data exists) and the "Start shipping" welcome screen.

## Known app/test gaps

Bugs and coverage holes found while building this matrix, not fixed here per the task's scope:

1. **Planner has no e2e coverage (P0 gap).** "Open Planner → build a plan → Run plan → jobs appear
   in the Brain" is a documented, real user flow (`docs/guide/planner.md`,
   `docs/guide/getting-started.md#5-give-the-brain-a-brief`) with zero end-to-end proof against the
   built app. The component test (`planner-canvas.browser.test.tsx`) and service test
   (`planner-service.test.ts`) cover the logic in isolation but never through the real Electron UI
   with a live Brain. Recommend a follow-up spike on driving React Flow-style canvases with
   Playwright before attempting this suite.
2. **Unattended job execution has no e2e coverage (P0 gap).** `lane-run-mode.e2e.mjs` (this PR)
   proves the attended ⇄ unattended UI toggle, but not a Brain job actually completing through a
   real `claude -p` unattended run. Repro of why it is hard: the harness's `FAKE_AGENT_SCRIPT` is
   baked into the interactive `claude` wrapper as a file path (`installFakeClaude` in
   `harness.mjs`), but an unattended run's environment is built from
   `exec-runs/api/node/run-env.ts`'s narrow allowlist, which does not carry `FAKE_AGENT_SCRIPT`
   through — so a `-p` launch always falls back to the wrapper's default approving-reviewer script
   (`{"pass": true, "issues": []}`), which never calls `complete_job`. Fixing this needs either a
   allowlisted test-only escape hatch in `run-env.ts`, or a way to bake a lane-specific unattended
   script into the run the way `installFakeClaude` does for the interactive case.
3. **STOP's documented behavior for an untouched idle lane is correct, but easy to
   misread from the docs alone (not a bug, a doc-clarity note).**
   `docs/guide/unattended-runs.md#the-stop-switch` says STOP "also stops the terminal session of
   every attended lane that holds a Brain job" — confirmed exactly true by `stop-halts-lanes.e2e.mjs`:
   only the lane holding the running job is stopped (and its job requeued to `ready`); a second,
   never-dispatched lane is left running. What is easy to miss until you dogfood it: **Clear STOP
   does not restart a stopped lane.** The job stays `ready` — not dispatched anywhere — until you
   click that lane's own "Start agent" button. A user who clears STOP and expects work to resume on
   its own will see nothing happen. **Documented in this PR** in `docs/guide/unattended-runs.md`
   (the STOP switch) and `docs/guide/troubleshooting.md`.
4. **Resolved (PR #5):** the stale `<!-- VERIFY -->` markers in `planner.md`,
   `unattended-runs.md` and `brain-and-jobs.md` that denied the Planner entry point and the lane
   mode control. This branch was first cut before PR #5 merged.
5. **Fixed in this PR:** `docs/guide/contributing.md` and root `CONTRIBUTING.md` said the e2e suites
   are "kept out of CI". `.github/workflows/e2e.yml` runs them on the `run-e2e` label, weekly, on
   `release/**` pushes and before every release; both docs now say so.

## This matrix's own coverage

| Suite | Flow | Status |
|---|---|---|
| `apps/emdash-desktop/e2e/stop-halts-lanes.e2e.mjs` | STOP latches dispatch, requeues the held job, stops that lane; Clear STOP; restart; dispatch resumes | New, added in this PR |
| `apps/emdash-desktop/e2e/lane-run-mode.e2e.mjs` | Attended → unattended (with confirmation) → attended (no confirmation) | New, added in this PR |
| `apps/emdash-desktop/e2e/lane-from-pack-role.e2e.mjs` | Enable the coding pack, add a lane with the Builder role, role's system prompt reaches the real launch | New, added in this PR |

All three build with `pnpm --dir apps/emdash-desktop run build` and pass locally
(`node apps/emdash-desktop/e2e/<suite>.e2e.mjs`), and are added to the `for suite in ...` list in
`.github/workflows/e2e.yml`.
