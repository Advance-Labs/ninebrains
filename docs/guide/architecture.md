---
title: Architecture
description: >-
  A contributor's map of Ninebrains: how it extends the Emdash fork through feature slices, where
  the Brain, lanes, planner, gates and packs live, and the rules that keep upstream rebases cheap.
---

This is a summary for contributors. The full seam map, with the exact upstream files, is
`docs/SEAMS.md` in the repository. Read it before you touch Emdash code. For the test setup, see
[Contributing](contributing.md).

## Vocabulary: read this first

- An Emdash **Task** is a workspace: one git worktree plus its conversations.
- An Emdash **Conversation** is one agent session, in a terminal or a chat.
- A Ninebrains **lane** is one Emdash Task plus one terminal Conversation in it.
- A Ninebrains **Job** is a unit of work in the Brain. In code it is never called a task, so grep
  and types stay unambiguous. The interface may still say "task".

## The shape

```
┌──────────────────────── Electron main ─────────────────────────┐
│ Emdash core: projects, worktrees, terminals, preview servers   │
│                                                                │
│ Brain: jobs, edges, mailbox, runs (its own SQLite DB)          │
│   ├─ endpoint on 127.0.0.1, one token per launch               │
│   ├─ dispatcher: idle lane + ready job -> paste or run         │
│   └─ gate runner: complete_job -> gates -> done / retry        │
│ exec-runs: claude -p / codex exec, budgets, STOP               │
│ gates: tests, screenshot, reviewer, security-review, fact-check│
│ packs: coding, seo, research                                   │
└────────────────────────────────────────────────────────────────┘
        ▲ IPC                                 ▲ CDP
┌───────┴─────── Renderer ─────────┐   ┌──────┴─ lane browser ─┐
│ Lanes grid, planner, Brain drawer│   │ the lane's preview    │
└──────────────────────────────────┘   └───────────────────────┘
lane = worktree + terminal (claude | codex) + editor + browser
  └─ brain-mcp (stdio) forwards each tool call to the endpoint
```

## Where the code lives

| Piece | Location |
|---|---|
| Lanes grid | `apps/emdash-desktop/src/core/features/lanes/` |
| Planner canvas | `apps/emdash-desktop/src/core/features/planner/` |
| Packs | `apps/emdash-desktop/src/core/features/packs/` |
| Unattended runs | `apps/emdash-desktop/src/core/features/exec-runs/` |
| Model routing (subagent model, optional profiles) | `apps/emdash-desktop/src/core/features/routing/` |
| Gate capabilities (fetch, run command, reviewer, checkout) | `apps/emdash-desktop/src/core/features/gates/` |
| Brain: DAG, state machine, mailbox, routing, store, endpoint | `packages/brain-core/` |
| MCP shim each lane runs (its README covers the env contract and tools) | `packages/brain-mcp/` |
| Gate logic, rigor mapping, self-heal | `packages/gates-core/` |
| Claim checking (grounded / imprecise / invented) | `packages/citations/` |
| Stand-in CLI for tests | `tooling/fake-agent/` |
| Licence gate | `tooling/scripts/check-licenses.mjs` |
| This documentation site | `apps/docs/` (content in `docs/guide/`) |

Each package and feature folder has a README with its API, wiring notes and the decisions made
while building it.

## How Ninebrains extends Emdash

Emdash is built from **vertical feature slices**, each with a typed contract, plugged in through
about ten registration files. Almost everything Ninebrains adds is a new slice under
`apps/emdash-desktop/src/core/features/` or a new package. Changes to upstream files are mostly
one-line registrations.

A slice looks like this:

```
features/<x>/
  api/contract.ts      defineContract(...), zod only
  api/browser/client.ts  renderer client via domainClient
  node/wire-controller.ts  thin delegate to services
  node/…               services, repositories
  browser/…            React components and hooks
  contributions/…      views, commands, settings, mementos
```

Boundary lint enforces the rules. A feature may import another feature's `api/` or
`contributions/`, never its `node/` or `browser/`. Core code may not import Electron; anything that
needs Electron is injected from `app/main`. The lint allowlists are ratcheted empty. **Do not add
entries.** If the lint blocks you, change the design.

## Decisions that shape the code

- **The Brain has its own database** (`ninebrains-brain.db`), not tables in Emdash's app database.
  Upstream edits its migration journal constantly, so sharing it would conflict on every rebase.
  The cost is no foreign keys into Emdash rows: Brain rows store project, task and conversation IDs
  as text, and orphans are swept when a project or task is deleted.
- **brain-mcp is a thin forwarder.** Only the main process opens the Brain database. The shim sends
  each tool call over HTTP, and main decides identity from the token.
- **MCP config is per launch.** Upstream writes MCP servers to each provider's global config. Lanes
  instead get a per-launch file passed as `--mcp-config=<path>`. The `=` form matters: the flag is
  variadic, and a space-separated form swallows the next argument, including a prompt.
- **Unattended runs are new code.** Emdash has no print or exec path; it runs interactive agents or
  ACP chat only. `exec-runs` spawns `claude -p` and `codex exec` itself, with argv arrays and no
  shell.
- **The grid is its own view.** Emdash's split panes are scoped to one task, and a lane grid holds
  four different worktrees. The grid renders each lane's terminal output stream directly.

## Rebasing on upstream

Upstream moves fast: about 700 commits in the 30 days before the fork. So:

- Prefer a new slice to a patch.
- Log every change to an inherited file in `docs/UPSTREAM-PATCHES.md`, and start the code comment
  on the patched line with `Ninebrains:`.
- Keep hot-spot patches small. Boot wiring goes through one call to `createNinebrainsServices()`.
- Regenerate `pnpm-lock.yaml` on a rebase. Never hand-merge it.

The fork baseline, toolchain and CI are in `docs/FORK.md`. The exec-path findings behind the launch
flags are in `docs/SPIKE-EXEC-PATHS.md`. Both are in the repository, not on this site.
