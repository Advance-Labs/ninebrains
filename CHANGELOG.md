# Changelog

All notable changes to Ninebrains, newest first. `pnpm run release:prepare X.Y.Z` writes each
release section from the Conventional Commit titles on main; edit it before the release PR merges.
Hand-written notes go under Unreleased and move into the next release.

## [Unreleased]

## [0.1.0] - 2026-09-21

The first public build of Ninebrains. It runs Claude Code and OpenAI Codex agents in parallel, each
in its own git worktree, with a central Brain handing out the work and gates that prove it before
it counts as done.

Ninebrains is a fork of [Emdash](https://github.com/generalaction/emdash) by General Action, so
everything Emdash does — worktrees, terminals, the Monaco editor, diffs, pull requests, issue
integrations, MCP servers, skills and automations — is in here too. What follows is what the fork
adds on top.

### Read this before you install

**These builds are not code-signed.** macOS will refuse to open the app on first launch, and
Windows SmartScreen will warn about the installer. That is the expected behaviour for an unsigned
app, not a sign that something is wrong with your download. `docs/RELEASING.md` has the click-path
for both, and the one-line `xattr` command for macOS.

Check your download against `SHA256SUMS` on this release page before you open it. A matching hash
proves you have the exact bytes CI built. It does not prove who built them, which is what signing
would add, so it is worth doing and worth knowing the limit of.

There is **no auto-update** in this build, by design. An update is remote code execution, and
without a signature there is nothing for your machine to check it against. Updating means
downloading the next release yourself.

### What is in this build

- **Lanes.** 2×2 lanes per tab and unlimited tabs. Each lane gets its own git worktree on a
  `lanes/<id>` branch, plus its own terminal, editor and browser, so two agents cannot touch the
  same file. Status lights come from the agents' own hooks. Lanes can sleep (hidden, still running)
  or maximize.
- **The Brain.** A drawer in the Lanes view that runs a Claude Code session as a coordinator. Give
  it a brief; it turns that into a graph of jobs with dependencies and hands each ready job to
  whichever lane is idle.
- **Verification gates.** When a lane says it is done, a second independent run has to agree:
  tests, a screenshot check at three widths, a read-only reviewer, and citation checks. A failed
  gate sends the feedback back to the lane and retries, up to three attempts, then stops and tells
  you. No agent grades its own work.
- **Rigor settings.** Two 0-10 sliders in Settings → Gates decide which gates a job gets, with a
  per-project override.
- **Planner.** A canvas where jobs are nodes and dependencies are edges. **Run plan** compiles it
  into Brain jobs, idempotently, and refuses cycles.
- **Packs.** Per-project bundles of lane roles, skills, MCP servers and gates for coding, SEO and
  research. Every pack is off until you turn it on.
- **Lane roles and modes.** Start a lane from a pack role, and switch a lane between attended and
  unattended from its header.
- **Unattended runs.** `claude -p` runs, and experimental `codex exec` runs, each with a budget, a
  sandbox, a minimal environment, and a STOP switch that ends every run in under five seconds.
- **Model profiles.** Off by default. Turn on `ninebrains.routing.profilesEnabled` in
  Settings → Models to pin a model per lane against your own API key. Your key stays write-only and
  lives in the lane's environment, never in the app's database.
- **Nothing phones home.** No telemetry, no endpoint compiled in, no hosted account, no update
  feed. The app talks to your agents' CLIs and to whatever you point it at.

### What is not in it yet

A per-lane account picker and usage meter, per-lane port leases, an overnight queue with a morning
digest, a video pack, signed builds and auto-update. `codex exec` support is experimental; Claude
Code is the better-tested path today.

### Fork groundwork

This release also cuts every tie to the upstream project's infrastructure, which matters because
the two apps can otherwise share state on one machine:

- Its own app id, user-data directory, database and worktree root, so Ninebrains and Emdash never
  share a database, a worktree or a remote server.
- No calls to Emdash-hosted infrastructure, and no update feed pointing at it.
- Its own brand throughout: a black-and-white identity, the nine-square mark, and a landing page at
  [ninebrains.runs-on.dev](https://ninebrains.runs-on.dev).

Full documentation is at [docs.advancelabs.dev/ninebrains](https://docs.advancelabs.dev/ninebrains/).
