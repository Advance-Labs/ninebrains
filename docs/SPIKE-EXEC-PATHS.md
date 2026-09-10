# Spike 0.3: execution paths (attended + unattended, Claude + Codex)

Task 0.3 of `2026-09-10-oss-agent-workbench.md` (decisions D5, D6, D7). Date: 2026-09-10.

Every claim is tagged **[verified]** (I ran it on this machine) or **[docs]** (read in `--help`,
Context7 docs, generated protocol schema, or package type definitions). Nothing here logged in,
logged out, or read a credential (D5).

**Environment:** macOS 26 arm64, Node 25.8.1, Claude Code **2.1.267** (auto-updated to 2.1.268
before the zero-token variadic probe), Codex CLI **0.154.0** (via
`npx -y @openai/codex@latest`, not installed, not logged in), `node-pty` 1.1.0 (same as Emdash),
`@modelcontextprotocol/sdk` 1.30.0. Real model calls: 6 `claude` launches on `--model haiku`
(one exited at the trust dialog before any request), total cost reported by the CLI about $0.30.

## 0. Answers in one screen

| Question | Answer |
|---|---|
| Attended Claude | `claude --mcp-config=<lane.json> --strict-mcp-config --settings <lane-settings.json> --session-id <uuid> --no-chrome [--model M]` in node-pty; submit with bracketed paste, then a separate `\r` **[verified]** |
| Unattended Claude | `claude -p "<prompt>" --output-format stream-json --verbose --mcp-config=<lane.json> --strict-mcp-config --allowedTools mcp__brain --permission-mode dontAsk --session-id <uuid> --max-turns N` with `ENABLE_TOOL_SEARCH=false`, stdin closed **[verified]** |
| MCP injection | Per-launch `--mcp-config` JSON with the lane id in the server's `env`; `--strict-mcp-config` drops the user's other servers. No approval prompt for servers passed this way **[verified]** |
| Prompt vs variadic flags | `--mcp-config <f> "prompt"` eats the prompt as a second config path and exits 1 ("MCP config file not found: .../prompt") in both `-p` and the TUI. **Always write `--mcp-config=<f>`** (one flag per file). `-p`: prompt right after `-p`, or on stdin. Attended: no argv prompt; paste after `SessionStart` **[verified, zero tokens]** (§3.1) |
| Hot-load | Editing the `--mcp-config` file mid-session does **not** add servers **[verified]**. A connected server **can** add tools mid-turn via `notifications/tools/list_changed` **[verified]**. So: one Brain server per lane that grows its own tool set; anything else = restart at idle with `--resume` |
| Lane state | Hooks via per-launch `--settings`: `UserPromptSubmit` = running, `PermissionRequest` = waiting-on-user (fires in ~0.1 s), `Stop` = idle, `SessionEnd` = exited **[verified]**. No screen scraping, except for first-run dialogs before `SessionStart` |
| Multi-account | One `CLAUDE_CONFIG_DIR` per account. An empty dir reports `loggedIn: false` even though the default dir is logged in via the macOS Keychain, so credentials are scoped per dir **[verified]**. Codex: `CODEX_HOME` **[verified]** |
| Usage meter | Attended: statusline JSON `rate_limits.five_hour/seven_day.used_percentage` **[verified]**. Unattended: `rate_limit_event` in stream-json **[verified]**. Codex: app-server `account/rateLimits/read` + `account/rateLimits/updated` **[verified exists, needs login]** |
| Codex | Attended `codex -c mcp_servers.brain.command=... --cd <wt> --no-alt-screen`; unattended `codex exec --json ...`; or `codex app-server` (JSON-RPC stdio) with per-thread `config` **[verified up to auth]** |
| Fake agent | `tooling/fake-agent/`, zero deps, 35 `node --test` tests passing, event shapes checked against 3 real captures |

## 1. Claude attended path (PTY)

Script: `spikes/exec-paths/attended.mjs <workdir> <outdir>`. Final run timeline **[verified]**:

```
+0.4s first render          +4.1s SessionStart hook       +4.4s prompt submitted
+4.6s UserPromptSubmit      +6.6s PreToolUse mcp__stub__ping
+6.7s PermissionRequest     +12.7s Notification(permission_prompt)
+16.9s Enter (approve)      +17.0s PostToolUse            +18.2s Stop  -> stub log: ping@lane-B
+18.3s edit --mcp-config on disk (add stub2) -> /mcp shows only "stub · connected · 2 tools"
+22.8s prompt 2             +25.0s claim_task (registers late_tool, list_changed)
+26.9s late_tool called in the SAME turn    +28.0s Stop       +30.6s SessionEnd (/exit)
```

