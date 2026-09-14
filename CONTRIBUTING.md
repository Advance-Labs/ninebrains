# Contributing to Ninebrains

Thanks for helping. Ninebrains is a fork of [Emdash](https://github.com/generalaction/emdash), so
most of this guide is Emdash's, adapted. Four things are specific to the fork: the upstream rebase
policy, the patch log, the licence gate and the fake agent. Read those sections before your first
PR.

We favour small, focused PRs with a clear reason. By contributing you agree that your contribution
is licensed under the Apache License 2.0, the same as the project, and that you follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

**Security issues:** email security@advancelabs.dev. Do not open a public issue. See
[docs/SECURITY.md](docs/SECURITY.md).

## Quick start

### Prerequisites

- Git.
- Any reasonably recent `pnpm`. `package.json` pins `pnpm@10.28.2` (`packageManager`) and Node
  `24.14.0` (`devEngines.runtime`, `onFail: "download"`), so any pnpm on your PATH switches to the
  pinned versions inside this repo. You do not need nvm or a matching Node. `mise` is optional.
- Optional: the GitHub CLI (`gh`), and `claude` or `codex` if you want to try real agents. Tests
  never need them.

### Get the source and run it

```bash
git clone https://github.com/Advance-Labs/ninebrains.git
cd ninebrains
pnpm install
pnpm run dev            # builds packages/, watches them, and starts the Electron app
```

`pnpm run dev` from `apps/emdash-desktop/` starts only the desktop app. Use the root command when
you change anything under `packages/`, so their `dist/` output stays current. Renderer changes
hot-reload; main-process changes may need a restart.

The dev app keeps its data in `~/Library/Application Support/ninebrains-dev` on macOS
(`~/.config/ninebrains-dev` on Linux, `%APPDATA%\ninebrains-dev` on Windows).

[docs/FORK.md](docs/FORK.md) records the fork baseline, test counts and CI.

## Repository layout

- `apps/emdash-desktop/`: the Electron app. Package and folder names keep the `emdash` prefix on
  purpose; renaming them would make every rebase conflict.
  - `src/core/features/`: vertical feature slices. Ninebrains adds `lanes`, `planner`, `packs`,
    `exec-runs` and `gates`.
  - `src/main/`: the Electron main process. `src/renderer/`: the React shell.
- `apps/docs/`: the documentation site (Astro Starlight). Its content is `docs/guide/`.
- `packages/brain-core/`, `packages/brain-mcp/`: the Brain and the MCP shim lanes run.
- `packages/gates-core/`, `packages/citations/`: gate logic and claim checking.
- `packages/core/`, `shared/`, `ui/`, `plugins/`, `wire/`, `theme/`, `chat-ui/`: inherited from
  Emdash.
- `tooling/fake-agent/`: a stand-in `claude` CLI for tests.
- `tooling/scripts/check-licenses.mjs`: the licence gate.
- `agents/`: Emdash's architecture, workflow and risk notes. Still accurate for the inherited code.
- `docs/`: fork docs (`FORK.md`, `SEAMS.md`, `UPSTREAM-PATCHES.md`, `THREAT-MODEL.md`) and the user
  guide.

Start with [docs/guide/architecture.md](docs/guide/architecture.md), then
[docs/SEAMS.md](docs/SEAMS.md) before you touch Emdash code.

## Commands

From the repo root:

```bash
pnpm run dev            # packages + Electron app
pnpm run build          # build every workspace project
pnpm run format         # oxfmt
pnpm run lint           # oxlint, plus the boundary allowlist check
pnpm run typecheck
pnpm run licenses       # the licence gate and its tests
pnpm run test           # every project's tests
pnpm run check          # format:check, lint, typecheck, licenses, tooling tests, test (edits nothing)
pnpm run check:write    # the same, but runs format to fix formatting
pnpm run hooks:install  # the pre-push guard (once per clone)
pnpm run merge <pr>     # maintainers: the only way to merge (see "CI and merging")
pnpm run affected       # lint, typecheck and test only what changed vs main
```

One feature's tests, from the repo root:

```bash
pnpm --dir apps/emdash-desktop exec vitest run --project node src/core/features/lanes
pnpm --dir apps/emdash-desktop exec vitest run --project browser src/core/features/lanes
```

The docs site:

```bash
pnpm --filter @ninebrains/docs dev
pnpm --filter @ninebrains/docs build
```

## Before you open a PR

Run `pnpm run check`. It must be green. It runs `format:check`, `lint`, `typecheck`, `licenses`,
`test:tooling` and `test` in order (the checks CI runs) and never edits a file.
`pnpm run check:write` runs `format` instead of `format:check`.

Install the pre-push hook once per clone:

```bash
pnpm run hooks:install   # git config core.hooksPath tooling/git-hooks
```

It refuses pushes to `main`. Before any other push it runs `format:check`, `nx affected` lint,
typecheck and test against `origin/main`, and the upstream-patch log check. It checks your working
tree, so commit first. `git push --no-verify` skips it; CI still runs everything.

CI runs the Playwright-backed `browser` projects too, but run them locally for UI changes. The first
run on a machine needs:

```bash
pnpm --dir apps/emdash-desktop exec playwright install chromium-headless-shell
```

`EMDASH_TEST_BROWSER=1` forces the browser projects on under a `CI` environment;
`EMDASH_TEST_SKIP_BROWSER=1` skips them locally.

If a browser test fails with "Vite unexpectedly reloaded a test", Vite found a dependency its scan
missed. Run the test with `DEBUG=vite:deps`, find the name after "new dependencies found", and add it
to the browser project's `optimizeDeps.include` in `vitest.config.ts`. Do not just re-run it.

Then:

1. Branch: `git checkout -b feat/<short-slug>`.
2. Commit with Conventional Commits and a sign-off (below): `git commit -s -m "feat(lanes): …"`.
3. Title the PR as a Conventional Commit as well (`fix(gates): …`). It becomes the squash commit on
   `main` and the line in the changelog.
4. Fill in the PR template: what changed, why, what you ran, and the checklist. Add screenshots at
   1440 and 390 px for UI changes.
5. Update `docs/guide/` in the same PR when behaviour changes. Docs reviewed next to the code that
   changes them are the ones that stay true.

## Sign your commits (DCO)

A sign-off certifies the [Developer Certificate of Origin](https://developercertificate.org/): you
wrote the change, or otherwise have the right to submit it under the project's licence. Add it with
`git commit -s`. The `Signed-off-by` email must match the commit's author email. To sign off a
branch you already committed, run `git rebase --signoff origin/main` and force-push.

CI's `pr-hygiene` job checks every commit in the PR, except merge commits and commits by GitHub App
bots such as Dependabot.

If a tool sets `GIT_COMMITTER_NAME` or `GIT_COMMITTER_EMAIL` to its own identity, `-s` signs off as
that identity instead of you, and the check fails. Add the trailer explicitly instead:
`git commit --trailer "Signed-off-by: Your Name <you@example.com>"`.

## CI and merging

`.github/workflows/ci.yml` runs on every PR to `main` or `release/**`, on pushes to them, weekly and
on demand:

| Job | What it runs |
|---|---|
| `static` | `format:check`, lint, the boundary allowlist ratchet, typecheck, the licence gate, the node tests of the release scripts, the fake agent and `tooling/scripts`, and, when the docs site is affected, its build plus the link checker (`@ninebrains/docs:build`) |
| `test-node` | Vitest in four shards: every package except the desktop app; desktop `node`; desktop `main-db`, `migrations` and `scripts`; desktop `node-spawn` (suites that spawn real processes, two files at a time). No retries: SEC-* tests are never retried to green |
| `test-browser` | The desktop and chat-ui `browser` projects in headless Chromium, with one retry. A test that passes only on the retry is shown as a warning annotation and in the job summary. Open a `flaky-test` issue for it |
| `pr-hygiene` | DCO sign-offs, a Conventional Commit PR title, and the upstream-patch log: every changed file that existed at `dbf690c` must be named in the lines your PR adds to `docs/UPSTREAM-PATCHES.md` |
| `e2e` | The Electron e2e suites under xvfb. Runs only with the `run-e2e` label, weekly, on pushes to `release/**` and before a release |
| `ci-ok` | Green only when every job that should have run passed. This is the one status that matters |

PRs and pushes test only the projects Nx reports as affected. The weekly and manual runs test
everything.

**Merging.** This private repository is on GitHub's free plan, which has no branch protection, so the
merge rules live in `pnpm run merge <pr>` (`tooling/scripts/merge-pr.mjs`). Maintainers merge only
through it. It refuses:
- a draft, or a PR whose title is not a Conventional Commit;
- a head commit without a green `ci-ok`;
- a branch that is behind its base. Update it with `gh pr update-branch <pr> --rebase` and wait for
  CI;
- a change to a security-sensitive path (the marked section of `.github/CODEOWNERS`) without the
  `security-reviewed` label.

Then it prints the file list, squash-merges pinned to the head commit it checked, deletes the branch
and watches CI on the base. `pnpm run merge <pr> --dry-run` runs the checks without merging.

Once the repository is public or on GitHub Team, add a ruleset for `main` and `release/**`:
- require the `ci-ok` status check, with GitHub Actions as its source;
- require branches to be up to date before merging;
- block force pushes and deletions;
- allow squash merges only.

`merge-pr.mjs` keeps working alongside the ruleset.

## End-to-end tests

`apps/emdash-desktop/e2e/` drives the built Electron app with Playwright.

- Build first, from the repo root: `pnpm run build`. Then run a suite:
  `node apps/emdash-desktop/e2e/lanes-smoke.e2e.mjs` (also `brain-fanout`, `self-heal`,
  `stop-halts-lanes`, `lane-run-mode` and `lane-from-pack-role`).
  `pnpm --dir apps/emdash-desktop run e2e` builds the app and runs the lanes smoke test.
- [docs/testing/DOGFOOD-MATRIX.md](docs/testing/DOGFOOD-MATRIX.md) tracks every user-facing flow
  from the guide against what actually covers it (unit, e2e, or manual only), with a priority.
  Check it before adding a new e2e suite, so you don't duplicate coverage.
- The harness (`e2e/harness.mjs`) gives each run a temp HOME, an isolated profile and the fake agent
  as `claude` on PATH, so no real credits are spent. It sets `NINEBRAINS_E2E=1` and launches with
  `--use-mock-keychain`, so macOS never prompts for, or touches, your login keychain.
- The built app stays in the tray after its window closes, so `app.close()` can hang. If a run prints
  PASS and then sits there, kill the process tree. CI gives each suite 10 minutes and reports exit
  124 as a hang.
- On Linux, run under a virtual display with zsh installed (the harness sets `SHELL=/bin/zsh`):
  `xvfb-run -a node apps/emdash-desktop/e2e/lanes-smoke.e2e.mjs`.
- To run them in CI, add the `run-e2e` label to your PR.

## The fork: upstream rebase policy

- The `upstream` remote is `https://github.com/generalaction/emdash.git`. **Never push to it.**
- We rebase on upstream regularly. Upstream ships about 20 commits a day, so every patch to an
  inherited file costs us again at each rebase.
- **Prefer a new feature slice to a patch.** Most work fits a slice under
  `apps/emdash-desktop/src/core/features/` plus one-line registrations in the manifests. SEAMS.md
  names the extension point for each area.
- When you must change an inherited file, keep the change small, start the code comment on the
  patched line with `Ninebrains:`, and **log it in
  [docs/UPSTREAM-PATCHES.md](docs/UPSTREAM-PATCHES.md)** in the same PR: file, what, why. A PR that
  patches an upstream file without a log entry will be sent back.
- Boot wiring goes through the single `createNinebrainsServices()` call, so the hot `services.ts`
  patch stays small.
- On a rebase, regenerate `pnpm-lock.yaml`. Never hand-merge it.
- Kept from Emdash on purpose: the `.emdash.json` file name, `EMDASH_*` variables, the `@emdash/*`
  package names and the `emdash4.db` file name. Renaming any of them is a separate, deliberate
  decision.
- If you fix a bug that also exists upstream, consider sending the fix to Emdash as well.

## The licence gate

`pnpm run licenses` runs `tooling/scripts/check-licenses.mjs`. It checks the production dependency
tree and walks every installed package, because the renderer bundles the desktop app's
`devDependencies`.

- **Allowed:** MIT, Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause, 0BSD, MPL-2.0, BlueOak-1.0.0,
  CC0-1.0, Unlicense, Python-2.0.
- **Blocked packages:** tldraw (licence key), Remotion (paid company licence), claude-task-master
  (Commons Clause), mcp_agent_mail (usage rider).
- **Never allowed, even as an exception:** AGPL, GPL, SSPL, Elastic, BUSL and Commons Clause.
- Anything else, including LGPL, needs a reviewed entry with a written reason in
  `tooling/scripts/allowlist-exceptions.json`. An entry names the package and the exact licence
  string, so a licence change re-opens the review.

Before adding a dependency, check its licence and its transitive tree. Code from projects under a
source-available or copyleft licence (for example Superset's ELv2, or AGPL projects) must not be
copied in, even in part. Reading their public design is fine; re-implement from scratch.

## Tests use the fake agent

Tests never spend real credits. `tooling/fake-agent/` is a zero-dependency stand-in for the
`claude` CLI (`bin/fake-claude.mjs`). It accepts the real flags, rejects unknown ones, reproduces
the variadic `--mcp-config` behaviour, emits `stream-json` events whose shapes are checked against
real captures, fires hooks from `--settings`, and makes real MCP stdio calls.

- Script its behaviour with `FAKE_AGENT_SCRIPT` (a file or inline JSON array of steps: `say`,
  `callTool`, `writeFile`, `sleep`, `waitForInput`, `exit`).
- Record each launch's argv, working directory and lane ID with `FAKE_AGENT_ARGV_LOG`.
- Point code that spawns Claude at it with `CLAUDE_BIN=<path>/fake-claude.mjs`.
- Its own tests: `node --test "tooling/fake-agent/test/*.test.mjs"`.

Run a real CLI only by hand, and say in the PR that you did.

## End-to-end tests

The Electron tests in `apps/emdash-desktop/e2e/` drive the built app with Playwright and the fake
agent. They are too slow for every push, so CI runs them (`.github/workflows/e2e.yml`, under xvfb)
only when a PR carries the `run-e2e` label, weekly, on pushes to `release/**`, and before every
release. Add the label to any PR that touches lanes, the Brain, gates or the e2e harness. The
daily-use coverage they give is mapped in [`docs/testing/DOGFOOD-MATRIX.md`](docs/testing/DOGFOOD-MATRIX.md).

1. Build from the repo root: `pnpm run build`. It builds the workspace packages the app bundles.
   On a fresh worktree, `pnpm --dir apps/emdash-desktop build` alone fails with
   `@emdash/wire/worker` unresolved.
2. Run one test, for example `node apps/emdash-desktop/e2e/self-heal.e2e.mjs`
   (`brain-fanout.e2e.mjs`, `lanes-smoke.e2e.mjs`, `stop-halts-lanes.e2e.mjs`,
   `lane-run-mode.e2e.mjs` and `lane-from-pack-role.e2e.mjs` work the same way). See
   [docs/testing/DOGFOOD-MATRIX.md](docs/testing/DOGFOOD-MATRIX.md) for what each flow covers.

Each run gets a temp profile and HOME, `--use-mock-keychain` and a fake `claude` on PATH. Lanes and
reviewer runs get an allowlisted environment, so the harness bakes the test's lane script and an
approving reviewer script into that `claude` wrapper instead of passing `FAKE_AGENT_*` variables.
The app's main-process output for a run is in `<profile>/main.log`.

## Security-sensitive code

Lanes run agents that execute shell commands as the user. Treat these areas as high risk: the Brain
endpoint and brain-mcp, launch config, the dispatcher and exec runs, gates, the lane browser, packs,
and anything that spawns a process.

- Every requirement in [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) has an ID (`SEC-01` …). Its test
  uses a `describe` title that starts with the ID, so `grep SEC-17` finds the proof. Keep that
  convention for new tests.
- Spawn with argv arrays, `shell: false` and absolute binary paths. Pass prompts on stdin, never as
  argv.
- Build agent environments from the allowlist in `packages/core/src/primitives/agent-env/api`, never
  from raw `process.env`.
- Never emit a permission-bypass flag from any launch builder.
- Never read provider credential files, and never drive a provider login.
- Put anything untrusted into a reviewer prompt only through `createFence()` from gates-core.

Security-relevant PRs get an extra security review before merge. List the SEC-IDs your change
touches in the PR. `pnpm run merge` refuses a PR that changes a path in the security section of
`.github/CODEOWNERS` until it has the `security-reviewed` label; a maintainer adds it once the
review is done.

## Code style

- TypeScript strict mode; avoid `any`, and document it if a boundary needs it.
- Top-level `import` only: no `require()`, no dynamic `import()`.
- `pnpm` only; do not add npm or yarn lockfiles.
- Format with oxfmt (width 100, single quotes), lint with oxlint.
- Files stay under 500 lines.
- Do not re-export as a shortcut; import from the original source.
- Features follow the boundary lint (see SEAMS.md §2). The lint allowlists are ratcheted empty. Do
  not add entries; change the design instead.

## Databases

- The app database is Emdash's (`emdash4.db`), with Drizzle migrations in
  `apps/emdash-desktop/drizzle/`. Do not hand-edit numbered migrations; use `pnpm run db:generate`
  from `apps/emdash-desktop/`. Read `agents/risky-areas/database.md` first.
- Use a scratch database when working on schema changes:
  `EMDASH_DB_FILE=/tmp/ninebrains-scratch.db pnpm run dev`.
- Brain data lives in its own database, owned by `packages/brain-core`. Do not add Brain tables to
  the app database.

## Worktrees, terminals and providers

- Do not delete worktree folders by hand unless you know the matching git state. Prefer in-app
  cleanup or `git worktree prune`.
- Do not weaken shell quoting, spawn behaviour, environment allowlists or secret redaction.
- Read `agents/risky-areas/pty.md`, `agents/integrations/providers.md` and
  `agents/integrations/mcp.md` before changing those areas.

## Native dependencies

After changing native dependencies, rebuild them from `apps/emdash-desktop/` with
`pnpm run rebuild`. This matters most for `better-sqlite3` and `node-pty`.

## Issues and feature requests

Use GitHub Issues on `Advance-Labs/ninebrains`. Include your OS, the Ninebrains version or commit,
steps to reproduce, what you expected, what happened, and relevant logs. Never include secrets,
tokens, private keys, app databases or private repository content.

Problems that also happen in upstream Emdash, and that Ninebrains does not change, are best
reported to `generalaction/emdash` too.

## Releases

Maintainers only. See [docs/RELEASING.md](docs/RELEASING.md). Do not dispatch release workflows,
publish packages or upload artifacts unless you are doing release work.

## Further reading

- [docs/guide/](docs/guide/README.md): the user guide.
- [docs/SEAMS.md](docs/SEAMS.md): where Ninebrains plugs into Emdash.
- [docs/SPIKE-EXEC-PATHS.md](docs/SPIKE-EXEC-PATHS.md): verified CLI flags and gotchas.
- `agents/README.md`, `agents/architecture/overview.md`, `agents/workflows/testing.md`: Emdash's
  own notes.
