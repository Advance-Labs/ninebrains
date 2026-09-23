---
title: Everyday workflow
description: >-
  The workbench Ninebrains inherits from Emdash: tasks and worktrees, the editor, diffs, commit and
  push, pull requests, MCP servers, skills, automations, the preview browser and issues.
---

Lanes are one way to work. Underneath, Ninebrains is a full agent workbench, inherited from
Emdash. Everything on this page works with or without lanes, and with agents other than Claude Code
and Codex.

A **task** is one git worktree plus the agent conversations in it. A lane is a task with one
terminal agent, shown in the grid.

## Tasks and worktrees

Create a task in any of these ways:

- the **New Task** button on a project in the left sidebar, or in the project's task list;
- **New Task** from a row in the project's **Pull Requests** tab;
- **Mod+N**, or **New Task** in the command palette (Mod+K).

The **Create Task** dialog has a task name, an optional linked issue or pull request, and two tabs:

- **Initial Conversation:** the agent conversation to start with the task.
- **Workspace Settings:** **Create new branch** or **Checkout branch**, and the branch to start
  from.

New tasks start from the project's default branch. Change it in the project's **Settings** tab,
under **Default branch**. The app-wide branch settings are in **Settings → Repository**.

Switch tasks with Mod+Alt+Up and Mod+Alt+Down. Archive a task with Mod+Shift+E.

## Editor

Open the **Files** panel (Mod+Shift+2, or **Files** in the task's title bar). Files open as editor
tabs in a Monaco editor. Save with Mod+S.

To open the worktree in another editor, use the **Open in** menu, or Mod+O.

### Cowork on an SSH worktree

Cowork lets two people edit the same text file live when each opens the same worktree on one SSH
host through their own Unix account. The host owner first starts the
[Cowork server](../../apps/cowork-server/README.md) and gives both people its socket path and
access token through a trusted channel. Both accounts need access to the shared worktree and
socket.

Open a text file, choose **Cowork** in its toolbar, enter the socket path and token, then choose
**Join shared file**. Typing synchronizes between joined editors. Save writes the shared text to
the worktree. After an SSH interruption, choose **Reconnect** to merge edits made while offline.
Use **Leave shared file** to return to ordinary file editing.

Cowork currently needs manual server setup and a manual join for each file. It shares editor text;
it does not share cursors, terminals, agents, or task tabs. If another program changes the file on
disk, Save reports a conflict and keeps the editor buffer for review.

## Changes and diffs

Open the **Changes** panel (Mod+Shift+1, or **Changes** in the task's title bar). It lists staged
and unstaged files. Click a file to open its diff in a tab.

## Commit and push

The commit card in the Changes panel has a **Commit message** box and three actions:

- **Commit**
- **Commit & Push**
- **Commit & Create PR**

There is also a **Push changes** button, and **Git Fetch**, **Git Pull** and **Git Push** in the
command palette.

## Pull requests

- **Create:** click **Create PR** in the pull request section of the Changes panel. The dialog
  offers a normal or draft pull request, and **Push & Create PR**.
- **Browse:** open the project's **Pull Requests** tab. Start a task from any pull request.

Pull requests need GitHub connected. See [First run](first-run.md#github).

## Terminals

Toggle the terminal drawer with Mod+J. It has two tabs:

- **Terminals:** shells in the worktree. **New terminal** opens another (Mod+Shift+`).
- **Scripts:** the project's lifecycle scripts, such as the run script that starts a dev server.

Terminal settings are in **Settings → Interface → Terminal**.

## Project scripts and .emdash.json

Each project can have lifecycle scripts: prepare, setup, run and teardown. Set them in the
project's **Settings** tab. Setup runs automatically in each new task; run does not, until you turn
on **Auto-run on task creation** for it.

These settings are saved for your machine. To share scripts with your team, use the share option
to write them to `.emdash.json` in the repository. See
[Configuration](configuration.md#emdashjson).

## Preview browser

Ninebrains watches each task's terminal and script output for a local URL, such as
`http://localhost:5173`. When it finds one and the port answers, a **Preview** pill appears in the
task's title bar.

- Open the in-app browser with Mod+Shift+B.
- Copy its URL with Mod+Shift+C.
- If your server is not detected, use **Forward Port** to add it by hand.

The browser does not open by itself when a server is found. Lanes use the same preview servers for
the lane browser and for the screenshot gate.

## MCP servers

Open **Settings → MCP**. Search the catalog, add a server from its card, or add your own with
**Custom MCP**.

Servers added here are written to each agent's own configuration, in the default config directory
only. Lanes do not use them: a lane gets only the Brain's server and its project's pack servers.
See [Packs](packs.md).

## Skills

Open **Settings → Skills**. Search the catalog, then **Install** or **Uninstall** from a skill's
card or its detail dialog. Skills are stored in `~/.agentskills`, where every agent that reads that
folder can use them.

Skills whose names start with `nb-` belong to packs. Ninebrains manages them, and removes any it
does not expect. Do not name your own skills `nb-…`.

## Automations

Click **Automations** at the bottom of the left sidebar. **Create automation** asks for a name, a
project, a schedule and a prompt. The schedule is a standard five-field cron expression, with an
optional time zone.

Each run of an automation creates a task with the prompt as its conversation. Automations are
separate from the Brain and from [unattended runs](unattended-runs.md).

## Issues

**Settings → Integrations** connects issue trackers: GitHub, GitLab, Linear, Jira, Asana, Trello,
Notion, Plane, Plain, Monday, Forgejo and Featurebase. Once one is connected, the Create Task
dialog can start a task from an issue.

## Settings pages

**Settings** (Mod+,) has these pages, in order: General, Integrations, Interface, Browser,
Repository, Prompts, System, Workspaces, Conversations, Agents, MCP, Skills, Packs, Gates, Models
and Machines.
