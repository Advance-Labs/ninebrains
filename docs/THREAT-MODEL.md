# Ninebrains threat model (plan task 6.4, done early)

Status: design review, 2026-09-10. Written before Phase 2 code lands so the build agents implement
controls instead of retrofitting them. Every requirement below is a test, not a guideline. A phase is
not done until its `SEC-*` tests exist and pass.

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
| T07 | Injected Brain (or lane) creates jobs with `gates: []`, so work ships as `unverified` | M | H | gate floor from rigor settings; callers can only add gates | SEC-08 |
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
  creates a disposable checkout (`git worktree add --detach <tmp> <HEAD>`, with untracked files copied
  in) and runs the reviewer there under the strictest mode available: Claude `--restricted
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

## 6. Where the current design already breaks a requirement

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
| R2 | Codex's sandbox restricts writes, not reads, so a Codex lane can read other lanes' `mcp.json`. Damage is limited to lane impersonation, since gates still run. | No read-deny in Codex. | when Codex adds read policy |
| R3 | Attended lanes use upstream's broad env allowlist. | Matches the user's own terminal. | — |
| R4 | Pack skills install globally to `~/.agentskills` (SEAMS §3.16) and are visible to non-Ninebrains agents. | Bundled skills only, `nb-` prefix. | per-lane config dir |
| R5 | Prompt injection against an attended lane can't be fully prevented. We rely on the provider's permission prompts and the user. | That's the state of the art; we don't claim otherwise. | — |
| R6 | Remote/SSH lanes are unsupported, so there is no remote Brain channel. | v0.1 is local-only (SEAMS §3.6). | v0.2 |
| R7 | Screenshots of the lane's own preview may show seeded or test personal data. | Local only, 30-day retention. | — |
| R8 | Unsigned builds, verified by checksums and attestations only. | No signing spend yet (plan §9 Q4). | 7.1 |
| R9 | Lanes share one OS user, so there is no kernel-level isolation between lanes. | Containers or VMs per lane are out of v0.1 scope. | v0.3 |

## 8. Release gate

Before v0.1 ships, all SEC tests must exist and pass on macOS, and on Linux and Windows where the
control applies. §6 items 1, 4, 5, 6, 7 and 9 must be fixed in code. The Phase 6.4
`security-auditor` pass re-checks this file against the code and records any new finding here as
`T31+`.
