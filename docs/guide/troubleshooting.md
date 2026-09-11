---
title: Troubleshooting
description: >-
  Fixes for the common Ninebrains problems: lanes without status lights, a lane browser that says
  it is not ready, unsigned-build warnings, GitHub sign-in, SSH projects, SEO pack warnings, and
  flaky browser tests when building from source.
---

## Using the app

### A lane shows a warning triangle next to the agent name

The tooltip says "Status lights unavailable: this agent's hooks are not installed yet". Status
lights come only from the agent's hooks, never from reading terminal output. The hooks are
installed into the agent's config directory the first time it starts. If the triangle stays,
open **Settings → Agents** and check the agent's hook status.

### The lane browser says "Browser not ready"

The lane browser reuses the task's preview servers, and they load when the lane's task has been
opened in this window. Use the **Open task** button in the cell, then come back to Lanes.

### A lane's dev server is on the wrong port, or two lanes clash

Each lane's terminal gets `EMDASH_PORT`, derived from a hash, so two lanes can land on the same
port. Start your dev server with that port (`PORT=$EMDASH_PORT pnpm dev`, or the same in the
project's `.emdash.json` `scripts.run`). Per-lane port leases that avoid collisions are planned.

### macOS or Windows says the app is from an unidentified developer

v0.1 builds are not code-signed. [RELEASING.md](../RELEASING.md) explains how to verify the
download and open it on macOS (Gatekeeper) and Windows (SmartScreen).

### "Connect GitHub" offers only GitHub CLI import

GitHub's device-flow sign-in needs an OAuth App registered for Ninebrains, and Emdash's was
removed. Until a build carries one, sign in with the GitHub CLI (`gh auth login`) and use the
import option.

### An SSH project fails with `artifact-download-failed`

Remote projects need the workspace server, and no Ninebrains release carries it yet. Point
`EMDASH_WORKSPACE_SERVER_ARTIFACTS_URL` at a mirror, or use local projects. Lanes are local-only in
v0.1 anyway.

### The app is still running after I closed the window

It keeps running in the tray. Quit it from the tray icon or the app menu.

### An SEO pack server is missing from a lane

A server with a missing required secret is left out, with a warning on the Packs settings page.
Also check `AEO_MCP_BASE_URL`: anything other than `https`, or `http` on localhost, is refused.
Google access tokens expire after about an hour.

### An unattended run finished but did nothing

Check the account it ran under with `claude auth status --json` or `codex login status`. A
logged-out Claude run can report a "success" subtype while failing. See [Accounts](accounts.md).

## Where Ninebrains keeps its data

| What | macOS |
|---|---|
| App data | `~/Library/Application Support/ninebrains` (dev builds: `ninebrains-dev`) |
| App database | `emdash4.db` inside that folder (the file name is kept from Emdash) |
| Brain database | `ninebrains-brain.db` inside that folder |
| Pack, lane and evidence files | `ninebrains/` inside that folder |

On Linux the app data folder is under `~/.config`, and on Windows under `%APPDATA%`.

## Building from source

### Browser tests fail with a missing `chromium_headless_shell`

Install it once per machine:

```bash
pnpm --dir apps/emdash-desktop exec playwright install chromium-headless-shell
```

### Browser tests fail with "Cannot read properties of null (reading 'useRef')"

That is Vite re-optimising dependencies during the run, not a code failure. Re-run the same files.
CI skips the browser test projects for the same reason.

### `posix_spawnp failed` from node-pty

This happens when an install skipped node-pty's install scripts, so its `spawn-helper` is not
executable:

```bash
chmod +x node_modules/node-pty/prebuilds/*/spawn-helper
```

### `pnpm run check` fails and the failure looks environmental

Run `pnpm run doctor` to rule out your setup.