### Recommended launch

```bash
claude \
  --mcp-config="$LANE_DIR/mcp.json" --strict-mcp-config \
  --settings "$LANE_DIR/settings.json" \
  --session-id "$LANE_SESSION_UUID" \
  --no-chrome \
  --model "$MODEL"                    # optional
# cwd = lane worktree; env = Emdash allowlisted agent env + LANE_ID, CLAUDE_CONFIG_DIR (account)
```

- `--session-id <uuid>`: deterministic transcript id, relaunch with `--resume <uuid>` **[verified in -p]**.
- `--setting-sources project,local` (used in the spike) drops the user's settings, hooks and plugins
  **[verified]**. Not for real lanes: users expect their own skills. `--settings` hooks apply either way.
- `--no-chrome` avoids the blocking "Claude in Chrome extension detected" dialog **[verified]**.

### TUI input recipe [verified]

1. **Wait for the `SessionStart` hook before typing anything.** First-run dialogs block the input
   box, and `SessionStart` fires only once they are gone. In run 4 the first prompt was pasted
   into the Chrome dialog, dismissed it, and was lost.
2. Write `ESC[200~` + text + `ESC[201~` (bracketed paste). Multi-line text stays one prompt.
3. Wait about 300 ms, then write `\r` as a **separate** write. That submits.
4. Confirm with the `UserPromptSubmit` hook (0.2 s after `\r`); its `prompt` field echoes the text.
5. Slash commands (`/mcp`, `/exit`) are typed as plain text followed by `\r`; `ESC` closes panels.

### First-run dialogs [verified]

| Dialog | Default option | Handling |
|---|---|---|
| Workspace trust ("Is this a project you created or one you trust?") | **"No, exit"**: a bare Enter quits with exit code 1 | Pre-trust the worktree in `<CLAUDE_CONFIG_DIR>/.claude.json` (`projects[path].hasTrustDialogAccepted`) as Emdash's `claude/trust.ts` does, or send Down then Enter |
| Claude in Chrome | "No, keep browser tools off" | `--no-chrome` |
| Any (detection) | Screen shows `Enter to confirm` before `SessionStart` | Handle, then keep waiting for `SessionStart` |

### Permission and idle detection [verified]

An MCP tool not covered by `--allowedTools` raises a dialog: `PreToolUse`, then `PermissionRequest`
0.1 s later, then `Notification(permission_prompt)` about 6 s later. Enter picks the default "Yes".
`Stop` marks the free input box and carries `last_assistant_message` (`"pong from lane lane-B"`), so
the final answer needs no scraping. `SessionEnd` has `reason: "prompt_input_exit"` after `/exit`.

## 2. Hooks for lane state

Per-launch `--settings <file>` hooks work and touch no user config **[verified]**. Upstream instead
installs global hooks into `<CLAUDE_CONFIG_DIR>/settings.json`, which its `tui-agents` runtime reads.

| Hook | Lane status | Key payload fields [verified] |
|---|---|---|
| `SessionStart` | ready (TUI accepts input) | `source` (`startup`/`resume`), `model` |
| `UserPromptSubmit` | running | `prompt`, `prompt_id`, `permission_mode` |
| `PreToolUse` / `PostToolUse` | running (tool activity) | `tool_name`, `tool_input`, `tool_use_id`, `tool_response` |
| `PermissionRequest` | waiting-on-user | `tool_name`, `tool_input`, `permission_suggestions` |
| `Notification` | waiting-on-user (slow, backup) | `message`, `notification_type` |
| `Stop` | idle | `stop_hook_active`, `last_assistant_message` |
| `SessionEnd` | exited | `reason` |

Every payload also carries `session_id`, `transcript_path`, `cwd` and, in 2.1.267,
`scratchpad_dir`. Hook commands inherit the claude process env, so `LANE_ID` reaches them **[verified]**.
A `PreToolUse` hook that exits 2 blocks the call **[docs]**, which is a natural hook for gates.

