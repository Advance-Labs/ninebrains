# Risky Area: PTY And Sessions

## Main Files

- `packages/core/src/services/pty/` — terminal env construction, shell resolution, spawning, and session registry
- `packages/core/src/runtimes/terminals/` — interactive terminal lifecycle and Wire component
- `packages/core/src/runtimes/scripts/` — lifecycle script execution through the shared PTY plane
- `packages/core/src/runtimes/tui-agents/` — PTY-backed agent sessions, runtime-owned hook server, hook installation, and agent state LiveModels
- `src/main/core/agent-status/` — desktop projection of runtime agent states into the conversation cache
- `src/services/notifications/` — desktop notification feed, batching, sound sink, and OS notification sink

## Core Risks

- PTY cleanup and exit handling
- resize behavior
- shell quoting and Windows command wrapping
- tmux lifecycle
- provider-specific resume/session behavior
- env passthrough safety

## Rules

- construct every PTY environment through `packages/core/src/services/pty/api/terminal-env.ts`
- keep the host/worker `process.env` separate from the captured user-shell environment; only the
  host process captures it, spawning runtimes receive a parent-owned source and resolve that source
  exactly once per spawn, never as an ambient fallback or immutable worker config
- do not weaken quoting or spawn behavior casually
- validate both direct spawn and shell-wrapped spawn cases when changing PTY startup logic
- confirm renderer event flow if hook/plugin payload or agent status behavior changes

## tmux Server Loss: What Has Been Ruled Out

Three sessions investigated "the tmux server keeps crashing". The cause was never found,
because nothing in the app recorded tmux at all — a full desktop log had zero tmux lines.
These hypotheses were each tested and eliminated; do not re-chase them without new evidence.

- **Segfault or abort.** macOS writes a `.ips` crash report for CLI binaries (there are
  `node` ones). There has never been a tmux report on this machine.
- **OOM / jetsam kill.** tmux appears in none of the JetsamEvent files, including a
  397-process snapshot.
- **SIGKILL from `PosixPtyTerminator`'s process-group kill.** The tmux server reparents to
  `ppid=1` with its own pgid within 50ms of `new-session`, so `kill(-rootPid)` cannot
  reach it, and it is never a descendant in the `ps` snapshot.
- **"Stale socket means an unclean death."** It does not. tmux leaves its socket behind
  even after a clean `kill-server`, so a socket with no server proves nothing either way.
- **The test suite killing the live server.** `tmux.test.ts` isolates through
  `TMUX_TMPDIR`, and its `kill-server` is scoped to that directory.

What remains is that a tmux server exits when its **last session ends**, and the spawn line
is fail-open: `has-session || new-session` cannot tell a dead server from a name that
missed, so a fresh server is created silently and the user sees empty panes. That is
indistinguishable from a crash without the generation tracking in
`tmux-server-supervisor.ts`, which now records the server pid each session spawned into and
reports a loss at `warn`. **The next investigation should start from those log lines.**

Two changes narrowed the blast radius while the cause is still unknown: Ninebrains now runs
on its own tmux socket (`tmux-socket.ts`) rather than sharing the user's default server, and
`history-limit` defaults to 10k rather than 100k lines per pane, held in the server's memory.

## The First Recorded Loss (2026-09-25 22:58 EDT)

The supervisor's first real occurrence, and what it did and did not settle.

Three agent sessions were diagnosed `server-gone` within one millisecond. Around it:

- No tmux crash report, and none has ever existed on this machine.
- No new JetsamEvent; 67% system memory free at the time.
- No kernel kill or jetsam entry at that instant.
- The desktop app stayed running throughout.
- No successor server was created, and none existed afterwards.
- **11ms earlier**, two `caffeinate` processes died with
  `ClientDied PreventUserIdleSystemSleep` (one aged 2m27s). That is what an agent CLI
  holding a sleep assertion looks like when it exits.

**`server-gone` does not mean the server crashed.** It means no server was reachable when
that pty exited. A tmux server exits the moment its last session ends, so three sessions
ending together produces this signature exactly as a server death would. The `caffeinate`
deaths landing *first* point at the sessions ending and tmux exiting behind them — which
would mean the "crash" was never one. That is not yet proven.

What was missing, and is now fixed: the server-level `server-lost` report never fired,
because `recordSpawn` did not tell the watch the server was alive (the watch was fed only
on pty exit, so `running` was still false and the transition was dropped). And the pty's
`exitCode`/`signal` were not logged, which is the one bit that separates an agent that
finished from one that was killed.

**The next occurrence is the decisive one.** Read all three together:

```
grep -E "tmux server changed underneath|destroyed by a tmux server loss" \
  ~/Library/Application\ Support/ninebrains/logs/ninebrains.log
```

- A `server-lost` / `server-restarted` line now accompanies the per-session lines.
- `signal` on the session lines names a kill; a clean `exitCode` with no signal means the
  agent ended on its own and tmux exited behind it — not a crash.
