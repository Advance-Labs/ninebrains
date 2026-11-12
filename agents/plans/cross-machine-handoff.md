# Plan: continue a task on another machine, with shared memory of past work

Target behavior: the user works on a task on the Mac laptop, clicks **Continue on…**, picks the
Windows desktop, and the task opens there with the same branch, the uncommitted changes, the
agent conversation and a handoff note. Later they hand it back the same way. Every machine can
also search a shared memory of what agents did across all tasks.

**Headline: hand work over, do not sync live state.** A running agent process stays on the
machine that started it. What moves is a *handoff bundle*: the work-in-progress commit, the task
record, the agent transcript and a note. This is how Pane does it (`runpane handoff`, see
[Competitive context](#competitive-context)). It works natively in both directions between macOS
and Windows, needs no server, and stays inside the "no hosted agent cloud" rule
(`docs/strategy/00-north-star.md:160`).

Written 2026-11-11 against `main` at `372ed5c07`.

## What exists today (verified, do not re-derive)

| Piece | State | Source |
|---|---|---|
| Resume handle per conversation | `conversations.provider_session_id` stores the agent's session id | `apps/emdash-desktop/src/core/services/app-db/node/schema.ts:445` |
| Resume flags per provider | Claude declares `resumeFlag: '--resume'`, `sessionIdFlag: '--session-id'` | `packages/plugins/src/agents/impl/claude/index.ts:166` |
| Resume outcome tracking | TUI runtime records `resumed \| attached \| fresh-fallback` | `packages/core/src/runtimes/tui-agents/api/schemas.ts` |
| Remote host runtime | Workspace server runs every core runtime on a remote host over Wire, multi-client, SSH-only transport, Linux-only managed install; Ninebrains ships no artifact yet | `agents/architecture/workspace-server.md`, `apps/workspace-server/docs/` |
| Durable notes | Brain `notes` table + brain-mcp note tool; project-scoped, local, no search | `packages/brain-core/src/store/sqlite/migrations.ts`, `packages/brain-mcp/src/tools.ts` |
| Embeddings / vector search | **None anywhere in the repo** | — |
| Account / sync backend | None; hosted account is gated off with an empty `baseUrl` | `apps/emdash-desktop/src/core/features/account/node/config.ts` |

## Why a task cannot move today

1. **Agent transcripts are machine-local.** Claude keeps them under `$CLAUDE_CONFIG_DIR`
   (default `~/.claude/projects/<encoded-absolute-cwd>/<session-id>.jsonl`). A resume id is
   useless on a machine without that file, at that path.
2. **Worktree paths are absolute.** `workspaces.path` and `conversations.cwd` differ between
   `/Users/...` and `C:\Users\...`.
3. **Uncommitted changes never leave the worktree.**
4. **Projects and tasks live only in each desktop's `emdash4.db`.**
5. **tmux does not exist on Windows**, so the detached-session path
   ([`detached-sessions.md`](detached-sessions.md)) cannot carry a live agent across.

## Design

### Handoff bundle

One bundle per handoff, transported over git so no new server is required:

```
refs/ninebrains/handoff/<task-id>          commit: WIP snapshot of the worktree (tracked + untracked,
                                           .gitignore respected), parent = task branch HEAD
  .ninebrains-handoff/manifest.json        task, project remote URL, branch, base, provider,
                                           provider session id, source machine, created-at, note
  .ninebrains-handoff/note.md              user note + last agent summary
  .ninebrains-handoff/memory.jsonl         memory records created since the last handoff
```

The **agent transcript does not go in the git ref** (see Security). It moves directly between
the two machines.

Sending (`Continue on…`):

1. Pause: if the agent is mid-turn, ask the user to wait or interrupt it.
2. Snapshot the worktree into the WIP commit with a temporary index, without touching the user's
   branch or index.
3. Write the manifest and note, then push the ref to the project's push remote.
4. Send the transcript to the target machine (see Transport).
5. Mark the local task `handed-off → <machine>` and make it read-only until it comes back.

Receiving:

1. Find the project by remote URL; offer to clone it if missing.
2. Fetch the ref, create the worktree on the task branch, apply the WIP snapshot as uncommitted
   changes, then delete the remote ref.
3. Create or update the task and conversation rows with **local** paths.
4. Write the transcript into the local provider config dir under the **local** encoded cwd,
   rewriting `cwd` fields inside the JSONL.
5. Start the agent with `--resume <id>`. If that fails, fall back to a fresh session seeded with
   `note.md` and record `fresh-fallback`.

Handing back is the same flow in reverse. The task's identity is its id plus the branch, so a
round trip lands on the same rows.

### Transport for the transcript

**Direct, over Tailscale** (decided 2026-11-11: the user's machines share a tailnet). Each app
exposes a small handoff Wire endpoint bound to loopback and published to the tailnet with
`tailscale serve`, the same pattern as Pane's remote daemon. The first connection between two
machines is approved with a pairing code; after that each side keeps the other's identity in
Electron safe storage. Tailscale provides encryption and machine identity; the pairing code keeps
other tailnet members out.

Deferred: an encrypted copy of the transcript in the git ref, for machines with no direct route.
Build it only if someone needs handoff without a shared tailnet.

### Shared memory

1. **Capture.** At the end of each agent turn, on existing agent-status events, store a short
   record: task, project, branch, files touched, summary.
   - **Summary source (decided 2026-11-11): the agent's last assistant message, trimmed to about
     600 characters, plus `git diff --name-only` for files touched.** Agents already end a turn
     by saying what they did, so this is free, needs no API key, adds no latency and works for
     every provider.
   - Skip turns with no file changes and a summary under 80 characters ("Done.", questions).
   - Upgrade path: if records turn out noisy, batch the day's raw records through a cheap model
     to write titles and types (decision, bugfix, discovery) like claude-mem. That needs a model
     choice and an opt-in setting, so it waits for evidence.
2. **Store.** New table in the app DB plus an SQLite FTS5 index. FTS5 ships with SQLite, so this
   adds no dependency. The Drizzle migration goes through `pnpm run db:generate`.
3. **Sync.** Each record also appends to `memory.jsonl`, which travels in every handoff bundle.
   Records carry a UUID; the receiver inserts by id, so replays are idempotent and merges cannot
   conflict.
4. **Query.** A `memory_search` tool on brain-mcp so agents can ask "what did we do about X",
   plus a search box in the app.
5. **Vectors later.** Add `sqlite-vec` embeddings only once keyword search measurably misses.
   That needs an embedding model choice and a native extension review (see Security & Compliance
   in `AGENTS.md`).

Interim, for the operator only: claude-mem cloud sync on both machines gives shared memory today
with no product code. It cannot ship in the product because it is a hosted service.

## Task sequence

| # | Task | Done when |
|---|---|---|
| H0 | **Spike by hand.** Copy a Claude transcript Mac → Windows over the tailnet, rewrite cwd, `claude --resume`. Confirm the same for Codex TUI. | Written result per provider: resumes / needs X / impossible |
| H1 | **Worktree snapshot ref.** Snapshot to `refs/ninebrains/handoff/<task>` and restore it, both sides, unit-tested with temp repos. | Round trip restores tracked, untracked and deleted files byte-for-byte |
| H2 | **Manifest + receive flow.** Find the project by remote URL, create worktree, task and conversation rows with local paths. | Handoff of a task without transcript works Mac ↔ Windows |
| H3 | **Transcript move + resume** per provider, with the `fresh-fallback` path. | Agent resumes the conversation on the other machine |
| H4 | **Pairing + Tailscale transport** (loopback Wire endpoint, `tailscale serve`, pairing code). | Two paired machines list each other under Machines |
| H5 | **UI.** `Continue on…` command, handed-off task state, incoming-handoff toast. | Full flow from the UI with no CLI |
| M1 | **Memory capture + FTS5 store.** | Records appear for each agent turn; search returns them |
| M2 | **Memory in bundles** (`memory.jsonl`, idempotent merge). | Both machines return the same search results after a round trip |
| M3 | **`memory_search` MCP tool + search UI.** | An agent can cite a past decision from another machine |
| M4 | *(Optional)* `sqlite-vec` embeddings. | Only if M3 search misses are logged |

H0 gates everything. If resume across machines is impossible for a provider, that provider gets
note-seeded fresh sessions only.

## Non-goals

- **Live process migration.** A running agent never moves; hand off between turns.
- **ACP chat conversations** (decided 2026-11-11). Handoff covers TUI agents only for now. ACP
  resume across machines depends on each provider's adapter and is a follow-up.
- **A hosted sync service.** It conflicts with `docs/strategy/00-north-star.md:160` and would need
  an L0 decision.
- **One host with thin clients** (Pane's Remote Pane model). Shipping the workspace server,
  supporting macOS or WSL hosts and syncing task DBs between desktops is a separate, larger
  project. It is the route to "pick up mid-run" and can reuse H4's pairing.
- **Team sharing.** Single user, multiple machines.

## Security

- **Transcripts may contain secrets** (pasted keys, env dumps, tool output). They never go into a
  git ref in plaintext, and the encrypted fallback is opt-in.
- **Before writing a received transcript,** apply the same secret-redaction patterns used for file
  logging.
- **The receive path writes into the provider config dir and builds a worktree path from remote
  data.** Validate every path with the existing path-safety helpers; reject `..`, absolute paths
  and symlinks inside the bundle.
- **The pairing endpoint binds loopback only.** Reach it through Tailscale or SSH, never a LAN or
  public bind.
- **High-risk areas touched:** DB migration, provider spawning (`--resume`), new network endpoint.
  Read [`risky-areas/database.md`](../risky-areas/database.md) and
  [`risky-areas/pty.md`](../risky-areas/pty.md) first.

## Decisions (2026-11-11)

1. **Transport:** Tailscale direct. The machines share a tailnet; the git-ref encrypted fallback is
   deferred.
2. **Scope:** TUI agents only. ACP chat is a follow-up.
3. **Memory summary:** last assistant message plus files touched, no model call. Model-written
   titles only if the raw records prove noisy.

## Competitive context

Pane ([github.com/dcouple/Pane](https://github.com/dcouple/Pane)) covers the same space:
Electron, worktree per task, agents as plain terminals, about one stable release a day (v2.4.216
on 2026-11-08). Relevant to this plan:

- **`runpane handoff`** starts the agent on another machine from the pushed branch plus a note,
  and copies the agent's session when both ends use the same agent. "Move to host…" moves a whole
  Session. WSL receivers are unsupported.
- **Remote Pane** is a headless daemon bound to `127.0.0.1:42137`, reached through Tailscale Serve
  or an SSH tunnel with a bearer pairing code. Clients are the desktop app and a phone PWA. An
  "All machines" sidebar merges sessions from every saved machine. State stays on the host; there
  is no cloud sync.
- **No persistent memory store.** Context sharing is limited to `@pane` terminal mentions and
  session notes. Shared memory is where we can lead.
- **Other gaps to consider separately:** `notify` MCP tool with approvals queue, overlay and phone
  alerts; a secrets broker that keeps values out of chat; an agent-facing CLI/MCP to create tasks;
  per-task port ranges and a ports list; session import from other tools, including Emdash.
