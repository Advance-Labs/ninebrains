# Terminal input lag in 0.2.4, and what fixed it in 0.2.5

Source material for posts and talks. Every number below was measured on one install, with the
method stated next to it. Read [Measurement limits](#measurement-limits) before quoting any number.

- Shipped in: [0.2.5](https://github.com/Advance-Labs/ninebrains/releases/tag/v0.2.5) (2026-10-16)
- PRs: #136, #143, #139 (performance), #142 (archived task cleanup)
- Follow-ups: #146, #147, #148

## The symptom

Typing into an agent terminal felt delayed and choppy, and scrolling lagged. The machine was an M5
Pro MacBook on full charge, so raw hardware speed was not the limit. Seven agent sessions were open,
and the app was tracking 159 live workspaces.

## How we found it

The first guesses were terminal-side: xterm's DOM renderer, tmux, and the keystroke path from the
renderer to the PTY. Reading that path found nothing slow. Each keystroke is one Wire call, and
output goes straight to `terminal.write()` with no batching timer.

The process list was the first real clue:

| Process | CPU (`ps`, then live `top`) |
|---|---|
| Electron main | 66%, then 80.5% |
| Renderer | 37% |

In an Electron app every keystroke and scroll event crosses the main process. A busy main process
delays all of them, however fast the terminal itself is.

`sample` shows only native frames, which said nothing about JavaScript. The packaged app sets no
Electron fuses, so `kill -USR1 <main pid>` opens a Node inspector on `127.0.0.1:9229`. A ~40-line
script then took a CPU profile through the Chrome DevTools Protocol (`Profiler.start` / `stop`,
500 µs sampling) without restarting the app or touching its state.

One 5-second profile of the main process:

| | ms |
|---|---|
| Total | 5,205 |
| Idle | 2,210 (42%) |
| `parseVersionedColumn` (JSON column parsing) | 837 |
| Drizzle ORM row mapping (`is`, `utils`, `values`) | ~780 |
| Path normalization (`normalizeUnicode`, `splitPosixInput`, …) | ~180 |

Nearly all of the busy time sat under one call chain:

```
applyWorkspaceRegistrySnapshot → WorkspaceRegistry.refresh → findLiveByPath
```

## Root cause: three costs that multiplied

**1. A collision check that scanned the whole table, once per row.** The desktop app mirrors the
host's workspace registry into SQLite. Each sync calls `refresh` for every live workspace, and
`refresh` called `findLiveByPath` to make sure no other workspace owned the same path.
`findLiveByPath` selected every live row for that host, parsed each row's JSON columns, and
normalized each path, only to find a single match. That is O(n²) per sync: with 159 live rows in a
230-row table, roughly 37,000 row parses per sync (estimated as 159 × 230).

**2. Full syncs every two seconds.** Watching the `updated_at` column showed a new sync landing
every ~2 s (15 consecutive syncs, 1.5 to 2.3 s apart). Each one rewrote all 159 rows in a
single synchronous transaction on the main thread, then told the renderer to re-run its workspace
queries. That explains part of the renderer's 37%.

**3. Most of those syncs carried no news.** Two consecutive snapshots, taken 5 s apart, differed in
zero of the observation columns the desktop stores. The cause was on the host: file-watch events
on active worktrees trigger a rescan, nearly every rescan finds nothing new, and the host still
republished each record just to bump its `lastObservedAt` timestamp. Each republish reached the
desktop as a full snapshot.

Any one of these alone would have been tolerable. Together they blocked the main thread for about
one second out of every two.

## The fixes

Each fix removes one of the three costs, at the layer where it lives.

| PR | Layer | Change |
|---|---|---|
| #136 | Desktop registry | `refresh` runs the path-collision scan only when a workspace's path identity actually changes. An unchanged path cannot create a collision, and the sync already rejects conflicts up front. |
| #143 | Desktop sync | Each incoming record is compared with the row already in memory. An unchanged row is not rewritten, its timestamp is touched at most every 30 s in one bulk update, and the renderer is told to re-query only when something was written. |
| #139 | Host registry | A rescan that finds nothing new still stores its timestamp (the scan scheduler reads it), but republishes the record only when it changed, or when the published timestamp is a minute old. |

Two details worth keeping:

- **Equality had to match storage.** JSON columns drop `undefined` keys when written, so a naive
  deep-equal of incoming versus stored data would have called every row "changed". The comparison
  normalizes both sides the way they persist. A regression test caught exactly this mismatch
  during development.
- **The timestamp still has a reader.** The UI shows "Synced 2m ago", at minute granularity. The
  30 s desktop touch and the 60 s host republish exist only to keep that label honest without
  rewriting rows.

## Results

Measured on the same install after updating to 0.2.5, with the same method:

| | 0.2.4 | 0.2.5 |
|---|---|---|
| Main process CPU (`ps` / `top`) | 66–80% | 5–12% |
| Main process idle in a 5 s CPU profile | 42% | 97% (4,980 of 5,116 ms) |
| Renderer CPU (`ps`) | 37% | 25% |
| Renderer JS idle in an 8 s CPU profile | not measured | 90% |
| Full registry syncs applied | every ~2 s | only on real change, plus a timestamp touch at most every 30 s |

The user-visible result: typing and scrolling stopped stuttering.

## Also in 0.2.5: archived tasks clean themselves up

The 159 live workspaces were mostly leftovers: 117 belonged to archived tasks, and 31 were
worktrees created by other tools inside registered repositories. An existing sweep was supposed to
expire archived worktrees after a fixed 30 days, but it kept the task and its database row, so the
row count never fell.

#142 changes it: a task archived longer than a retention you pick (1, 7, 14 or 30 days; default 7)
is deleted with its worktree, branch and conversations. The guards are unchanged:

- worktrees with uncommitted changes, a detached HEAD, a `git worktree lock`, or no observation yet
  are skipped;
- worktrees Ninebrains did not create are never touched.

Settings shows how many tasks a run would delete before it deletes anything. Deleting the branch
also deletes commits that were never pushed, and the setting says so.

## Lessons

- **Profile the process that owns the input path, not the widget that shows the lag.** The
  terminal looked guilty. The main process was.
- **A packaged Electron app can be profiled live** if its fuses allow the inspector. One
  `kill -USR1`, one CDP script, no rebuild.
- **O(n²) hides until n grows.** The collision check was correct, and fast with a handful of
  workspaces. It became the bottleneck only once archived worktrees accumulated.
- **"Re-send everything, it's idempotent" has a price.** Idempotent sync made correctness easy and
  made redundant work invisible. Comparing before writing, and publishing only on change, kept the
  correctness and removed the cost.
- **Fix each cost at its own layer.** Any single fix would have helped. All three were needed so
  the redundant work does not happen at all, not just faster.

## Measurement limits

- One install: an M5 Pro MacBook running 7 agent sessions with 159 live workspaces. This is not a
  benchmark, and the numbers will differ on other machines and workloads.
- The before and after numbers were taken on the same machine several hours apart, not under a
  controlled identical load.
- `ps` CPU on macOS is a decaying average. `top` gives a live sample. Profiles are statistical
  samples at 500 µs intervals.
- The 37,000-parses figure is an estimate (rows synced × rows scanned), not a counted value.

## Post angles

Each angle sticks to the measured facts above. Keep the
[claims discipline](../strategy/00-north-star.md#claims-discipline): no "fastest", and no
percentage improvements without the method and the limits.

1. **"The terminal wasn't slow; the main process was."** A debugging story: the wrong suspects,
   the `kill -USR1` profiling trick, and the one-line call chain that explained everything.
2. **"Idempotent sync, and the O(n²) hiding inside it."** An architecture lesson: three layers,
   each reasonable alone, that multiplied into a one-second stall every two seconds.
3. **"Profiling a packaged Electron app without rebuilding it."** A how-to: SIGUSR1, the inspector,
   CDP `Profiler`, and reaching the renderer through `webContents.debugger`.
4. **"Agents leave worktrees behind."** A product angle: why archived agent work piles up, and the
   guarded cleanup that removes it (what it skips, and why).
