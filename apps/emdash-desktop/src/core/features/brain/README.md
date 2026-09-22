# Brain (Phase 2 wiring)

The Brain from `@ninebrains/brain-core`, wired into the app: the Brain DB, the
loopback endpoint lanes reach through `brain-mcp`, per-launch MCP config, the
dispatcher, the verification hand-off, Brain sessions, the Brain drawer and
the global STOP. Glossary: a **Job** is a Brain work item; a **lane** is one
agent in a worktree (`features/lanes`).

## Layout

| Path | What |
|---|---|
| `api/contract.ts` | `brain` wire contract: `project` / `lanePanel` / `overview` / `allJobs` live models, `events`, procedures. `allJobs` (its own model, unkeyed) is every open job across every project — kept separate from `overview` so `overview`'s always-mounted consumers (titlebar, Settings, lane run-mode) don't also subscribe to it |
| `api/schemas.ts` | `JOB_STATE_META`/`OPEN_JOB_STATES` — the one place job-state labels and the open/closed split are defined, so every dashboard derives from it instead of hand-maintaining its own (divergent) state list |
| `api/side-panel-items.ts`, `api/browser/side-panel-source.ts` | `LaneSidePanelSource` over the `lanePanel` live model (Jobs / Done / Notes, verified or unverified badge) |
| `node/brain-db.ts` | Opens `<userData>/ninebrains-brain.db` with `defineDurableSqliteStore` + `BRAIN_BUNDLED_MIGRATIONS`; dir 0700, file 0600 |
| `node/endpoint.ts` | `startBrainHttpServer` on 127.0.0.1 plus a ledger: one token per launch key (`lane:`, `brain:`, `run:`) |
| `node/launch-config.ts` | `buildLaneLaunch`: 0600 `mcp.json` (brain-mcp + pack servers), Claude `--settings=` (status hooks + sandbox), Codex `--config=` overrides, argv guard |
| `node/hook-settings.ts` | Upstream's hook commands (same `EMDASH_HOOK_CONFIG_VERSION`) plus `SessionStart`→stop and `PermissionRequest`→notification |
| `node/dispatcher.ts` | The loop over `brain.planDispatch`: lane sync, fairness, pause, STOP latch, attended paste or unattended run |
| `node/attended.ts` | SEC-15 paste rule and sanitizer; bracketed paste then a separate `\r` |
| `node/unattended.ts` | `claude -p` through `ExecRunSupervisor` with a run-scoped token |
| `node/verification.ts` | `verifying` → gate runner, or `done` with a `[gates] unverified:` note |
| `node/brain-sessions.ts` | Brain sessions: brain-mode `claude` PTYs in their own worktree Task, persisted in the `brain.sessions` memento |
| `node/stop.ts` | Global STOP with a 4.5 s answer deadline |
| `node/brain-service.ts` | `BrainService`: owns all of the above and implements the procedures |
| `browser/brain-drawer.tsx`, `browser/titlebar-controls.tsx` | The drawer (with a plain-language `SummaryStrip`) and the titlebar toggle + STOP (hover tooltip shows dispatcher status and unread count), mounted by the Lanes view through `contributions/lanes-drawer.ts` |
| `contributions/settings.ts` | What Settings uses from this slice (`useBrainOverview`, `runBrainAction`), consumed by `settings/browser/components/BrainSettingsCard.tsx` |
| `contributions/arena.ts` | What the Arena view uses from this slice (`useBrainOverview`), consumed by `arena/browser/arena-dashboard.tsx`'s `BrainSection` |

The composition root is `app/main/bootstrap/boot/ninebrains/create-ninebrains-services.ts`.
Lanes and the Brain may not import each other's `node/`, so they meet there
through ports (`LaneBrainPort` in `lanes/node/lane-ports.ts`, `BrainLanesPort`
here), with a late binding for the lanes side. The same factory builds the
packs service (keychain `SecretResolver`), the planner (`createBrainPlanTarget`
+ a `MementoRowPort` over the mementos runtime) and the exec supervisor.

## Flow

1. A lane starts: `LaneService` provisions the worktree, `prepareLaunch` warms
   the project's pack servers, and upstream's `TuiConversationProvider` calls
   `resolveLaneLaunch(conversationId, { extraArgs, autoApprove, cwd })`.
2. `buildLaneLaunch` mints the launch's token, writes `mcp.json` and
   `settings.json` 0600 under `<userData>/ninebrains/lanes/<laneId>/`, and
   returns `--mcp-config=… --strict-mcp-config --settings=…`. The token lives
   only in the brain-mcp server entry's env.
