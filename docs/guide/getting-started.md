---
title: Getting started
description: >-
  Install Ninebrains from a release or from source, add a project, open the Lanes view, start four
  agents in their own worktrees, and hand the Brain its first brief.
---

## What you need

- **An agent CLI.** `claude` (Claude Code), `codex`, or both, installed and logged in. Ninebrains
  starts them; it never logs in for you. To use several accounts, see [Accounts](accounts.md).
- **Git**, and a local git repository to work on.
- macOS, Windows or Linux. Ninebrains is developed and tested on macOS first.

Ninebrains is free. Your agents use your own login or API key, so usage is whatever your provider
plan or key charges. Ninebrains makes no claim about which quota its runs draw from.

## Install

### In one line

On macOS or Linux, in a terminal:

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://ninebrains.runs-on.dev/install | sh
```

On Windows, in PowerShell:

```powershell
irm https://ninebrains.runs-on.dev/install.ps1 | iex
```

The script picks the file for your OS and CPU (the `.zip` on macOS, the AppImage into
`~/.local/bin` on Linux x86_64, the x64 installer for the current user on Windows), downloads it
from GitHub Releases, checks it against the release's `SHA256SUMS`, and installs it. Run the same
line again later to update. Options such as `--deb` or `--require-attestation`, and what the
checks prove, are in [Verify a download → Updating](verify-download.md#updating).

### From a release

Download the build for your OS from
[ninebrains.runs-on.dev](https://ninebrains.runs-on.dev/#download) or
[GitHub Releases](https://github.com/Advance-Labs/ninebrains/releases).

Builds are **not code-signed** yet. Before you open one, check it against the release's
`SHA256SUMS` file. [Verify and open a download](verify-download.md) gives the commands, and
explains how to open an unsigned app past macOS Gatekeeper and Windows SmartScreen.

### Updating

Ninebrains does not update itself: unsigned builds cannot be updated safely from inside the app.
Update with the one-line installer above, or download the new build and install it over the old
one. If you installed the `.deb`, update with
`curl --proto '=https' --tlsv1.2 -fsSL https://ninebrains.runs-on.dev/install | sh -s -- --deb`
(it runs `sudo apt install`); the plain line would add an AppImage instead. On macOS the installer
asks you to quit Ninebrains first; on Windows, quit it before you run the line.
[Verify a download → Updating](verify-download.md#updating) has the details.

To hear about new releases, turn on **Settings → General → Check for new versions**. Once after
startup and every 12 hours, the app asks GitHub for the latest release. When there is a newer one,
a notice appears at the bottom of the left sidebar, and Settings → General shows a download button
and the installer line to copy. Nothing is downloaded or installed for you. The setting is off by
default; **Check now** on the same page works either way. Versions before 0.2.0 do not have it.

### From source

You need Git and any recent `pnpm`. The repo pins pnpm 10.28.2 and Node 24.14.0, and pnpm
downloads both for you, so you do not need a particular Node installed.

```bash
git clone https://github.com/Advance-Labs/ninebrains.git
cd ninebrains
pnpm install
pnpm run dev
```

`pnpm run dev` builds the packages, watches them, and starts the app. [Install from
source](install-from-source.md) covers building the app without the dev server, and the problems
people hit on a first build.

## First run

There is no account to create and no sign-in step. Telemetry is off, and no telemetry endpoint is
built into the app. Your data stays in the app's data folder
(`~/Library/Application Support/ninebrains` on macOS). [First run](first-run.md) lists what the app
sets up the first time you use it, including hooks it adds to your Claude Code settings.

## 1. Add a project

In the sidebar, click the add button next to **Projects** and choose a local git repository.

## 2. Open Lanes

Press **⌘K** (Ctrl+K on Windows and Linux) and run **Open Lanes**. The Lanes view opens with one
tab and four empty slots.

## 3. Add lanes

Click an empty slot. Choose the **project** and the **agent**; only agents installed on your
machine are listed. Ninebrains creates a worktree for the lane on its own `lanes/<id>` branch and
starts the agent in it.

Fill the other slots the same way, or use **+** in the tab strip for another tab. Each lane is
fully separate: its own branch, files and terminal. Type into any lane's terminal as you would in
your own shell.

Useful from here:

- **⌘1–⌘4** (Ctrl+1–Ctrl+4) focus a lane, even while a terminal has focus.
- **⌘⇧Enter** (Ctrl+Shift+Enter) maximizes the focused lane.
- **Sleep** hides a lane without stopping its agent.

[Lanes](lanes.md) covers the rest of the controls.

## 4. Set up gates

At the default settings, every job the Brain creates must pass the tests gate, and the tests gate
needs a test command for the project. Without one, every job is blocked.

Open **Settings → Gates**. Under **Tests**, pick the project, type its test command (for example
`pnpm test`) and click **Save test command**. See [Verification gates](gates.md#test-command).

## 5. Give the Brain a brief

Click **Brain** in the Lanes view's title bar to open the Brain drawer, then click **Start Brain**.
The Brain is a Claude Code session of its own, in the project of a lane in the current tab. Type
your brief into its terminal in the drawer, the way you would brief a small team.

The Brain splits the work into jobs, links the ones that depend on each other, and the app hands
each ready job to an idle lane in the project. Each lane's side panel shows its current job,
finished work and notes.

You can also lay the plan out on the [planner](planner.md) canvas and press **Run plan**. Click
**Planner** in the Lanes view's title bar, or run **Open Planner** from the command palette.

## 6. Watch the gates

When a lane reports a job as finished, its light turns to **verifying** while the job's gates run:
tests, a screenshot check, an independent reviewer, or a citation check, depending on the job and
your rigor settings.

- If every gate passes, the job moves to the lane's **Done** list.
- If a gate fails, the lane gets the feedback in its inbox and goes back to work.
- After three failed attempts, the job is **blocked** and you get a notification.
- If a gate cannot run because of your setup, the job is blocked at once.

A job with no gates at all (for example, with rigor set low) is marked **unverified**, never
passed. See [Verification gates](gates.md).

## Next

- Turn on a [pack](packs.md) for the project's kind of work.
- Learn the [keyboard shortcuts](keyboard-shortcuts.md).
- Read the [security overview](security.md) before running lanes on code or sites you do not trust.
