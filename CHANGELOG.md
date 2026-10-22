# Changelog

All notable changes to Ninebrains, newest first. `pnpm run release:prepare X.Y.Z` writes each
release section from the Conventional Commit titles on main; edit it before the release PR merges.
Hand-written notes go under Unreleased and move into the next release.

## [Unreleased]

## [0.2.9] - 2026-10-22

In-app updates work on Windows again. Before this release the update downloaded and the pill said
**Update ready**, but the installer never ran, so each restart came back on the old version and
downloaded the same update again. **On Windows, install 0.2.9 by hand once** (download the `.exe`
below and run it): 0.2.8 and older still have the bug and cannot update themselves. From 0.2.9 on,
**Restart now** installs the update and reopens the app.

### Fixes

- **updates:** install and relaunch Windows updates (#166) (9537971)
- **updates:** drop the loading mark from the idle update-available pill (#165) (bfe8187)

## [0.2.8] - 2026-10-19

The Brain TUI now opens as a tab beside a task's conversations: use the **+ ▾** menu next to the
conversation tabs and pick **Brain TUI**. The TUI itself is redesigned as a live feed, a prompt box
with slash commands and a status line, with light animations (set `NINEBRAINS_REDUCED_MOTION=1` to
turn them off). Jobs no longer get stuck behind a lane whose session has gone away.

For people running many agents at once: Claude task sessions can skip plugins you don't need there
(**Settings → Agents → Claude → Plugins to skip in task sessions**), which saves an MCP server or LSP
per session. Heavy test runs from gate checks now take turns instead of all running together.

When the app hangs, a process dies or memory runs high, the log at
`~/Library/Application Support/ninebrains/logs/ninebrains.log` now says so, and a clean quit is
recorded, so a force quit can be told apart from one.

### Features

- **brain:** open the Brain TUI as a tab beside a task's conversations (#141) (28b7d7e)
- **brain-cli:** redesign the TUI as a feed, a prompt box and a status line (#152) (8a78f00)
- **agents:** let Claude task sessions skip plugins (#160) (15ef73a)

### Fixes

- **main:** log hangs, process deaths, high memory and clean exits (#159) (5a8473c)
- **brain:** park stale lanes so the dispatcher stops planning onto them (#144) (249aecd)

### Performance

- let heavy check runs take turns across worktrees and lanes (#161) (0f570f5)

## [0.2.7] - 2026-10-17

Terminals on screen now draw with the GPU (WebGL) instead of building a DOM row for every line,
which is the work that remained when agents stream output or you scroll. Only visible terminals use
WebGL, since browsers limit how many WebGL contexts a page may hold. Terminals in background tabs
switch back to the regular renderer, which already pauses off-screen. If WebGL is unavailable or the
GPU resets, terminals fall back to the regular renderer on their own.

Redrawing in the same step as a resize avoids the one blank frame that made GPU-drawn terminals
flicker when panels open and close. If you still see a flicker or garbled text, please open an issue.

### Performance

- **terminals:** render on-screen terminals with WebGL (#155) (14f40b1)

## [0.2.6] - 2026-10-17

Agents keep their git access when Ninebrains restarts. Agent sessions live in tmux and survive a
restart or an update, but the channel they use to get git credentials did not, so every surviving
agent's `git push` failed with "could not read Username". The channels now persist (encrypted, in
the app's secret storage) and the credential server reopens on the same port.

Sessions started before 0.2.6 never had their channel saved, so restart each running agent session
once after updating. Until then, `git -c credential.helper= -c 'credential.helper=!gh auth
git-credential' push` works around it.

### Fixes

- **github:** keep agent git credential channels across an app restart (#151) (3a86625)

### Documentation

- **engineering:** write up the 0.2.4 terminal input lag and its fixes (#149) (97e0e83)

## [0.2.5] - 2026-10-16

Typing and scrolling in agent terminals no longer stutter. With many workspaces open, the app
spent about one second in every two re-checking every workspace against every other one, on the
same thread that carries your keystrokes and scroll events. That work is gone, and so are the
rewrites it triggered: a rescan that finds nothing new now writes nothing and sends nothing.

Archived tasks now clean up after themselves. A task archived longer than the retention you pick in
Settings (default 7 days) is deleted with its worktree and branch, including commits that were
never pushed. Worktrees with uncommitted changes are always skipped, and worktrees Ninebrains did not
create are never touched. **Clean up archived tasks now** in Settings shows how many would go
before deleting anything.

### Features

- **tasks:** delete archived tasks with their worktree after a retention window (#142) (4cf146c)

### Fixes

- **workspaces:** skip path-owner scan when a refresh keeps the same path (#136) (3b8f8a2)

### Performance

- **workspace-registry:** don't republish a record when a rescan finds nothing new (#139) (a71fbbd)
- **workspaces:** skip no-op row rewrites and pokes in snapshot sync (#143) (8bb663d)

## [0.2.4] - 2026-10-15

The working spinner and the status dot now follow the conversation they belong to. tmux does not
give a new session the environment of the terminal that created it: it reuses the environment the
tmux server was first started with, so every agent pane opened after the first one inherited the
first pane's identity. Provider hooks reported every agent's activity under that one conversation,
and no other conversation ever showed that it was working. The same leak pointed one task's
`git push` at another task's credential session.

0.2.3 was prepared but never published, so this release also carries everything listed under it
below: a Retry button for a Project stuck opening, an update pill that no longer sticks on
"Checking…" and re-checks after your machine wakes, notifications that open the conversation they
belong to, and a sidebar spinner that corrects itself instead of depending on a provider's stop
hook.

### Fixes

- **pty:** give each tmux pane its own per-pane environment (#133) (99048c5)
- **projects:** offer Retry while a Project is stuck attaching (#127) (b9fa7f5)
- **updates:** dismiss the update pill when a check finds nothing, and re-check on wake (#121) (37b4dc3)
- **workbench:** open the conversation a notification belongs to, not a new one (#120) (635a0b1)
- **tui-agents:** make the working spinner self-correcting and provider-agnostic (#119) (d037134)

### Documentation

- **patches:** log the workspace Open Brain CLI action (section 60) (#115) (03bc8f9)

## [0.2.3] - 2026-10-10

A maintenance release, all bug fixes. A Project that got stuck opening now offers a Retry button
instead of stranding you with stale Git decorations and files that will not open. The update pill no
longer sticks on "Checking…" when a check fails, and it re-checks after the machine wakes. Clicking a
notification opens the conversation it belongs to rather than starting a new one. The sidebar working
spinner now corrects itself and no longer depends on a provider sending a stop hook.

### Fixes

- **projects:** offer Retry while a Project is stuck attaching (#127) (b9fa7f5)
- **updates:** dismiss the update pill when a check finds nothing, and re-check on wake (#121) (37b4dc3)
- **workbench:** open the conversation a notification belongs to, not a new one (#120) (635a0b1)
- **tui-agents:** make the working spinner self-correcting and provider-agnostic (#119) (d037134)

### Documentation

- **patches:** log the workspace Open Brain CLI action (section 60) (#115) (03bc8f9)

## [0.2.2] - 2026-09-26

This release removes the Arena, Lanes, and Automations views from the app UI in favour of the Planner and Brain CLI. The Brain CLI is now bundled with the app and can be launched from any project's workspace menu. The Freebuff fallback feature has been archived and removed from active UI.

Also fixes the one-line installer so it correctly falls back to the latest stable release when GitHub's `latest` tag points to a monorepo-scoped tag (e.g. `brain-cli@0.2.0`).

### Features

- **app:** bundle brain-cli with the app build and add "Open Brain CLI" to project workspaces (#114) (cf25b27)
- **app:** remove Arena, Lanes, and Automations from the UI (#114) (cf25b27)
- **site:** archive Freebuff panel and references from the landing page (#114) (cf25b27)

### Fixes

- **site:** fall back to releases list when latest tag is not a stable v* release (#114) (8bb3155)

## [0.2.1] - 2026-09-23

Ninebrains can now update itself. The app checks GitHub for a newer release, tells you what
changed, and fetches it when you press **Download**; nothing is installed until you choose
**Restart now**. Every update has to verify against Ninebrains' own Ed25519 update key, whose
public half is compiled into the app, so a tampered or unsigned build is refused even though the
installers themselves still ship unsigned. This is the first release that carries the updater, so
it is also the last one you will need to install by hand.

The Brain is now visible everywhere it matters: a Settings → General card explains what it does
and lets you pause dispatch, and Arena shows its status and every open job across every project you
have open at once, with a jump straight to a blocked job's plan. The Planner can accept just a
selection of the Brain's proposed draft jobs instead of all-or-nothing.

Also in this release: a first-run board on Lanes that explains the Lanes → Planner → Brain flow,
keyboard shortcuts for the task context menu, Option+drag text selection inside TUIs that capture
the mouse, and MCP/project-context support for Freebuff and Codebuff. Fixes a starting lane that
could hang indefinitely, the install page's Copy button on browsers that refuse the Clipboard API,
and a dropped terminal resize on newly created tasks.

### Features

- **updates:** signed auto-update from GitHub releases (#70) (a44a74e)
- **brain:** make the Brain discoverable and cross-project (#61) (b502fac)
- **lanes:** first-run board that explains itself, home deep-links to Lanes/Planner (#58) (ab8b1d1)
- **ui,theme:** brand-mark agent status, Hardstyle theme, Pulse/Arena views (#59) (45e4201)
- **tasks:** add keyboard shortcuts to task context menu (#57) (b89fe7e)
- **terminals:** force text selection with Option+drag while TUIs track the mouse (fixes #44) (#55) (e9c3292)
- **providers:** give Freebuff and Codebuff MCP servers and project context (#54) (373afd8)
- **site:** bring back the loading intro: nine cubes fall into the mark, then hand off to the page (#53) (8e2f43d)
- **release:** steer macOS to the quarantine-free installer and make Apple signing turnkey (#47) (59a8492)
- **site:** cinematic single-screen landing with a 3D nine-cube stage and per-feature demos (#48) (6db2c7d)

### Fixes

- **lanes:** stop a starting lane for real, bound how long it may spin, and surface a dead terminal (#60) (877c751)
- **site:** make the install Copy button work where the Clipboard API is refused (#56) (21da34c)
- **site:** outline the planner's cycle on the nodes themselves (#52) (939a155)
- **site:** nothing overlaps: layout-measured 3D stage, dissolve transitions, populated first frames (#51) (616a58e)
- **conversations:** re-send terminal size dropped before the agent PTY spawns (#50) (2ccc329)

## [0.2.0] - 2026-09-21

When Claude Code or Codex runs out of usage mid-task, the conversation now offers to carry on in
Freebuff, free, in the same worktree, with a handoff note on your clipboard. Installing and
updating is one line:

- macOS and Linux: `curl --proto '=https' --tlsv1.2 -fsSL https://ninebrains.dev/install | sh`
- Windows: `irm https://ninebrains.dev/install.ps1 | iex`

The installer checks the download against this release's `SHA256SUMS` and, when `gh` is signed in,
verifies its build provenance before installing. Run the same line again to update.

The app can also tell you when a new release is out: turn on Settings, General, "Check for new
versions". It is off by default because Ninebrains makes no network request you did not ask for.
0.1.0 has no such check, so this is the last release you need to find by hand. Builds are still
unsigned; see "Read this before you install" under 0.1.0.

### Features

- **updates:** tell users when a new Ninebrains release is out (#44) (a889e54)
- **site:** single-screen landing page with install tabs and live feature demos (#42) (aea4b41)
- **site:** one-line installer that also updates (#43) (fc9cfd3)
- **conversations:** offer Freebuff when an agent hits its usage limit (#41) (7f6be7e)
- **ui:** show agent status with thinking-orbs (#40) (dcf3d45)
- **editor:** preview PDFs with Chromium's built-in viewer (#38) (2406c27)
- **tasks:** name the first conversation after its task (#31) (8649c66)
- **site:** offer the v0.1.0 download now that it exists (#27) (a094f61)

### Fixes

- **projects:** hide PR row metadata behind the hover action (#45) (6ff417b)
- **tasks:** keep the prompt drop highlight on the composer (#39) (2d88ca9)
- **desktop:** build brain-mcp before the app's tests and build (#32) (fa4b62f)
- **brand:** default branches to ninebrains/ and put install steps in release notes (#29) (f2a1391)
- **ui:** make switches legible under the monochrome accent (#28) (5ceebae)

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
  [ninebrains.dev](https://ninebrains.dev).

Full documentation is at [ninebrains.dev/docs](https://ninebrains.dev/docs/).
