---
title: Unattended runs
description: >-
  How Ninebrains runs claude -p and codex exec without anyone watching: the budgets that bound
  each run, the STOP switch that ends them all, and the actions that never run automatically.
---

A lane you watch is **attended**: the agent's normal interactive interface runs in a terminal, and
it asks you before doing anything risky. An **unattended** run has no terminal and no one to ask.
Ninebrains starts the CLI in print mode and reads its event stream:

- Claude Code: `claude -p --output-format=stream-json`.
- Codex: `codex exec --json`. Codex support for unattended runs is **experimental**.

Unattended runs carry out Brain-dispatched work and the reviewer side of verification gates.

Unattended runs use whatever login or API key your CLI uses. Ninebrains makes no claim about which
plan, quota or billing they draw from. Check your provider's terms.

## Budgets

The run supervisor in the app's main process enforces the limits, not the agent. Each run can
carry:

| Limit | How it is enforced |
|---|---|
| Wall clock | The supervisor ends the run when time is up |
| Turns | `--max-turns` |
| Spend | `--max-budget-usd` (Claude) |
| Tokens | Counted from the stream's `usage` events: input, output, cache-creation and cache-read tokens |
| Concurrent runs | A global cap. A run over the cap is refused, not queued; queueing is the dispatcher's job |

<!-- VERIFY-AFTER-P2 -->
Budget counters are stored in the Brain database, so restarting the app does not reset them.
<!-- /VERIFY -->

## The STOP switch

STOP ends every run the Brain owns:

1. New dispatch is blocked straight away.
2. Every run's process group gets SIGTERM.
3. After 2 seconds, anything still alive gets SIGKILL.

A test runs eight runs whose processes and child processes ignore SIGTERM, and checks that all are
gone in under 5 seconds. STOP stays **latched**: nothing new starts until you clear it.

<!-- VERIFY-AFTER-P2 -->
STOP is in the tray menu, the app menu and a keyboard shortcut. All three are handled in the main
process, so they work even if the window has frozen. STOP also stops the terminal sessions of lanes
the Brain started.
<!-- /VERIFY -->

Known limits:

- A process that calls `setsid()` leaves its process group and survives STOP.
- On Windows, STOP uses `taskkill /T`, which reaches only the process tree.

## Where a run may work

- **Folder.** A run's working directory must sit inside an allowed root, which is the project's
  worktree root or the review-checkout root. Symlinks that lead outside are refused. There is no
  fallback to another directory: if the check fails, the run does not start.
- **Sandbox (Claude).** Each run gets its own settings file that turns on the Claude Code sandbox
  and fails if the sandbox is unavailable. The run can write only its own worktree. Reads of
  Ninebrains' data folder, other lanes' worktrees, `~/.ssh`, `~/.aws`, `~/.config/gcloud`,
  `~/.config/gh`, `~/.codex`, provider credential files, `~/.netrc`, `~/.npmrc` and a few others
  are denied.
- **Sandbox (Codex).** `--sandbox workspace-write` with approvals set to never. Codex's sandbox
  limits writes, not reads, so a Codex run can read other lanes' files.
- **MCP servers.** Only the servers in the run's own config (`--strict-mcp-config`).
- **Environment.** A narrow allowlist: provider login variables (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`,
  and `ANTHROPIC_API_KEY` only if you chose API-key mode), `PATH`, `HOME`, `TMPDIR`, locale and
  proxy variables. `GITHUB_TOKEN`, `GH_TOKEN`, `AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS` and
  third-party model keys are dropped.
- **Transcripts** pass through a redactor that removes common key and token formats before they are
  written.

## What never runs automatically

- **Permission bypasses.** No launch builder may produce `--dangerously-skip-permissions`,
  `--permission-mode bypassPermissions`, or Codex's `--dangerously-bypass-approvals-and-sandbox` or
  `--sandbox danger-full-access`. A guard inside the spawn wrapper throws if one appears.
- **Outbound actions.** Deploys, DNS changes, payments, email, `git push`, package publishing and
  cloud CLIs are denied by absence: an unattended run has no credentials for them, and its network
  access is limited unless a plan lists allowed domains.
- **Prompt text as flags.** The job text reaches the CLI on stdin, never as a command-line
  argument, so a job that starts with `--` cannot turn into a flag.
- **Programs planted in the worktree.** The CLI is started from an absolute path found by the app,
  never from the worktree or its `node_modules/.bin`.
- **Test commands from the work itself.** The tests gate runs only the command you set for the
  project, never one taken from a job or from a file in the worktree.
- **A reviewer that can change things.** Reviewers get Read, Grep and Glob only: no shell, no
  writes, no network.

<!-- VERIFY-AFTER-P2 -->
A plan can name outbound capabilities it needs. You approve them in the app when the plan starts,
the approval is recorded, and a Brain session cannot grant or widen them.
<!-- /VERIFY -->

## Not built yet

An overnight queue runner with a morning digest is planned. So is an append-only security event
log in the Brain database. Neither ships in this build.

## Known gaps

- The tests gate's OS sandbox exists on macOS only (`sandbox-exec`, which Apple has deprecated, and
  which leaves the network open). On Linux and Windows the gate relies on the scrubbed environment,
  the timeout, the process kill and the output cap.
- Windows paths are untested.
- The unattended path has been tested against `tooling/fake-agent`, a stand-in CLI. It has not yet
  been exercised against the real `claude` or `codex` CLIs in this form.
