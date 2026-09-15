# Ninebrains extension seams (task 0.2)

**Historical record, not a live map.** Written at task 0.2, before any of this was built, as the
pre-implementation mapping from upstream Emdash to the Ninebrains slices. Kept as-is for the
record of what was planned and why; some paths and details below have since diverged from the
shipped code (a few subdirectories described here were never created, for instance). For what is
true today, read `docs/guide/architecture.md` and the README in each feature or package folder it
points at.

Upstream base: `generalaction/emdash` @ `dbf690c6a` (2026-09-10). Plan: `docs/superpowers/plans/2026-09-10-oss-agent-workbench.md` in the advance-labs repo.
Every later phase builds from this file. Read it, then read the named upstream file. Don't read the whole tree.

Path shorthands: `app/` = `apps/emdash-desktop/src/`, `pkg-core/` = `packages/core/src/`, `pkg-plugins/` = `packages/plugins/src/`.

## 1. Summary

- **Vocabulary collision (read first).** An Emdash **Task** is a *workspace*: one git worktree plus its conversations (`app/core/services/app-db/node/schema.ts` → `tasks`). An Emdash **Conversation** is one agent session: a PTY (`type:'pty'`) or ACP chat.
  - A Ninebrains **lane** = one Emdash Task (its worktree) + one PTY Conversation in it.
  - Brain work items **must not** be called `tasks` in code. Use `brain_items` / `BrainItem` so grep, types and tables stay unambiguous. (UI copy can still say "task".)
- **Emdash is built for extension.** Every feature is a vertical slice with typed Wire contracts, plugged in through ~10 aggregation manifests. Almost everything Ninebrains adds is a **new slice** under `app/core/features/` plus one new workspace package (`packages/brain-mcp`). Upstream patches are one-line manifest registrations or small hooks in the spawn path.
- **Gold already in upstream:**
  1. Hook-driven agent status (`idle | working | awaiting-input | error | completed`) for Claude and Codex, over a localhost hook server.
  2. `sendInput` into a running agent PTY.
  3. A `browserId → WebContents` registry in main.
  4. Per-session `extraArgs` + `providerVars` on the TUI start input.
  5. A durable-SQLite-store primitive with its own migration runner, so Brain can use a separate DB file.
  6. Cron automations that already provision a worktree and start a headless TUI agent.