3. The dispatcher mirrors each lane's availability into the Brain (idle only
   when its hooks say idle or completed and it holds no job), plans with
   `planDispatch`, `assignJob`s, and pastes the job prompt. A paste that does
   not land releases the job. A landed paste starts an attended run.
4. The lane calls `complete_job` over brain-mcp → `verifying` → the gate
   runner, or **done, unverified**. Dependents become ready and the next tick
   dispatches them.
5. Lights: the job state feeds `mapLaneStatus` (`verifying`, `blocked`) and
   the lane's `activeJobId`.

## Discoverability and the cross-project view

Settings → General has a "Brain" card (`BrainSettingsCard`) explaining what
Brain does, its live dispatch state, and a pause switch. The Lanes first-run
intro links straight to the drawer ("What does the Brain do?"). Arena (every
provisioned task across every open project) also shows a `BrainSection`:
dispatcher state plus every open job's state across all projects, with blocked
jobs listed by name and a one-click jump to that project's Planner canvas.

This works because `BrainService` is a single app-wide instance (constructed
once in `create-ninebrains-services.ts`); `projectId` is a scoping parameter
on individual calls, not a sign of per-project instantiation. `overview`
(`unread` / `sessions` / `dispatcher`) was already unkeyed and already spanned
every project on the backend, so Arena's cross-project view didn't need a new
aggregator class — just one more Brain-role, unfiltered-by-project query:
`brain.listJobs(APP_IDENTITY, { states: OPEN_JOB_STATES, limit: 500 })` in
`BrainViews.refresh()`. `states` matters: without it the query sorts by
creation time ascending with no way to exclude finished work, so a filtered-
only-by-limit query eventually fills up with the oldest `done` jobs (`done`
entries are never archived) and the cross-project view silently goes stale
forever past a few hundred lifetime jobs. `allJobs` is its own live model,
not a fourth field on `overview` — see `api/contract.ts`'s comment for why.
Brain *tokens* remain per-project (see Accepted risks below) — that is a
separate, narrower constraint than instance scope, easy to conflate with it.

## Security requirements

| SEC | Where | Test |
|---|---|---|
| SEC-01 | Only main opens the DB; dir 0700, file 0600 | `brain-db.ts`; brain-mcp `SEC-01` tests; e2e reads the DB only after shutdown |
| SEC-02 | Identity from the token only; one token per launch; Brain tokens carry the session's `projectId` | `endpoint.test.ts` › `SEC-02 lane token cannot act as brain or another lane` |
| SEC-03 | Revoke on relaunch, stop, remove and run end | `SEC-03 token lifecycle`; `unattended.test.ts` (token revoked after the run) |
| SEC-04 | Loopback bind | `SEC-04 endpoint binds loopback` |
| SEC-05 | Origin / Referer / Sec-Fetch → 403, foreign Host → 421, non-JSON → 415 | `SEC-05 browser-shaped requests rejected`; e2e: an offscreen `BrowserWindow` with a real token changes nothing |
| SEC-10 | `mcp.json` 0600 via `wx`, dir 0700, deleted on stop/remove, orphans swept at boot, no token in `providerVars` | `launch-config.test.ts` › `SEC-10 lane config files` |
| SEC-11 | Attended lanes get `--settings=` with the exec-runs sandbox (deny `<userData>/ninebrains`, siblings, credentials) | `SEC-11 lane sandbox settings` |
| SEC-12 | The guard runs over the user's `extraArgs` plus ours; auto-approve refused; our files passed as `trusted` | `SEC-12 launch argv guard` |
| SEC-13 | Unattended runs use the supervisor's minimal env | exec-runs `SEC-13`; `unattended.test.ts` bakes the fake's script into a wrapper because the env is scrubbed |
| SEC-14 | Launch dirs built only through `launchDir`, which re-validates and checks the realpath | `SEC-14 ids cannot traverse` |
| SEC-15 | Paste only when idle or completed; ESC/C0 stripped; paste delimiters refused; Enter held if a prompt opens | `attended.test.ts` › `SEC-15 paste cannot inject keystrokes`; `dispatcher.test.ts` › `SEC-15 never dispatches…` |
| SEC-26 | Bundled packs only (`USER_PACKS_ENABLED = false`) | `packs/node/user-packs-flag.test.ts` |
| SEC-28 | Pack servers named `brain` / `ninebrains*` are dropped | `SEC-28 drops a pack server that shadows the Brain` |
| SEC-30 | STOP: latch, `killAll`, stop dispatched attended lanes, answer within 5 s | `stop.test.ts` › `SEC-30 global STOP` |

