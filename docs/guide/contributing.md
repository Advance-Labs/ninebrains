---
title: Contributing
description: >-
  An overview for contributors: the test projects, the flaky browser tests, the end-to-end harness,
  the fake agent CLI and its step format, releases, and rebasing on upstream Emdash.
---

This page is an overview. The rules for pull requests, code style and the licence gate are in
`CONTRIBUTING.md` at the root of the repository. Read it before you open a pull request. For the
code map, see [Architecture](architecture.md).

## Commands

| Command | Does |
|---|---|
| `pnpm run dev` | Builds the packages and starts the app with hot reload |
| `pnpm run build` | Builds every package and the app |
| `pnpm run test` | Runs every package's tests |
| `pnpm run check` | Format check, lint, typecheck, licence gate, then tests. Stops at the first failure |
| `pnpm run licenses` | The licence gate on its own |
| `pnpm run doctor` | Reports problems with your machine's setup |

## Test projects

The desktop app's tests run in Vitest, split into projects:

| Project | Runs |
|---|---|
| `node` | Main-process and shared code in Node |
| `main-db` | Database code |
| `migrations` | Database migrations |
| `scripts` | The app's build and tooling scripts |
| `browser` | React components, in headless Chromium through Playwright |
| `fixtures` | Generates database fixtures. Not part of `test`; run it with `db:fixtures` |

To run one feature's tests:

```bash
pnpm --dir apps/emdash-desktop exec vitest run --project node src/core/features/brain
```

### The browser project

The `browser` project is skipped when `CI` or `EMDASH_TEST_SKIP_BROWSER` is set, so CI does not run
it. Run it locally before you open a pull request that touches the interface. It needs Chromium's
headless shell; see [Install from source](install-from-source.md#run-the-tests).

It can fail with "Cannot read properties of null (reading 'useRef')". That is Vite re-optimising
dependencies during the run. Re-run the same files; do not change the code to make it pass.

## End-to-end tests

The end-to-end tests launch the **built** app with Playwright's Electron driver. Each run gets a
fresh temporary folder that holds `HOME`, the app data folder and a fixture git repository. The
harness also:

- puts a `claude` on the `PATH` that runs the fake agent below;
- sets `NINEBRAINS_E2E=1`, which uses a mock keychain so no Keychain prompt appears;
- turns telemetry off.

```bash
pnpm --dir apps/emdash-desktop e2e         # build, then the lanes smoke test
pnpm --dir apps/emdash-desktop e2e:run     # the lanes smoke test, without building
pnpm --dir apps/emdash-desktop e2e:brain   # build, then the Brain fan-out test
```

The end-to-end tests are kept out of CI.

## The fake agent

`tooling/fake-agent` is a stand-in for the `claude` CLI. It speaks the same print-mode event
stream and interactive terminal, and makes real MCP calls, so tests can drive lanes, unattended
runs and gates without a model.

A script is a list of steps. Pass it in `FAKE_AGENT_SCRIPT`, either as inline JSON (a value that
starts with `[` or `{`) or as a path to a JSON file. The content is an array of steps, or an object
`{ "steps": [...] }`.

| Step | Does |
|---|---|
| `{ "say": "text" }` | Prints assistant text. Counts as a turn toward `--max-turns` |
| `{ "callTool": { "server": "brain", "tool": "complete_job", "args": { … } } }` | Makes a real MCP call to a server from the `--mcp-config` file. Strings in `args` are filled in from templates |
| `{ "writeFile": { "path": "notes.md", "content": "…" } }` | Writes a file, relative to the working directory |
| `{ "bash": "cmd" }` | Runs a shell command in the working directory, with no sandbox. A non-zero exit is reported as a tool error |
| `{ "sleep": 500 }` | Waits, in milliseconds |
| `{ "waitForInput": true }` | Interactive mode: ends the turn, and continues when the next line is typed |
| `{ "exit": 1 }` | Ends the run with that exit code |

Templates in strings:

| Template | Becomes |
|---|---|
| `{{prompt}}` | The current prompt |
| `{{lastToolResult}}` | The text of the last tool result |
| `{{prompt:<regex>}}` | The first capture group of the regex, matched against the prompt, or an empty string |

`{{prompt:<regex>}}` lets a scripted lane report the job it was given, for example
`"jobId": "{{prompt:job id: (\\S+)}}"`.

Tool steps go through the same checks as the real CLI: the turn limit, disallowed tools, permission
rules and hooks. With no script, print mode echoes the prompt back.

Other variables: `FAKE_AGENT_ARGV_LOG` appends each launch's arguments to a file,
`FAKE_AGENT_RATE_LIMIT` emits a rate-limit event, and `FAKE_AGENT_USAGE` overrides the token usage
it reports.

## Releases

Releases are cut by a maintainer from a manual workflow. It builds every target, writes
`SHA256SUMS`, and creates a draft release that a maintainer reviews before publishing. Builds are
unsigned, and auto-update stays off until they are signed. Users check downloads as described in
[Verify and open a download](verify-download.md).

## Rebasing on upstream

Ninebrains is a fork of Emdash, and it rebases on upstream regularly. Upstream moves fast, so every
change to an inherited file costs effort again at each rebase.

- Prefer a new feature slice to a patch of an inherited file.
- If you must patch one, keep it small, start the code comment with `Ninebrains:`, and log it in
  `docs/UPSTREAM-PATCHES.md` in the same pull request.
- On a rebase, regenerate `pnpm-lock.yaml`. Never merge it by hand.
- The `.emdash.json`, `EMDASH_*`, `@emdash/*` and `emdash4.db` names are kept on purpose, to keep
  rebases small.
