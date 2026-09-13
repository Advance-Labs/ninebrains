# exec-runs

Unattended agent runs for Ninebrains: `claude -p --output-format stream-json` and (experimental)
`codex exec --json`. Upstream Emdash has no print/exec path, so all of this is new code.

Everything lives under `api/node/`. The gates slice reuses the supervisor, argv guard, env builders
and sandbox settings, and a feature may only import another feature's `api/` surface. The
precedent is `tasks/api/node/task-service.ts` and `automations/api/node/automations-service.ts`.

## What the integrator wires

Don't edit `services.ts`/`wiring.ts` from this slice. Construct these in `createNinebrainsServices()`.

| Factory | From | Inputs |
|---|---|---|
| `new ExecRunSupervisor(opts)` | `api/node/run-supervisor` | `userDataDir` (`app.getPath('userData')`), `resolveBinary(provider)` → **absolute** path (adapt the HostDependencies resolver), `allowedRoots()` (worktree root + review-checkout root), `maxConcurrentRuns`, `killGraceMs` 2000 |
| `await supervisor.recover()` | same | **Once at app start, before any run** (SEC-29). Closes runs a dead app instance left open as `killed`, with their last persisted counters, and emits a `finished` event for each |
| `supervisor.killAll()` / `clearStop()` | same | Global STOP: tray, menu and shortcut, all in main so it works with a hung renderer. It latches until cleared, and also kills and latches the app-wide `processGroups` registry (tests gate, review-checkout git) |
| `supervisor.onEvent(fn)` | same | Bridge to an `eventStream` for the UI and to `security_events` (SEC-33). Budget counters arrive here for the Brain DB (SEC-29 restart part) |
| `assertSafeArgv(argv, { trusted, provider })` | `api/node/argv-guard` | See **Attended launches** below (SEC-12, M2) |
| `createSpawnReviewer({ supervisor, route, auth, checkoutRoot, laneWorktrees })` | `gates/node/capabilities/spawn-reviewer` | `route(purpose)` picks the provider/model per gate |
| `createPrepareReviewCheckout({ worktreeForJob, root })` | `gates/node/capabilities/review-checkout` | `worktreeForJob` maps from lane state, never from the job record |
| `createRunCommand({ allowedRoots, ninebrainsDataDir, userDataDir, siblingWorktrees, deniedPaths, projectSettings })` | `gates/node/capabilities/run-command` | Pass the review-checkout root in `deniedPaths`. `projectSettings(cwd)` returns the owning project's `testsGate` settings (below) |
| `createFetchText()` | `gates/node/capabilities/fetch-text` | No options in the app. `addressPolicy` is for tests only |

Not here: `captureScreenshot` (it needs lane browser ids) and `readWorktreeFile` (SEC-23).

### Attended launches: `assertSafeArgv(argv, { trusted, provider })`

The attended launch-config builder must call it right before every PTY spawn, on the **full** argv:
its own flags, upstream's `providerConfig.extraArgs` and the `autoApproveFlag` if upstream adds one.