**Mapping onto upstream lane states** (`packages/core/src/runtimes/tui-agents/node/runtime/agent-state.ts`,
`claude/hooks.ts`). Upstream installs 4 Claude hooks: `UserPromptSubmit` → `start` → **working**;
`Stop` → `stop` → **completed**; `Notification` → **awaiting-input** if `notification_type` is
`permission_prompt`, `idle_prompt` or `elicitation_dialog`, else **idle**; `SessionStart` →
`session` (records the provider session id only). No Claude hook produces **error** upstream.
Recommended additions: `PermissionRequest` → **awaiting-input** (fires ~6 s before the
`Notification`), and `SessionEnd` → lane exited. For unattended runs, map `result.is_error`
(not `subtype`, see gotcha 15) → **error**.

Codex has the same event names (`PreToolUse`, `PermissionRequest`, `PostToolUse`, `SessionStart`,
`UserPromptSubmit`, `Stop`, `SessionEnd`, ...) configured in `config.toml` `[[hooks.<Event>]]` or
`hooks.json`, and app-server exposes `hooks/list`, `hook/started`, `hook/completed` **[docs]**.

## 3. Claude unattended path (`-p` stream-json)

Script: `spikes/exec-paths/unattended.mjs` (real claude, or the fake via `CLAUDE_BIN`).

### Recommended launch

```bash
ENABLE_TOOL_SEARCH=false claude -p "$PROMPT" \
  --output-format stream-json --verbose \
  --mcp-config="$LANE_DIR/mcp.json" --strict-mcp-config \
  --allowedTools mcp__brain \
  --permission-mode dontAsk \
  --session-id "$RUN_UUID" \
  --max-turns 30 \
  --append-system-prompt "$LANE_BRIEF" \
  --model "$MODEL" < /dev/null
```

Resume a run: replace `--session-id` with `--resume "$RUN_UUID"`. Upstream Emdash has no
`-p`/`exec` path at all, so this recipe is new code in Ninebrains.

### 3.1 Prompt placement vs variadic flags [verified, zero tokens]

`--mcp-config`, `--allowedTools`, `--disallowedTools`, `--add-dir` and `--tools` are variadic.
Upstream `buildStandardCommand()` (`standard-command.ts`) appends `extraArgs` and then the
positional initial prompt, so a lane `extraArgs` ending in `--mcp-config <file>` hits this trap.
Probe: `spikes/exec-paths/variadic-probe.mjs`, run with an empty `CLAUDE_CONFIG_DIR` so every case
stops at "Not logged in" before any model request (Claude Code 2.1.268).

| Form | Result |
|---|---|
| `-p --mcp-config a.json "say hi"` | exit 1, `MCP config file not found: <cwd>/say hi` |
| `--mcp-config a.json "say hi"` (TUI) | exit 1, same error, before the UI renders |
| `-p --mcp-config=a.json "say hi"` | prompt accepted, `stub` connected |
| `--mcp-config=a.json "say hi"` (TUI) | TUI starts normally |
| `-p "say hi" ... --mcp-config a.json` | prompt accepted, `stub` connected |
| `-p --mcp-config a.json -- "say hi"` | prompt accepted, `stub` connected |
| `-p --mcp-config a.json` + prompt on stdin | prompt accepted, `stub` connected |
| `--mcp-config=a.json --mcp-config=b.json` | both servers connected (repeats accumulate) |
| `--mcp-config a.json b.json` | both servers connected |
| `--mcp-config '<inline JSON>'` | server connected |

**Recommendation:** emit every variadic flag in `--flag=value` form, one flag per value
(`--mcp-config=a --mcp-config=b`, `--allowedTools=mcp__brain`). It is immune to argument order, so
it is safe inside upstream `extraArgs`. For `-p`, also put the prompt directly after `-p`, or pipe
it on stdin when it is long (avoids argv length limits and shell quoting). For attended lanes, pass
no argv prompt: paste it after `SessionStart` (§1). The fake agent reproduces the swallowing, so
tests catch a regression.

### Event stream [verified, fixtures in `tooling/fake-agent/fixtures/`]

`system/init` (has `session_id`, `tools`, `mcp_servers: [{name, status: "connected"}]`, `model`,
`permissionMode`, `apiKeySource`) → `rate_limit_event` → `system/thinking_tokens`* → `assistant`
(content `thinking` | `text` | `tool_use {id, name: "mcp__stub__ping", input}`) → `user` (content
`tool_result {tool_use_id, content, is_error}`, plus top-level `tool_use_result`) → ... → `result`.

