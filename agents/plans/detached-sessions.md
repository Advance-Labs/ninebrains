# Plan: agent sessions keep working while the app is closed or updating

Target behavior: the user quits Ninebrains (or an update quits it), the agents running in their
worktrees keep working, and reopening the app reattaches to those agents mid-task with scrollback
intact.

**The headline finding: this already works for tmux-backed TUI agent sessions. It is switched off by
default, and one unguarded failure mode makes switching it on unsafe today.** The work below is
therefore mostly gating, defaults, surfacing and locking the guarantee in — not new machinery.

Read this page with [`risky-areas/pty.md`](../risky-areas/pty.md) and
[`risky-areas/updater.md`](../risky-areas/updater.md). Written 2026-09-24 against `main` at
`2780e8160`.

## What already works (verified, do not re-derive)

| Requirement | Mechanism | Source |
|---|---|---|
| Agent survives app quit | `lifecycle.dispose()` only sets `disposed = true` and clears a timer; it does **not** run the keyed cleanup steps | `packages/core/src/services/session-lifecycle/node/session-lifecycle.ts:440` |
| …and quit does not kill tmux | `TuiAgentsRuntime.dispose()` calls `registry.killAll()`, which kills the **pty clients**, not the tmux server | `packages/core/src/runtimes/tui-agents/node/runtime/runtime.ts:466` |
| tmux is only killed on eviction | `{ name: 'tmux-session', run: … killTmuxForConfig }` is a keyed cleanup step, reached from the idle/evict path | `runtime.ts:208`, `runtime.ts:1076` |
| Eviction never fires in the desktop | the desktop ships `lifecycle: { session: { kind: 'always' } }` | `packages/core/src/runtimes/tui-agents/node/worker-spec.ts:46` |
| Output while detached keeps the session alive | `tmuxKeepAliveMs`, because tmux-side output is invisible to the activity tracker | `runtime.ts:116-120` |
| Reattach to the **live** agent | `(tmux has-session -t =N \|\| tmux new-session -d -s N cmd) && <configure> && tmux attach-session -t =N` — idempotent ensure-then-attach | `packages/core/src/services/pty/api/tmux-commands.ts:13-36` |
| Scrollback preserved | `history-limit` set via `TMUX_HISTORY_LIMIT` on the session | `tmux-commands.ts` (`setHistoryLimit`) |
| Stable identity across restarts | `resolveTmuxSession` matches a stored tmux identity option first, then a legacy name | `packages/core/src/services/pty/api/tmux.ts` |
| Survives an update by construction | tmux lives outside the app's process tree, so bundle-swap + `app.relaunch()` cannot reach it | `src/main/host/updates/apply/index.ts`, `update-service.ts:130` |

Quit teardown for reference: `runQuitCleanup()` runs `desktop-wire-workers → runtimes.dispose()` as a
**critical** phase under `CRITICAL_DEADLINE_MS = 5_000`
(`apps/emdash-desktop/src/main/bootstrap/shutdown/phases.ts`).

## Non-goals

- **ACP conversations are out of scope.** ACP runs as a Wire component worker
  (`src/main/gateway/entries/acp.ts`) that the critical quit phase kills, taking its agent CLI
  children with it. ACP has `lazy-session-restoration` / `session-materializer`, so transcripts come
  back on reopen, but an in-flight turn is lost. Making ACP survive means hosting it in a detached
  daemon with its own transport, version-skew handling and orphan reaping — a separate project.
- **Windows gets nothing here.** `resolveSessionTmux` forces `false` on local win32 and
  `local-spawn.ts:109` already emits `tmux_unsupported_on_windows`. Do not let UI copy promise
  survival on Windows.

## The blocking defect: no availability gate

tmux is a declared core host dependency with install commands
(`TMUX_DEPENDENCY_DESCRIPTOR`, `packages/core/src/services/host-dependencies/api/core-dependencies.ts:109`),
but **nothing checks the binary exists before building the tmux shell line.** With the flag on and
tmux absent, `/bin/sh -c 'tmux has-session … || tmux new-session …'` exits non-zero and the session
fails to start outright.

This must land before the default flips. T1 is worth doing even if the default never flips, because
today a user who enables tmux without installing it just gets broken sessions.

---

## T0 — Prove the baseline on your machine (blocking, ~20 min, no code)

Everything after this depends on the claim above being true on a real host. Prove it before changing
anything.

1. Enable tmux for a project (Settings → project placement, or set the host default).
2. Start a TUI agent task and give it a long-running prompt.
3. Quit the app completely. Run `tmux ls` — the session must still be listed and its process still
   progressing (`tmux capture-pane -p -t =<name> | tail`).
4. Reopen the app, open the same task, and confirm you attach to the *same* running agent with its
   scrollback, not a fresh one.
5. Repeat step 3–4 across an actual update (`Download` → `Restart now`) if you can.

