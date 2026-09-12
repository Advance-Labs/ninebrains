---
title: Security overview
description: >-
  A plain summary of how Ninebrains contains agents that run shell commands on your machine: the
  two real boundaries, the controls around the Brain, gates and unattended runs, the accepted
  risks, and how to report a vulnerability.
---

Ninebrains runs coding agents that execute shell commands as you. This page summarises how it
limits the damage an agent that has been misled can do. The full analysis is in the
[threat model](../THREAT-MODEL.md), and the reporting process is in the
[security policy](../SECURITY.md).

## The one fact that shapes everything

Every lane runs **as your own OS user**, with a shell. File permissions stop other users; they do
not stop a lane's shell from reading your files. So there are two real boundaries between a lane
that has read a hostile web page and the rest of your machine:

1. **The provider's sandbox and permission layer**: the Claude Code sandbox and permission rules,
   and Codex's `--sandbox`. This is what stops a lane reading other lanes' secrets or leaving its
   worktree.
2. **The app's checks on everything a lane hands back.** The app's main process owns the Brain
   database, the gates and the dispatcher. A lane only ever asks.

Per-lane tokens are a real boundary only while the sandbox is on. With the sandbox off, a lane is
your own shell.

## Controls in this build

**Brain endpoint and brain-mcp** (`@ninebrains/brain-core`, `@ninebrains/brain-mcp`):

- The endpoint listens on `127.0.0.1` only. It accepts only `POST` with JSON and a bearer token,
  rejects any other `Host` header (a DNS-rebinding defence), and rejects anything carrying
  `Origin`, `Referer` or `Sec-Fetch-*`, so web pages cannot call it.
- Each launch gets a 256-bit token. Identity and role come from the token alone; environment
  variables, headers and tool arguments cannot change them.
- Bodies are capped at 64 KiB, with 5-second timeouts and a per-token rate limit.
- The brain-mcp process never opens the database. It forwards each call to the app.
- Messages between lanes are structured data marked with their sender, never pasted into another
  lane's instructions.
- A job's gates are the union of your rigor settings and whatever the caller asks for. An agent
  can add gates, never remove them.

**Gates** (`@emdash/gates-core` and the app's gate capabilities):

- Reviewers run in a disposable checkout with read-only tools: no shell, no writes, no network. A
  test checks the lane worktree byte for byte after a hostile reviewer run.
- Everything the worker or the web controls is fenced in per-call random delimiters that the
  content cannot close. Deterministic failures (console errors, failing tests, invented citations)
  fail the gate whatever the reviewer says.
- Pages are fetched through an SSRF-safe fetcher. It pins the checked IP at connect time, re-checks
  every redirect, and blocks loopback, private, link-local and similar addresses.
- The tests gate runs with a scrubbed environment and kills its whole process group. On macOS it
  also runs in a sandbox.

**Unattended runs:** budgets, a latched STOP switch, a sandbox, a minimal environment, prompts on
stdin, and a guard against permission-bypass flags. See [Unattended runs](unattended-runs.md).

**The app:**

- Telemetry is off by default. No telemetry key or host is built in, and the settings card for it
  is hidden.
- The auto-updater is compiled out until builds are signed.
- The app does not contact Emdash or General Action servers.
- Pack secrets are referenced by name and never written into pack files or preferences.

**Lane launches:**

- Attended Claude lanes start with a per-lane settings file that turns the Claude Code sandbox on
  and denies reads of Ninebrains' data folder, other lanes' worktrees and credential folders. There
  is no setting to turn it off per project.
- Each lane's MCP config file is created with mode `0600` in a folder with mode `0700`. It is
  deleted when the lane stops, and any left over are deleted when the app starts.
- Codex lanes get their Brain settings as command-line flags instead of a file, so the lane's token
  is visible in the process list to other programs running as you.
- A lane never starts with auto-approve on, and a guard rejects permission-bypass flags.

## Accepted risks for v0.1

These are documented rather than fixed. Details and the reasons are in the threat model, section 7.

- With the sandbox off, a lane can read other lanes' tokens and your files.
- Codex's sandbox limits writes but not reads, so a Codex lane can read other lanes' config.
- Attended lanes inherit a broad environment allowlist, like your own terminal.
- Pack skills install globally and are visible to agents outside Ninebrains.
- Prompt injection against an attended lane cannot be fully prevented. It relies on the provider's
  permission prompts and on you.
- Remote (SSH) lanes are not supported.
- Screenshots of a lane's own preview may show test data. They stay on your machine.
- Builds are unsigned and verified by checksums and build attestations only.
- All lanes share one OS user, so there is no kernel-level isolation between them.

## Reporting a vulnerability

Email **security@advancelabs.dev**. Do not open a public issue. The
[security policy](../SECURITY.md) covers scope, response times and the 90-day disclosure window.

## Verifying a download

Until builds are signed, check every download against the release's `SHA256SUMS` file.
[Verify and open a download](verify-download.md) has the commands.
