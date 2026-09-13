---
title: Brain and jobs
description: >-
  The Brain holds a dependency graph of jobs and a mailbox, and hands ready jobs to idle lanes.
  The job states, the tools agents call, how a lane is chosen, and how identity is enforced.
---

The **Brain** is the central coordinator. It holds:

- a **graph of jobs**, where an edge means "this job needs that one done first";
- a **mailbox** for messages between lanes and the Brain;
- the record of every run and note.

A **job** is one unit of work routed to one lane. It is not the same as an Emdash task, which is a
worktree session.

Agents reach the Brain through `brain-mcp`, a small MCP server that the app starts for every lane.
It forwards each tool call to the app and holds no data of its own.

## Job states

```
proposed -> ready -> claimed -> running -> verifying -> done
               ^                  ^           |
               |                  +-----------+  gate failed (attempts + 1)
blocked / failed --requeue--> ready | proposed
```

- A job becomes **ready** only when every job it depends on is **done**. When a job finishes, the
  jobs waiting on it are promoted automatically.
- When the lane says it is finished, the job moves to **verifying** and its gates run. See
  [Verification gates](gates.md).
- If a gate fails, the job goes back to **running** with the feedback in the lane's inbox. On the
  third failure it goes to **blocked**, and you are notified.
- **Requeue** puts a blocked or failed job back in the queue with its attempts reset.

## Tools the agents call

A lane sees these tools:

| Tool | Does |
|---|---|
| `claim_job` | Takes a ready job |
| `complete_job` | Reports the job finished, with a summary and artifacts; starts the gates |
| `block_job` | Reports the job cannot go on, with a reason |
| `send_message` | Sends a message to another lane or the Brain |
| `read_inbox` | Reads the lane's messages |
| `list_jobs` | Lists jobs in the lane's project |
| `add_note` | Leaves a note on the lane |

A Brain session sees the same set except `claim_job` (the Brain assigns jobs; it does not take
them), plus `create_job`, `link_jobs`, `assign_job`, `requeue_job`, `list_lanes` and `broadcast`.

## Who may do what

Each launch gets its own token, minted by the app. The token alone decides who is calling and in
which role. Environment variables, headers and tool arguments cannot change it. So:

- Lane A cannot complete, block or claim as lane B.
- A lane cannot act as the Brain, even if it starts brain-mcp itself.
- Messages are data. Each one carries its sender, and anything a lane wrote is marked untrusted.
  The Brain never pastes one lane's message into another lane's instructions.

**Gates have a floor.** A job's gates are the union of the minimum your rigor settings require and
whatever the creator asked for. An agent can add gates. Only you, in the app, can lower rigor.

## How a lane is chosen

When a job is ready, the Brain picks a lane in this order:

1. Only idle lanes in the job's project.
2. For a review, a lane whose provider differs from the author's, so Claude's work can be checked
   by Codex and the other way round.
3. Context: a lane that touched overlapping files, or whose last job is in this job's dependency
   chain.
4. The least-loaded lane.

## Giving the Brain a brief

Click **Brain** in the Lanes view's title bar to open the Brain drawer, then click **Start Brain**.
The Brain is itself a Claude Code session, in a worktree of its own, with the Brain's tools. It
runs in the project of a lane in the current tab, and it can plan only inside that project.

Type the brief into the Brain's terminal in the drawer. The Brain breaks the work into jobs and
links their dependencies. The app then hands ready jobs to idle lanes.

The drawer also shows:

- whether dispatch is running, paused or stopped, with a **Pause** / **Resume** button;
- how many jobs are ready, running, verifying, blocked and done;
- each lane's unread messages, with a **Message** button to write to a lane;
- **Replies**, the Brain's own inbox.

## Dispatch

The dispatcher pairs ready jobs with idle lanes in the same project. It assigns the job first, so
the lane does not need to call `claim_job`.

- An **attended** lane gets the job pasted into its terminal as a prompt. Ninebrains pastes only
  when the lane is idle, never while it is waiting on a permission prompt, and strips control
  characters so a job cannot type keystrokes. If the paste does not land, the job goes back to
  ready.
- An **unattended** lane runs the job with `claude -p`, with the job on stdin. See
  [Unattended runs](unattended-runs.md). Lanes are attended by default, and this build has no
  control to change a lane's mode.
  <!-- VERIFY: a lane mode picker (attended or unattended) is being added -->

## Several Brains

Click **+ Brain** in the drawer to start another Brain session. Each has its own tab in the drawer.
Messages you send from the drawer go out as the selected Brain, so replies come back to it.

## Where the data lives

Only the app's main process opens the Brain database, `ninebrains-brain.db` in the app data folder,
with the folder mode `0700` and the file mode `0600`. It is separate from Emdash's own database.
