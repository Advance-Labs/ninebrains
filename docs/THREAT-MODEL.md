# Ninebrains threat model (plan task 6.4, done early)

Status: design review, 2026-09-10. Written before Phase 2 code lands so the build agents implement
controls instead of retrofitting them. Every requirement below is a test, not a guideline. A phase is
not done until its `SEC-*` tests exist and pass.

Updated 2026-09-11 after the first independent security review (findings H1, M1–M4, L1–L4 and the
SEO reviewer bug, branch `w6/sec-fixes`). The per-requirement status is in §5a, new accepted risks
are R10–R15 in §7, and one new finding is T31.

Updated 2026-09-12 after the integration review of `w7/integrate` (branch `w7/sec-review-fixes`).
Four findings are fixed: T32 (a lazy fetch runs a lane's `core.sshCommand` in main), T33 (the
filter-driver list could be raced), T34 (the review root was shared on Linux) and T35 (the
working-tree mirror followed symlinks). T36 was open: upstream git runs lane-controlled config
outside any sandbox. The new accepted risks are R16 and R17. T36 was fixed the same day on the same
branch, with residual risk R18.

Updated 2026-09-12 after a security review of the daily-use commits (branch `w7/daily-use-sec`).
Pack secrets, the unattended toggle and role prompts hold. One finding is fixed: T37 (Clear STOP
resumed a dispatcher the user had paused). SEC-27 now has its at-rest scan.

Updated 2026-09-13 (branch `w7/testsgate-prefs`): R11 and R12's `testsGate.allowNetwork` /
`allowUnsandboxed` opt-ins are wired to real per-project storage and a Settings → Gates UI for the
first time (SEC-08). Not a new finding: the gap those risks accepted was previously unreachable
(always false), so this only makes the documented, accepted risk real and user-controllable. A
same-day independent security review of that change found one finding, fixed the same day: the
project-prefs memento stayed at schema version '1', so a row stored before this change could read
the two new flags as `undefined` rather than `false` in a production build (never exploited; see
SEC-08).

Updated 2026-09-15 (branch `w8/routing-ux`, `docs/plans/2026-09-15-routing-usability.md` item 1):
the new read-only "Agents" panel (`RoutingService.agentCliStatus`) surfaces routing decisions —
which role runs under which profile — to the renderer for the first time. New finding T46, Low/Low:
it reflects the same profile list already visible via `listProfiles` and reuses the exact
`resolveRoute` path launch-time routing already runs, so it adds no new decision surface, only a
new place an existing one is displayed.

Inputs: plan `2026-09-10-oss-agent-workbench.md` (D5, D6, Phase 6), `docs/SEAMS.md` (§3.6–3.8,
§3.12–3.14, §3.16–3.17), `brain-remediation-spec.md` (a real RCE in our earlier voice orchestrator),
the `gates-core` and `citations` READMEs, the brain-core/brain-mcp checkpoint (`06f5d8284`), and the
upstream `webview-security.ts`, `hook-server.ts`, `agent-env/api` and `agents/risky-areas/`.

## 1. The one fact that shapes everything

Every lane agent runs **as the user's own OS account** with a shell tool. File modes such as `0600`
stop *other users*; they do not stop a lane's `Bash` from reading `mcp.json`, another lane's token,
the Brain DB, or `~/.ssh`. So there are only two real boundaries between a prompt-injected lane and
everything else:

1. **The provider's sandbox and permission layer** (Claude Code sandbox and permission rules; Codex
   `--sandbox`). That is what stops a lane from reading other lanes' secrets or escaping its worktree.
2. **Main-process checks on everything a lane hands back** (tool calls, `complete_job`, artifacts,
   claims, diffs). Main owns the DB, the gates and the dispatcher. A lane only ever *asks*.