- **Missing upstream (we build):**
  - a print/exec (`claude -p`, `codex exec`) path. Emdash only runs interactive TUIs or ACP;
  - per-session MCP injection (MCP config is written to the provider's **global** file);
  - any grid layout;
  - an Electron/Playwright e2e harness;
  - port leasing (the base port is a hash, so collisions are possible).
- **Verdict: GO.** About 24 upstream files patched, under 1% of the tree (§7). The rebase risk is how often those few files churn, not how many there are.

## 2. "Add a feature module" recipe

### Anatomy

Reference slices: `app/core/features/dev-perf/` (smallest) and `app/core/features/mcp/` (live models + a browser test).

```
app/core/features/<x>/
  api/contract.ts        defineContract(...) + `<x>Domain = '<x>' as const` (zod only, no node/DOM)
  api/index.ts           explicit named re-exports of the contract/schemas (the one allowed barrel)
  api/browser/client.ts  getXClient() via domainClient (renderer-safe)
  api/node/…             node-only types/services other slices may import (optional)
  node/wire-controller.ts createXWireController(deps): Controller  (createController(contract, impl))
  node/…                 services, repositories, operations
  browser/…              React components, MobX stores, hooks (.tsx lives here, never in api/)
  contributions/browser.ts  { views?, modalDefs? }
  contributions/views.ts    defineView({ id, params: z.object(...), layout: workbenchLayout })
  contributions/commands.ts defineCommand(...)   contributions/palette.ts defineCommandPaletteItem(...)
  contributions/settings.ts defineSettingsContribution<'key', T>({ key, schema, defaults })
  contributions/mementos.ts defineMemento(...)   contributions/tabs.ts (task-view tab providers)
```

### Steps

1. **Contract** (`api/contract.ts`):

   ```ts
   export const brainDomain = 'brain' as const;
   export const brainContract = defineContract({
     listItems: fallible({ input: z.object({ projectId: z.string() }), data: z.array(brainItemSchema), error: brainErrorSchema }),
     board: liveModel({ key: z.object({ projectId: z.string() }), states: { items: liveState({ data: z.array(brainItemSchema) }) } }),
     events: eventStream({ key: z.void(), event: z.custom<BrainEvent>() }),
   });
   ```

   - `procedure`/`fallible` = request/response. `liveModel`/`liveState` = broadcast state. `liveLog` = streamed output.
   - `eventStream` = notifications; create its host with `createEventStreamHost(contract.events)` (see `app/core/features/browser/node/event-host.ts`).
   - Expected failures return `Result` (`ok`/`err` from `@emdash/shared`).
2. **Client** (`api/browser/client.ts`): `export type BrainClient = ContractClient<typeof brainContract>; export const getBrainClient = () => domainClient<BrainClient>(brainDomain, brainContract);`
   - `domainClient` (`app/core/primitives/wire/browser/connection.ts`) avoids patching `app/renderer/main.tsx`. dev-perf's `configure*Client` pattern needs that patch, so don't copy it.
3. **Controller** (`node/wire-controller.ts`): `createBrainWireController(deps)` returns `createController(brainContract, impl)`, a thin delegate to services.
4. **Register (upstream manifest patches, 1–3 lines each):**
   - `app/core/manifests/shared/domain-contracts.ts`: add `[brainDomain]: brainContract`.
   - `app/core/manifests/node/controllers.ts`: add `brain: { create: (ctx) => createBrainWireController(ctx.brain) }` and `readonly brain: BrainService` on `DesktopControllerContext`. Dev builds assert contract/controller key parity (`assertDomainKeyParity`, `app/main/bootstrap/boot/phases/controllers.ts`).
   - `app/main/bootstrap/boot/wiring.ts` → `createDesktopWireOptions()`: pass `brain: services.brain`.
   - `app/main/bootstrap/boot/phases/services.ts`: construct the service into `ServicesBundle`. **Hot spot** (28 upstream commits in 30 days): make it one call to a factory in our slice (`createNinebrainsServices(...)`) so the patch stays at 3 lines.
   - Views → `app/core/manifests/browser/browser-contributions.ts` (`featureViewRuntimes`) and `view-catalog.ts`. Modals → `featureModalDefs`.
   - Settings → `app/core/manifests/shared/settings-contributions.ts` and the node overlay `app/core/manifests/node/settings-contributions.ts`.
   - Mementos → `app/core/manifests/shared/memento-catalog.ts`. Commands → `command-catalog.ts` + `command-palette-catalog.ts`. Task-view tabs → `app/core/manifests/browser/task-tab-contributions.ts`.
5. **Tests** sit next to the code: `*.test.ts`; DB integration `*.db.test.ts`; renderer isolation `*.browser.test.tsx` with `seedSliceWire` (see §5).

### Boundary lint

Rules: `tooling/oxlint/rules/core-module-boundaries.js`, `core-host-boundaries.js`, `no-tsx-in-api.js`, `no-dynamic-imports.js`.

- **A feature may import:** another feature's `api/` or `contributions/` (never its `node/` or `browser/`); any `@core/primitives/*` or `@emdash/core/primitives/*`; a runtime's `api/` only (e.g. `@emdash/core/runtimes/tui-agents/api`).
- **Feature `node/`** may also import service `api/` and `node/`, including `@core/services/app-db/node/*`. **Feature `browser/`** may import only `api`, `contributions` and primitives, never any `node/`.
- **`app/core/**` may not import `@main/*` or `@renderer/*`** (`coreToHost`). Anything that needs Electron (webContents, `app.getPath`) is **injected** from `app/main` via `DesktopControllerContext` or factory arguments. Electron itself may be imported only under `app/main/{host,gateway,bootstrap,core,db}`.
- `api/` may not import its own `node/` or `browser/`. No `.tsx` under `features/*/api/`. No dynamic `import()`, no `require`.
- **Direct schema writes are banned.** The app-DB tables `workspaces` and `conversations` are written only through `@core/features/workspaces/api/node/registry` and `@core/features/conversations/api/node/registry` (`.oxlintrc.json` `no-restricted-imports`).
- Allowlists (`tooling/oxlint/allowlists/*.json`) are ratcheted empty. **Do not add entries.** If the lint blocks you, redesign.
- Files under 500 lines. oxfmt (width 100, single quotes). Conventional Commits.

## 3. Component seams

Each component lists **Extend** (upstream code we call or hook), **New**, **Patch upstream?** and **Risk**.

### 3.1 Lanes / Grid (1.1, 1.2, 1.3)

**Extend:**

- **Task pane layout.** `app/core/primitives/workbench-shell/browser/tabs/pane-layout-store.ts` (`PaneLayoutStore`): horizontal `splitRight` only, `MAX_PANE_COUNT = 8`, persisted via `taskPaneLayoutMemento` (`app/core/features/tasks/contributions/mementos.ts`). **Scoped to ONE task** (`getConversationSessionManager(taskId)` in `app/core/features/conversations/browser/conversation-tab-provider.tsx`), so a 2×2 grid of four *different* worktrees cannot live in it.
- **Resizable panels.** `Resizable` from `@emdash/ui/react/primitives`. Never import `react-resizable-panels` directly or program panels imperatively (`app/core/features/workbench/node/layout-contract.test.ts` enforces this).
- **Terminal rendering.** The conversations `terminalOutput` liveLog (`app/core/features/conversations/api/contract.ts`) is keyed by `conversationId` alone, so a lane cell needs no task scope. The xterm frontend is `app/core/features/terminals/browser/pty/` (`xterm-host.ts`, `use-pty.ts`).
- **Browser** = reuse `BrowserPane` (`app/core/features/browser/browser/browser-pane.tsx`). **Views** via `defineView` (example `app/core/features/automations/contributions/views.ts`).

**New:**

- `app/core/features/lanes/`: `api/contract.ts` (`lanes` domain), `node/lane-service.ts` (`LaneService`: CRUD + state machine), `node/lane-repo.ts` (rows in the Brain DB, §3.5), `browser/use-lanes.ts` (`useLanes()`).
- `Lane = { id, tabId, slot 0-3, projectId, taskId, conversationId, provider, model, accountLabel, status }`.
- `app/core/features/lanes/browser/grid/`: `lanes-view.tsx` (new top-level view `lanes`, params `{ tabId }`), the grid from 2 nested `Resizable` groups, the tab strip, maximize and sleep controls. Layout persists through a new memento (`lanesGridMemento`, subject `app`).
- Plan path `features/workbench/grid/**` → use `features/lanes/browser/grid/**` instead, so we never touch the workbench slice.

**Patch upstream?:** yes: `view-catalog.ts`, `browser-contributions.ts`, `memento-catalog.ts`. Optionally one sidebar entry in `app/core/features/workbench/browser/sidebar/`; prefer a palette command (`command-catalog.ts`).

**Risk:**

- Workspace activation is **renderer-driven for the current task only**: `TaskActivationCoordinator` (`app/core/features/tasks/browser/stores/task-activation-coordinator.ts`) never provisions other tasks. Four live lanes = four provisioned tasks, so `LaneService` must provision explicitly through `TaskService` (`app/core/features/tasks/api/node/task-service.ts`, the same verb the coordinator's Retry path uses). Verify the verb name in 1.1.
- Sleep = hide the cell. Never call `tuiAgents.stop` on sleep; the PTY must keep running.

### 3.2 Lane status lights (1.1)

**Extend:**

- **Runtime state:** `pkg-core/runtimes/tui-agents/node/runtime/agent-state.ts` (`TuiAgentStates.applyCanonicalEvent`). Status comes **only** from hooks, never inferred from output (`agents/integrations/providers.md`).
- **Claude hooks** (`pkg-plugins/agents/impl/claude/hooks.ts`): `SessionStart` → session id captured; `UserPromptSubmit` → `working`; `Notification` matching permission/approval → `awaiting-input`, other `Notification` → `idle`; `Stop` → `completed`.
- **Codex hooks** (`pkg-plugins/agents/impl/codex/hooks.ts`): notification, stop and session only, **no start hook**. `working` comes from `markInputSubmitted` when input contains `\r`.
- **Delivery:** hooks install into the **user-global** provider config (e.g. `$CLAUDE_CONFIG_DIR|~/.claude/settings.json`) and `POST http://127.0.0.1:$EMDASH_HOOK_PORT/hook` with headers `X-Emdash-Token`, `X-Emdash-Pty-Id` (= conversationId). Receiver: `pkg-core/runtimes/tui-agents/node/hooks/hook-server.ts`.
- **Consume** either the `tuiAgents.agentStates` liveModel in main (contract `pkg-core/runtimes/tui-agents/api/contract.ts`; subscribe like `app/main/core/agent-status/tui-agent-status-bridge.ts`) or the `conversations.agent_status` column + `conversations.events`.
- **Map to plan lights:** `working` → running; `awaiting-input` → waiting-on-user; `idle`/`completed` → idle; `error` → blocked. `verifying`/`blocked` come from Brain item state and override these.
- `use-agent-hooks-status.ts` (`app/core/features/agents/api/browser/`) reports only whether hooks are **installed** (`agents.hooksStatus`), not live state. Use it to warn "status lights unavailable".

**New:** `app/core/features/lanes/node/lane-status.ts`: a pure mapper plus a subscription that publishes a `lanes.statuses` liveModel.

**Patch upstream?:** no.

**Risk:**

- If hooks are disabled, lanes have no lights and dispatch can't detect idle. Fall back to a Brain-MCP `complete_task` / `block` call as the authoritative signal.
- Hook entries carry an Emdash version marker, and Ninebrains shares `~/.claude/settings.json` with any installed Emdash. Version drift makes the two apps rewrite each other's entries every session. Keep the hook config version identical to upstream.

### 3.3 Port lease registry (1.4)

**Extend:**

- **Base port today:** `app/core/features/workspaces/api/node/workspace-env.ts` → `getTaskEnvVars()` sets `EMDASH_PORT = hash(portSeed)` (can collide). It is called from `app/core/features/tasks/api/node/task-session-launch-context.ts` (`TaskSessionLaunchContextResolver`) and flows into every PTY env as `providerVars` via `app/core/features/conversations/node/tui-conversation-provider.ts`.
- **Detection:** `pkg-core/services/preview-detection/node/url-detector.ts` regex-matches `localhost:<port>` in terminal output; `app/core/features/preview-servers/node/preview-server-service.ts` registers it and emits `previewServers.events`.
- The plan's "extend `port-forward-service`" is the **wrong seam**: `port-forward-service.ts` is SSH tunnelling only.

**New:** `app/core/features/port-leases/node/port-lease-service.ts`: lease per `(workspaceId, name)`, probe with `net.createServer().listen`, rebind on collision, persist in the Brain DB (§3.5). Subscribe to `previewServers.events` to reconcile "detected ≠ leased".

**Patch upstream?:** yes, 1 file. In `task-session-launch-context.ts`, set `EMDASH_PORT` (and `NINEBRAINS_PORT_*`) from an injected lease lookup when a lease exists (optional resolver dependency).

**Risk:** dev servers ignore `EMDASH_PORT` unless `.emdash.json` `scripts.run` uses it. Document `PORT=$EMDASH_PORT pnpm dev`.

### 3.4 Account meter (1.5)

**Extend:**

- **Auth status:** the `agents.auth` liveModel + `refreshAuthStatus` (`app/core/features/agents/api/contract.ts`). Plugins implement `auth.checkStatus`: Claude `pkg-plugins/agents/impl/claude/auth.ts`, Codex `codex login status`.
- **Account per lane** = config dir: `CLAUDE_CONFIG_DIR` / `CODEX_HOME`. Both are already in the agent env allowlist (`pkg-core/primitives/agent-env/api/index.ts`). Hook roots resolve from the same env (`envConfigRoot('CLAUDE_CONFIG_DIR','.claude')`), so hooks install into each account dir automatically.
- `app/core/features/account` is Emdash's own cloud account, **not** relevant.

**New:** `app/core/features/lanes/node/accounts.ts` keeps `{label, provider, configDir}` and runs each plugin's status check with that dir in env. `app/core/features/lanes/browser/account-badge.tsx`. Moving a lane = `tuiAgents.stop` + start with `providerVars.CLAUDE_CONFIG_DIR` set to the new dir.

**Patch upstream?:** shared with §3.7 (same `tui-conversation-provider.ts` hook).

**Risk:** D5: read status only; never read or copy token files. Settings-installed MCP servers are written only to the default root, not to extra config dirs.

### 3.5 Brain DB (2.1)

**Extend:**

- `pkg-core/primitives/sqlite-store/` (`defineDurableSqliteStore`, `betterSqlite3Driver`, `assertSqliteStoreInvariants`; read its `README.md`).
- Reference: `pkg-core/runtimes/automations/node/persistence/store.ts`, opened with `automationsStore.open(dbFile)` in `component.ts`.
- **Migration flow:** drizzle-kit config (`packages/core/drizzle-automations.config.ts`) → `scripts/bundle-drizzle-migrations.ts` → `migrations.generated.ts` (script `db:generate:automations` in `packages/core/package.json`).

**New:**

- `app/core/features/brain/node/db/`: `schema.ts`, `store.ts` (`brainStore`), `migrations/`, `repo.ts` (typed repository, one module per table).
- `apps/emdash-desktop/drizzle-brain.config.ts` + a `db:generate:brain` script reusing core's bundler.
- Tables:

  ```
  brain_items(id, project_id, title, body, state, lane_id, attempts, gate_spec, created_by)
  brain_edges(from_id, to_id)
  messages(id, from, to, body, attachments, read_at)
  runs(id, item_id, lane_id, mode, started, ended, exit, transcript_path)
  notes, done_log, lanes, port_leases, project_prefs, canvases
  ```

- Open in main at `join(app.getPath('userData'), 'ninebrains-brain.db')`. Inject the path from `app/main` (core may not call `app.getPath`), following `automationRuntimePaths` in `app/main/gateway/desktop-workers.ts`.

**Patch upstream?:** no. (Using the app DB would mean patching `app/core/services/app-db/node/schema.ts` and adding numbered migrations to `apps/emdash-desktop/drizzle/`, currently `0000`–`0046` + `meta/_journal.json`.)

**Decision: separate DB.** Upstream edits the drizzle journal constantly (every rebase would conflict), the app DB has single-writer registry rules, and Brain data is ours to back up and version. Cost: no foreign keys into Emdash rows. Store `project_id`/`task_id`/`conversation_id` as text and sweep orphans on `project:deleted` / task delete (`projectEvents` is already used in `services.ts`).

**Risk:**

- **The app DB path is hard-pinned to `<userData>/emdash/emdash4.db` "regardless of product identity"** (`app/main/db/default-path.ts`, `USER_DATA_DIR_NAME`). A Ninebrains build and an installed Emdash would share one DB and the worktree root `~/emdash/worktrees`. **Task 0.5 must change `USER_DATA_DIR_NAME`** (and `CURRENT_DB_FILENAME` if desired) plus `resolveDefaultUserDataPath`.
- Keep the Brain drizzle config's `schema` pointed at the Brain schema only, so nobody generates against the app schema by accident.

### 3.6 Brain MCP server (2.2)

**Extend:**

- Transport pattern: `pkg-core/runtimes/tui-agents/node/hooks/hook-server.ts` (`127.0.0.1`, random port, UUID token header). Reuse it for the lane-to-main channel.
- Launch pattern: `pkg-plugins/agents/impl/claude/index.ts` runs its ACP adapter as `process.execPath` + `ELECTRON_RUN_AS_NODE=1` with a script from `pkg-plugins/agents/helpers/adapter-assets.ts` (`resolveAdapterAsset`). Ship brain-mcp the same way, so users need no global Node.

**New:**

- `packages/brain-mcp/`: a stdio MCP server on `@modelcontextprotocol/sdk` + zod, a thin client forwarding each tool call as HTTP to main (`pnpm-workspace.yaml` already globs `packages/**`). Tools: `claim_task`, `complete_task`, `block`, `send_message`, `read_inbox`, `list_tasks`, `add_note`.
- `app/core/features/brain/node/brain-endpoint.ts`: HTTP endpoint in main with a token → laneId map that is **authoritative for identity**. Don't trust a `LANE_ID` claim alone; a lane holds only its own token, so it can't impersonate another. zod validation at the boundary.

**Patch upstream?:** yes: `apps/emdash-desktop/electron.vite.config.ts` + the electron-builder config (bundle the brain-mcp entry like adapter assets), and `apps/emdash-desktop/package.json` (dependency + `db:generate:brain`).

**Risk:** remote SSH hosts run the TUI remotely, where a stdio server can't reach local `127.0.0.1`. v0.1 = local-host lanes only; gate that in `LaneService`.

### 3.7 Per-launch MCP config + `LANE_ID` (2.3)

**Extend:** the only per-session injection point is `TuiAgentStartInput` (`pkg-core/runtimes/tui-agents/api/schemas.ts`):

- **`extraArgs: string[]`**, appended by `buildStandardCommand` (`pkg-core/services/agent-plugins/api/plugins/helpers/standard-command.ts`) *before* the positional initial prompt.
- **`providerVars: Record<string,string>`**, merged into the PTY env after the allowlisted base env, unfiltered (`EMDASH_TASK_*` travels this way).
- **Both are built in `TuiConversationProvider.buildStartInput()`** (`app/core/features/conversations/node/tui-conversation-provider.ts`): `extraArgs` from `providerConfig.extraArgs` (global per provider); `providerVars` = provider env + color env + launch-context env.
- Upstream MCP (`pkg-core/runtimes/agent-config/node/runtime/mcp.ts`, `AgentMcpConfigManager`) writes **global** files only (Claude `~/.claude.json` via `passthroughMcpAdapter('.claude.json')`; Codex `config.toml` via `codexMcpAdapter()`). Leave it untouched.

**New:** `app/core/features/brain/node/launch-config.ts`: `buildLaneLaunch(lane)` → `{ extraArgs, providerVars }`.

- Writes `<userData>/ninebrains/lanes/<laneId>/mcp.json` (brain-mcp + pack servers) **with `env: { NINEBRAINS_LANE_ID, NINEBRAINS_BRAIN_URL, NINEBRAINS_TOKEN }` inside the server entry**, rather than relying on the CLI passing its env to MCP children. Under userData, **not** in the worktree (git pollution).
- Claude: `--mcp-config <path>`. Codex: `-c mcp_servers.brain.command=…`, `-c mcp_servers.brain.args=[…]`, `-c mcp_servers.brain.env.NINEBRAINS_LANE_ID=…`.

**Patch upstream?:** yes, 1 file (`tui-conversation-provider.ts`). Add an optional `resolveLaneLaunch(conversationId) → {extraArgs, providerVars} | undefined` to `TuiConversationProviderDependencies` and merge its result (~10 lines). Wire it in `services.ts` inside `tuiConversationDependencies`.

**Risk (verify in 0.3):**

1. **Claude's `--mcp-config` is variadic**, and `buildStandardCommand` appends the initial prompt as a bare positional after `extraArgs` (Claude's `initialPromptFlag: ''`). The prompt may be swallowed as a second config path. Mitigation: never pass `initialPrompt` to Brain-dispatched lanes and paste instead (§3.8), or end the list with `--` if Claude accepts it.
2. Codex `-c mcp_servers.*` override syntax, and whether `-c` values persist across `codex resume`.
3. No hot-add of servers. Relaunch at the next `idle` status.

### 3.8 Dispatcher: attended paste and unattended spawn (2.4)

**Extend:**

- **Attended paste:** `tuiAgents.sendInput({ conversationId, data })` (contract `pkg-core/runtimes/tui-agents/api/contract.ts`; impl `runtime.ts` → `pty.write`). In main, the client is `(await runtimes.client(LOCAL_HOST_REF)).data.tuiAgents` (`RuntimeBroker`, `pkg-core/services/runtime-broker/api/runtime-broker.ts`; `services.ts` already calls `runtimes.client(LOCAL_HOST_REF)`). Data: bracketed paste `\x1b[200~${body}\x1b[201~` then `\r` (verify in 0.3). For Codex this also flips status to `working` via `markInputSubmitted`.
- **Output:** `tuiAgents.output` liveLog, or conversations `terminalOutput`.
- **Start a lane session:** `createConversation()` (`app/core/features/conversations/node/createConversation.ts`) then `launchTuiConversation()` (`launch-tui-conversation.ts`), both through the registry. Never insert into `conversations` directly (lint ban).
- **Unattended:** upstream has no print mode (`grep stream-json` finds nothing). Automations run a **headless interactive TUI** (`pkg-core/runtimes/automations/node/ports/session-start.ts` → `TuiSessionStartContract.start` with a prompt). For D6 we spawn `claude -p --output-format stream-json --mcp-config …` / `codex exec --json` ourselves, with env from `buildAllowlistedAgentEnv` (`pkg-core/primitives/agent-env/api`) + `mergeAgentEnvLayers`, and the binary resolved through the HostDependencies runtime (see `createDependencyManagerResolver`, `app/main/core/dependencies/dependency-managers.ts`).

**New:**

- `app/core/features/brain/node/dispatch/`: `dispatcher.ts` (loop + fairness), `attended.ts` (paste), `route.ts` (`pickLane` signature + TODO for Lucas, plan §8).
- `app/core/features/brain/node/exec/`: `claude-print.ts` (spawn `claude -p`, parse stream-json), `codex-exec.ts` (spawn `codex exec --json`, parse events), `run-supervisor.ts` (timeouts, kill, transcript file). Plain `child_process.spawn`: no PTY and no TUI hooks, so run status comes from the event stream.

**Patch upstream?:** no (the launch-hook patch is shared with §3.7).

**Risk:** provider spawning is high-risk per `AGENTS.md`: no `shell: true`, argv arrays, allowlisted env. Pasting while a lane is `awaiting-input` answers the permission prompt, so paste only when the lane is `idle` or `completed`.

### 3.9 Brain drawer UI (2.5, 2.6)

**Extend:**

- No workspace-level right-sidebar contribution point exists: `app/renderer/lib/layout/workspace-layout.tsx` has only a left sidebar + main. The task view's right sidebar is task-scoped (`app/core/features/tasks/browser/view/task-sidebar.tsx`).
- Chat with the Brain = a normal PTY conversation for a `claude` session launched with brain-mcp in brain mode (§3.7). No new chat UI.

**New:** `app/core/features/brain/browser/brain-drawer.tsx`, rendered **inside `lanes-view.tsx`** as a collapsible `Resizable.Panel`, with the unread badge (`brain.events`) and per-lane inboxes. Multi-brain: the `messages.to = 'brain:<id>'` convention.

**Patch upstream?:** no. **Risk:** the drawer shows only in the Lanes view; fine for v0.1.

### 3.10 Planner canvas (3.x)

**Extend:** the view system (as in §3.1) and `@xyflow/react` (new dependency).

**New:** `app/core/features/planner/`: `browser/planner-view.tsx` (view `planner`, params `{ projectId, canvasId? }`), `api/contract.ts` with `compile({ projectId, nodes, edges })`, and `node/compile.ts` (idempotent upsert keyed by node id, cycle detection via Kahn's algorithm) into the Brain DB. Canvas documents live in the Brain DB `canvases` table; mementos hold only viewport/pan/zoom.

**Patch upstream?:** yes: view catalog + browser contributions (already listed) and `apps/emdash-desktop/package.json` for the dependency. **Risk:** low, pure addition.

### 3.11 Gate framework (4.1)

**Extend:** notifications for `blocked` via `app/core/services/notifications/` (the agent-status producer in `node/producers/` is the template for a `brain-gate` producer). Feedback to the lane goes through the Brain mailbox or a paste (§3.8).

**New:** `app/core/features/gates/node/core/`:

- `gate.ts`: `interface Gate { id; appliesTo(item); run(ctx) → { pass, evidence[], feedback } }`.
- `runner.ts`: triggered by the Brain on `complete_task`. `verifying → running` (attempts+1), or `blocked` at 3 attempts.
- `evidence-store.ts`: files under `<userData>/ninebrains/evidence/<itemId>/` (not `.<app>/` in the worktree), paths recorded in the Brain DB.

**Patch upstream?:** no. Call the injected `NotificationService` rather than adding to the upstream producer index. **Risk:** the runner must be idempotent per `(itemId, attempt)` so a crash mid-gate can't double-count attempts.

### 3.12 Screenshot gate via CDP (4.2)

**Extend:**

- **Webview enabled:** `app/main/host/window.ts` sets `webviewTag: true`; `will-attach-webview` validates the partition and hardens preferences (`app/main/host/browser/webview-security.ts`). Webviews use browser-profile partitions.
- **Registry in main:** `app/main/host/browser/browser-webcontents-registry.ts` (`BrowserWebContentsRegistry`: `sessionsByBrowserId`, `webContentsByBrowserId`), filled by `bindWebContents`, which the renderer calls after `did-attach` with `webview.getWebContentsId()` (`browser-pane.tsx` passes `data-browser-id`).
- **Existing screenshot:** `captureScreenshotToClipboard` already calls `webContents.capturePage()`.

**New:**

- `app/main/host/ninebrains/cdp-gate-host.ts` (Electron allowed there): `wc.debugger.attach('1.3')`; `Emulation.setDeviceMetricsOverride` at 1440/768/390; `Page.captureScreenshot`; collect `Runtime.consoleAPICalled` / `Log.entryAdded` / `Network.loadingFailed`. Injected into `app/core/features/gates/node/screenshot-gate.ts` as a port.
- Headless fallback for unattended runs: an offscreen `BrowserWindow` on the same partition (`webPreferences.offscreen: true`), since a lane webview exists only while its pane is mounted.
- `pixelmatch` against a baseline. A `browser.*` MCP tool surface for self-check, re-implemented from Superset's *design* only.

**Patch upstream?:** yes, 1 file: add `getWebContents(browserId): WebContents | undefined` to `BrowserWebContentsRegistry` (5 lines).

**Risk:** attaching the debugger conflicts with open DevTools on that webview; detach on DevTools open and report "gate skipped". The lane needs a stable `browserId`, owned by `LaneService` and passed to `BrowserPane`.

### 3.13 Reviewer gate (4.3)

**Extend:** the exec path from §3.8.

**New:** `app/core/features/gates/node/reviewer-gate.ts`: a fresh unattended run with a read-only preset (Claude `--permission-mode plan` or `--allowedTools` limited to Read/Grep/Glob + the test command, verify in 0.3; Codex `exec --sandbox read-only`). Input: the item, `git diff` (git runtime via `runtimes.client(host).data.git`) and evidence. Output: zod-validated JSON.

**Patch upstream?:** no.

**Risk:** the reviewer must run on a **clean checkout or read-only sandbox** of the worktree; prompts alone aren't enough. Plan test 4.6 "reviewer cannot write" must be a real filesystem assertion. Prefer a different provider from the author (Claude builds, Codex reviews).

### 3.14 Tests gate (4.4)

**Extend:** `TaskSessionLaunchContextResolver.resolve()` for the project env and shell setup. The upstream `scripts` runtime (`pkg-core/runtimes/scripts/`) is lifecycle-only (one run per `(workspace, script)` for `prepare/setup/run/teardown`); **do not overload it**.

**New:** `app/core/features/gates/node/tests-gate.ts`: `child_process.spawn` of the project test command (from `project_prefs.test_command`, or detected from `package.json`) in the worktree, with a timeout and a tail-log excerpt as evidence.

**Patch upstream?:** no. **Risk:** long suites vs the unattended budget (§3.17 enforces it).

### 3.15 Rigor sliders (4.5)

**Extend:**

- **Global:** settings contributions (`defineSettingsContribution`, example `app/core/features/tasks/contributions/settings.ts`), stored by `app/core/services/settings/node/settings-store.ts`, read via `appSettings.get/update`.
- **Per-project:** `agents/architecture/settings.md` **forbids a new merged project-settings bag**, and `project_settings` JSON is owned by git/placement.

**New:** app setting `ninebrains: { testingRigor: 0-10, securityRigor: 0-10, ... }` in `app/core/features/brain/contributions/settings.ts`; per-project override in the Brain DB `project_prefs`; resolver `resolveRigor(projectId)` (project override > app default) in `app/core/features/gates/node/rigor.ts`, mapping rigor to the default `gate_spec`.

**Patch upstream?:** yes: `app/core/manifests/shared/settings-contributions.ts` + `app/core/manifests/node/settings-contributions.ts`. **Risk:** low.

### 3.16 Packs (5.1)

**Extend:**

- **Skills** install **globally** to `~/.agentskills/<name>/SKILL.md` (`pkg-core/runtimes/agent-config/node/runtime/skills.ts`, `SKILLS_ROOT = '.agentskills'`) from the bundled catalog `app/core/features/catalog/node/bundled-catalog.json` or skills.sh (`catalog-service.ts`).
- **MCP catalog entries:** `McpCatalogEntry` in `pkg-core/primitives/mcp/api/catalog.ts` + the live registry fetch.
- **No per-session skill or MCP scoping exists.**

**New:** `app/core/features/packs/`: `pack.json` loader (zod) + per-project toggle in `project_prefs`.

- Pack MCP servers reach lanes **only via the per-launch config** (§3.7), so packs are truly per-project.
- Pack skills install through the upstream skills manager with prefix `nb-<pack>-<skill>` (global but harmless).
- Roles = lane presets `{ systemPrompt, provider, model, gates }`. Bundled packs: `app/core/features/packs/node/bundled/<id>/pack.json`.

**Patch upstream?:** no. Server definitions live in `pack.json`, not upstream `catalog.ts`.

**Risk:** global skills leak across projects. Accept for v0.1, or later use a per-lane `CLAUDE_CONFIG_DIR` (collides with the account meter). The aeo-toolkit npm packages (`aeo-*-mcp`) still ship as MIT on npm per the relicense note, so the licence CI (0.4) must allow them.

### 3.17 Unattended runs, budgets, kill switch (6.x)

**Extend:** the automations runtime (`pkg-core/runtimes/automations/`, its own worker and `automations.db`): `scheduling/cron.ts`, `scheduling/scheduler.ts`, `runs/executor.ts` (provision worktree → `sessionPort.start` headless TUI with the prompt → markDone). It **can** kick off an unattended agent, but only as a new worktree with one TUI prompt. It's a runtime, so features can import its `api` only.

**New:** `app/core/features/brain/node/overnight/`:

- **queue runner:** its own tiny scheduler over `brain_items`.
- **budgets:** wall-clock, tokens (from stream-json `usage`), max concurrent runs.
- **global STOP:** `run-supervisor.killAll()` + `tuiAgents.stop` on Brain-owned lanes, with a 5 s deadline test.
- **scope guard:** path validation against the worktree + allowedTools presets. **Morning digest** via notifications.
- Optional: a built-in automation template in `app/core/features/automations/browser/builtin-catalog.ts` that starts a brain-mode conversation.

**Patch upstream?:** no (the optional template is a 1-file patch).

**Risk:** billing and terms are the biggest risk; follow D5/D6 wording. Never default to `--dangerously-skip-permissions`: upstream Claude sets it as `autoApproveFlag` whenever `autoApprove: true`, so Brain-created conversations must pass `autoApprove: false`.

## 4. Exec-path spike items (0.3 fills these in)

The spike owner records results here; the §3 items depend on them.

1. Claude `--mcp-config` variadic vs a positional prompt. Does `--` terminate the list? (§3.7)
2. Codex `-c mcp_servers.<n>.{command,args,env}` inline override, and whether it persists on `resume`. (§3.7)
3. Whether stdio MCP children inherit the CLI env. The design assumes not and bakes env into the config. (§3.7)
4. Bracketed-paste submit sequence for the Claude and Codex TUIs. (§3.8)
5. Read-only reviewer flags for `claude -p` and `codex exec`. (§3.13)
6. Stream-json `usage` fields for token budgets. (§3.17)

## 5. Test recipes

- **Runner:** Vitest projects in `apps/emdash-desktop/vitest.config.ts`:
  - `node` = `src/**/*.test.ts`;
  - `main-db` = `*.db.test.ts`, real SQLite via `tooling/node-deps` better-sqlite3;
  - `migrations` = `src/main/db/tests/migrations/**`;
  - `fixtures`, `scripts`;
  - `browser` = Playwright-backed, `*.browser.test.tsx` + `src/renderer/tests/browser/**`. CI skips it, as does `EMDASH_TEST_SKIP_BROWSER=1`.
- **One feature:**

  ```bash
  pnpm --dir apps/emdash-desktop exec vitest run --project node src/core/features/brain
  pnpm --dir apps/emdash-desktop exec vitest run --project main-db src/core/features/brain
  pnpm --dir apps/emdash-desktop exec vitest run --project browser src/core/features/lanes
  ```

  Core package tests run from `packages/core` (own `vitest.config.ts`). Lint `pnpm --dir apps/emdash-desktop run lint`; typecheck `pnpm --dir apps/emdash-desktop run typecheck` (tsgo); full gate `pnpm run check`.
- **Slice in isolation (renderer):** `seedSliceWire(domain, contract, impl)` from `@core/primitives/wire/browser/testing` with `cell`/`expose` from `@emdash/wire/state`. Template: `app/core/features/mcp/browser/mcp-slice.browser.test.tsx`.
- **Client unit tests:** stub the provider for DI clients, seed the wire for `domainClient`. Template: `app/core/features/dev-perf/api/browser/capture-trace.test.ts`.
- **DB tests:** Brain DB via `brainStore.openTemp()` (sqlite-store temp handle) in `*.db.test.ts`. App DB via `openFixture(name)` from `@tooling/utils/db` and `tooling/vitest/app-db-test-instance.ts`. Fixtures: `apps/emdash-desktop/tooling/fixtures/*.db`; seeds: `tooling/seeds/`.
- **TUI runtime fakes:** `pkg-core/runtimes/tui-agents/node/runtime/runtime.test.ts` (905 lines) fakes `PtySpawner`, `agentHost` and the clock. `pkg-core/services/pty/testing/` exports PTY test doubles.
- **Electron e2e: none exists upstream.** Task 1.6 creates `apps/emdash-desktop/e2e/` with Playwright `_electron.launch` from scratch. Budget for it, and keep it out of CI until stable (matching upstream's browser-project policy).

## 6. Rebase-risk hot spots

Upstream shipped 697 commits in the last 30 days. Files we patch, by churn (commits in 30 days):

| File | 30-day commits | Our patch | Mitigation |
|---|---|---|---|
| `app/main/bootstrap/boot/phases/services.ts` | 28 | construct Ninebrains services + launch hook | one call to `createNinebrainsServices()` |
| `app/core/manifests/node/controllers.ts` | 15 | `brain`, `lanes`, `planner`, `gates` entries + context fields | append-only block at end |
| `app/core/features/conversations/node/tui-conversation-provider.ts` | 7 | optional `resolveLaneLaunch` dependency | ~10 lines, isolated merge |
| `app/main/bootstrap/boot/wiring.ts` | 8 | pass services into context | 1 line per service |
| `app/core/manifests/shared/domain-contracts.ts`, `browser-contributions.ts`, `view-catalog.ts`, `memento-catalog.ts`, `settings-contributions.ts` (shared + node), `command-catalog.ts`, `command-palette-catalog.ts` | low–medium | registrations | append at end; alphabetical conflicts are trivial |
| `app/core/features/tasks/api/node/task-session-launch-context.ts` | medium | port-lease override | optional dependency |
| `app/main/host/browser/browser-webcontents-registry.ts` | low | `getWebContents()` accessor | 5 lines |
| `app/main/db/default-path.ts` | low | rebrand userData dir (task 0.5) | 1 constant |
| `apps/emdash-desktop/package.json`, `electron.vite.config.ts`, electron-builder config, `pnpm-lock.yaml` | high (lockfile) | dependencies, brain-mcp bundle, `db:generate:brain` | regenerate the lockfile on rebase, never hand-merge |

**Deliberately avoided:** `app/core/services/app-db/node/schema.ts` + `drizzle/` (separate Brain DB), the task split-pane system, the workspace layout, PTY / tui-agents runtime internals, provider plugins, and the upstream MCP writer. Record every patch in `docs/UPSTREAM-PATCHES.md` as it lands.

## 7. Kill-criterion verdict

- **Patch estimate ≈ 20–24 upstream files:** ~11 manifest/registration files (the manifest row of §6 + `wiring.ts` + `services.ts`); 3 spawn/launch hooks (`tui-conversation-provider.ts`, `task-session-launch-context.ts`, `browser-webcontents-registry.ts`); 1 rebrand constant; ~5 build/package files (desktop `package.json`, `electron.vite.config.ts`, builder config, lockfile, optional automations template); ~2 optional (sidebar entry, notification producer index).
- **Denominators:** 5,038 tracked files → **≈0.5%**; 3,313 non-test TS/TSX → **≈0.7%**; 2,362 desktop-app TS → **≈1%**. Every count is far under the 30% threshold.
- **Structural fit:** lanes, Brain, Planner, gates and packs all fit as new feature slices behind the existing manifests. The two places Emdash "fights" the model both have clean answers:
  1. **Task-scoped UI:** the grid can't reuse the task split view, so it is its own view over conversation-keyed output streams.
  2. **Global-only MCP:** per-launch `extraArgs` + `providerVars` through one small hook.

  Neither touches the PTY runtime, the provider plugins or the app DB schema.
- **Verdict: GO**, on three conditions:
  1. Task 0.5 changes `USER_DATA_DIR_NAME` so we never share Emdash's DB.
  2. Task 0.3 resolves the `--mcp-config` / positional-prompt question before 2.3 starts.
  3. Every upstream patch is logged in `docs/UPSTREAM-PATCHES.md`, and weekly rebases stay the norm given upstream's ~23 commits/day.
