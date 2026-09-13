---
title: Configuration
description: >-
  Reference for Ninebrains configuration: the gates setting, per-project gate preferences, the
  tests-gate options, environment variables, file locations and the .emdash.json file.
---

## Gates setting

The app stores gate settings under the key `ninebrains.gates`.

| Field | Range | Default |
|---|---|---|
| `testingRigor` | 0–10 | 5 |
| `securityRigor` | 0–10 | 5 |
| `evidenceRetentionDays` | 1–3650 | 30 |

Change both rigor values with the sliders in **Settings → Gates**. The evidence retention has no
control; the Gates page shows the current value. [Verification gates](gates.md#rigor) explains what
each rigor level attaches.

## Per-project gate preferences

Each project can hold these values. Set `testCommand` in **Settings → Gates → Tests**. The rigor
overrides cannot be set in this build.

| Field | Meaning |
|---|---|
| `testingRigor` | Overrides the app's testing rigor for this project. Empty means use the app setting |
| `securityRigor` | Overrides the app's security rigor for this project. Empty means use the app setting |
| `testCommand` | The command the tests gate runs, up to 500 characters. Only you set it, never a job or a file in the worktree |

With no `testCommand`, the tests gate reports a setup problem and the job is blocked. See
[Verification gates](gates.md#test-command).

## Tests gate options

The tests gate reads two per-project options. Both default to off, and neither can be set in this
build.

| Option | When on |
|---|---|
| `testsGate.allowNetwork` | The test command may reach any network address, not only localhost |
| `testsGate.allowUnsandboxed` | The test command may run without an OS sandbox, on Windows or on Linux without bubblewrap. This is an accepted risk: the command then runs as you with full access |

## Environment variables

Ninebrains reads these from the environment it was started with. On macOS, an app opened from the
Dock or Finder does not see variables set in your shell. Start it from a terminal to pass them.

### For users

| Variable | Effect |
|---|---|
| `NINEBRAINS_SECRET_<NAME>` | Supplies the pack secret or setting `<NAME>`, for example `NINEBRAINS_SECRET_GOOGLE_ACCESS_TOKEN`. Used when the app's secret store has no value for it. An empty value counts as unset |
| `NINEBRAINS_SECRET_AEO_MCP_BASE_URL` | The SEO pack's server address. Default `https://aeo.advancelabs.dev/api/mcp`. Must be `https`, or `http` on localhost. There is no plain `AEO_MCP_BASE_URL` variable; the pack reads it as a secret. See [Packs](packs.md#self-hosting-the-seo-servers) |
| `CLAUDE_CONFIG_DIR` | The Claude Code config directory lanes use, and where Claude hooks are installed. Default `~/.claude`. See [Accounts](accounts.md) |
| `CODEX_HOME` | The Codex config directory lanes use, and where Codex hooks are installed. Default `~/.codex` |
| `EMDASH_USER_DATA_DIR` | Replaces the whole app data folder: databases, logs and settings |
| `EMDASH_WORKSPACE_SERVER_ARTIFACTS_URL` | Where remote (SSH) projects download the workspace server. The default points at Ninebrains releases, which do not carry it yet |
| `TELEMETRY_ENABLED` | Set to `false`, `0` or `no` to turn telemetry off. No telemetry endpoint is built in, so nothing is sent either way |
| `EMDASH_DB_FILE` | Replaces the app database path |
| `EMDASH_LOG_FILE` | Replaces the log file path |
| `EMDASH_LOG_LEVEL` | The log level. Falls back to `LOG_LEVEL` |

### Set by the app

These are set by Ninebrains for the processes it starts. You read them; you do not set them.

| Variable | Where | Value |
|---|---|---|
| `EMDASH_PORT` | Every task and lane terminal, and project scripts | A port from 50000 to 59990, in steps of 10, derived from a hash of the worktree path. Start your dev server on it |
| `EMDASH_TASK_ID`, `EMDASH_TASK_NAME`, `EMDASH_TASK_PATH`, `EMDASH_ROOT_PATH`, `EMDASH_DEFAULT_BRANCH` | The same places | The task and its worktree |
| `NINEBRAINS_BRAIN_URL`, `NINEBRAINS_TOKEN`, `NINEBRAINS_LANE_ID` | Only the Brain's MCP server process for a lane | How that server reaches the app |

The app's own `EMDASH_*` variables are removed from the environment agents get.

### For builds and development

| Variable | When | Effect |
|---|---|---|
| `NINEBRAINS_GITHUB_OAUTH_CLIENT_ID` | Build time | Bakes in a GitHub OAuth app ID, which turns on device-flow sign-in. Empty by default. Setting it on an installed app does nothing |
| `FLAG_<NAME>` | Dev builds only | Forces feature flag `<name>` on (`true` or `1`) or off. Ignored in packaged builds. No feature in this build reads a flag |
| `EMDASH_SKIP_ELECTRON_REBUILD=1` | Install time | Skips rebuilding native modules for Electron |

Some switches are fixed when the app is built, with no variable to change them: auto-update, the
hosted account, the telemetry settings card and user packs are all off.

## File locations

The app data folder is:

| OS | Built app | Dev build (`pnpm run dev`) |
|---|---|---|
| macOS | `~/Library/Application Support/ninebrains` | `~/Library/Application Support/ninebrains-dev` |
| Linux | `~/.config/ninebrains` | `~/.config/ninebrains-dev` |
| Windows | `%APPDATA%\ninebrains` | `%APPDATA%\ninebrains-dev` |

`EMDASH_USER_DATA_DIR` replaces it. Inside it:

| Path | What |
|---|---|
| `emdash4.db` | The app database (the name is kept from Emdash) |
| `ninebrains-brain.db` | The Brain database: jobs, edges, mailbox, runs. Mode `0600` |
| `logs/emdash.log` | Logs, 5 MB per file, 5 files kept |
| `ninebrains/` | Ninebrains' own files. Mode `0700`, and denied to every lane's sandbox |
| `ninebrains/lanes/<launchId>/` | One folder per running lane launch: `mcp.json`, and for Claude `settings.json`, both mode `0600`. Deleted when the lane stops, and swept when the app starts |
| `ninebrains/runs/<runId>.jsonl` | Unattended run transcripts, redacted, mode `0600` |
| `ninebrains/evidence/<jobId>/<attempt>/` | Gate evidence and the verdict for each attempt. Kept for 30 days |

Outside the data folder, see [Files outside the data folder](files-outside-data-folder.md).

## .emdash.json

A project can keep shared settings in `.emdash.json` at the repository root. The file name is kept
from Emdash. Ninebrains writes it only when you choose to share a project's settings.

```json
{
  "preservePatterns": [".env.local"],
  "shellSetup": "source .venv/bin/activate",
  "scripts": {
    "prepare": "",
    "setup": "pnpm install",
    "run": "PORT=$EMDASH_PORT pnpm dev",
    "teardown": ""
  }
}
```

| Key | Meaning |
|---|---|
| `preservePatterns` | Gitignored files to copy into each new worktree, such as local env files |
| `shellSetup` | A shell line run before each of the project's scripts, terminals and agent sessions starts |
| `scripts.prepare`, `scripts.setup`, `scripts.run`, `scripts.teardown` | The project's lifecycle scripts |

Other keys are ignored. A file that does not parse is treated as empty.

The auto-run switches and project environment variables are not part of the file. They are
per-machine settings in the project's **Settings** tab. By default, setup runs automatically in a
new task and run does not.
