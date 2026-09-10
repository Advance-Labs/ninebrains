# Ninebrains fork notes

Ninebrains is a fork of [Emdash](https://github.com/generalaction/emdash) (Apache-2.0).

- Upstream remote: `upstream` = `https://github.com/generalaction/emdash.git`. Never push to it.
- Origin: `https://github.com/Advance-Labs/ninebrains.git` (private until reviews pass).
- Forked at upstream **`dbf690c`** (`Merge pull request #3183 … fix-hide-emdash-from-task-bar`), app version 1.2.4.
- Every change to an inherited file is listed in [UPSTREAM-PATCHES.md](UPSTREAM-PATCHES.md).

## Toolchain

The repo pins Node `24.14.0` (`devEngines.runtime`, `onFail: download`) and `pnpm@10.28.2`
(`packageManager`). Any pnpm on PATH provisions both, so the machine's Node 25.8 is never used for
repo commands. `mise` is not installed and not needed. `.npmrc` sets `node-linker=hoisted`.

## Baseline (upstream `dbf690c`, macOS arm64, 2026-09-10)

| Command | Result | Time |
|---|---|---|
| `pnpm install` | pass | 56 s (warm store) |
| `pnpm build` | pass, 9 projects | 175 s |
| `pnpm typecheck` | pass, 9 projects | 27 s |
| `pnpm lint` | pass, 9 projects | 26 s |
| `pnpm test` | **fail (environment only)**, see below | 129 s |

Baseline test counts:

| Project | Files | Tests |
|---|---|---|
| @emdash/shared | 43 | 340 |
| @emdash/wire | 52 | 321 |
| @emdash/theme | 1 | 43 |
| @emdash/plugins | 64 | 369 |
| @emdash/chat-ui | 19 of 26 loaded | 251 |
| @emdash/workspace-server | 11 | 62 |
| @emdash/core | 231 | 1748 pass, 13 skipped |
| @emdash/ui | 31 | 214 |
| @emdash/emdash-desktop | 550 of 612 loaded | 3671 pass, 1 skipped |

**Known failure (upstream, environmental):** the Playwright-backed `browser` Vitest projects in
`chat-ui` and `emdash-desktop` could not start: `chromium_headless_shell-1223` was not installed.
Every test that ran passed. Fix once per machine:

```bash
pnpm --dir apps/emdash-desktop exec playwright install chromium-headless-shell
```

With the browser installed, the first run can still fail a handful of browser files with
`Cannot read properties of null (reading 'useRef')` or "Failed to fetch dynamically imported
module". This is Vite re-optimising dependencies mid-run, not a code failure: the same 8 files
passed 67/67 on the immediate re-run. Upstream CI skips the browser projects for the same reason.

## After the W0 fork changes

| Command | Result |
|---|---|
| `pnpm format` | pass |
| `pnpm typecheck` | pass, 9 projects |
| `pnpm lint` | pass, 9 projects |
| `pnpm run licenses` | pass: 11 unit tests; 763 production package versions, 1,414 installed versions walked; 5 reviewed exceptions |
| `pnpm test` | pass. Packages as baseline (chat-ui now loads 26/26 files, 280 tests). Desktop: node 3165 + main-db 365 + migrations 69 + scripts 75 tests pass; browser 246/249 on a loaded machine, and the 3 failures (5 files) pass 9/9 on re-run (Vite/contention flakes, see above) |

## Launch the dev app

```bash
pnpm install
pnpm run dev            # all package watchers + Electron (from the repo root)
```

Built-app check (what W0 verified): `pnpm --dir apps/emdash-desktop build`, then launch Electron
with `apps/emdash-desktop` as the app directory. The W0 run:

- `app.getName()` = `Ninebrains`; window title `Ninebrains`; userData
  `~/Library/Application Support/ninebrains` (dev builds use `ninebrains-dev`).
- Renderer: no external requests.
- Main process and helpers: `lsof` polling during a 20 s boot saw exactly one outbound socket,
  TCP 443 to 140.82.112.6 (GitHub, Inc.; the GitHub integration and skills catalog). There were no
  connections to any Emdash, PostHog, Sentry or General Action host. A `NODE_OPTIONS=--require`
  fetch hook did not load, because this Electron ignores `NODE_OPTIONS`, so the socket poll is the
  evidence.
- Screenshot: [screenshots/w0-rebrand.png](screenshots/w0-rebrand.png).

Note: the built app keeps running in the tray after its window closes, so a Playwright
`app.close()` can hang. Kill the process tree afterwards.

## CI

| Workflow | Trigger | Notes |
|---|---|---|
| `code-consistency-check.yml` | push + PR to `main` | ubuntu-latest; `nx affected` format:check, lint, typecheck, test (browser projects skipped, as upstream) |
| `licenses.yml` | push + PR to `main` | `pnpm run licenses` |
| `build-matrix.yml` | `workflow_dispatch` only | macOS 14, Windows 2022, Ubuntu 22.04: install, build, test, `electron-builder --dir --publish never`. Unsigned, no secrets |
| `workspace-server-package-check.yml` | `workflow_dispatch` only | Was push/PR upstream; moved to save minutes |
| `release-*.yml` (4 files) | **deleted** | They publish to Emdash's R2/GitHub and need Emdash's Apple, Azure, PostHog and R2 secrets |

Actions minutes on the private repo are limited, so only the two ubuntu checks run automatically.
Run the build matrix by hand before a release (`gh workflow run build-matrix.yml`).

## Licence gate

`tooling/scripts/check-licenses.mjs` (tests: `check-licenses.test.mjs`, which includes the
`tldraw` rejection). Production scope comes from `pnpm licenses list --json --prod`. The installed
scope walks every `node_modules`, because `pnpm licenses list` without `--prod` fails here with
`ERR_PNPM_UNSUPPORTED_PACKAGE_TYPE` (the `node@runtime` devEngine). The walk matters because the
renderer bundles the desktop app's `devDependencies`. Reviewed exceptions, each with a written
reason, live in `tooling/scripts/allowlist-exceptions.json`: the Inter and JetBrains Mono fonts
(OFL-1.1), elkjs (EPL-2.0), caniuse-lite (CC-BY-4.0), and require-like (no licence field; its
License file is MIT). `pnpm check` runs it between typecheck and test.

## Open items for later waves

1. **GitHub device-flow sign-in is off until Lucas registers a Ninebrains OAuth App.** Emdash's
   client ID was removed. Until an ID is built in, "Connect GitHub" offers GitHub CLI import only and
   explains why. To turn it on:
   1. Create the app under the Advance-Labs org (Organization settings → Developer settings → OAuth
      Apps → New OAuth App), or under your account (Settings → Developer settings → OAuth Apps).
   2. Name `Ninebrains`, homepage `https://github.com/Advance-Labs/ninebrains`. Device flow does
      not use a callback, but the form requires one, so enter the homepage URL.
   3. Tick **Enable Device Flow** and register. Copy the **Client ID**. It is public; no client
      secret is needed, so never generate or commit one.
   4. Build with `NINEBRAINS_GITHUB_OAUTH_CLIENT_ID=<client id> pnpm run build`. For CI, set it as a
      repository *variable* (not a secret); `build-matrix.yml` already passes it through.
2. **Feature flags are empty.** Upstream fetched them from PostHog `/decide`; with telemetry cut,
   every `useFeatureFlag` is `false` outside dev (`FLAG_*` env overrides still work in dev).
3. **Auto-update is off** (`UPDATES_ENABLED`). Turn it on with the first signed release (plan 7.1/7.2).
   A private repo needs a token for electron-updater, so the repo must be public first.
4. **Remote workspace server:** no Ninebrains release carries it yet, so SSH projects fail at
   install (`artifact-download-failed`) until one is published, or until
   `EMDASH_WORKSPACE_SERVER_ARTIFACTS_URL` points at a mirror.
5. **Kept for compatibility:** the `.emdash.json` team config file name, the `emdash` default
   branch prefix, `EMDASH_*` env var names, the internal DB file name `emdash4.db` (inside the
   `ninebrains` dir), and `@emdash/*` package names. Renaming any of these is a bigger, rebase-heavy
   change. Decide deliberately.
6. Signing is not configured: Emdash's Azure profile was removed, and macOS notarisation was
   already off upstream.
