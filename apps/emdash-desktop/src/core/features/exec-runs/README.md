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
| `supervisor.killAll()` / `clearStop()` | same | Global STOP: tray, menu and shortcut, all in main so it works with a hung renderer. It latches until cleared |
| `supervisor.onEvent(fn)` | same | Bridge to an `eventStream` for the UI and to `security_events` (SEC-33). Budget counters arrive here for the Brain DB (SEC-29 restart part) |
| `assertSafeArgv(argv)` | `api/node/argv-guard` | The attended launch-config builder must call it on every PTY spawn (SEC-12) |
| `createSpawnReviewer({ supervisor, route, auth, checkoutRoot, laneWorktrees })` | `gates/node/capabilities/spawn-reviewer` | `route(purpose)` picks the provider/model per gate |
| `createPrepareReviewCheckout({ worktreeForJob, root })` | `gates/node/capabilities/review-checkout` | `worktreeForJob` maps from lane state, never from the job record |
| `createRunCommand({ allowedRoots, ninebrainsDataDir, siblingWorktrees, deniedPaths })` | `gates/node/capabilities/run-command` | Pass the review-checkout root in `deniedPaths` |
| `createFetchText()` | `gates/node/capabilities/fetch-text` | No options in the app. `addressPolicy` is for tests only |

Not here: `captureScreenshot` (it needs lane browser ids) and `readWorktreeFile` (SEC-23).

## SEC requirements and their tests

| SEC | Test (`describe`) |
|---|---|
| SEC-11 | `SEC-11 lane sandbox settings` (settings generation). The live deny can't be proven with the fake agent: **manual e2e with the real CLI before release** |
| SEC-12 | `SEC-12 launch argv guard`: builder snapshots plus the runtime guard inside `spawnInGroup` |
| SEC-13 | `SEC-13 unattended env is minimal` |
| SEC-14 | `SEC-14 ids cannot traverse` (runId → transcript path) |
| SEC-16 | `SEC-16 refuses a relative binary`, `SEC-16 never executes a binary planted in the worktree` |
| SEC-17 | `SEC-17 prompt is not argv`: the prompt goes on stdin for both providers |
| SEC-18 | `SEC-18 reviewer cannot write the worktree`: real git repo, hostile fake reviewer, byte-for-byte snapshot, plus a control run showing the same script does write when allowed |
| SEC-20 | `SEC-20 tests gate env is scrubbed`, `SEC-20 tests gate is sandboxed`, `SEC-20 macOS seatbelt profile` |
| SEC-21 | `SEC-21 address policy`, `SEC-21 rebinding and redirects blocked`, `SEC-21 pinning, redirects and caps` |
| SEC-29 | `SEC-29 enforces the wall-clock budget` / `token budget` / `caps concurrent runs` |
| SEC-30 | `SEC-30 kill switch`: 8 runs whose leader and grandchild ignore SIGTERM are all gone in under 5 s, and the switch stays latched |
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
      "denyRead": ["<userData>/ninebrains", "<sibling worktrees>", "~/.ssh", "~/.aws", "~/.config/gcloud",
                   "~/.config/gh", "~/.codex", "~/.claude/.credentials.json", "~/.claude.json", "~/.netrc",
                   "~/.npmrc", "~/.docker/config.json", "~/.kube", "~/.gnupg", "<CLAUDE_CONFIG_DIR>/.credentials.json"],
      "allowRead": ["<worktree>"],
      "allowWrite": ["<worktree>"],
      "denyWrite": []
    }
  },
  "permissions": { "deny": ["Read(//<each denied path>/**)", "Edit(//<each denied path>/**)"] }
}
```

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
9. **Review checkouts mirror the lane's working state at HEAD**: tracked edits, untracked files and
   deletions. Only regular files are copied, up to 5 MB each, and git hooks and fsmonitor are off.
10. **`runCommand` gets a private `TMPDIR`.** The shared system temp dir isn't writable, because
    review checkouts live there.
11. **Process groups are SIGKILLed when a run closes**, so leftover dev servers and watchers are
    reaped.

## Accepted risks

- **R2, Codex:** `--sandbox` restricts writes, not reads, so a Codex run can read sibling lanes and
  Ninebrains data.
- **`runCommand` on Linux and Windows:** there is no OS sandbox. Only env scrubbing, the timeout,
  the process-group or tree kill and the output cap apply. On macOS it relies on `sandbox-exec`,
  which Apple deprecates, and it leaves the network open, so tests can reach loopback services
  (the Brain endpoint still needs a token).
- **Escaping the process group:** a process that calls `setsid()` leaves the group and survives
  STOP. On Windows, `taskkill /T` only reaches the tree.
- **Deny lists are best-effort:** they cover known credential paths, not every secret on disk.
- **Regex redaction:** the transcript redactor is pattern plus literal-value based.
- **Untested platforms:** Windows paths are untested.
- **Unverified against real `claude` or `codex`:** everything runs on `tooling/fake-agent`, and the
  real CLIs were spawned zero times.
