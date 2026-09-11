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

The Brain logic lives in [`@ninebrains/brain-core`](../../packages/brain-core/README.md). Agents
reach it through [`@ninebrains/brain-mcp`](../../packages/brain-mcp/), a small MCP server that
every lane runs.

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

<!-- VERIFY-AFTER-P2 -->
## Giving the Brain a brief

Open the **Brain drawer** in the Lanes view. The Brain is itself a Claude Code session with the
Brain's tools in Brain mode. Describe the work; the Brain breaks it into jobs, links their
dependencies, and hands ready jobs to idle lanes. An unread badge shows new messages, and each
lane's inbox is visible from the drawer.

## Dispatch

The dispatcher pairs ready jobs with idle lanes in the same project:

- An **attended** lane gets the job pasted into its terminal as a prompt. Ninebrains pastes only
  when the lane is idle, never while it is waiting on a permission prompt, and strips control
  characters so a job cannot type keystrokes.
- An **unattended** run starts `claude -p` or `codex exec` with the job on stdin. See
  [Unattended runs](unattended-runs.md).

## Several Brains

You can run more than one Brain session. Replies go back to the Brain that sent the message.
<!-- /VERIFY -->

## Where the data lives

Only the app's main process opens the Brain database, `ninebrains-brain.db` in the app data folder,
with the folder mode `0700` and the file mode `0600`. It is separate from Emdash's own database.