**Report the result in the PR for T1.** If any step fails, stop and re-scope: the rest of this plan
assumes it passes.

## T1 — Gate tmux on the binary being available (blocking)

**Goal.** Requesting tmux on a host without tmux degrades to a plain PTY instead of failing.

**Files.**
- `apps/emdash-desktop/src/core/features/tasks/api/node/task-session-launch-context.ts` — the
  `Promise.all` at `:95` and `resolveSessionTmux` at `:129`
- `packages/core/src/services/host-dependencies/api/contract.ts:26` — the `resolve` procedure takes a
  dependency id and returns a resolved descriptor; it is **per host**, so SSH hosts consult their own
  machine
- `packages/core/src/services/pty/api/local-spawn.ts:41` — `LocalPtySpawnWarning` union

**Approach.** `resolveSessionTmux` is pure and synchronous; keep it that way. Resolve tmux
availability in the caller's existing `Promise.all` and pass it in as a third input, so the decision
stays testable without I/O:

```ts
resolveSessionTmux(identity.host, tmux.value && tmuxAvailable, platform)
```

Add a `tmux_missing` warning alongside `tmux_unsupported_on_windows` so the renderer can distinguish
"your OS cannot" from "install tmux and you can".

**Acceptance.**
- tmux requested + binary present → tmux session as today
- tmux requested + binary absent → plain PTY, session starts, `tmux_missing` warning surfaced, nothing throws
- local win32 → unchanged (`false`, `tmux_unsupported_on_windows`)
- remote host → resolves against **that** host, not the desktop
- dependency lookup failure is treated as "absent", never as a hard error

**Tests.** Unit-cover the four rows above next to the existing `resolveSessionTmux` tests, and a
`local-spawn` case asserting the new warning.

**Verify.**
```bash
pnpm exec nx run @emdash/core:test
cd apps/emdash-desktop && pnpm exec vitest run --project node src/core/features/tasks/api/node/
```

**PR.** `fix(tasks): fall back to a plain pty when tmux is not installed`

## T2 — Flip the default on (depends on T1)

**Goal.** Survival is on for everyone who can have it, without overriding anyone's explicit choice.

**Files.**
- `apps/emdash-desktop/src/core/features/projects/contributions/settings.ts:29` — `tmuxByDefault: false` → `true`
- `apps/emdash-desktop/src/core/features/projects/node/settings/migrations/stored-settings.ts:56` —
  the existing one-shot marker: `if (options.tmuxDefault !== undefined && next.tmuxDefaultMigrated !== true)`
- `apps/emdash-desktop/src/core/features/projects/node/create-project-provider.ts:150` — `hostTmux` / `appDefaultTmux`
- update expectations in `settings/project-settings.test.ts` and
  `browser/components/settings-view/use-project-settings-form.test.ts` (currently asserts
  `tmux: { value: false, provenance: … 'app default' }`)

**Approach.** Reuse `tmuxDefaultMigrated` rather than inventing a new marker — it exists precisely to
change this default once per project, idempotently and retryably. Precedence stays
project override > host default > app default.

**Acceptance.**
- fresh project on a host with tmux → tmux on, provenance `app default`
- project where the user explicitly set `false` → stays `false`, marker untouched
- migration applied twice → no second write (marker holds)
- host without tmux → T1 gate still yields a working plain-PTY session
- only **newly launched** sessions change; already-running non-tmux agents cannot retroactively gain it

**Verify.**
```bash
cd apps/emdash-desktop && pnpm exec vitest run --project node src/core/features/projects/
pnpm run test:migrations
```

**PR.** `feat(projects): default new sessions to tmux so agents survive a restart`

## T3 — Make the guarantee visible (depends on T2)

**Goal.** The user knows work continued while the app was closed, and knows how to get the guarantee
when they lack tmux.

**Files.**
- a session/task surface under `apps/emdash-desktop/src/core/features/workbench/browser/` (confirm the
  exact host; `UpdateStatusPill` in `src/core/features/updates/browser/` is the precedent for a small
  status pill, and `src/renderer/app/workspace.tsx:31` shows how one is mounted)
- `apps/emdash-desktop/src/core/features/settings/browser/components/TaskSettingsRows.tsx` — the tmux row
- new UI must be contributed through the owning slice's `contributions/browser.ts` and aggregated by
  `src/core/manifests/browser/browser-contributions.ts` (see `AGENTS.md`)

**Approach.** Two distinct states, do not conflate them:
1. *reattached* — this session was already running when you opened the app
2. *unavailable* — tmux missing (`tmux_missing`) → offer the install command from
   `TMUX_DEPENDENCY_DESCRIPTOR` (`brew install tmux`, apt); or *unsupported* on Windows → state it
   plainly and offer nothing

Copy must not promise survival for ACP conversations, which do not have it.

**Acceptance.** Reattached sessions are labelled as such; a tmux-less host gets an actionable install
path; Windows copy says unsupported; no promise is made for ACP.