`result` on success: `subtype: "success"`, `is_error: false`, `result` (final text), `num_turns`,
`session_id`, `total_cost_usd`, `usage`, `modelUsage`, `permission_denials`,
`terminal_reason: "completed"`. On `--max-turns` exhaustion: `subtype: "error_max_turns"`,
`is_error: true`, **no `result` key**, `errors: ["Reached maximum number of turns (1)"]`,
`terminal_reason: "max_turns"`, `stop_reason: "tool_use"`, `num_turns` = max + 1, process exit 1.

### Flags checked

| Flag | Status | Finding |
|---|---|---|
| `--mcp-config <files-or-json...>` | [verified] | Variadic. Stub connected, tools `mcp__stub__{ping,claim_task}` listed in init |
| `--strict-mcp-config` | [verified] | Exists; only `--mcp-config` servers loaded |
| `--allowedTools` | [verified] | Pre-approves; **not** a restriction (see gotcha 5) |
| `--disallowedTools Bash` | [verified] | Removes the tool from `init.tools`; a call gets "No such tool available" |
| `--permission-mode dontAsk` | [verified] | Choices: `acceptEdits auto bypassPermissions manual dontAsk plan` |
| `--append-system-prompt` | [verified] | Accepted; lane brief reached the model |
| `--max-turns` | [verified] | Shape above |
| `--session-id` / `--resume <id>` | [verified] | Resume keeps the same `session_id` and history. It costs cache creation: run 2 cost 3x run 1 |
| `--no-session-persistence` | [verified] | `-p` only; used for the max-turns probe |
| `--setting-sources project,local` | [verified] | Drops user hooks/plugins |
| `--continue`, `--fork-session`, `--add-dir`, `--tools`, `--input-format stream-json`, `--include-hook-events`, `--permission-prompts none`, `--bare`, `--json-schema` | [docs] | In `claude --help` for 2.1.267 |

**Billing observation [verified]:** `-p` runs on a Max login report `apiKeySource: "none"` and a
`rate_limit_event` against the subscription's `five_hour` and `seven_day` windows. So today the
unattended path draws on the same subscription limits as attended lanes. See §9.

## 4. MCP injection

Lane config written by `spikes/exec-paths/lib.mjs#writeLaneMcpConfig` **[verified]**:

```json
{ "mcpServers": { "brain": { "type": "stdio", "command": "/abs/node", "args": ["/abs/brain-mcp.js"],
    "env": { "LANE_ID": "lane-A", "BRAIN_SOCKET": "..." }, "alwaysLoad": true } } }
```

- The lane id travels in the server's `env`. The stub's `ping` returned `pong from lane lane-A`, so
  the Brain knows which lane is calling without trusting the model **[verified]**.
- `alwaysLoad: true` keeps that server's tools out of tool search **[docs]**. Alternatively set
  `ENABLE_TOOL_SEARCH=false` for the whole process **[verified]**.
- `claude mcp add` has scopes `local` (default, `~/.claude.json` per project), `project`
  (`.mcp.json`) and `user` **[docs: help]**. Ninebrains should not use it: it writes user config,
  and `.mcp.json` servers need approval.

## 5. MCP hot-load

1. **Adding a server mid-session: no [verified].** After `stub2` was added to the `--mcp-config`
   file on disk, `/mcp` still listed only `stub · connected · 2 tools`. `/mcp` manages
   existing servers only (reconnect, enable, disable) **[docs]**.
2. **Adding tools to a connected server: yes [verified].** The stub registers `late_tool` inside
   `claim_task`, and the SDK emits `notifications/tools/list_changed`. Claude refreshed and called
   `late_tool` in the same turn. This matches the "dynamic tool updates" docs **[docs]**.

**Design consequence:** give every lane exactly one Brain MCP server and let it add or remove tools
(for example discipline-pack tools) with `list_changed`. For new third-party servers, use the
restart-at-idle fallback: wait for `Stop`, send `/exit\r`, wait for `SessionEnd`, then relaunch
with the new `--mcp-config` and `--resume <session-uuid>`. Codex app-server also has
`config/mcpServer/reload` **[docs: schema]**.

## 6. Multi-account

- **Claude: `CLAUDE_CONFIG_DIR=<dir>` per account [verified + docs].** With an empty temp dir,
  `claude auth status --json` returned `{"loggedIn": false, "authMethod": "none"}` and exit 1,
  while the default dir is logged in (`authMethod: "claude.ai"`, `subscriptionType: "max"`). On
  macOS the credential lives in the Keychain, so the Keychain entry is evidently keyed by the
  config dir. The docs say this is how to "run multiple accounts side by side". The temp dir was
  deleted. Running `claude` with the empty dir only created `.claude.json` and `backups/`.
