---
title: First run
description: >-
  What happens the first time you open Ninebrains: the import step, the hooks it adds to your
  Claude Code and Codex settings, the folder trust prompt, and connecting GitHub.
---

## No account, no sign-in

Ninebrains has no account and no sign-in screen. The first time you open it, you go straight to
the main window. Add a project from the sidebar to begin, as in
[Getting started](getting-started.md).

Telemetry is off, and no telemetry endpoint is built into the app.

### Importing Emdash data

If the app finds data from an earlier Emdash install that has not been imported yet, it shows an
import step first:

- **Import data** imports it. You choose which sources to import.
- **Start fresh** skips it.

After an import, a welcome screen appears. Click **Start shipping** (or press ⌘Enter / Ctrl+Enter)
and the app reloads.

## Agents

**Settings → Agents** lists the agent CLIs the app found on your machine. Lanes offer only Claude
Code and Codex, and only if they are installed. Log in to each CLI yourself, in a terminal. See
[Accounts](accounts.md).

## Hooks in your agent settings

Status lights, notifications and resume come from the agents' own hooks. The first time an agent
session starts, Ninebrains checks that its hooks are installed and adds them if they are missing.

| Agent | File | Hooks added |
|---|---|---|
| Claude Code | `settings.json` in `~/.claude`, or in `CLAUDE_CONFIG_DIR` if set | `SessionStart`, `UserPromptSubmit`, `Notification`, `Stop` |
| Codex | `config.toml` in `~/.codex`, or in `CODEX_HOME` if set | `SessionStart`, `PermissionRequest`, `Stop` |

These are your **user-level** settings, so the hooks are present in every Claude Code or Codex
session you run, including ones outside Ninebrains. They do nothing there: each hook command exits
at once unless Ninebrains started the session. Your own hooks and other settings are kept.

**Settings → Agents** shows the state in the **Hooks** row: "Configured on first session" before
they are added, and "Configured" with the folder once they are.

Claude lanes also carry the same hooks in their own per-launch settings file.

## The folder trust prompt

Claude Code asks whether you trust a folder the first time it runs in it. Every task and lane has
its own worktree, so without help you would see this prompt for each one.

**Settings → General → Auto-trust worktree directories** answers it for you. It is on by default.
When it is on, Ninebrains marks each new worktree as trusted in `~/.claude.json` before the agent
starts. When it is off, the agent asks as usual.

The trust record is per Claude config directory. See [Accounts](accounts.md).

## Worktrees

Every task and every lane gets its own git worktree. By default they are created under
`~/ninebrains/worktrees`, in one folder per repository. Lanes use branches named `lanes/<id>`.

## GitHub

Open **Settings → Integrations** and connect GitHub. The **Connect GitHub** dialog offers:

- **Import from GitHub CLI.** Uses the accounts you have already signed in to with `gh`. If there
  is no session, it tells you to run `gh auth login` first.
- **Use device flow.** Sign in on this device with a one-time code. This option appears only in
  builds that carry a GitHub OAuth app ID. Builds without one, including v0.1 releases so far,
  offer only the GitHub CLI import.

```bash
gh auth login
```

Then choose **Import from GitHub CLI**.
