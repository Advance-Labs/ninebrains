---
title: Accounts
description: >-
  How to use more than one Claude Code or Codex login with Ninebrains, using one config directory
  per account, and what Ninebrains does and never does with your credentials.
---

Ninebrains never handles your logins. You install `claude` and `codex` and log in to them
yourself. Ninebrains starts the CLIs, and only ever asks them whether they are logged in.

## One config directory per account

Both CLIs keep everything for an account in one directory:

| CLI | Variable | Default |
|---|---|---|
| Claude Code | `CLAUDE_CONFIG_DIR` | `~/.claude` |
| Codex | `CODEX_HOME` | `~/.codex` |

Logins are scoped per directory. A fresh, empty directory reports "not logged in" even when your
default directory is logged in. Settings, workspace trust, hooks and transcripts are per directory
too.

To add a second Claude Code account:

```bash
mkdir -p ~/.claude-work
CLAUDE_CONFIG_DIR=~/.claude-work claude auth login
CLAUDE_CONFIG_DIR=~/.claude-work claude auth status --json
```

The same for Codex:

```bash
mkdir -p ~/.codex-work
CODEX_HOME=~/.codex-work codex login
CODEX_HOME=~/.codex-work codex login status
```

Two things differ between directories that people often miss:

- **Workspace trust.** Claude Code asks whether you trust a folder once per config directory.
- **MCP servers added in Settings** are written to the default directory only.

Status-light hooks follow the variable, so they install into each account's directory
automatically.

## Choosing an account for a lane

In this build, lanes launch with the CLI's default directory.

`CLAUDE_CONFIG_DIR` and `CODEX_HOME` are on the environment allowlist that lanes inherit. If you
start Ninebrains from a terminal where one of them is set, every lane uses that account. On macOS,
an app opened from the Dock or Finder does not see variables set in your shell.

Planned: a per-lane account picker, and a usage meter per account. Moving a lane to another account
will relaunch its CLI with a different directory. The app will not copy or move your login.

## What Ninebrains never does

- It never reads `.credentials.json`, `~/.codex/auth.json` or the provider entries in your OS
  keychain.
- It never copies, moves, symlinks or writes a config directory.
- It never runs a login for you. Status comes from `claude auth status` and `codex login status`.

This follows Anthropic's rule that third-party apps must not offer Claude.ai login or its usage
limits on the user's behalf. Ninebrains stays a launcher for the CLIs you already use.

## A logged-out account can look like success

A logged-out `claude -p` run can end with `subtype: "success"` while `is_error` is true and the
text says "Not logged in". Ninebrains decides success from `is_error` and the exit code, not the
subtype. If a run does nothing, check the account with `claude auth status --json`.