- Everything else is per dir too: `.claude.json` (trust state, MCP), `settings.json`, projects and
  transcripts. Ninebrains must pre-trust each worktree in **each** account's dir.
- **Detection without credentials:** `CLAUDE_CONFIG_DIR=<dir> claude auth status --json` returns
  `loggedIn`, `authMethod`, `subscriptionType`, `email` **[verified]**. Emdash's `claude/auth.ts`
  already parses this. For D5, the user runs `claude auth login` themselves in a terminal with that
  env set; Ninebrains never drives it.
- **Codex: `CODEX_HOME=<dir>` [verified].** Empty dir → `codex login status` prints `Not logged in`,
  exit 1. `--ignore-user-config` still uses `CODEX_HOME` for auth **[docs: help]**.

## 7. Usage-meter data source (no credentials)

| Path | Source | Shape |
|---|---|---|
| Claude attended | `statusLine` command in `--settings`; stdin JSON on every refresh | `rate_limits.five_hour.used_percentage`, `.resets_at`, same for `seven_day`; also `cost.total_cost_usd`, `context_window.used_percentage` **[verified]** |
| Claude unattended | `rate_limit_event` in stream-json | `rate_limit_info.unifiedWindows.{five_hour,seven_day}.{utilization 0-1, resetsAt}`, `status`, `overageStatus` **[verified]** |
| Codex | app-server `account/rateLimits/read`, `account/rateLimits/updated` notification | `rateLimits.primary/secondary.{usedPercent, windowDurationMins, resetsAt}`, `planType` **[docs: schema; verified that it errors "authentication required" without login]** |

`rate_limits` is absent from the statusline until the first API response of the session **[verified]**.
Only Claude.ai subscribers get it **[docs]**. The meter is per account (per config dir), so one
reading covers every lane on that account.

## 8. Codex

Nothing ran against a model (not installed, not logged in). Everything up to the auth boundary is
verified with an empty `CODEX_HOME`.

**MCP per launch [verified]:** `-c` takes dotted TOML paths. `codex mcp list --json -c
'mcp_servers.stub.command="node"' -c 'mcp_servers.stub.args=["/abs/stub.mjs"]' -c
'mcp_servers.stub.env={LANE_ID="lane-C"}'` listed the server with that env.

**Attended [docs: help]:**

```bash
codex -c mcp_servers.brain.command="\"/abs/node\"" -c 'mcp_servers.brain.args=["/abs/brain.js"]' \
  -c 'mcp_servers.brain.env={LANE_ID="lane-C"}' \
  --cd "$WORKTREE" -s workspace-write -a on-request --no-alt-screen [-m MODEL] ["$PROMPT"]
```

`--no-alt-screen` keeps scrollback, which helps PTY capture. Lane state: Codex hooks (§2).

**Unattended [verified up to auth]:**
`codex exec --json -C "$WORKTREE" -s workspace-write <same -c flags> "$PROMPT" < /dev/null`.
JSONL events: `thread.started {thread_id}`, `turn.started`, `item.started|updated|completed
{item}`, `turn.completed {usage}`, `turn.failed {error}`, `error {message}` **[verified: first two,
error, item.completed(error), turn.failed; docs for the rest]**. Item types: `agent_message`,
`reasoning`, `command_execution`, `file_change`, `mcp_tool_call {server, tool, arguments, result?,
error?, status}`, `web_search`, `todo_list`, `error` **[docs: @openai/codex-sdk 0.154.0 types]**.
Resume: `codex exec resume <thread_id>` **[docs]**. Without auth it retried 5x over WebSocket and 5x
over HTTPS (about 15 s), then `turn.failed`, exit 1 **[verified]**.

