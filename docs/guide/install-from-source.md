---
title: Install from source
description: >-
  Build and run Ninebrains from a git checkout: prerequisites, the dev server, a full build and a
  packaged app, where each one keeps its data, and fixes for the common first-build problems.
---

## What you need

- **Git.**
- **pnpm 10.28 or later.** The repo pins pnpm 10.28.2 and Node 24.14.0. pnpm downloads that Node
  for you, so you do not need a particular Node installed.
- **An agent CLI** to run in lanes: `claude`, `codex`, or both, logged in.
- **Linux only:** bubblewrap (`bwrap`), if you want the tests gate to run. See
  [Verification gates](gates.md#tests).

## Get the source and run it

```bash
git clone https://github.com/Advance-Labs/ninebrains.git
cd ninebrains
pnpm install
pnpm run dev
```

`pnpm install` also runs the app's install script, which:

- rebuilds `better-sqlite3` for Electron (set `EMDASH_SKIP_ELECTRON_REBUILD=1` to skip it);
- on macOS, makes node-pty's `spawn-helper` executable, which the published package leaves off.

`pnpm run dev` builds the workspace packages, watches them, and starts the app with the Electron
dev server. Its logs go to `apps/emdash-desktop/.emdash-logs/emdash.log`.

## Build the app

A full build, from the repository root:

```bash
pnpm run build
```

This builds every package, then the app, into `apps/emdash-desktop/out`. Run the root build at
least once before you use the app's own build commands: `pnpm --dir apps/emdash-desktop build`
builds only the app, and fails if the packages it imports have not been built.

To make an installable app for your OS:

```bash
pnpm --dir apps/emdash-desktop package:mac     # or package:linux, package:win
```

The result is in `apps/emdash-desktop/release/`. It is unsigned, like the published builds.

## Dev and built apps keep separate data

| How you run it | App data folder name |
|---|---|
| `pnpm run dev` | `ninebrains-dev` |
| A built or packaged app | `ninebrains` |

The folder sits in `~/Library/Application Support` on macOS, `~/.config` on Linux and `%APPDATA%`
on Windows. A packaged app you built yourself shares `ninebrains` with any release you installed.
To keep them apart, start one with `EMDASH_USER_DATA_DIR` set to another folder. See
[Configuration](configuration.md#file-locations).

On macOS, each new build may ask for Keychain access. See
[Troubleshooting](troubleshooting.md#macos-asks-for-keychain-access-after-every-update).

## Check your setup

```bash
pnpm run doctor
```

It only reports; it changes nothing. It checks:

- the Node and pnpm versions against the pinned ones;
- that the SQLite native module loads, and was built for Electron's ABI;
- that node-pty loads;
- that Playwright's browsers are installed (needed for the browser tests);
- Docker and the Nx daemon;
- escape-hatch environment variables that change how the app or tests behave.

Run it first whenever a build or test failure looks like your machine rather than the code.

## Run the tests

```bash
pnpm run test      # every package's tests
pnpm run check     # format, lint, typecheck, licence gate, then tests
```

The browser tests need Chromium's headless shell. Install it once per machine:

```bash
pnpm --dir apps/emdash-desktop exec playwright install chromium-headless-shell
```

[Contributing](contributing.md) covers the test projects, the end-to-end tests and the stand-in
agent CLI.

## Common problems

### `posix_spawnp failed` from node-pty

node-pty's `spawn-helper` is not executable, usually because the install script did not run:

```bash
chmod +x node_modules/node-pty/prebuilds/*/spawn-helper
```

### Browser tests fail with a missing `chromium_headless_shell`

Install it, as above:

```bash
pnpm --dir apps/emdash-desktop exec playwright install chromium-headless-shell
```

### Browser tests fail with "Cannot read properties of null (reading 'useRef')"

That is Vite re-optimising dependencies during the run, not a code failure. Re-run the same files.
CI skips the browser tests for the same reason.

### The app build fails to resolve a workspace package

Run `pnpm run build` from the repository root first. The app imports the packages' built output.
