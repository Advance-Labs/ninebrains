---
title: Ninebrains
description: >-
  Ninebrains is an Apache-2.0 desktop app that runs a grid of Claude Code and Codex agents, each in
  its own git worktree, with a central Brain that routes the work and gates that check it.
---

Ninebrains runs several coding agents side by side. Each one works in a **lane**: its own git
worktree and branch, its own terminal, an editor and a browser. A central **Brain** holds the plan
as a graph of **jobs** and hands ready jobs to idle lanes. **Verification gates** check the work
with a second, independent run before it counts as done.

The name comes from the octopus: one central brain, plus a small brain in each of its eight arms.

Ninebrains is free and open source (Apache-2.0), and a fork of
[Emdash](https://github.com/generalaction/emdash) by General Action. It launches the `claude` and
`codex` CLIs you already have, under your own login. It never handles your credentials.

**Status:** pre-release. v0.1 is being built now, and builds are unsigned.

## Start here

- [Getting started](getting-started.md): install, add a project, open your first lanes.
- [Install from source](install-from-source.md), [first run](first-run.md), and how to
  [verify and open a download](verify-download.md).
- [Lanes](lanes.md): the grid, status lights, sleep and maximize.
- [Brain and jobs](brain-and-jobs.md): how work is planned, routed and reported.
- [Planner](planner.md): draw the plan as a graph and run it.
- [Verification gates](gates.md): what checks the work, and the rigor settings.
- [Packs](packs.md): coding, SEO and research bundles, and what the SEO pack sends where.
- [Unattended runs](unattended-runs.md): budgets, the STOP switch, and what never runs on its own.
- [Accounts](accounts.md): several Claude Code or Codex logins.
- [Models](models.md): routing lanes and subagents to cheaper models, and what SEC-39 and SEC-41
  protect against.
- [Everyday workflow](ide-workflow.md): tasks, the editor, diffs, pull requests, MCP, skills and
  automations.
- [Keyboard shortcuts](keyboard-shortcuts.md).
- [Configuration](configuration.md) and
  [files outside the data folder](files-outside-data-folder.md): settings, environment variables
  and file locations.
- [Security overview](security.md), [security policy](../SECURITY.md) and
  [threat model](../THREAT-MODEL.md).
- [Troubleshooting](troubleshooting.md).
- [Architecture](architecture.md) and [contributing](contributing.md), for contributors.

## What Ninebrains adds

On top of **Claude Code**, which it runs unchanged:

- several agents on screen at once, each in its own worktree;
- a shared plan with dependencies, and a mailbox between agents;
- an independent check before any work counts as done;
- budgets and a STOP switch for runs nobody is watching.

On top of **Emdash**, which it is built on:

- the 2×2 lane grid across worktrees;
- the Brain, the planner, the gates and the packs;
- no telemetry endpoint and no hosted account; auto-update runs on Ninebrains' own signed digest
  (releases only, nothing installed without your choice), not on OS signing.