**App server [verified up to auth]:** `codex app-server` (stdio JSON-RPC, one JSON per line).
`initialize {clientInfo}` → `initialized` notification → `thread/start {cwd, ephemeral, config:
{"mcp_servers.stub.command": ..., ...}}` returned a thread. Notifications followed:
`mcpServer/startupStatus/updated` (starting, then ready). Then `mcpServerStatus/list {threadId}`
showed `stub` connected with `ping` and `claim_task`. That is per-thread MCP injection with no
config file. Then `turn/start {threadId, input:[{type:"text", text}]}` drives a turn, with
`item/*` and `turn/completed` notifications and server→client approval requests
(`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`,
`mcpServer/elicitation/request`) **[docs: `codex app-server generate-ts`]**. Probe:
`spikes/exec-paths/codex-app-server-probe.mjs`. The app-server is the better Codex unattended
path: typed, resumable, and it exposes rate limits.

## 9. Contradictions with the plan and with Emdash

1. **D6 billing:** the plan says unattended `claude -p` uses "Agent SDK credit, then the user's
   API key". On a Max login, 2.1.267 `-p` reported `apiKeySource: "none"` and a
   `rate_limit_event` against the subscription `five_hour`/`seven_day` windows. Today, unattended
   runs appear to draw on the same subscription limits. D6's "never market unlimited overnight"
   still stands, but the credit model in D6 does not match observed behaviour. Lucas should
   confirm the current policy before Phase 6.
2. **Task 0.3 output location:** the plan puts findings in `SEAMS.md`. Per the lead's brief they
   are here. `SEAMS.md` (0.2) should link this file.
3. **Emdash `claude/hooks.ts` comment** says Claude's `Notification` payload has no
   `notification_type`. It does in 2.1.267 (`"permission_prompt"`) **[verified]**. The regex
   fallback still works, but `PermissionRequest` is faster and should drive waiting-on-user.
4. **D7 PTY fallback nudge:** it works (bracketed paste recipe), but only after `SessionStart` and
   only when the lane is idle (`Stop`), or the text lands in a dialog or mid-turn.
5. Hot-load is only half-possible (§5). The Brain design should assume one Brain server per lane.
6. **Upstream arg order is a live trap:** `buildStandardCommand()` puts the positional prompt after
   user `extraArgs`. Any lane that injects `--mcp-config <file>` through `extraArgs` loses its prompt
   and the CLI exits 1 (§3.1). Fix: `--mcp-config=<file>` form, or no argv prompt.

## 10. Gotchas

1. **node-pty `posix_spawnp failed`** when npm skips install scripts (npm's `allow-scripts`
   warning): the prebuilt `prebuilds/darwin-*/spawn-helper` is not executable. Fix:
   `chmod +x node_modules/node-pty/prebuilds/*/spawn-helper` **[verified]**. The Electron build must
   check this.
2. **Trust dialog defaults to "No, exit"** (§1).
3. **Typing before `SessionStart`** loses the prompt into a dialog (§1).
4. **MCP tools are deferred behind `ToolSearch` by default.** In run 1, Haiku spent 2 of its 4
   turns finding the tool. Set `ENABLE_TOOL_SEARCH=false` or `alwaysLoad: true` on the Brain
   server **[verified]**.
5. **`--allowedTools` pre-approves; it does not restrict.** With only `mcp__stub__ping` allowed in
   default mode, Haiku still ran `Bash: echo ...` (read-only commands are auto-approved). Restrict
   with `--tools`, `--disallowedTools`, or `--permission-mode dontAsk` plus an allow list **[verified]**.
6. **Variadic flags swallow the prompt.** `claude -p --allowedTools x "hello"` fails with "Input
   must be provided", and `--mcp-config f "hello"` fails with "MCP config file not found"
   **[verified, zero tokens]**. Use `--flag=value` (§3.1).
