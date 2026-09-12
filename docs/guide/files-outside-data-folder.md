---
title: Files outside the data folder
description: >-
  Everything Ninebrains writes outside its own data folder: hooks in your Claude Code and Codex
  settings, folder trust records, skills, worktrees, branches and temporary review checkouts.
---

Most of what Ninebrains keeps is in its data folder (see
[Configuration](configuration.md#file-locations)). A few things have to live elsewhere, because the
agent CLIs and git read them from their usual places. This page lists them, so you know what to
clean up if you stop using Ninebrains.

## Agent settings

| File | What Ninebrains writes | When |
|---|---|---|
| `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`) | Hook entries for `SessionStart`, `UserPromptSubmit`, `Notification` and `Stop` | The first time a Claude Code session starts, if missing |
| `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`) | Hook entries for `SessionStart`, `PermissionRequest` and `Stop` | The first time a Codex session starts, if missing |
| `~/.claude.json` | For each new worktree, `hasTrustDialogAccepted` and `hasCompletedProjectOnboarding` under `projects` | When **Auto-trust worktree directories** is on |
| Each agent's MCP config | The servers you add | Only when you add a server in **Settings → MCP** |

Ninebrains' hook entries are recognised by the `EMDASH_HOOK_PORT` variable in their command. When
it rewrites them, it replaces its own entries and keeps yours. Outside Ninebrains the hook commands
exit straight away. See [First run](first-run.md#hooks-in-your-agent-settings).

If you use other agents through tasks, their own trust files are updated the same way when
auto-trust is on, for example `~/.cursor/projects/…` or `~/.copilot/config.json`.

## Skills

Skills are stored in `~/.agentskills/<id>/`, with install records in
`~/.agentskills/.emdash/skillssh-installs.json`.

Pack skills are installed there as `nb-<pack>-<skill>`, for every pack enabled in at least one
project. Skill sync removes any `nb-*` skill it does not expect. Anything you name with the `nb-`
prefix yourself will be deleted.

## Worktrees and branches

| Where | What |
|---|---|
| `~/ninebrains/worktrees/<repo>-<hash>/` | One worktree per task and per lane |
| `~/ninebrains/repositories/` | Repositories you clone from inside the app |
| Your repository | Branches for tasks, `lanes/<id>` branches for lanes, and git's own worktree records in `.git/worktrees` |
| Your repository | `.emdash.json`, only when you choose to share project settings |

## Temporary files

| Where | What | Removed |
|---|---|---|
| `<tmp>/ninebrains-review/nb-review-XXXXXX/checkout` | A disposable git worktree of a job's result, for the reviewer gates | After each review, whatever the result |
| `<tmp>/nb-tests-XXXXXX` | The tests gate's private temp folder | After each run |

`<tmp>` is your system's temp folder. A review checkout is a real `git worktree`, so while it
exists, git lists it in your repository's worktrees.

## OS keychain

The app keeps an encryption key named **Ninebrains Safe Storage** in your OS keychain. It encrypts
the app's cookie store and saved secrets. Pack secrets saved in the app use the key name
`ninebrains.pack.<NAME>`.
