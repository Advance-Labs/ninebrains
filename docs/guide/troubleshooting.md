---
title: Troubleshooting
description: >-
  Fixes for the common Ninebrains problems: blocked jobs, the tests-gate sandbox, a latched STOP,
  screenshot-gate failures, lane status lights, unsigned-build and Keychain prompts, GitHub
  sign-in, SSH projects, SEO pack warnings, and building from source.
---

## Jobs and gates

### Every job is blocked with "No test command is set for this project"

At the default rigor, every code and ui job gets the tests gate, and a job with no kind counts as
code. The tests gate needs a test command for the project; without one, the job is blocked at once
and no attempt is used.

Open **Settings → Gates**, pick the project under **Tests**, type its test command (for example
`pnpm test`) and click **Save test command**. Then requeue the blocked job. See
[Verification gates](gates.md#test-command).

### The tests gate says it needs a sandbox

The message reads "tests gate needs a sandbox (install bubblewrap) or an explicit per-project
opt-in". The tests gate runs the lane's code, so it only runs inside an OS sandbox.

- **Linux:** install bubblewrap, then quit and reopen Ninebrains. The app looks for `bwrap` on its
  `PATH` when it starts.

  ```bash
  sudo apt install bubblewrap    # Debian, Ubuntu
  sudo dnf install bubblewrap    # Fedora
  ```

- **Windows:** there is no sandbox for the tests gate. Either lower **Testing rigor** below 3 so
  code jobs skip the tests gate, or turn on **Allow unsandboxed** for the project in
  **Settings → Gates → Tests**. With that on, the test command (code the lane can rewrite) runs as
  you, with only a scrubbed environment and a timeout.

Like a missing test command, this is a setup problem: the job is blocked at once and no attempt is
used.

### STOP is latched and nothing is dispatched

After STOP, the Brain drawer shows **STOP is latched** and the title bar button reads **Stopped**.
No job is dispatched and no run starts until you clear it.

Open the Brain drawer and click **Clear STOP**. Quitting and reopening the app also clears it.

### The screenshot gate fails with "gate skipped: devtools open"

The screenshot gate attaches to the lane's browser through the Chrome DevTools Protocol. If
DevTools is open on that browser, it cannot attach, so it reports the capture as skipped and the
gate fails. The same happens with "another debugger is attached to the lane browser".

Like a missing test command, this is a setup problem: the job is blocked at once and no attempt is
used. Close DevTools (or the other debugger) on the lane's browser, then requeue the blocked job.

### The screenshot gate says "No preview URL"

The gate captures the lane's dev server. Ninebrains finds it by watching the lane's terminal and
script output for a `localhost` or `127.0.0.1` URL. If no dev server is running, there is no URL.

Give the project a run script that starts the dev server:

1. Open the project, then its **Settings** tab.
2. Under the lifecycle scripts, set **Run script**, for example `PORT=$EMDASH_PORT pnpm dev`.
3. Turn on **Auto-run on task creation** for it, so it starts in new tasks. It is off by default;
   the setup script's auto-run is on by default.

For a lane that already exists, open its task (the **Editor** button in the lane header) and start
the script from the **Scripts** tab of the terminal drawer (⌘J, or Ctrl+J).

The run script is saved for this machine. To share it with your team, use the project's share
option, which writes it to the repository's `.emdash.json` as `scripts.run` (**Write
.emdash.json**). The auto-run switch stays a setting on each machine.

### An unattended run finished but did nothing

Check the account it ran under with `claude auth status --json` or `codex login status`. A
logged-out Claude run can report a "success" subtype while failing. See [Accounts](accounts.md).

## Lanes

### A lane shows a warning triangle next to the agent name

The tooltip says "Status lights unavailable: this agent's hooks are not installed yet". Status
lights come only from the agent's hooks, never from reading terminal output. The hooks are
installed into the agent's config directory the first time it starts. If the triangle stays, open
**Settings → Agents**: the **Hooks** row reads "Configured" with a folder once they are in place,
and "Configured on first session" before that. See [First run](first-run.md).

### The lane browser says "Browser not ready"

The lane browser reuses the task's preview servers, and they load when the lane's task has been
opened in this window. Use the **Open task** button in the cell, then come back to Lanes.

### A lane's dev server is on the wrong port, or two lanes clash

Each lane's terminal gets `EMDASH_PORT`, derived from a hash, so two lanes can land on the same
port. Start your dev server with that port (`PORT=$EMDASH_PORT pnpm dev`, or the same in the
project's run script). Per-lane port leases that avoid collisions are planned.

## The app

### macOS or Windows says the app is from an unidentified developer

v0.1 builds are not code-signed. [Verify and open a download](verify-download.md) explains how to
check the download and open it on macOS (Gatekeeper) and Windows (SmartScreen).

### macOS asks for Keychain access after every update

The prompt reads *"Ninebrains wants to use your confidential information stored in 'Ninebrains Safe
Storage' in your keychain"*. Click **Always Allow**; the app cannot start until you answer.

An unsigned build has no stable identity, so macOS treats each new build as a different app and
asks again. A dev build of the app triggers it too. Signed builds will stop this.

### "Connect GitHub" offers only GitHub CLI import

GitHub's device-flow sign-in needs an OAuth App registered for Ninebrains, and Emdash's was
removed. Until a build carries one, sign in with the GitHub CLI (`gh auth login`) and use the
import option. See [First run](first-run.md#github).

### An SSH project fails with `artifact-download-failed`

Remote projects need the workspace server, and no Ninebrains release carries it yet. Point
`EMDASH_WORKSPACE_SERVER_ARTIFACTS_URL` at a mirror, or use local projects. Lanes are local-only in
v0.1 anyway.

### The app is still running after I closed the window

It keeps running in the tray. Quit it from the tray icon or the app menu.

### An SEO pack server is missing from a lane

A server with a missing required secret is left out, with a warning on the Packs settings page.
Also check the SEO server address (`NINEBRAINS_SECRET_AEO_MCP_BASE_URL`): anything other than
`https`, or `http` on localhost, is refused. Google access tokens expire after about an hour.

## Where Ninebrains keeps its data

| What | macOS |
|---|---|
| App data | `~/Library/Application Support/ninebrains` (dev builds: `ninebrains-dev`) |
| App database | `emdash4.db` inside that folder (the file name is kept from Emdash) |
| Brain database | `ninebrains-brain.db` inside that folder |
| Lane, run and evidence files | `ninebrains/` inside that folder |

On Linux the app data folder is under `~/.config`, and on Windows under `%APPDATA%`. The full list
is in [Configuration](configuration.md#file-locations). What Ninebrains writes elsewhere on your
machine is in [Files outside the data folder](files-outside-data-folder.md).

## Building from source

See [Install from source](install-from-source.md#common-problems) for `posix_spawnp failed`,
missing `chromium_headless_shell`, and the flaky browser-test error.

### `pnpm run check` fails and the failure looks environmental

Run `pnpm run doctor` to rule out your setup.