- `provider: 'claude' | 'codex'` decides what short flags mean (`-c` is Claude's `--continue` but
  Codex's `--config`). Always pass it: without it the guard reads `-c` and `-p` the strict (Codex)
  way, so a Claude `-p` argv is refused.
- `trusted`: every value Ninebrains generated for a config-bearing flag. That means the absolute
  paths of the `--settings` and `--mcp-config` files it wrote, and each Codex `-c` override it built
  (`buildCodexExecLaunch` returns them). `--settings`, `-c`/`--config`, `--profile`, `--mcp-config`
  and `--add-dir` with any other value are refused, which includes a user's `extraArgs`.
- Write `--mcp-config=<f>` and `--add-dir=<d>` with `=`. In the space form every following non-flag
  token is taken as a value and must be trusted.
- It throws `UnsafeArgvError`. Before matching, it splits `--flag=value`, expands attached and
  combined short flags, parses inline `--settings` JSON and decodes `-c` TOML strings. It matches
  case-insensitively.

### Per-project settings for the tests gate (wired by the settings UI owner)

| Key | Default | Effect |
|---|---|---|
| `testsGate.allowNetwork` | `false` | Opens all network to the tests gate. Off: macOS denies everything but loopback, and Linux runs with `--unshare-net` (loopback only) |
| `testsGate.allowUnsandboxed` | `false` | Linux without `bwrap`, and Windows: run the tests gate without an OS sandbox. Off: the gate fails with "tests gate needs a sandbox (install bubblewrap) or an explicit per-project opt-in". Accepted risk R11 |

## SEC requirements and their tests

| SEC | Test (`describe`) |
|---|---|
| SEC-11 | `SEC-11 lane sandbox settings` (settings generation). The live deny can't be proven with the fake agent: **manual e2e with the real CLI before release** |
| SEC-12 | `SEC-12 launch argv guard`: builder snapshots plus the runtime guard inside `spawnInGroup`; `M2 argv guard normalises before matching`: every bypass from the review's repro |
| SEC-13 | `SEC-13 unattended env is minimal` |
| SEC-14 | `SEC-14 ids cannot traverse` (runId → transcript path) |
| SEC-16 | `SEC-16 refuses a relative binary`, `SEC-16 never executes a binary planted in the worktree` |
| SEC-17 | `SEC-17 prompt is not argv`: the prompt goes on stdin for both providers |
| SEC-18 | `SEC-18 reviewer cannot write the worktree`: real git repo, hostile fake reviewer, byte-for-byte snapshot, plus a control run showing the same script does write when allowed |
| SEC-20 | `SEC-20 tests gate env is scrubbed`, `SEC-20 tests gate is sandboxed`, `SEC-20 macOS seatbelt profile`, `H1 tests gate needs a sandbox on Linux and Windows`, `M1 macOS seatbelt profile`, `M1 seatbelt under real sandbox-exec` |
| SEC-21 | `SEC-21 address policy`, `SEC-21 rebinding and redirects blocked`, `SEC-21 pinning, redirects and caps` |
| SEC-29 | `SEC-29 enforces the wall-clock budget` / `token budget` / `caps concurrent runs`, `SEC-29 budgets survive restart`, `SEC-29 Codex budgets come from its event stream` |
| SEC-30 | `SEC-30 kill switch`: 8 runs whose leader and grandchild ignore SIGTERM are all gone in under 5 s, and the switch stays latched. `SEC-30 kill switch reaches tests-gate commands` and `… reaches review-checkout git` |
| L4 | `L4 review checkout runs no repo-controlled code`: hooks, fsmonitor, `file://` and repo filter drivers off, scrubbed env |
| T32 | `T32 no lazy fetch from a review checkout` (real git, with a control); `T32 gate-built argv commands (the reviewer git calls) get GIT_NO_LAZY_FETCH=1` |
| T33 | `T33 the review checkout is its own repository`: config, attributes and a promisor added to the lane repo mid-review never apply in the checkout |
| T34 | `T34 review root` (`main/bootstrap/boot/ninebrains/review-root.test.ts`) |
| T35 | `T35 mirroring never follows a symlink or a hard link`, `isSafeReviewPath` |
| M4 | `M4 denies every listed home secret and all of <userData>` |
| SEC-31 | `SEC-31 unattended scope` (root and symlink checks), `refuses a cwd outside the allowed roots` |
| SEC-32 | `SEC-32: carries no outbound credentials` (env). Egress is set only when a plan passes `egressAllowedDomains` |
| SEC-35 | `SEC-35 transcript redactor`, and a supervisor test checking that the API key never reaches the transcript |

## Per-run Claude settings (`--settings=<runs>/<runId>/settings.json`, mode 0600)

The syntax was checked against the Claude Code settings reference on Context7 (2026-09-10). Sandbox
paths are plain absolute paths. Permission rules use `//abs` for absolute paths; a single `/` is
relative to the settings file.

```json
{
  "sandbox": {
    "enabled": true,
    "failIfUnavailable": true,
    "allowUnsandboxedCommands": false,
    "autoAllowBashIfSandboxed": true,
    "filesystem": {
      "denyRead": ["<userData>/ninebrains", "<sibling worktrees>", "<userData>", "<SECRET_HOME_PATHS>",
                   "<CLAUDE_CONFIG_DIR>/.credentials.json"],
      "allowRead": ["<worktree>"],
      "allowWrite": ["<worktree>"],
      "denyWrite": ["<common>/config", "<common>/config.worktree", "<gitdir>/config.worktree",
                    "<common>/info/attributes", "<common>/hooks"]
    }
  },
  "permissions": { "deny": ["Read(//<each denied path>/**)", "Edit(//<each denied path>/**)",
                            "Edit(//<each denyWrite path>)", "Edit(//<each denyWrite path>/**)"] }
}
```

`denyWrite` (T36) holds the worktree repo's git control files, resolved by `resolveLaneGitPaths`
with read-only hardened git: config (fsmonitor, filter drivers, `sshCommand`, `hooksPath`),
`info/attributes`, hooks and a linked worktree's `.git` gitfile. The tests gate's seatbelt and
bubblewrap profiles make the same paths read-only. The app runs git against the repo outside any
sandbox. Objects, refs
and the index stay writable, so a lane can still commit. A plain directory gets no git entries.

`SECRET_HOME_PATHS` (`sandbox-settings.ts`) is the one list the settings file, the macOS seatbelt
profile and the Linux bubblewrap mounts all read: `~/.ssh`, `~/.aws`, `~/.azure`,
`~/.config/gcloud`, `~/.config/gh`, `~/.config/git/credentials`, `~/.git-credentials`, `~/.kube`,
`~/.docker/config.json`, `~/.npmrc`, `~/.pypirc`, `~/.netrc`, `~/.cargo/credentials{,.toml}`,
`~/.gnupg`, `~/.codex`, `~/.claude/.credentials.json` and `~/.claude.json`.

The reviewer preset differs in three ways: `autoAllowBashIfSandboxed: false`, `allowWrite: []`, and
`denyWrite` plus `Edit(//<checkout>/**)` on its own checkout. The live lane worktree is on its
deny-read list.

Unattended argv:

```
claude -p --output-format=stream-json --verbose --mcp-config=<f> --strict-mcp-config --settings=<f>
  --permission-mode=dontAsk --permission-prompts=none --session-id=<uuid> --allowedTools=<each>
  [--max-turns=N] [--max-budget-usd=X] [--model=M]        # prompt on stdin; ENABLE_TOOL_SEARCH=false
reviewer adds: --tools=Read,Grep,Glob --disallowedTools=Bash|Edit|Write|MultiEdit|NotebookEdit|WebFetch|WebSearch|Task
codex exec --json --cd <wt> --sandbox workspace-write|read-only -c approval_policy="never" [-c mcp_servers...] -
```

## Decisions made while blocked

1. **gates-core types.** `gates/node/capabilities/types.ts` re-exports the contract with
   `import type` from `@emdash/gates-core` and `@emdash/citations` (a desktop dependency since the
   packs merge). It adds only the planned optional `mcpServers` field to `SpawnReviewerOptions`.
2. **`fetchText` pins with `node:http(s)`'s `lookup` option, not undici.** undici isn't installed,
   and adding it would touch the lockfile, a hot spot. The `lookup` option is the socket's
   connect-time resolver, which gives the same guarantee.
3. **Upstream patch:** `packages/core` now exports `./primitives/agent-env/api`, in `package.json`
   exports and as a `tsdown` entry. It is additive, and it is logged in `docs/UPSTREAM-PATCHES.md` §5.
4. **Reviewer uses `--permission-mode=dontAsk`** (per the brief), not `plan` (threat model). The
   restriction comes from `--tools`, `--disallowedTools` and a sandbox with no writable path.
5. **The prompt always goes on stdin**, never `-p "<prompt>"` (SEC-17 overrides the spike's recipe).
6. **The concurrency cap rejects rather than queues.** Queueing is the dispatcher's job.
7. **The token budget** counts input, output, cache-creation and cache-read tokens.
8. **`--permission-prompts=none`, `--max-budget-usd` and `failIfUnavailable`** appear in
   claude 2.1.x help or the docs, but I haven't exercised them against a real model (zero real runs).
9. **Review checkouts are independent repositories** (T33). Each is made with
   `git init --template=` and `core.symlinks=false`. It reads objects through
   `objects/info/alternates`, and the lane's branch, remote and tag refs are copied with
   `update-ref --stdin`. It is populated with `read-tree -u --reset`: from an unborn branch,
   `checkout --detach` exits 0 without a file whose blob is missing. Alternatives rejected:
   `clone --no-local` and `fetch` run `upload-pack` in the lane repo under its config, and
   `git archive` drops the history `baseRef` needs. The checkout mirrors the lane's working state
   at HEAD (tracked edits, untracked files, deletions), reaching every path through real
   directories only (T35). A symlink becomes a file holding its target. A file over 5 MB or with
   several hard links keeps HEAD's version (R16). Every git call gets `--no-lazy-fetch` and
   `GIT_NO_LAZY_FETCH=1` (T32), plus hooks, fsmonitor and repo filter drivers off, so git 2.44 or
   later is required; older git fails closed. The root is a new `mkdtemp` directory per boot
   (`createReviewRoot`, T34).
10. **`runCommand` gets a private `TMPDIR`.** The shared system temp dir isn't writable, because
    review checkouts live there.
11. **Process groups are SIGKILLed when a run closes**, so leftover dev servers and watchers are
    reaped.

## Accepted risks

- **R2, Codex:** `--sandbox` restricts writes, not reads, so a Codex run can read sibling lanes and
  Ninebrains data.
- **R11, unsandboxed tests gate:** only with `testsGate.allowUnsandboxed` (Linux without `bwrap`,
  Windows). Then only env scrubbing, the timeout, the process-group or tree kill and the output cap
  apply. macOS relies on `sandbox-exec`, which Apple deprecates. The Linux bubblewrap path has only
  been exercised with a stand-in `bwrap`.
- **R12, loopback:** loopback stays open to the tests gate for dev servers, so tests can reach
  local services (the Brain endpoint still needs a token and rate-limits failed auth).
- **R13, Codex budgets:** `maxTurns` does not apply to Codex, and its usage arrives only at
  `turn.completed`, so the wall clock is the real cap for one `codex exec` turn.
- **R14, escaping the process group:** a process that calls `setsid()` leaves the group and
  survives STOP. On Windows, `taskkill /T` only reaches the tree. `recover()` never signals the
  pids of a dead app's runs.
- **Deny lists are best-effort:** they cover known credential paths, not every secret on disk.
- **Regex redaction:** the transcript redactor is pattern plus literal-value based.
- **Untested platforms:** Windows paths are untested.
- **Unverified against real `claude` or `codex`:** everything runs on `tooling/fake-agent`, and the
  real CLIs were spawned zero times.
