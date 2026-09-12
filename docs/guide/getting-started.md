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

### From a release

Download the build for your OS from
[GitHub Releases](https://github.com/Advance-Labs/ninebrains/releases).

v0.1 builds are **not code-signed**. Before you open one, check it against the release's
`SHA256SUMS` file. [Verify and open a download](verify-download.md) gives the commands, and
explains how to open an unsigned app past macOS Gatekeeper and Windows SmartScreen. Unsigned
builds do not update themselves; download new releases by hand.

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
needs a test command for the project. This build has no field to set one, so every job is blocked
until you change the rigor.
<!-- VERIFY: a per-project test command setting is being added -->

For now, open **Settings → Gates** and set **Testing rigor** below 3. Jobs then finish as
**unverified** rather than blocked. See [Verification gates](gates.md#test-command).

## 5. Give the Brain a brief

Click **Brain** in the Lanes view's title bar to open the Brain drawer, then click **Start Brain**.
The Brain is a Claude Code session of its own, in the project of a lane in the current tab. Type
your brief into its terminal in the drawer, the way you would brief a small team.

The Brain splits the work into jobs, links the ones that depend on each other, and the app hands
each ready job to an idle lane in the project. Each lane's side panel shows its current job,
finished work and notes.

You can also lay the plan out on the [planner](planner.md) canvas and press **Run plan**. This
build has no menu item or command that opens the planner yet.
<!-- VERIFY: an entry point for the planner is being added -->

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
