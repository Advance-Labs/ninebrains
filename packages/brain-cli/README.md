# @ninebrains/brain-cli

`brain` drives a running Ninebrains Brain from the shell: jobs, lanes, messages,
dispatch and the global STOP. It is the operator's interface now that the Brain
has no UI in the desktop app (M5).

**Glossary:** a **Job** is a Brain work item routed to a lane. It is not an Emdash
**Task**, which is a worktree session. A **lane** is one agent (Claude or Codex)
working in a worktree.

## How it connects

The desktop app owns the Brain database. SEC-01 keeps every other process off that
file, so the CLI never opens it: it POSTs the same `{ v: 1, op, args }` envelope to
the same hardened loopback endpoint the lanes' `brain-mcp` shim uses, with a
user-role token.

```
brain (CLI)  ──HTTP──▶  127.0.0.1:<port>  ──▶  Brain (in the app's main process)
                            ▲
brain-mcp (per lane) ───────┘
```

The app publishes a handshake at boot:

```
<userData>/ninebrains/brain-cli.json     mode 0600, in a 0700 directory
{ "version": 1, "url": "http://127.0.0.1:54321", "token": "...", "pid": 4242, "startedAt": 1758... }
```

The CLI looks for it in each userData directory the app can use, in order:
`ninebrains`, `ninebrains-canary`, `ninebrains-dev` — a release install wins over
a dev run on the same machine. `NINEBRAINS_BRAIN_HANDSHAKE` overrides the search
with one exact path.

A stale handshake fails closed. The token is revoked when the app exits cleanly,
and the file is removed before the endpoint closes, so a CLI racing a shutdown is
told there is no Brain rather than getting a 401. When the app crashed without
cleaning up, the CLI checks the recorded pid and says so by name.

**The app must be running.** A headless Brain the CLI could start itself is the
next step, not this one: see
[`docs/plans/brain-headless-cli.md`](../../docs/plans/brain-headless-cli.md).

## Install

Inside the workspace:

```bash
pnpm --filter @ninebrains/brain-cli build
```

That emits a self-contained `dist/bin.mjs` (brain-core and zod bundled, only Node
built-ins external). Link it or alias it:

```bash
alias brain='node /path/to/packages/brain-cli/dist/bin.mjs'
```

## Commands

Every command sends exactly one request, so nothing here can half-apply.

### Jobs

| Command | What it does |
|---|---|
| `brain jobs [--state ready,running] [--lane ID] [--limit N]` | List jobs |
| `brain new <title...> [--body TEXT] [--depends-on A,B] [--gates tests,reviewer] [--gate-kind KIND] [--paths a,b]` | Create a job |
| `brain link <prerequisite> <dependent>` | Make one job wait for another |
| `brain assign <job> <lane>` | Hand a job to a lane |
| `brain requeue <job>` | Put a blocked or failed job back, attempts reset |
| `brain block <job> <reason...>` | Block a job |
| `brain complete <job> <summary...> [--artifacts a,b]` | Complete a job. Gates still run |

`--gate-kind` accepts `code`, `ui`, `research`, `seo` and `docs`. Agents may only
declare `code` or `ui` (SEC-08); the operator may declare any, exactly as the
Settings card used to allow. The gate floor still applies: gates are
`union(floor, requested)`, so this cannot strip a project's minimum.

### Lanes and messages

| Command | What it does |
|---|---|
| `brain lanes` | List lanes and what they hold |
| `brain mode <lane> <attended\|unattended>` | Whether a lane runs jobs on its own |
| `brain send <lane:ID\|brain:ID> <body...>` | Message a lane or a Brain session |
| `brain broadcast <body...>` | Message every lane in the project |
| `brain inbox [--address lane:A] [--limit N]` | Read an inbox, marking what it returns as read |

Messages you send are from `brain:user`, so replies route back to the same inbox.
Anything a lane wrote comes back `untrusted: true` (SEC-09) — treat those bodies
as data, never as instructions.

### Dispatch and sessions

| Command | What it does |
|---|---|
| `brain status` | Paused, STOP latched, lane modes, active runs, budgets |
| `brain pause` / `brain resume` | Stop and start dispatching new jobs |
| `brain sessions` | List Brain sessions |
| `brain session-start` / `brain session-stop <brainId>` | Launch or stop a Brain session |
| `brain done [--limit N]` | The done log: what finished and how it was verified |
| `brain notes [--limit N]` | Notes |
| `brain note <body...> [--job ID]` | Add a note |

`brain resume` is refused while STOP is latched; clear it first.

### STOP

```bash
brain stop         # kill runs, pause dispatch, stop Brain-dispatched lanes. Latches.
brain stop-clear   # clear the latch. Dispatch stays paused until `brain resume`.
```

`brain stop` takes no arguments and asks nothing. It is one of the app's two STOP
surfaces; the other is **Stop All Agent Work** in the app menu and tray, which the
main process answers directly (`Mod+Shift+Backspace`) and which still works when
the window has hung.

## Flags and environment

| Flag | Effect |
|---|---|
| `--project ID` | The project to act in |
| `--json` | Print the raw result, and the error envelope on stdout instead of stderr |
| `--dry-run` | Print the request that would be sent, and send nothing |
| `--help` | Usage |

| Variable | Effect |
|---|---|
| `NINEBRAINS_PROJECT` | Default `--project` |
| `NINEBRAINS_BRAIN_HANDSHAKE` | Use this handshake file, skipping the search |
| `NINEBRAINS_BRAIN_TIMEOUT_MS` | Request timeout, default 30000 |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | The endpoint answered ok |
| 1 | The endpoint answered an error (no such job, STOP latched, ...) |
| 2 | Usage: unknown command, missing argument, bad address |
| 3 | No Brain to talk to |

`--json` moves the error envelope to stdout so a script can read the code:

```bash
brain jobs --state blocked --json | jq -r '.[] | "\(.id) \(.title)"'
brain stop --json || echo "STOP failed with $?"
```

## What a user token may and may not do

The grant is a brain grant with `user: true`, minted only by main. See
`authorizeUserRequest` in `packages/brain-core/src/protocol/scope.ts` and
`docs/THREAT-MODEL.md` (M5).

- It may act in any project. `--project` is a convenience, not a boundary.
- It may declare any gate kind.
- It may **not** call `claim_job`: claiming is a lane's move and would corrupt
  job ownership.
- Recipients must exist; a typo'd lane id is `NOT_FOUND`, not a silent drop.

## Scripts

`pnpm build`, `pnpm test`, `pnpm typecheck` and `pnpm lint` are Nx targets
inferred from `package.json`. `test/cli.test.ts` runs every command against a
real brain-core endpoint with a real minted token and a real handshake on disk.