## Decisions made while blocked

1. **The composition root lives in `app/main/bootstrap/boot/ninebrains/`**, not
   in a feature, because it must import both `lanes/node` and `brain/node`.
   `lanes/node/ninebrains-services.ts` now only builds LaneService (`createLaneService`).
2. **`resolveLaneLaunch` stays synchronous** (upstream calls it inside
   `buildStartInput`): it mints and writes synchronously; pack servers come
   from a cache that `prepareLaunch` warms before each lane session.
3. **The dispatcher assigns, then pastes.** An assigned job is `claimed`, so
   lanes do not call `claim_job` for dispatched work; the prompt carries the
   job id and asks for `complete_job`. The e2e lanes therefore script
   `complete_job` only.
4. **Unverified is a note.** brain-core's done log has no verified column, so
   the verification hand-off writes `[gates] verified:` or `[gates] unverified:`
   notes (author `brain:gates`) and the read model derives the badge from the
   latest one. No note means unverified.
5. **Gate runner:** `createGateRunnerService` and `resolveGateFloor` from the
   gates slice were not on main. They are optional deps of the composition
   root; without them jobs finish unverified and the gate floor is brain-core's
   default (empty). Wire them when w5-gates-wiring lands.
6. **Claude's idle reminder.** Upstream classifies "Claude is waiting for your
   input" as `awaiting-input`; the paste rule accepts that exact text only,
   never the type alone, so an idle lane stays dispatchable.
7. **Attended lanes use `--strict-mcp-config`** (spike recommendation), so a
   lane sees the Brain and its project's pack servers, not the user's global MCP.
8. **Lane run mode is persisted with the lane** (`runMode` on the lane config;
   absent means attended). `setLaneMode` writes it through the lanes port, and the
   dispatcher adopts each lane's stored mode every round, so a restart keeps it.
   The lane header toggles it (`browser/lane-run-mode.tsx`, exported to lanes
   through `contributions/lanes-drawer.ts`); unattended shows the headless command
   and the budgets from the overview (`dispatcher.unattendedBudgets`).
9. **Pack secrets:** keychain (upstream `EncryptedAppSecretsStore`, safeStorage)
   under `ninebrains.pack.<NAME>`, falling back to the read-only env resolver.
   Nothing is written in plaintext. Settings → Packs sets and clears keychain
   values through `createKeychainSecretStore` (write-only; see the packs README).
10. **Pack launches are per role.** A lane's `roleId` reaches
   `resolvePackLaunch(projectId, roleId)`, cached per project and role, for
   attended launches and unattended runs. A role's gates are not applied to the
   lane's jobs: a job's gate spec is set by its creator.
11. **STOP from main.** `onStopChange` lets `main/host/ninebrains/agent-stop-controls.ts`
   rebuild the app menu and tray on the latch; both call `stopAll`/`clearStop`
   directly, never through the renderer.
12. **fake-agent** gained `{{prompt:<regex>}}` interpolation in `callTool` args
    (additive, tested) so scripted lanes can report the job they were pasted.

## Accepted risks and open items

- Codex lanes: the token travels in `--config=` argv, so it shows in the
  process list (same class as R2). Codex attended lanes are untested.
- HTTP pack servers are skipped for unattended runs (the supervisor's MCP
  config is stdio-only).
- STOP only stops PTY lanes that hold a Brain-dispatched job; a lane the user
  drives by hand keeps running. The app menu and tray entries run in main and
  work with a hung renderer (SEC-30).
- The live sandbox deny (SEC-11) is proven only as settings content; the real
  CLI check stays a manual pre-release step.
- Brain *tokens* are per project (a session can only plan inside the project
  it was started in), even though the `BrainService` instance and its
  `overview` read model already span every open project — see "Discoverability
  and the cross-project view" above.
- `apps/workspace-server` (remote/SSH lanes) has no Brain wiring at all today;
  remote lanes are outside orchestration entirely. Extending Brain there needs
  its own design pass (how a remote lane gets a `lane`-role grant without a
  second token-minting authority) before implementation — not started.

## Tests

```bash
pnpm --dir apps/emdash-desktop exec vitest run --project node src/core/features/brain src/core/features/packs src/core/features/lanes
pnpm --dir apps/emdash-desktop e2e:brain   # builds, then the fan-out demo + SEC-05 + screenshots
```