Brain authorization (lane A cannot complete lane B's job) is a correctness property on its own. It
becomes a security property only when (1) keeps the token unreadable. Build agents must not describe
per-lane tokens as a boundary where the sandbox is off.

## 2. System and trust boundaries

```
 USER (trusted) ──UI──▶ ┌──────────────── Electron main (trusted) ──────────────────────┐
                        │ Brain endpoint 127.0.0.1:<rand>  token→identity map          │
                        │ Brain DB (only main opens it)   dispatcher   run supervisor  │
                        │ gate runner ─ evidence store (<userData>/ninebrains/evidence) │
                        │ CDP gate host   pack loader + safeStorage   updater (off)     │
                        └──▲─────────────▲──────────────▲──────────────▲───────────────┘
              TB2 (HTTP+token)     TB5 (stdio/env)   TB7 (read-only)  TB3 (CDP)
 ┌───────── lane (semi-trusted: obeys untrusted input) ─────────┐  ┌─ reviewer run ──┐
 │ claude|codex CLI ─ Bash/Edit tools ─ worktree (own only)     │  │ disposable      │
 │   ├─ brain-mcp (stdio shim, holds this lane's token only)    │  │ checkout, no    │
 │   └─ pack MCP servers (third-party code, own secrets)  ◀─TB5 │  │ write, no shell │
 └──────────▲──────────────────────────────────────▲────────────┘  └─────────────────┘
       TB3  │ page text, fetch, crawl, GSC data     │ TB4: any local process or web page
 ┌──────────┴─────────── UNTRUSTED ─────────────────┴──────────────────────────────────┐
 │ lane webview pages · fetched URLs · SEO crawl · GSC/GA4/Bing rows · MCP tool output │
 │ other local processes · browsers on this machine · release/update channel (TB6)    │
 └─────────────────────────────────────────────────────────────────────────────────────┘
```

| Boundary | Crossing | Default stance |
|---|---|---|
| TB1 user ↔ main | UI, settings, plan approval | trusted; the only source of consent for outbound actions |
| TB2 lane ↔ main | Brain tool calls over localhost HTTP | lane is untrusted input; identity from token only |
| TB3 web ↔ lane/gates | page text, screenshots, fetched bodies, SEO data | untrusted *data*, never instructions |
| TB4 local host ↔ endpoint | other processes, browser tabs, DNS rebinding | reject anything that isn't brain-mcp |
| TB5 main ↔ pack MCP | third-party code, their env secrets | untrusted code, pinned and least-privilege |
| TB6 app ↔ release channel | installers, update feed | no updater until signed; checksums always |
| TB7 worker ↔ reviewer | diff, evidence, verdict | reviewer is independent and cannot write |

## 3. Assets

| ID | Asset | Where it lives | Worst outcome |
|---|---|---|---|
| A1 | User's machine (`~/.ssh`, `.env` files, other repos, browser sessions) | disk, same uid | exfiltration or tampering by a lane (the Brain RCE blast radius) |
| A2 | Provider logins (`claude`, `codex`) | Keychain, `~/.claude`, `~/.codex/auth.json` | D5 breach; account ban; theft |
| A3 | Pack secrets (GSC/GA4 service accounts, DataForSEO, GitHub, Vercel, Stripe) | safeStorage, then per-lane `mcp.json` env | third-party account takeover |
| A4 | Brain DB (jobs, messages, runs) | `<userData>/…/brain.sqlite` | forged `done`, gate bypass, job injection |
| A5 | Lane and Brain tokens | main memory, per-lane `mcp.json` | impersonation; brain-role job creation |
| A6 | Gate verdicts and evidence | evidence store | fake "verified" work reaching the user or a client |
| A7 | Worktrees and git remotes | `~/…/worktrees/*` | cross-lane tampering, pushed malicious commits |
| A8 | Spend (Agent SDK credit, API keys) | provider billing | runaway overnight cost |
| A9 | Release artifacts and users' installs | GitHub Releases | supply-chain compromise of every user |
| A10 | Transcripts and screenshots | `<userData>` | secrets or third-party personal data at rest |

## 4. Threats

Likelihood (L) and impact (I): H/M/L. "Req" points at §5.

| ID | Threat | L | I | Mitigation | Req |
|---|---|---|---|---|---|
| T01 | Page in a lane browser (or a fetched URL, crawl result, GSC row) carries instructions; the lane runs a destructive or exfiltrating command | H | H | provider sandbox + deny-read list, strict env, egress allowlist for unattended runs, outbound actions gated | SEC-11, SEC-13, SEC-31, SEC-32 |
| T02 | Lane reads another lane's token or the Brain DB and acts as that lane or as the Brain | M | H | main owns DB; token→identity map; sandbox deny-read of `<userData>/ninebrains` | SEC-01, SEC-02, SEC-11 |
| T03 | Lane spawns brain-mcp itself with `NINEBRAINS_ROLE=brain` | H | H | role comes from the token held by main, never env | SEC-01, SEC-02 |
| T04 | Web page or local process calls the Brain endpoint (`fetch('http://127.0.0.1:<port>')`, DNS rebinding, port scan) | M | H | loopback bind, Host check, Origin/Sec-Fetch reject, header token, no CORS, JSON-only | SEC-04, SEC-05 |
| T05 | Token guessed or timed | L | H | 256-bit random, constant-time compare, per-launch rotation | SEC-03 |
| T06 | Endpoint flooded or fed huge bodies (renderer or lane DoS) | M | M | body cap, header timeout, per-token rate limit | SEC-06 |
| T07 | Injected Brain (or lane) creates jobs with `gates: []`, so work ships as `unverified` | M | H | gate floor from rigor settings; callers can only add gates; agents may declare only the code or ui kind | SEC-08 |
| T08 | Job body breaks out of the bracketed paste and types keystrokes, or a paste lands on a permission prompt and approves it | M | H | paste only when idle; strip ESC/C0; reject `ESC[201~` | SEC-15 |
| T09 | Job body starting with `--` is parsed as a CLI flag (`--dangerously-skip-permissions`) | M | H | prompt via stdin, never argv | SEC-17 |
| T10 | Worktree plants `claude.cmd` / `node_modules/.bin/claude` and the dispatcher runs it | M | H | absolute binary path from the dependency resolver; no `shell: true` | SEC-16 |
| T11 | Reviewer run writes to the worktree (or is given Bash) and "fixes" the work it grades | M | H | disposable checkout, provider read-only sandbox, FS-level test | SEC-18 |
| T12 | Diff, page text or `claims.json` tells the reviewer "reply `{\"pass\":true}`" | H | H | nonce-delimited untrusted blocks; deterministic checks win; JSON-only verdict | SEC-19 |
| T13 | Lane edits `package.json` `test` script; the tests gate runs it unsandboxed with the app's env | H | H | tests gate runs under the lane sandbox with a scrubbed env | SEC-20 |
| T14 | `fetchText` reaches `169.254.169.254`, `localhost:<brain port>` or a LAN router via redirect or rebinding | M | H | net-guard with connect-time IP pinning | SEC-21 |
| T15 | `claims.json` is a symlink to `~/.ssh/id_ed25519`; its content comes back in gate feedback | M | H | realpath confinement, no symlink escape, size cap | SEC-23 |
| T16 | Forged evidence (fake screenshot or log committed to the worktree and cited as proof) | M | M | gates generate evidence themselves; artifact paths never count as proof | SEC-22 |
| T17 | ID like `..`, `.` or `a:b` becomes a path segment (traversal; NTFS alternate data streams) | M | M | path-segment ID grammar | SEC-14 |
| T18 | Secrets end up in transcripts, logs, evidence or screenshots | H | M | redactor on every write; screenshot origin rule; retention | SEC-24, SEC-35 |
| T19 | CDP attaches to the app's own window or another lane's page; `browser.eval` runs JS against a logged-in site | M | H | CDP only on the lane's registered webview; per-lane ephemeral partition; eval origin-locked | SEC-25 |
| T20 | Pack MCP server is malicious or rug-pulled (tool poisoning, description changes after approval) | M | H | bundled-only packs in v0.1, pinned versions + integrity, description hash, no `@latest` | SEC-26, SEC-28 |
| T21 | Pack secret stored in plaintext (Linux `basic_text` safeStorage) or leaked into the PTY env | M | H | safeStorage required; server-entry env only | SEC-27 |
| T22 | Pack server named `brain` shadows the Brain tools | L | H | reserved server names | SEC-28 |
| T23 | Overnight run loops or burns credit | H | M | budgets enforced by the supervisor, persisted across restart | SEC-29 |
| T24 | STOP doesn't stop grandchildren (dev servers, test runners) | M | H | process-group / job-object kill, 5 s test | SEC-30 |
| T25 | Unattended run deploys, pushes, emails, pays or changes DNS because a page told it to | M | H | no outbound credentials or network unless the plan allowlists them | SEC-32 |
| T26 | Brain-created session gets `--dangerously-skip-permissions` via upstream `autoApprove` | M | H | argv guard test on every launch builder | SEC-12 |
| T27 | App reads `.credentials.json` / `auth.json` (D5) or moves a `CLAUDE_CONFIG_DIR` | L | H | status via CLI only; FS spy test | SEC-34 |
| T28 | Unsigned build auto-updates from a feed we don't control (upstream Emdash feed, hijacked release) | M | H | updater compiled out until signing; checksums + provenance | SEC-36, SEC-37 |
| T29 | Telemetry or a crash report leaves the machine | L | M | default off; no key or host compiled in; egress test | SEC-38 |
| T30 | An incident can't be reconstructed because the logs were in memory (remediation lesson 4) | M | M | append-only `security_events` in the Brain DB | SEC-33 |
| T31 | The reviewer gate's `git diff` runs in the review checkout, which shares the lane-writable repo config, so a `filter.<x>.clean` driver in `.git/config` runs during the diff. Review checkouts themselves empty every filter driver (L4). It runs under the tests-gate sandbox on macOS and on Linux with bubblewrap, but unsandboxed on Linux without it and on Windows | M | H | **Fixed 2026-09-12:** `reviewer-gate.ts` lists the repo's filter drivers with `git config` and blanks `smudge`/`clean`/`process` for the diff and the untracked listing, the same rule as `review-checkout.ts`; it fails closed on an unreadable config or an unsafe name (`T31` tests in `reviewer-gate.test.ts`). The listing and the diff are separate git processes; T33 keeps the config stable between them | SEC-18, SEC-20 |
| T32 | A lane makes its repo a partial clone (`core.repositoryformatversion=1`, `extensions.partialClone=evil`, `remote.evil.url=ssh://…`, `core.sshCommand=<cmd>`) and deletes a loose blob that HEAD or the base needs. Any git in main that reads the blob lazy-fetches it and runs `<cmd>` as the user, unsandboxed on every platform: review-checkout's `worktree add` and its mirror's `git diff`, and the reviewer gate's diff and `ls-files`. `-c protocol.allow=never` does not stop it, because a repo-level `protocol.ssh.allow=always` overrides it | M | H | **Fixed 2026-09-12:** `--no-lazy-fetch` comes first in review-checkout's `HARDENING` and in the reviewer gate's `SAFE_GIT`, which the gate now puts before every git call, including a caller's `diffArgs`. `GIT_NO_LAZY_FETCH=1` is set in review-checkout's env and in runCommand's env for argv (gate-built) commands. git older than 2.44 rejects the flag, so both fail closed there. Tests: `T32 no lazy fetch from a review checkout` (real git; the marker is never written, and a control shows plain `worktree add` does write it), `T32 the reviewer diff never lazy-fetches (real git)` (the argv flag alone, with a control), and argv/env assertions in `reviewer-gate.test.ts` and `run-command.test.ts` | SEC-18, SEC-20 |
| T33 | The reviewer gate lists filter drivers in one git process and diffs in another. While the review checkout was a linked worktree, its config and `$GIT_COMMON_DIR/info/attributes` were the lane repo's. A lane process that survives into `verifying` (R14) could add `filter.<x>.clean` between the two steps, and the diff would run it. review-checkout had the same gap between its own listing and `worktree add` | L | H | **Fixed 2026-09-12:** the review checkout is now an independent repository. It is a fresh `git init --template=` in the review root with its own config (`core.symlinks=false`) and no attributes. It reads objects from the lane's store through `objects/info/alternates`, and the lane's `refs/heads`, `refs/remotes` and `refs/tags` are copied with `update-ref --stdin`, so `baseRef` resolves as it does in the lane. The lane repo only gets read-only git (`rev-parse`, `for-each-ref`, `ls-files`). The lane sandbox (SEC-11) cannot write the review root, so the checkout's config cannot change between listing and diff. Alternatives rejected: `clone --no-local` and `fetch` run `upload-pack` in the lane repo under its config; `git archive` drops the history `baseRef` needs. Test: `T33 the review checkout is its own repository` (a filter, attributes and a promisor added to the lane repo mid-review never run under plain git in the checkout) | SEC-18 |
| T34 | Linux only: the review root was a fixed `join(realpath(tmpdir()), 'ninebrains-review')` made with `mkdirSync({ recursive, mode: 0o700 })`. That silently accepts a directory another local user created first, who then owns it and can read or swap checkouts. A file at that path blocks boot | L | M | **Fixed 2026-09-12:** `createReviewRoot()` makes a new `mkdtemp` directory (`ninebrains-review-XXXXXX`, 0700) on every boot and removes it on scope dispose. It is still outside `<userData>` (M4). Test: `T34 review root` | SEC-18 |
| T35 | The review-checkout mirror, which runs in main unsandboxed, followed links. The lane commits a symlink `x -> ~/.zshrc`, then replaces `x` with a regular file in the working tree. The mirror copied that file through the checkout's symlink, so a lane could overwrite any file the user can write. The mirror now also lists index paths, so a lane that turned `keys/` into a link to `~/.ssh`, or hard-linked a secret into its worktree, could have had the secret copied into the checkout the reviewer reads | M | H | **Fixed 2026-09-12:** the checkout has `core.symlinks=false`, so HEAD's links are plain files. Both trees are walked through real directories only (`lstat` on every parent). The lane file is opened with `O_NOFOLLOW` and its inode re-checked after reading. A lane symlink is mirrored as a file holding its target, which is how git stores one. Files with several hard links keep HEAD's version. Any path with a `.git` component is refused (case, trailing dots and spaces, HFS-ignorable code points, `git~1`), and writes use `wx`. Tests: `T35 mirroring never follows a symlink or a hard link`, `isSafeReviewPath` | SEC-18, SEC-23 |
| T36 | Upstream `packages/core` runs git against lane worktrees outside any sandbox, with no config hardening, in two forked Node children (the git worker and the workspace-registry worker). **Automatic, with no user action:** the git worker runs `status --porcelain=v2 -uall` on every worktree watch event and on a periodic revalidate (`runtimes/git/node/checkout/ops/status.ts:31`). The registry scan runs `status --porcelain=v1` and `diff --numstat HEAD` over every registered lane on watch events and a periodic poll (`runtimes/workspace-registry/node/scan/observe-git.ts:292`, `:309`), plus `rev-list`. So a lane's `core.fsmonitor=<cmd>`, or `filter.<x>.clean` with `info/attributes`, runs as the user within seconds. Lazy fetch (T32) applies to the diff, `rev-list` and `cat-file` calls, and `textconv` to the changes panel's diff, `log` and `blame`. **App-driven writes** (`create-worktree`, `update-worktree`, `background-steps` push/fetch, `delete-worktree`) add hooks and transport vectors. Lanes share the common config, so a poisoned config also fires when the app creates the next lane. The registry's `registryGitEnv` (`runtimes/workspace-registry/node/git-context.ts`) sets no `GIT_SSH_COMMAND`, so a lane's `core.sshCommand` runs on its fetch and push. git is spawned through four helpers over `createBoundExec`, not one: `runtimes/git/node/exec/git-exec.ts` (`gitEnv`), `workspace-registry/node/git-context.ts`, `services/exec/node/git-exec.ts` and an inline call in `workspace-registry/node/inspect-path.ts` | H | H | **Fixed 2026-09-12, two layers.** (1) The root cause, for Claude lanes and runs: `buildClaudeSandboxSettings` write-denies `$GIT_COMMON_DIR/config`, `config.worktree` (common and per-worktree), `info/attributes` and `hooks`, with matching `Edit` deny rules. The paths come from the worktree via read-only hardened git (`resolveLaneGitPaths`), plus a linked worktree's `.git` gitfile, which names the git dir. A lane that rewrote it could point the app's git at a config and hooks it made. The tests-gate sandbox makes the same paths read-only, for a lane whose repo `.git` sits inside its worktree, and seatbelt also stops `.git` being renamed. Objects, refs and the index stay writable. The live deny needs the manual real-CLI e2e (§5a SEC-11). (2) Every upstream git call goes through the Ninebrains `hardenGitExec` (`packages/core/src/services/exec/api/hardened-git.ts`), wired into all four helpers, which classifies each call. Every call gets `core.fsmonitor=false` via `GIT_CONFIG_COUNT` (which ranks above repo config) and a default `GIT_SSH_COMMAND` (which git prefers over a repo `core.sshCommand`). App-driven calls also get `core.hooksPath=/dev/null`, while user-initiated writes in the git worker keep the user's hooks. Reads also get `GIT_NO_LAZY_FETCH=1`, `--no-ext-diff --no-textconv` on diff, log and show (`--no-textconv` on blame), and the repo's own (local and worktree scope) filter drivers blanked on `status`, `diff`, `blame`, `ls-files` and `cat-file --filters`. Global drivers such as git-lfs keep working. Not scoped to lane-worktree paths: lanes share the common config with the user's main checkout, so a path scope would miss the main checkout's own status. `diff.external` is not set, because an empty value makes git run an empty command, so `git diff` fails. Tests: `T36 createGitExec hardening`, `T36 registry git hardening` and `T36 createNonInteractiveGitExec` (real git; fsmonitor, clean filter, `core.sshCommand`, promisor and hooks planted; none run through the hardened path, and plain git runs them), `T36 hardenGitExec argv`, `T36 repoFilterDriverFlags` (global lfs kept), `T36 resolveLaneGitPaths`, the `T36` settings snapshots, and `T36 tests-gate commands cannot rewrite the repo git control files` (real `sandbox-exec`: config, attributes, a hook, renaming `.git` and a linked worktree's gitfile all refused, while `git commit` still works). Residuals: R18 | SEC-11, SEC-16 |
| T37 | The dispatcher's `latch()` set `paused` as well as `latched`, and `BrainService.clearStop()` then called `setPaused(false)`. So a user who paused dispatch and then pressed STOP had dispatch resumed by Clear STOP, from the renderer, the app menu or the tray. The main-process guard only checked that STOP was latched | M | M | **Fixed 2026-09-12:** the latch is separate state. `latch()` no longer touches `paused`, and `clearStop()` no longer resets it, so a pause set before STOP survives Clear STOP. Tests: `T37 keeps a user pause across STOP and Clear STOP` (dispatcher) and `T37 Clear STOP keeps a pause the user set before STOP` (BrainService) | SEC-30 |
| T38 | A subscription lane or run gets `ANTHROPIC_BASE_URL` (from the user's shell, their Claude settings files, or a routing bug) and sends the claude.ai login through a third-party gateway. Setting only the base URL keeps the saved login and forwards it (Claude Code gateway docs) | M | H | **Mitigated 2026-09-12 (routing wave 1):** `routeLaunch` blanks every gateway and alias variable in the launch env and in our `--settings` env block, which outranks user, project and local settings (spike §13 Q2). `assertLaunchPolicy` checks both on every builder. Managed settings outrank `--settings`, so a gateway there refuses the launch. Unattended claude runs also check `apiKeySource` at init | SEC-39, SEC-41 |
| T39 | A lane's Bash reads the model-profile key from its own env and spends it directly, or sends it elsewhere | M | M | The key reaches only that one spawn's env (SEC-40); the guide tells users to set a vendor-side spend limit per key. Accepted risk R19 | SEC-40 |
| T40 | A reviewer is silently moved to a cheaper or weaker model, so gates pass on weaker review | L | H | **Fixed 2026-09-15 (wave 2):** the default stays the subscription with no setup. An app-level reviewer pin (Settings → Models, `ninebrains.routing`) routes reviewer runs to one chosen profile via `resolveRoute('reviewer', …)`; once pinned, a missing, disabled, keyless or unhealthy profile blocks the review (`spawnReviewer` throws, the gate returns `pass: false`) rather than falling back to the subscription or a lower tier. Off in a release build (`MODEL_PROFILES_ENABLED`): the setting is hidden and ignored, reviewers always run on the subscription there. Tests: `reviewer-route.test.ts`, `routing-service.test.ts`'s `SEC-42 prepareReviewerRoute` suite, `spawn-reviewer.test.ts`'s `SEC-42` suite, `run-supervisor-routing.test.ts`'s `SEC-42` suite | SEC-42 |
| T41 | A mispriced or unpriced model makes USD budgets meaningless; `--max-budget-usd` prices unknown models at Opus rates and stops only after a response (spike §13 Q3) | M | M | **Open (wave 2):** profiles store nullable prices now; R5 refuses unpriced unattended runs and computes USD from stream usage | SEC-43 |
| T42 | STOP correctly latched dispatch and stopped an attended lane's terminal, but only ever requeued the job it held when the dispatcher's own in-flight paste happened to observe the kill and return `not-ready` (`dispatcher.ts`'s `apply()`). Once a job reached `running`, nothing moved it back to `ready`: `stopEverything` and `LaneService.stopLane` never touched the Brain job at all. The Brain drawer then kept showing the job as running for a lane that had no agent left to run it — a race the CI runners hit reliably (2 of 3 ubuntu-22.04 runs), rarely on a quieter machine | M | M | **Fixed 2026-09-14:** `BrainService.stopAll` requeues the lane's held job itself, synchronously, before it even awaits the lane stop — `claimed` jobs are released directly (a legal edge), `running` jobs are failed then requeued (no direct `running -> ready` edge exists), and the whole thing is read-fresh-then-act so a second STOP or the dispatcher's own release is a no-op rather than a thrown error. The dispatcher's own `startRun`/`releaseJob` calls in `apply()` are now wrapped too, so an in-flight paste that loses the race to STOP's requeue fails quietly instead of throwing an unhandled rejection. Tests: `STOP requeues the job a dispatched lane held, even though the lane port never reports an exit` and `STOP requeues a claimed-but-not-yet-running job too` (BrainService). Limits (independent review, 2026-09-14): only `claimed` and `running` are requeued, by design — a `verifying` job's lane has already called `complete_job` and its gates die with the supervisor (a surviving process is R14); the requeue resets the attempt budget as a manual requeue does, and history shows a `failed` step with the STOP reason; a paste already in flight when STOP lands still reaches the stopping lane's terminal, which may act on it until the kill arrives, but cannot complete the released job (ownership check), so at worst the same job is briefly worked in two worktrees | SEC-30 |
| T43 | `resolveRunCwd` (SEC-31) refused a cwd that was exactly equal to an allowed root, on purpose: `ExecRunSupervisor`'s `allowedRoots` is `[...laneWorktrees(), checkoutRoot]`, and `checkoutRoot` is a single directory holding *several* review checkouts, so accepting an exact match there would let a run whose cwd is denied everywhere else reach every checkout under it. But that same blanket refusal also caught the *legitimate* case: an unattended job's cwd is its own lane's worktree root — a single-run, single-owner directory — and every unattended run hit it, failing before the agent even spawned (an e2e gap that shipped no working unattended runs at all) | H | H | **Fixed 2026-09-14:** `resolveRunCwd` takes a new `exactRootsAllowed` list; an exact-root match is accepted only for a root named there, still realpath-compared and still refused for a symlinked root. `ExecRunSupervisor` gained the matching `exactRootsAllowed` option, and `create-ninebrains-services.ts` wires it to `laneWorktrees` alone — `checkoutRoot` is never listed, so it still refuses an exact match there, and everywhere else (outside every root, `..` escapes, symlink escapes) is unchanged. The tests gate's `resolveGateCwd` had already carried its own copy of this exact-match-unless-denied rule; it now delegates to the same `resolveRunCwd` option instead of duplicating the logic. Tests: `run-paths.test.ts` (`T43 exactRootsAllowed`: allowed exact lane root, refused shared/checkout root even when listed alongside an allowed one, refused sibling never listed, refused escape), `run-supervisor.test.ts` (`T43` end-to-end through the supervisor: refused by default, allowed once wired, still refused for a shared root), `run-command.test.ts`'s existing exact-root coverage now exercises the shared path | SEC-31 |
| T44 | Four places call `signalGroup` (`process-group.ts`) to SIGTERM/SIGKILL a run's process group: the post-close reap (`run-supervisor.ts`'s `close` handler, ~478) and the three signals inside `terminateGroup` (initial SIGTERM, the grace-period SIGKILL escalation, and the final "finish the job" SIGKILL) — the last three fired by STOP (`killAll`), `cancel()`, and the wall-clock timeout. Under load, the OS can recycle a pid — and so the process-group id, which equals the leader's own pid — between the leader exiting and one of these signals, so `process.kill(-pid, …)` can throw `EPERM` against a group we never started. Each of these four calls sat in a context where a thrown exception broke a caller invariant: the reap's throw happened *before* `resolve(result)` in the `close` handler, so the run's promise never settled; the three STOP-path signals were called fire-and-forget (`void`, or from a `setTimeout`), so a throw there would have surfaced only as an unhandled rejection nobody was positioned to catch | M | H | **Fixed 2026-09-14, in two layers.** (1) `signalGroup` itself treats `EPERM` the same as `ESRCH` — neither throws — because Ninebrains' sandboxes (bubblewrap on Linux, `sandbox-exec` on macOS) never change the sandboxed process's uid: a process we actually still own always accepts our signal, so `EPERM` on `-pid` can only mean the pgid no longer refers to anything of ours, exactly like `ESRCH`. (2) Every one of the four call sites is also wrapped so *any other* exception can't break its caller's invariant, and — unlike ESRCH/EPERM, which are expected and stay silent — is recorded rather than dropped: the reap and the three STOP-path signals against an `ExecRunSupervisor` run all route through that run's own transcript (`security`/`signal-failed`) and its result's `errors`, and are emitted live as `{ type: 'security', kind: 'signal-failed' }`. The two call sites outside any run — `ProcessGroupRegistry.killAll` (tests-gate commands, review-checkout git, `terminateGroup`'s own SIGTERM/SIGKILL escalation for them) — have no run or result to attach a report to, so they keep their pre-existing behavior: `trySignalGroup` still logs every failure to the console and never throws, but nothing more durable records it. `terminateGroup` and `ProcessGroupRegistry.killAll` both grew an optional `onSignalFailure` callback so a caller that *does* have somewhere better to put a failure can opt in, without changing either function's return shape. The report hook is guarded as well: if an `onSignalFailure` callback itself throws, `trySignalGroup` catches and logs that too, so a caller's broken hook cannot stop STOP's `killAll` loop early, crash the main process from the grace-period `setTimeout`, or reject the final SIGKILL (`process-group.test.ts`; without the guard it fails with a rejected promise and an unhandled throw). Tests (`run-supervisor.test.ts`, `SEC-30 kill switch`): a stubbed `process.kill` throws once on the process-group form of a call only (every other call, including the tests' own liveness checks, reaches the real syscall, so nothing is left running afterward) — `EPERM` on the reap resolves the run `completed` with no reported error, exactly like `ESRCH` always has; a non-tolerated code (`EIO`) on the reap still resolves the run and is reported in its `errors`; and `EIO` on one of `killAll`'s own STOP-path signals still lets `killAll` complete, every run still ends `killed`, `stopLatched` stays `true`, and the failure appears in that run's `errors` and as an emitted `security` event. **Two things this fix does not do, named rather than fixed here:** it does not re-verify that a group is actually dead after SIGKILL — every signal here is fire-and-forget by design (pre-existing, not new) — and it does not close the pid-reuse race itself (R14: "killing a reused pid is worse"). If the recycled id has, by the time we signal it, become the process-group id of an unrelated group started by the *same* user, `kill(-pgid)` succeeds and signals that group; Ninebrains cannot tell the difference from a pid and a signal result alone. Job-object/cgroup-scoped tracking (R14's own open mitigation) is what would actually close that, not this fix | R14, SEC-30 |
| T45 | Wiring the reviewer pin (T40) opened a new trust boundary: a job, lane, Brain MCP op or worktree file could try to steer a reviewer run onto a model route, either by influencing `ExecRunSpec.routing` (a `worker` field) or by adding a `routing`/`profileId`-shaped option to `spawnReviewer`'s options contract | L | H | **Fixed 2026-09-15:** the reviewer route is a separate `ExecRunSpec` field, `reviewerRoute`, set only by `gates/node/capabilities/spawn-reviewer.ts` from `reviewer-route.ts`'s app-setting lookup. `ExecRunSupervisor.launch` refuses outright (before spawn) a `reviewer`-preset spec that also carries `routing`, and a non-`reviewer`-preset spec that carries `reviewerRoute` — neither is silently ignored. `SpawnReviewerOptions` (the only shape a gate can pass) has no routing-shaped field at all, and `assertSupportedOptions` rejects any unknown key at runtime, including one added by a hostile caller bypassing the type. Tests: `run-supervisor-routing.test.ts`'s `SEC-42 a reviewer route is a separate field from a worker route` suite, `spawn-reviewer.test.ts`'s `cannot honour option "routing"` case | SEC-42 |
| T46 | The new `agentCliStatus` panel (`docs/plans/2026-09-15-routing-usability.md` item 1) echoes a role's assigned profile label and tier, and a blocked reviewer's reason string, to the renderer for the first time — new information-disclosure surface, even though it's the user's own configuration | L | L | It reflects the same profile list already visible via `listProfiles`, and reports only which existing SEC-42-checked decision applies — the same `resolveRoute` call launch-time routing already runs, never a key, and never a health/error detail beyond the same reason string `resolveRoute` already produces for the UI's fallback banners. Mitigated by reuse, not new code: `installed`/`path` come from the same `hostDependencies.resolver` call already made for the reviewer's `installed` set (D5: no new probing, no credential file read). Tests: `routing-service.test.ts`'s `agentCliStatus` suite | SEC-42, SEC-44 |

## 5. Requirements

Owners: **EP** Brain endpoint + brain-mcp (Phase 2, 2.2) · **LC** launch config (2.3) · **DI**
dispatcher + exec (2.4) · **GA** gates (Phase 4) · **BR** lane browser/CDP (4.2) · **PK** packs
(Phase 5) · **ON** overnight (Phase 6) · **UP** updater/release (Phase 7). Test names are the
`describe` titles to use, so a grep for the SEC ID finds the proof.

### Brain endpoint and brain-mcp (EP, Phase 2)

- **SEC-01 Main is the only DB opener.** brain-mcp never imports `SqliteBrainStore` or opens
  `brain.sqlite`. It forwards every tool call to the main endpoint over HTTP. The DB directory is
  `0700`, the file `0600`, and it is on every lane's deny-read list (SEC-11).
  Test `SEC-01 brain-mcp has no DB access`: dependency-graph check that `packages/brain-mcp` does not
  import the store, plus a stdio test where `NINEBRAINS_BRAIN_DB` is unset and all tools still work.
- **SEC-02 Identity comes from the token alone.** Main keeps `token → { role, laneId|brainId,
  projectId, runId }`. Lane or role values in env, headers or tool arguments are ignored. The
  `brain` role exists only for tokens minted for a Brain session.
  Test `SEC-02 lane token cannot act as brain or another lane`: lane-A token with
  `NINEBRAINS_ROLE=brain` calling `create_job` → FORBIDDEN; lane-A token completing lane-B's job →
  FORBIDDEN; a spoofed `X-Lane-Id` header has no effect.
- **SEC-03 Tokens.** 32 bytes from `crypto.randomBytes`, base64url. One per launch, revoked when the
  lane stops, relaunches or its run ends. Compare SHA-256 digests with `crypto.timingSafeEqual`
  (fixed length, no throw on a length mismatch). Tokens never appear in logs, URLs or transcripts.
  Test `SEC-03 token lifecycle`: revoked token → 401; wrong-length token → 401, no exception; log
  capture contains no token.
- **SEC-04 Loopback only.** `listen(0, '127.0.0.1')`. Never `0.0.0.0`, `::` or `localhost`
  (which may resolve to `::1` and a different stack).
  Test `SEC-04 endpoint binds loopback`: `server.address()` is `127.0.0.1` with a non-zero port.
- **SEC-05 Browsers can't reach it.** Accept only `POST` with `Content-Type: application/json`
  exactly and `Authorization: Bearer <token>`. Reject (`421`) any `Host` other than
  `127.0.0.1:<port>` (DNS rebinding). Reject (`403`) any request carrying `Origin`, `Referer` or
  `Sec-Fetch-Site`; brain-mcp's Node client sends none of them. Never emit CORS headers and answer
  `OPTIONS` with 405.
  Test `SEC-05 browser origin rejected`: from an offscreen `BrowserWindow` on a lane partition, a
  `no-cors` `text/plain` POST and a JSON POST both leave the DB unchanged; `Host: evil.test` → 421.
- **SEC-06 Limits.** Body ≤ 64 KiB (reject before buffering by `Content-Length`, and abort
  streaming bodies at the cap). 5 s header/body timeout. Per token: 20 req/s, burst 60, then 429.
  ≤ 64 concurrent connections.
  Test `SEC-06 endpoint limits`: 300 KiB body → 413 without a full read; 100 rapid calls → 429s;
  a slow-loris client is cut at 5 s.
- **SEC-07 Boundary validation.** Every tool input is zod-validated in main (brain-mcp's own checks
  are UX only). Error text returned to agents carries a code and a message, never a stack, file
  path or SQL.
  Test `SEC-07 errors do not leak internals`.
- **SEC-08 Gate floor.** A job's effective gates are `union(rigorDefault(project, kind),
  requested)`. Neither a lane nor a Brain session can remove or weaken a gate. Only the user, in the
  UI, lowers rigor.
  Test `SEC-08 caller cannot drop gates`: `create_job({ gates: [] })` at testing rigor 7 still gets
  `reviewer`; no job created by an agent is `unverified` above rigor 0.
  The job's kind (`gateKind`, stored as `gateSpec.kind`) feeds the floor, so it is part of the
  rule: an agent (a Brain session or lane token) may declare only `code` or `ui`, whose floors hold
  everything `code` requires. `research`, `seo` and `docs` have weaker floors and are refused with
  FORBIDDEN, never coerced. The app's own identities (the UI's `createJob`, the planner canvas) may
  set any kind; a Brain-written planner draft that declares a weaker kind is refused.
  Tests `SEC-08 agents cannot declare a weaker kind` (brain and lane tokens, each weaker kind →
  FORBIDDEN) and `SEC-08 ui kind adds the screenshot floor`.
  **Extended 2026-09-13 (W7 testsgate-prefs):** the project rigor override and the tests-gate
  sandbox opt-outs (`testsGate.allowNetwork`, `testsGate.allowUnsandboxed`, R11/R12) are the same
  boundary. They live in the gates project-prefs memento behind `setProjectSettings`, a Settings →
  Gates wire-rpc op (`apps/emdash-desktop/.../gates/api/contract.ts`) registered only in the
  renderer controller manifest (`manifests/shared/domain-contracts.ts`,
  `manifests/node/controllers.ts`); it has no counterpart in brain-core's `BrainOp` vocabulary
  (`LANE_OPS`/`BRAIN_OPS`/`SESSION_OPS`, `packages/brain-core/src/protocol/ops.ts`), so no lane or
  Brain token can reach it, structurally, not by a runtime check. Both flags default to false; the
  UI shows a destructive-toned warning next to each toggle before it can be turned on. The rigor
  override is a single 0-10 level applied to both the testing and security sliders together (the
  independent per-slider override the store already supported stays reachable programmatically,
  just not from this UI). `createRunCommand`'s `projectSettings` hook now reads the running
  project's prefs through `RigorResolver.testsGateSettingsFor`, resolved from the job's lane
  worktree, not from a job record.
  Test `SEC-08: agent identities cannot reach this service` (`project-prefs-service.test.ts`) pins
  that the three project-prefs ops have no `BrainOp` counterpart.
  **Fixed 2026-09-13 (independent security review):** `gatesProjectPrefsSchema` stayed at version
  '1' when the two flags were added, only as `.default(false)` on the schema. `VersionedSchema`
  only validates a resolved version's own schema in dev (`versioned-schema.ts`); a v1 row already
  at the latest version takes a fast path with no schema validation at all in production, so a
  memento stored before this change would read back with both flags `undefined`, not `false`
  (never exploited — every consumer checks `=== true`/`!== true` strictly). Fixed by bumping the
  memento to version '2' with a real `up()` migration that sets both fields explicitly
  (`gates/contributions/mementos.ts`); a v1 row is then never "already at the latest version", so
  the migration runs in dev and production alike, independent of `isDevMode()`.
  Test `SEC-08: a legacy v1 row reads with both flags strictly false in production`
  (`gates/node/rigor/project-prefs-schema.test.ts`), run with `NODE_ENV=production`.
- **SEC-09 Messages are data.** `read_inbox` returns JSON with `from` on every message; the dispatcher
  never concatenates inbox bodies into a lane's instructions. Messages from lanes to a Brain are
  marked `untrusted: true`.
  Test `SEC-09 inbox is structured`.

### Launch config (LC, Phase 2)

- **SEC-10 Per-lane config files.** `<userData>/ninebrains/lanes/<laneId>/` is created `0700`;
  `mcp.json` is created with mode `0600` at `open()` (`wx` flag, not a later `chmod`), deleted on lane
  exit, and orphans are swept at boot. The lane token and pack secrets go only in that server entry's
  `env`, never in the PTY env. On Windows, restrict the ACL to the current user.
  Test `SEC-10 lane config files`: mode bits, deletion on exit, and a PTY env snapshot without
  `NINEBRAINS_TOKEN`.
- **SEC-11 Lane sandbox on by default.** Claude lanes launch with a `--settings` JSON that enables the
  Claude Code sandbox and denies Read/Edit/Bash access to `<userData>/ninebrains/**` (except its own
  lane dir, if the CLI needs it), other lanes' worktrees, `~/.ssh`, `~/.aws`, `~/.config/gcloud`,
  `~/.codex`, and the provider credential files. The exact settings keys are recorded in SEAMS §4
  (spike 0.3). Brain-dispatched and unattended runs add `--strict-mcp-config`. Codex lanes use
  `--sandbox workspace-write`. Codex can't deny reads, so see accepted risk R2. A user can turn the
  sandbox off per project, with a persistent warning badge on the lane.
  Test `SEC-11 lane cannot read siblings`: fake-agent in lane A runs `cat` on lane B's `mcp.json` and
  `sqlite3` on the Brain DB → both denied (Claude). Manual e2e with the real CLI before release.
- **SEC-12 No permission bypass, ever, by default.** No launch builder may emit
  `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`,
  `--permission-mode bypassPermissions`, Codex `--dangerously-bypass-approvals-and-sandbox` or
  `--sandbox danger-full-access`. Brain-created conversations pass `autoApprove: false` to upstream.
  Test `SEC-12 launch argv guard`: snapshot every builder (attended, unattended, reviewer, brain) and
  assert none of the flags appear; the same assertion runs inside the spawn wrapper at runtime and
  throws.
- **SEC-13 Environment.** Attended lanes use upstream `buildAllowlistedAgentEnv`. Unattended and
  reviewer runs use a **narrower** allowlist: provider auth (`ANTHROPIC_API_KEY` only when the user
  chose API-key mode, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`), `PATH`, locale, `HOME`, `TMPDIR` and proxy
  variables. The upstream list's `GITHUB_TOKEN`, `GH_TOKEN`, `AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS`
  and third-party model keys are dropped.
  Test `SEC-13 unattended env is minimal`: snapshot of the unattended env with a polluted parent env.
- **SEC-14 IDs are safe path segments.** Any ID used in a path (laneId, jobId, brainId, projectId,
  planNodeId) matches `^[A-Za-z0-9_-]{1,64}$`. The shared regex `^[A-Za-z0-9._:-]{1,128}$` allows
  `.`, `..` and `:` (NTFS streams) and must not reach a path builder. Paths are built only through one
  `laneDir(id)` / `evidenceDir(id)` helper that re-validates and checks the realpath.
  Test `SEC-14 ids cannot traverse`: `..`, `.`, `a:b`, `a/b` and 65-character IDs throw.

### Dispatcher and exec (DI, Phase 2)

- **SEC-15 Safe paste.** Paste only when the lane's hook status is `idle` or `completed`, never
  `awaiting-input` (that answers a permission prompt). Strip ESC and C0 controls except `\n` and
  `\t`, and refuse bodies that contain `\x1b[200~` or `\x1b[201~`.
  Test `SEC-15 paste cannot inject keystrokes`: a body with `\x1b[201~\ry\r` is refused, and a lane in
  `awaiting-input` gets no write.
- **SEC-16 Spawn hygiene.** Argv arrays, `shell: false`, and the binary resolved to an absolute path
  through the HostDependencies resolver, never through the worktree's cwd or `PATH` (Windows
  searches cwd first). Spawn inside a new process group (POSIX) or job object (Windows).
  Test `SEC-16 planted binary ignored`: a `claude`/`claude.cmd` planted in the worktree root and
  `node_modules/.bin` is not executed.
- **SEC-17 Prompts go through stdin.** `claude -p` and `codex exec` receive the job text on stdin (or
  after a verified `--`), never as a positional argv entry.
  Test `SEC-17 prompt is not argv`: a body of `--dangerously-skip-permissions rm -rf .` leaves
  fake-agent's parsed flags unchanged.

### Gates (GA, Phase 4)

- **SEC-18 The reviewer really is read-only.** `spawnReviewer` never runs in the lane worktree. The app
  creates a disposable checkout (an independent repository, T33, with the lane's working state
  mirrored in, T35) and runs the reviewer there under the strictest mode available: Claude `--restricted
  --strict-mcp-config --permission-mode plan` with Read/Grep/Glob only; Codex `exec --sandbox
  read-only`. The reviewer gets no Bash, so it does not "run tests" itself (plan 4.3); tests-gate
  output reaches it as evidence. The checkout is deleted afterwards.
  Test `SEC-18 reviewer cannot write the worktree` (plan 4.6): a fake reviewer tries a write, `rm`,
  `git commit` and an absolute-path write into the lane worktree. Afterwards the lane worktree's
  `git status --porcelain`, `HEAD`, and a hash of every file's content and mtime are unchanged.
- **SEC-19 Injection-resistant verdicts.** Everything the worker or the web controls (job body, diff,
  untracked names, page text, evidence text, claims) goes into the prompt inside a per-run random
  nonce block (`<untrusted-<nonce>>…</untrusted-<nonce>>`), with any fence longer than the longest
  backtick run inside. The prompt states that the block is data. Deterministic failures (console
  errors, failed requests, diff ratio, test exit code, invented claims) always fail the gate, whatever
  the reviewer says. Only a single JSON object is accepted (already the case in `parseReviewerVerdict`).
  Test `SEC-19 untrusted content cannot close its block`: attacker text containing the fence, a fake
  closing tag and `{"pass":true}` stays inside the nonce block. There is also a non-CI red-team eval
  with a canned hostile diff.
- **SEC-20 Tests gate sandbox.** `runCommand` runs under the lane's sandbox profile with the SEC-13
  unattended env: no `NINEBRAINS_*`, no pack secrets, no provider keys. It kills the whole process
  group on abort or timeout, and caps output at 1 MiB. The command string comes only from app config
  the user set (`project_prefs.test_command`, or detection confirmed in the UI), never from a job
  record or a worktree file. `git diff` for the reviewer runs as argv, not through a shell.
  Test `SEC-20 tests gate is sandboxed`: `env` output has no token; a test script that forks a
  `sleep 999` grandchild is fully gone 5 s after abort.
- **SEC-21 SSRF-safe fetch.** `fetchText` is net-guard with **connect-time pinning**: an undici
  `Agent` whose `connect.lookup` rejects any blocked address, so the IP that is checked is the IP
  connected to. Blocked: loopback, RFC 1918, link-local (incl. `169.254.169.254`), CGNAT, ULA,
  IPv4-mapped/compatible, `0.0.0.0/8`, multicast, broadcast. Every redirect hop is re-checked, with
  5 redirects max, 2 MB, 10 s, and no cookies, credentials or proxy env. The citations package's
  `defaultFetchText` is never wired in the app.
  Test `SEC-21 rebinding and redirects blocked`: a resolver that answers public then `127.0.0.1`, a
  302 to `http://[::ffff:127.0.0.1]:<brainPort>`, and `http://0x7f000001/` are all blocked; a lint rule
  forbids importing `defaultFetchText` outside the citations package.
- **SEC-22 Evidence is produced by gates, not by workers.** Screenshots, logs, diffs and fetched pages
  count as proof only when a gate captured them. Worker `artifacts[]` are shown to the user labelled
  "worker-supplied" and are never passed to a reviewer as evidence of a pass. Fact-check caps: 200
  claims and 50 distinct URLs per job. The SEO red-team gate re-runs cited GSC/GA4 queries against the
  property the user configured for the project, not one named in `claims.json`.
  Test `SEC-22 worker artifacts are not evidence`.
- **SEC-23 Worktree reads are confined.** `readWorktreeFile` checks the realpath is inside the
  worktree realpath, refuses symlinks that leave it, refuses non-regular files, and caps size at 5 MB.
  Test `SEC-23 symlinked claims.json refused`: `claims.json → ~/.ssh/id_ed25519` fails with no content
  echoed in the feedback.
- **SEC-24 Evidence store hygiene.** Root `<userData>/ninebrains/evidence`, dirs `0700`, files `0600`,
  never inside a worktree. IDs per SEC-14 (the store rejects `..` today but still allows `:`). Every
  text artifact passes through the SEC-35 redactor before write. Retention: 30 days by default
  (setting), deletion on project delete, and a "delete evidence" action per job. The screenshot gate
  captures only the lane's own preview origin, so it never captures a logged-in third-party site.
  Test `SEC-24 evidence retention and redaction`.

### Lane browser and CDP (BR, Phase 4)

- **SEC-25 CDP is scoped to one lane's webview.** The gate host attaches `webContents.debugger` only to
  a `webContents` found through `BrowserWebContentsRegistry` for that lane's `browserId`, whose
  partition is that lane's partition. Never to the app window, DevTools, or another lane. Brain lanes
  get a dedicated **ephemeral per-lane partition** (not a persisted profile shared with the user's
  logged-in browsing). Verify how upstream "browser-profile partitions" are shared. The agent-facing
  `browser.*` MCP may evaluate JS only on the lane's preview origin and may not navigate to `file:`,
  `devtools:` or `chrome:`. Downloads are blocked in lane partitions. The upstream
  `hardenBrowserWebviewPreferences` stays in force.
  Test `SEC-25 CDP scope`: attach by the main window's id → refused; lane B's token cannot drive lane
  A's browser; `browser.eval` on a non-preview origin → refused.

### Packs (PK, Phase 5)

- **SEC-26 Pinned supply chain.** `pack.json` names each MCP server by exact version plus integrity
  hash. No ranges, no `latest`, no `npx -y pkg`. The app installs servers into an app-owned directory
  with `--ignore-scripts` and verifies integrity before launch. Only bundled packs exist in v0.1.
  Test `SEC-26 pack pinning`: the schema rejects `^1.0.0`, `latest` and a missing integrity; a tampered
  tarball fails to load.
- **SEC-27 Secrets in the OS keychain.** Pack secrets are stored with Electron `safeStorage`. If
  `isEncryptionAvailable()` is false or the Linux backend is `basic_text`, the app refuses to store
  and says why; it never falls back to plaintext. Secrets are decrypted only when a lane's `mcp.json`
  is written (SEC-10), and never enter PTY env, logs, transcripts or evidence.
  Test `SEC-27 no plaintext secrets`: the settings DB and `userData` contain no secret bytes; a
  `basic_text` backend → refusal.
- **SEC-28 Tool poisoning.** When a pack is enabled, the user sees each server's tool names and
  descriptions. The app stores a hash of the tool list; if it changes later, the server is excluded
  from the next launch until the user re-approves. Server names `brain`, `ninebrains*` and any bundled
  name are reserved. Outbound-class servers (deploy, DNS, payments, email, git push) are tagged in
  `pack.json` and excluded from unattended runs unless SEC-32 allows them.
  Test `SEC-28 rug pull and shadowing`: a changed description hash → server absent from the next
  `mcp.json`; a pack that declares `brain` is rejected.

### Unattended runs (ON, Phase 6)

- **SEC-29 Budgets.** Each run has a wall clock, max turns, `--max-budget-usd` (Claude `-p`), a token
  budget from stream-json `usage`, and a global cap on concurrent runs. The run supervisor in main
  enforces them, not the agent. Counters live in the Brain DB, so a restart doesn't reset them
  (remediation §6.4).
  Test `SEC-29 budgets survive restart`: exceed each limit with fake-agent; restart mid-run and check
  the counters.
- **SEC-30 STOP in under 5 s.** A global STOP (tray, menu and shortcut, all working while the renderer
  is hung) blocks new dispatch, sends SIGTERM to every Brain-owned process group, and sends SIGKILL at
  2 s. On Windows it uses job objects or `taskkill /T /F`. It also stops Brain-owned PTY lanes with
  `tuiAgents.stop`. It stays latched until cleared.
  Test `SEC-30 kill switch`: 8 runs with grandchildren that ignore SIGTERM → zero live descendants at
  5 s; the dispatcher refuses work while latched.
- **SEC-31 Scope guard.** Unattended claude runs use `--permission-mode dontAsk --permission-prompts
  none`, `--allowedTools` from a preset, the SEC-11 sandbox and `--strict-mcp-config`, with cwd set to
  the worktree realpath and no `--add-dir` outside it. Codex runs use `--sandbox workspace-write` with
  approvals `never`. The worktree path is validated against the project's worktree root before spawn
  (remediation Control #2: fail closed, no `process.cwd()` fallback).
  Test `SEC-31 unattended scope`: argv snapshot; a worktree path outside the root or a symlinked root
  → spawn refused.
- **SEC-32 Outbound actions need a per-plan allowlist.** Deploy, DNS, payments, email, `git push`,
  package publish and cloud CLIs are denied by default. That is enforced by **absence**, not by regex:
  the unattended env has no credentials for those services (SEC-13), sandbox network egress is limited
  to the provider API plus an allowlist, and outbound-class MCP servers are excluded (SEC-28). A plan
  may name allowed outbound capabilities. The user approves them in the UI (TB1) at plan start, and
  the approval is logged (SEC-33). A Brain session cannot grant or widen them.
  `Bash(git push:*)`-style deny rules are extra, never the control.
  Test `SEC-32 outbound denied by default`: an unattended env and `mcp.json` without approval contain
  no `VERCEL_TOKEN`, `GITHUB_TOKEN`, `STRIPE_*` or outbound servers; `create_job` from a Brain token
  cannot add an outbound grant.
- **SEC-33 Durable security log.** An append-only `security_events` table records, per run: redacted
  argv, env variable **names**, sandbox profile, denied tool calls, budget use, outbound approvals,
  STOP events, rejected endpoint requests (401/403/421/429) and gate overrides. The morning digest
  summarizes it.
  Test `SEC-33 events recorded`.

### Credentials, redaction, release (all phases)

- **SEC-34 D5: never read provider credentials.** The account meter uses `claude auth status` and
  `codex login status` only (upstream `claudeAuthStatus` already does). No Ninebrains code opens
  `.credentials.json`, `~/.codex/auth.json` or Keychain provider items. A `CLAUDE_CONFIG_DIR` must be
  absolute and user-chosen, and is never copied, moved, symlinked or written by the app. Moving a lane
  between accounts is a relaunch with a different env.
  Test `SEC-34 no credential reads`: an `fs` spy over the lanes/brain/gates/packs test suites sees no
  open of those paths.
- **SEC-35 Redaction.** One redactor runs over transcripts (stream-json), logs, evidence text, gate
  feedback and crash output before anything is written or shown. It covers `sk-ant-…`, `sk-…`, `ghp_`
  / `github_pat_`, `AKIA…`, `xox[bap]-`, `-----BEGIN … PRIVATE KEY-----`, JWTs, `Bearer …`, live
  Ninebrains tokens, and the values of all pack secrets.
  Test `SEC-35 redactor`: a fixture transcript with each pattern is stored redacted.
- **SEC-36 Updater off until signing exists.** Unsigned builds compile the updater out: no
  `app-update.yml`, no `checkForUpdates` timer, and `autoInstallOnAppQuit` unreachable. The publish
  owner must never be `generalaction` (upstream's feed). The updater is re-enabled only with signed
  builds (plan 7.1) and signature verification on.
  Test `SEC-36 updater disabled`: a packaged-build smoke test sees no updater network call; a config
  test rejects an upstream publish owner.
- **SEC-37 Release integrity.** CI builds releases from a tag, publishes `SHA256SUMS` as an asset and
  in the release notes, and attaches GitHub build-provenance attestations. The README documents
  `shasum -a 256 -c` and `gh attestation verify`.
  Test `SEC-37 release sums`: the release workflow re-verifies sums before publishing.
- **SEC-38 Telemetry off, nothing leaves.** The default preference is **off**, even in a build that
  somehow has a key. No PostHog key or host is compiled in, and no crash reporter is on.
  Test `SEC-38 no egress on first run`: a network interceptor during first run and a 4-lane session
  sees only user-initiated traffic.

### Model routing (RT, `features/routing`, plan 2026-09-12)

- **SEC-39 Subscription runs are never routed to another host.** A launch on the user's own login
  carries no `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, alias variable
  (`ANTHROPIC_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`, `ANTHROPIC_DEFAULT_*_MODEL`) or Codex
  `model_provider(s)` override or `--profile`. `CLAUDE_CODE_SUBAGENT_MODEL` may carry a Claude
  alias or `claude-*` id (Lever A), nothing else. `routing/api/node/launch-env.ts` (`routeLaunch`,
  `assertLaunchPolicy`) is the one policy; `buildLaneLaunch` (attended lanes, Brain sessions) and
  `ExecRunSupervisor.launch` (unattended claude and codex, reviewers) both call it. Attended env is
  layered over the shell, so each variable is set to `''` (the CLI treats empty as unset); the
  same blanks go in our `--settings` `env` block.
  Tests `SEC-39 subscription runs carry no routing` (`launch-env.test.ts`, and
  `routing-launch.e2e.test.ts` for every builder), `SEC-39 profile routes`.
- **SEC-40 Keys stay in the keychain.** `ninebrains.model.<id>` in the safeStorage store (SEC-27 rules),
  decrypted by `keys.ts` `reveal` for one launch or one Test connection, taken once from the
  Brain's prepared-route map, and put only in that spawn's env (never in `--settings`, argv,
  a file, the Brain DB, logs or the renderer). Every revealed value is registered with the
  redactor, including redactors built earlier. The contract has no procedure that returns a key.
  Tests `SEC-40 keys are write-only` (`routing-service.test.ts`), `SEC-40 no key bytes in the Brain DB`
  (`profiles-repo.db.test.ts`), `R3 a profile run reaches only its host, with only its key (SEC-40)`.
- **SEC-41 The active credential is checked at run start.** The CLI applies settings-file `env`
  over the process env. Our `--settings` outranks user/project/local settings; managed settings
  outrank it, so a gateway variable there refuses the launch (attended and unattended). For
  unattended claude, the supervisor reads `apiKeySource` and `model` from `system/init` and kills
  the run (`credential-mismatch`, a `security` event, logged until SEC-33) on a mismatch.
  `ANTHROPIC_AUTH_TOKEN` reports `none` like a login (spike §13 Q1), so a token profile is told
  apart by the model it must report. Codex has no such event: not enforceable at run time.
  Tests `SEC-41 the active credential is checked at run start`, `SEC-41 managed settings`.
- **SEC-42 Reviewers are never downgraded.** Wave 2, wired 2026-09-15. The default stays the
  subscription with no setup: `reviewer-route.ts`'s `routeReviewer` returns `{ provider: 'claude' }`
  unless the app's `ninebrains.routing` setting (Settings → Models, one profile picker next to the
  profile list) names a pinned profile. When it does, `routing/node/routing-service.ts`'s
  `prepareReviewerRoute` calls `routing/node/policy.ts`'s `resolveRoute('reviewer', { explicitProfileId, … })`,
  which blocks — never a pass, never a lower tier, never the subscription — once the pinned profile
  is missing, disabled, keyless or has an open circuit breaker (R6's states, read as healthy until
  R6 starts writing them). The route reaches the run through `ExecRunSpec.reviewerRoute`, a field
  distinct from `routing` (workers only) that only `spawn-reviewer.ts` sets (T45); the supervisor
  refuses a spec that mixes the two. Off in a release build (`MODEL_PROFILES_ENABLED`): the setting
  is hidden and ignored, reviewers always run on the subscription there.
- **SEC-43 Budgets are in USD and computed by us.** Wave 2 (R5), partial. `routing/api/node/price.ts`
  has `usd()` (usage × the profile's own price), `checkBudget()` (a projected spend over its cap
  refuses, never downgrades) and `refusesUnpriced()`. Prices are stored, nullable. Not wired into
  a real run: no `run_costs`/`spend_caps` tables, no `maxUsd` check in the supervisor.
- **SEC-44 Allowed credential kinds and vendors only.** Kinds are `anthropic-api`, `openai-api`,
  `anthropic-compatible`, `openai-responses-compatible`, `local` (and `bedrock`/`vertex`/`foundry`,
  refused until wave 2). No OAuth, cookie, session or token-file kind exists. A remote profile's
  host must be on its vendor's `node/vendors.json` entry (R0 SAFE list plus first-party APIs);
  `local` must be loopback; claude.ai and chatgpt.com hosts are always refused. Checked on save,
  on every DB read (a hand-edited row is skipped) and at launch.
  Tests `SEC-44 allowed credential kinds and vendors`, `SEC-44 vendor allowlist`.
- **SEC-45 Egress follows the profile.** A profile run's sandbox egress is the plan allowlist plus
  the profile's API host, and profile runs set `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, which
  stops the CLI's own calls to api.anthropic.com (spike §13). Loopback can't be narrowed to one
  port in the sandbox's domain list. Test `SEC-45` assertions in `routing-launch.e2e.test.ts`.
- **SEC-46 No gateway without hardening.** Wave 1 starts no gateway; R8 is a separate decision.
- **SEC-12 update (deliberate).** Codex route values (`model_providers.nb={…}`, `model_provider="nb"`,
  `model=…`) are generated by `routeLaunch` and passed to the argv guard as `trusted`, like the MCP
  overrides. A user's own `-c`/`--config` stays refused.
- **SEC-13 update (deliberate).** The unattended allowlist gains the routing variables, and only
  from the route, never from the parent env: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`,
  `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL`, `NB_MODEL_KEY`, and the two exempt `CLAUDE_CODE_*`
  names (`CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`). A route's `''`
  removes the variable. Test `SEC-13 routing env comes only from the route`.

## 5a. Status (2026-09-11)

"Done" means the code enforces it and a test named after the ID proves it. "Open" means no
SEC-titled test exists on `main`, which is not proof the control is absent. Owners in brackets are
the agents or slices expected to close the gap.

| ID | Status | Proof and notes |
|---|---|---|
| SEC-01 | Done | brain-mcp `sec-01.test.ts`, `stdio.test.ts` |
| SEC-02 | Done, tightened | `http.test.ts`; `project-scope.test.ts`: L2, a lane token calling a brain-only op gets FORBIDDEN; M3, a brain token acts only inside its grant's project for every op. v0.1 has no global grant (`BrainGrant.global?: false` exists only as a type) |
| SEC-03 | Done | `tokens.test.ts` |
| SEC-04 | Done | `http.test.ts` |
| SEC-05 | Done at the handler | `http.test.ts`. The offscreen-`BrowserWindow` e2e is not written [w5-brain-wiring] |
| SEC-06 | Done, extended | `http.test.ts`; `pre-auth.test.ts` (L3): a failed-auth budget (5/s, burst 20) is checked before any token is resolved |
| SEC-07 | Done | `boundary.test.ts` |
| SEC-08 | Done, extended | `gate-floor.test.ts`; the kind rule: `SEC-08 agents cannot declare a weaker kind` (brain-core `execute.test.ts`), `SEC-08 ui kind adds the screenshot floor` (gates `rigor.test.ts`), and drafts in `planner-service.test.ts` [w7/self-heal-e2e] |
| SEC-09 | Done, extended | `boundary.test.ts`; L1: recipients must exist and share the sender's project (`project-scope.test.ts`); gate feedback is persisted `untrusted` (`gate-feedback.test.ts`) and brain-mcp fences every untrusted body it hands a lane (`fence.test.ts`, `stdio.test.ts`) |
| SEC-10 | Open | Lane config writer [w5-brain-wiring] |
| SEC-11 | Partial | Settings are generated and tested (`sandbox-settings.test.ts`). M4 widened the deny list to one shared list plus all of `<userData>`. T36 adds a write deny on the lane repo's `config`, `config.worktree`, `info/attributes` and `hooks` (`T36` snapshot, `lane-git-paths.test.ts`). **Manual pre-release e2e with the real CLI:** the live read deny, and the T36 write deny. The e2e must check that `git config`, `echo > .git/info/attributes` and a new hook fail from a lane while `git commit` still works, including on Linux for paths that do not exist yet (`info/attributes`, `config.worktree`) |
| SEC-12 | Done for unattended and reviewer runs | `argv-guard.test.ts` (SEC-12 and M2 normalisation). Attended launches must call `assertSafeArgv` on their full argv [w5-brain-wiring] |
| SEC-13 | Done | `run-env.test.ts` |
| SEC-14 | Done | `ids.test.ts`, `run-paths.test.ts`; the evidence store now uses the same rule (`evidence-hygiene.test.ts`) |
| SEC-15 | Open | Dispatcher paste [w5-brain-wiring] |
| SEC-16 | Done | `argv-guard.test.ts`, `run-command.test.ts` |
| SEC-17 | Done | `run-supervisor.test.ts` |
| SEC-18 | Done | `spawn-reviewer.test.ts`, `reviewer-gate.test.ts`, `review-checkout.test.ts`: T31 (the reviewer's `git diff` blanks every repo filter driver), T32 (no lazy fetch), T33 (the checkout is its own repository), T35 (the mirror follows no link); `review-root.test.ts` (T34). Needs git 2.44 or later; older git fails closed |
| SEC-19 | Done | gates-core `untrusted.test.ts`, `reviewer-gate.test.ts` |
| SEC-20 | Done on macOS, partial elsewhere | `run-command.test.ts`, `tests-sandbox.test.ts`. Gate-built git calls get `GIT_NO_LAZY_FETCH=1` (T32). macOS seatbelt denies secrets, `<userData>` and non-loopback network, checked with real `sandbox-exec`. Linux bubblewrap argv is tested with a stand-in `bwrap`, not yet on a Linux host. Linux without `bwrap` and Windows refuse the tests gate unless the project opts in (R11) |
| SEC-21 | Done | `fetch-text.test.ts`, `ip-policy.test.ts` |
| SEC-22 | Open | [w5-gates-wiring] |
| SEC-23 | Open | `readWorktreeFile` lives outside exec-runs [w5-gates-wiring] |
| SEC-24 | Partial | `evidence-hygiene.test.ts`: dirs 0700, files 0600, SEC-14 ids, redaction of all text evidence. Retention, deletion on project delete, per-job delete and the screenshot origin rule are open [w5-gates-wiring] |
| SEC-25 | Open | Lane browser/CDP |
| SEC-26 | Open | Exact npx versions without integrity (R10) |
| SEC-27 | Done | Settings → Packs writes pack secrets only through the keychain store, which refuses when safeStorage cannot encrypt (`keychain-secret-resolver.test.ts` › `SEC-27 refuses…`, `packs-secrets.test.ts` › `SEC-27 surfaces…`); values are write-only from the renderer [w7-daily]. A store error reaches the log and the renderer as its first line only, with the value cut out. `sec-27-secrets-at-rest.test.ts` drives the real `EncryptedAppSecretsStore` and a real app database file, with only safeStorage stubbed. The value never appears in plaintext or base64 under `userData`, and Linux `basic_text` writes nothing |
| SEC-28 | Open | No SEC-28 test on `main` |
| SEC-29 | Done in the supervisor | `run-supervisor.test.ts`, `run-budgets.test.ts`: wall clock, tokens, concurrency, counters persisted to the transcript, and restart recovery closing open runs as `killed` (`ExecRunSupervisor.recover()`). Codex per R13. Writing counters into the Brain DB depends on wiring the `finished` events [w5-brain-wiring] |
| SEC-30 | Done for unattended runs, the tests gate, review checkouts and the entry points | `run-supervisor.test.ts`, `run-command.test.ts`, `review-checkout.test.ts` (one `ProcessGroupRegistry` that `killAll()` latches and kills); `stop.test.ts` (dispatched attended PTY lanes, 4.5 s deadline). The app menu (with the STOP accelerator) and the tray call `BrainService.stopAll` in main: `main/host/ninebrains/agent-stop-controls.test.ts` drives a real BrainService from both with no renderer [w7-daily]. Clear STOP keeps a user pause (T37). No lane, Brain or web page can reach STOP or Clear STOP: they are renderer wire procedures and main-process menu items, and brain-mcp and the endpoint have no such op. Nothing dispatches between the latch and the kill: the dispatcher latches first, `killAll` latches the supervisor before its first await, and a run still preparing re-checks the latch before it spawns. PTY lanes the user drives by hand are not stopped (only Brain-dispatched ones). A stopped lane's held job goes back to `ready` deterministically, not on the lane's terminal-exit event (T42); `brain-service.test.ts` covers both a `claimed` and a `running` held job with a fake lane port that never reports an exit, and the e2e suite `stop-halts-lanes.e2e.mjs` covers it end to end. A run's own post-exit reap signal, and every `signalGroup` call `killAll`/the wall-clock timeout make, tolerate a failed signal without leaving the run's promise unsettled or throwing an unhandled rejection (T44) |
| SEC-31 | Done | `run-supervisor.test.ts`, `run-paths.test.ts` (includes T43: a run's cwd may equal a lane worktree root exactly, never the shared checkout root), `run-command.test.ts` (the tests gate's `resolveGateCwd` shares the same rule) |
| SEC-32 | Partial | `run-env.test.ts`: no outbound credentials in the env. The per-plan allowlist UI is open |
| SEC-33 | Open | `security_events` table |
| SEC-34 | Open | No fs-spy test |
| SEC-35 | Partial | Transcript (`redact.test.ts`) and evidence (`evidence-hygiene.test.ts`) redactors. Gate feedback and crash output are not redacted yet |
| SEC-36 | Implemented, not SEC-titled | UPSTREAM-PATCHES §1, `update-service.test.ts`. The packaged-build smoke test is open |
| SEC-37 | Open | Release workflow [w4-release] |
| SEC-38 | Implemented, not SEC-titled | UPSTREAM-PATCHES §1, `telemetry.test.ts`. The first-run egress test is open |
| SEC-39 | Done [w7-routing] | `launch-env.test.ts`, `routing-launch.e2e.test.ts` (attended, Brain session, unattended claude and codex, reviewer). Empty-means-unset checked on claude 2.1.269; the real attended CLI is not e2e-tested |
| SEC-40 | Done [w7-routing] | `routing-service.test.ts`, `profiles-repo.db.test.ts`, `routing-launch.e2e.test.ts` (transcript and settings carry no key). The key is readable by the lane's own tools (R19) |
| SEC-41 | Partial [w7-routing] | `run-supervisor-routing.test.ts`: unattended claude checked at init; managed settings refuse. Attended lanes rely on the `--settings` precedence (spike §13 Q2), with no runtime signal. Codex has none. Security events are logged until SEC-33 |
| SEC-42 | Done [w7/routing-wave2] | Wired end to end 2026-09-15: `reviewer-route.ts`'s `routeReviewer` reads the app's `ninebrains.routing` reviewer-pin setting (default: no pin, subscription, unchanged) and, when pinned, calls `routing-service.ts`'s `prepareReviewerRoute`, which uses `policy.ts`'s `resolveRoute('reviewer', …)` to block — never a lower tier, a different profile or the subscription — once the pinned profile is missing, disabled, keyless or unhealthy. The route reaches the run via `ExecRunSpec.reviewerRoute`, refused by the supervisor on any non-`reviewer` preset or alongside `routing` (T45). Tests: `reviewer-route.test.ts`, `routing-service.test.ts`'s `SEC-42 prepareReviewerRoute` suite, `spawn-reviewer.test.ts`'s `SEC-42` suite, `run-supervisor-routing.test.ts`'s `SEC-42` suite |
| SEC-43 | Partial [w7/routing-wave2] | `api/node/price.ts`: `usd()`, `checkBudget()`, `refusesUnpriced()` and the `SEC-43` suites. Not wired into the supervisor: no `run_costs`/`spend_caps` tables, no `maxUsd` check on a real run, no cost view |
| SEC-44 | Done [w7-routing] | `profile.test.ts`, `vendors.test.ts`, `routing-service.test.ts`, `profiles-repo.db.test.ts` |
| SEC-45 | Done for unattended claude [w7-routing] | `routing-launch.e2e.test.ts`. Attended lanes have no egress list (as today) |
| SEC-46 | N/A in wave 1 | No gateway exists |

## 6. Where the current design already breaks a requirement

Status 2026-09-11: items 1, 4, 5, 6 and 7 are fixed in code (brain-core and gates READMEs). Item 8
has its `argv` option. Item 9: the app's `fetchText` pins at connect time with `node:http(s)`'s
`lookup` (exec-runs README, decision 2) and never uses net-guard's resolver.

1. **brain-mcp opens the DB directly and takes identity from env** (`brain-mcp/src/bin.ts`
   `SqliteBrainStore.open`, `config.ts` `NINEBRAINS_ROLE`). Any lane can run the bin with
   `NINEBRAINS_ROLE=brain`, or write `brain.sqlite` with `sqlite3`. This breaks SEC-01 and SEC-02 and
   contradicts SEAMS §3.6. Fix: brain-mcp becomes the thin HTTP forwarder SEAMS describes, and
   brain-core's authz runs in main.
2. **SEAMS §3.6 says to reuse the hook-server transport as-is.** Upstream `hook-server.ts` compares
   tokens with `!==`, checks no `Host`, accepts 1 MB bodies, and puts its token in the PTY env. Reuse
   the bind pattern only; SEC-03/05/06 apply.
3. **SEAMS §3.7 treats `mcp.json` under userData as private.** It is not private from the lane (§1).
   SEC-11 is what protects it.
4. **The ID regex `^[A-Za-z0-9._:-]{1,128}$`** (brain-core `parseAddress`, brain-mcp `schemas.ts` and
   `config.ts`) admits `..` and `:`. The laneId feeds `lanes/<laneId>/` (SEAMS §3.7). SEC-14.
5. **`create_job` accepts `gates` from the caller** (brain-mcp `schemas.ts`), so an injected Brain can
   ship `unverified` work. SEC-08.
6. **The reviewer runs in the lane worktree** (`reviewer-gate.ts` passes `cwd: ctx.worktreePath`), and
   plan 4.3 asks it to "run tests". Both conflict with SEC-18. The app's `spawnReviewer` must use a
   disposable checkout and must not grant Bash.
7. **The reviewer prompt fences the untrusted diff with plain triple backticks**
   (`reviewer-gate.ts` line 114). A diff containing a fence escapes it. SEC-19.
8. **`runCommand(command: string)` is a shell line.** That is acceptable only under SEC-20's
   provenance rule. An additive `argv?: string[]` option is the cleaner fix and should be used for
   `git diff`.
9. **net-guard does not pin.** `createLiveSafeFetchDeps` resolves with `dns.lookup`, then global
   `fetch` resolves again, so DNS rebinding is still open, whatever its README says. Fix it in
   aeo-toolkit (undici `connect.lookup`) before depending on `@advance-labs/net-guard` 0.2.2. SEC-21.
10. **Upstream defaults to revisit in 0.5:** updater `autoInstallOnAppQuit = true` plus a periodic check
    (SEC-36); telemetry preference defaults to `true` (SEC-38; the key is already nulled); and
    `AGENT_ENV_VARS` passes `GITHUB_TOKEN`, `AWS_*` and others through (fine for attended lanes, too
    broad for SEC-13).

## 7. Accepted risks for v0.1

| ID | Risk | Why accepted | Revisit |
|---|---|---|---|
| R1 | With the sandbox off (user choice), a lane can read sibling tokens and the user's files. | That lane is the user's own shell. The badge makes it visible. | v0.2 default-deny toggle |
| R2 | Codex's sandbox restricts writes, not reads, so a Codex lane, and a Codex worker or reviewer run, can read other lanes' `mcp.json`, `<userData>` and the home secrets on the M4 list. Damage is limited to lane impersonation and secret reads, since gates still run. | No read-deny in Codex. | when Codex adds read policy |
| R3 | Attended lanes use upstream's broad env allowlist. | Matches the user's own terminal. | — |
| R4 | Pack skills install globally to `~/.agentskills` (SEAMS §3.16) and are visible to non-Ninebrains agents. | Bundled skills only, `nb-` prefix. | per-lane config dir |
| R5 | Prompt injection against an attended lane can't be fully prevented. We rely on the provider's permission prompts and the user. | That's the state of the art; we don't claim otherwise. | — |
| R6 | Remote/SSH lanes are unsupported, so there is no remote Brain channel. | v0.1 is local-only (SEAMS §3.6). | v0.2 |
| R7 | Screenshots of the lane's own preview may show seeded or test personal data. | Local only, 30-day retention. | — |
| R8 | Unsigned builds, verified by checksums and attestations only. | No signing spend yet (plan §9 Q4). | 7.1 |
| R9 | Lanes share one OS user, so there is no kernel-level isolation between lanes. | Containers or VMs per lane are out of v0.1 scope. | v0.3 |
| R10 | Pack MCP servers launch with `npx` at an exact version but no integrity check, so a compromised registry or package mirror could serve different code for the same version (SEC-26 not met). | Bundled packs only, pinned exact versions, no `@latest`. App-owned installs with `--ignore-scripts` and an integrity hash are not built yet. | Phase 5 follow-up |
| R11 | A project that sets `testsGate.allowUnsandboxed` runs its tests gate with no OS sandbox on Linux without bubblewrap and on Windows. Lane-controlled scripts then run as the user with only the scrubbed env, the timeout, the group or tree kill and the output cap. They can read the user's files and reach the network. **Wired 2026-09-13:** until then `createRunCommand` was never given a `projectSettings` source, so the opt-in was unreachable and the gate always refused (safer than documented). Settings → Gates now sets it per project, default false, with a warning in the UI | Explicit per-project opt-in (default off), user-set only (SEC-08). Without it, the gate refuses: "tests gate needs a sandbox (install bubblewrap) or an explicit per-project opt-in". | when a Windows sandbox is available |
| R12 | With `testsGate.allowNetwork`, the tests gate reaches the network. Without it, loopback stays open for dev servers, so tests can reach local services, including the Brain endpoint. **Wired 2026-09-13:** same gap and fix as R11 | The endpoint still needs a token, and failed auth is rate-limited before any token is resolved (L3). | — |
| R13 | Codex has no max-turns flag and reports usage only at `turn.completed`. So `maxTurns` does not apply to Codex, and a single `codex exec` turn can overrun `maxTokens` before the supervisor sees it. The wall clock is the real cap. | Codex is experimental in v0.1; the wall-clock budget always applies. | when Codex streams usage mid-turn |
| R14 | A process that calls `setsid()` leaves its process group and survives STOP. After an app crash, the process groups of old runs are not killed on restart: `recover()` closes their transcripts as `killed` but never signals old pids, which may have been reused. | Killing a reused pid is worse. bubblewrap's `--die-with-parent` covers the Linux tests gate. | job objects / cgroups |
| R15 | The L3 pre-auth budget is shared, so a local process that floods the endpoint with bad tokens also gets valid lanes 429s until it refills (5/s). | A local attacker can already exhaust the 64 connections. Refusing before token resolution keeps the flood cheap. | per-peer budgets |
| R16 | The review-checkout mirror keeps HEAD's version of any file that is over 5 MB, has more than one hard link, or is neither a regular file nor a symlink (a nested repo, a socket). An edit hidden that way is missing from the reviewer's diff. The tests gate still runs against the lane worktree. | Copying those files would put unbounded data, or a hard-linked secret (T35), into a checkout the reviewer reads. | list skipped paths in the reviewer prompt |
| R18 | T36 residuals. (a) Codex lanes get no settings file, so there is no write deny on the repo config (as R2). Only `hardenGitExec` protects the app's calls there. (b) The filter-driver listing and the call are separate processes, so without the SEC-11 deny a live lane can race in a new driver. (c) Writes keep filters, and the transport vectors on app fetch and push (`credential.helper`, `remote.<x>.uploadpack` on a local-path remote) are closed only by the config deny. (d) User-visible costs: in a user's own partial clone, a diff or blame of a never-fetched blob fails. Textconv drivers don't render in the app's diff views. A repo-local LFS install shows smudged files as modified. The registry now ignores a repo-level `core.sshCommand` on app fetch and push, as the git worker already did (use `~/.ssh/config`). (e) On Linux, bubblewrap cannot re-bind a control file that does not exist yet without creating it in the user's repo, so a tests-gate script there could create `info/attributes` or `config.worktree`. Seatbelt denies them by path. A Claude lane on the main checkout could still rename `.git` itself, because the settings file cannot express a rename-only deny. | Each costs a security layer the other layer still covers, or is a narrow UX cost. Blanking filters on writes would commit raw content where LFS expects pointers. | per-call scoping once lanes get their own repos (R9) |
| R17 | The review checkout reads objects from the lane's object store through `objects/info/alternates`, and the lane can write that store. A lane process that survives into `verifying` (R14) can delete objects, which fails its own review (there is no fetch, T32), or swap object files. So the base the reviewer diffs against is only as trustworthy as that store. The linked worktree it replaced shared the same store. | Copying objects with `clone --no-local` or `fetch` runs `upload-pack` in the lane repo under its config (T33). | copy and verify the base and HEAD trees |
| R19 | A lane (or unattended run) on a model profile holds the profile's key in its own env, so its Bash tool can read it and spend it directly or send it elsewhere (T39). | Claude Code and Codex read the key from the process env; there is no way to hand it to the CLI and hide it from its tools. The key is the user's own, scoped to one spawn, redacted from transcripts, and never in a file. The guide tells users to set a spend limit per key at the vendor. | R8 router (the lane would hold only a per-launch loopback token) |

## 8. Release gate

Before v0.1 ships, all SEC tests must exist and pass on macOS, and on Linux and Windows where the
control applies. §6 items 1, 4, 5, 6, 7 and 9 must be fixed in code. The Phase 6.4
`security-auditor` pass re-checks this file against the code and records any new finding here as
`T31+`.