7. **`--output-format stream-json` needs `--verbose` with `-p`**, or it exits 1 **[verified, zero tokens]**.
8. **Close stdin** (`< /dev/null`, `stdio: 'ignore'`). Otherwise claude waits 3 s ("no stdin data
   received") and `codex exec` waits for "additional input from stdin" **[verified]**.
9. **Env leaking from a parent Claude session** (`CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`,
   `CLAUDE_CODE_SESSION_ID`, ...) turns transcript saving off in the child: "Transcript saving is
   off — inherited CLAUDE_CODE_CHILD_SESSION marker" **[verified]**. Emdash's allowlisted agent env
   (`packages/core/src/primitives/agent-env/api/index.ts`) already excludes these; never spawn with
   raw `process.env`.
10. **`Notification(permission_prompt)` lags about 6 s** behind `PermissionRequest` **[verified]**.
11. **Resuming reloads context**: run 2 (`--resume`) cost 3x run 1 in cache creation **[verified]**.
12. **`--mcp-config` edits mid-session are ignored** (§5).
13. **Haiku will not call a tool it cannot see yet.** Before `late_tool` existed it asked a question
    instead. Brain instructions must say the tool appears after `claim_task` **[verified]**.
14. **The user's default permission mode can be `auto`**, which is "unavailable for this model" on
    Haiku; the TUI fell back to manual **[verified]**. Pass `--permission-mode` explicitly per lane.
15. **A logged-out account "succeeds".** `-p` on a logged-out config dir emits `result` with
    `subtype: "success"`, `is_error: true`, `terminal_reason: "api_error"`, `result: "Not logged in ·
    Please run /login"`, an assistant message with `error: "authentication_failed"` and model
    `<synthetic>`, and exits 1 **[verified]**. Decide success by `is_error` and the exit code, never by
    `subtype`. Run `claude auth status --json` before dispatching to an account.
16. **The CLI auto-updates under you.** It went from 2.1.267 to 2.1.268 in the middle of this spike
    **[verified]**. Record `init.claude_code_version` for every run and re-run the fixture shape tests
    after upgrades.

## 11. Fake agent (`tooling/fake-agent/`)

Zero-dependency Node ESM CLI, `bin/fake-claude.mjs`. Run `npm test` in that dir: **35 tests, all
passing** (`node --test "test/*.test.mjs"`). One test talks to the SDK-based stub in
`spikes/exec-paths/` and one drives the fake through real node-pty. Both skip if
`spikes/exec-paths` has not been `npm install`ed.

- **Flags:** `-p`, `--output-format text|json|stream-json`, `--verbose`, `--mcp-config` (files or
  JSON, variadic), `--strict-mcp-config`, `--model`, `--allowedTools`, `--disallowedTools`,
  `--tools`, `--append-system-prompt`, `--system-prompt`, `--resume [id]`, `--continue`,
  `--session-id`, `--max-turns`, `--permission-mode`, `--settings`, `--setting-sources`,
  `--add-dir`, `--dangerously-skip-permissions`. Unknown flags exit 1 like the real CLI, so
  launch-command typos fail in tests. Commander's variadic swallowing is reproduced.
- **Script:** `FAKE_AGENT_SCRIPT=<file or inline JSON>`, an array of steps: `{say}`,
  `{callTool: {server, tool, args}}` (a real MCP stdio call, `list_changed` followed),
  `{writeFile: {path, content}}`, `{sleep}`, `{waitForInput: true}` (interactive turn boundary),
  `{exit}`. `{{prompt}}` and `{{lastToolResult}}` interpolate.
- **Faithful behaviour:** stream-json event keys are checked as a subset of the real captures
  (`claude-p-ping.jsonl`, `claude-p-resume-claim-task.jsonl`, `claude-p-max-turns.jsonl`). The
  success and `error_max_turns` results match the real ones. `-p` denies tools that are not
  allowed and records them in `permission_denials`. Hooks from `--settings` fire (`SessionStart`,
  `UserPromptSubmit`, `Pre/PostToolUse`, `PermissionRequest`, `Notification`, `Stop`,
  `SessionEnd`), and a `PreToolUse` exit 2 blocks the call. `ENABLE_TOOL_SEARCH=false` removes
  `ToolSearch`.
- **Interactive (no `-p`):** banner, `> ` prompt, `you said: <line>`, runs the script to the next
  `waitForInput`. Accepts the same bracketed-paste + `\r` recipe as real claude, and shows a
  permission prompt ("1" or Enter approves) with the matching hooks.
- **Test helpers:** `FAKE_AGENT_ARGV_LOG` (argv, cwd, lane id per launch); `FAKE_AGENT_RATE_LIMIT`.
- **Not emulated:** real TUI rendering and first-run dialogs, `statusLine` invocation, transcript
  persistence (`--resume` of an unknown id succeeds), HTTP/SSE MCP servers (reported `failed`),
  text-mode error wording, partial messages, stream-json input. `unattended.mjs` runs unchanged
  against the fake with `CLAUDE_BIN=.../fake-claude.mjs` **[verified]**.

## 12. Files

`spikes/exec-paths/` (own `package.json`; `npm install`, then gotcha 1): stub, attended, unattended,
variadic and Codex app-server probes, hook and statusline loggers, fixture sanitiser.
`tooling/fake-agent/`: `bin/`, `src/`, `test/`, `fixtures/` (sanitised real captures).