**Verify.** Browser tests for the new component, plus `pnpm exec nx run @emdash/emdash-desktop:typecheck`.

**PR.** `feat(workbench): show when an agent kept running while the app was closed`

## T4 — Lock the guarantee in with a regression test (parallel with T1)

**Goal.** Nobody can quietly wire a tmux kill into the shutdown path. Today the guarantee is
*implicit* in what `dispose()` happens not to do, which is exactly the kind of thing a future
refactor breaks silently.

**Files.**
- `packages/core/src/runtimes/tui-agents/node/runtime/runtime.test.ts`
- `apps/emdash-desktop/src/main/bootstrap/shutdown.test.ts`

**Acceptance.** A test asserts `TuiAgentsRuntime.dispose()` kills pty clients but issues **no**
`kill-session` for a tmux-backed config, and a test asserts quit cleanup does not either. Both must
fail if someone adds a tmux kill to dispose or to `runQuitCleanup`.

**Verify.**
```bash
pnpm exec nx run @emdash/core:test
cd apps/emdash-desktop && pnpm exec vitest run --project node src/main/bootstrap/
```

**PR.** `test(tui-agents): assert quit detaches from tmux instead of killing it`

## T5 — Document it (last)

- `agents/risky-areas/pty.md` — the detach/reattach contract and the "never kill tmux on quit" rule
- `agents/risky-areas/updater.md` — that an update deliberately leaves tmux sessions running
- `agents/README.md` — docs-map pointer to this page
- `CHANGELOG.md` — an `## [Unreleased]` entry; those notes become the next release body

**Do not touch `docs/SECURITY.md`** unless genuinely required: it is security-sensitive, so
`pnpm run merge` refuses the PR until a human adds the `security-reviewed` label.

**PR.** `docs(pty): document detached tmux sessions across quit and update`

---

## Sequencing

```
T0 (prove baseline) ──► T1 (gate) ──► T2 (default) ──► T3 (UI) ──► T5 (docs)
                    └─► T4 (regression test, parallel with T1)
```

One PR per task, each small and self-reviewed. T1 and T2 must not be combined: flipping the default
without the gate ships broken sessions to anyone lacking tmux.

## Gates every PR must clear

Learned the hard way while shipping v0.2.1 — budget for these:

- **Conventional Commit** title, and commit with `git commit -s` (DCO sign-off is enforced by `pr-hygiene`).
- **Upstream-patch log.** Any file inherited from upstream Emdash needs a row in
  `docs/UPSTREAM-PATCHES.md` in the same PR. Check before you commit:
  ```bash
  git cat-file -e dbf690c:<path> && echo "inherited: needs an UPSTREAM-PATCHES row"
  node tooling/scripts/check-upstream-patches.mjs --base origin/main --head HEAD
  ```
  The gate reads the **committed** diff, so commit the log row before re-running it.
- **`ci-ok` must be green on the exact commit**, or the release workflow's preflight refuses it.
- **Security-sensitive files** (e.g. `docs/SECURITY.md`) require a human `security-reviewed` label;
  `pnpm run merge <pr>` refuses without it. Do not self-apply it.
- **Merge with `pnpm run merge <pr>`**, which waits for CI on the merge commit. It also refuses a
  branch behind `main` — rebase with `gh pr update-branch <pr> --rebase` and let CI re-run.
- The local pre-push hook runs `nx affected -t lint typecheck test`; the full desktop browser suite
  has a known flake (`installation-overrides`) that passes in isolation. Prefer focused commands
  while iterating, and if you bypass the hook, run
  `node tooling/scripts/check-upstream-patches.mjs` yourself — `--no-verify` skips that real gate too.

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Default flips without the gate → sessions fail on tmux-less hosts | high | T1 strictly before T2; keep them separate PRs |
| Orphaned tmux sessions accumulate when tasks are abandoned | medium | eviction still exists for non-`always` policies; verify Clean Artifacts / archived-worktree expiry reaches tmux sessions, and file a follow-up if not |
| A later refactor adds a tmux kill to quit | medium | T4 makes it fail CI |
| Users expect ACP chats to survive too | medium | T3 copy is explicit about which sessions survive |
| Version skew: an agent started by the old binary keeps running under a new app | low–medium | tmux only carries a shell process; the app reattaches by identity. Watch for hook/protocol changes in `tui-agents` that assume a same-version agent |
| Remote/SSH hosts behave differently | low | T1 resolves per host; cover a remote case in tests |

## Definition of done

- Quitting the app (and updating) leaves TUI agents running, on macOS and Linux, by default, on hosts with tmux
- Reopening reattaches to the live agent with scrollback, not a fresh session
- Hosts without tmux get a working plain-PTY session plus an actionable install path
- Windows is explicitly unsupported in copy, never silently broken
- A regression test fails if quit starts killing tmux
- `agents/` and `CHANGELOG.md` reflect the new behavior
