# Model routing: cheaper inference for lanes and subagents

Status: plan, 2026-09-12. Wave 1 (R0–R3) in progress on `w7/routing`. Inputs:
`docs/research/OMNIROUTE.md` (OmniRoute at `152d951`, MIT), Claude Code's gateway and
model-config docs (checked 2026-09-12), Codex's `model_providers` config, `docs/THREAT-MODEL.md`,
`docs/SPIKE-EXEC-PATHS.md`, plan decisions D5/D6. This file merges two drafts written the same
night; it is the only routing plan.

Goal: users can run subagents, workers and reviewers on models they choose, including cheaper
ones, using their own API keys or local models. Ninebrains picks a model per job, falls back when
a provider fails, enforces spend limits in dollars, and shows what each job cost.

## 1. Decision

**We take OmniRoute's ideas, not its code, and we do not bundle it.**

- Most of OmniRoute is subscription pooling. It replays Claude Code's OAuth client, forges its
  integrity token (`claudeCodeCCH.ts`), fingerprints billing headers and hides competitor names
  from filters. It also proxies ChatGPT, Copilot, Kiro and Antigravity logins and scrapes 22 web
  apps with cookies. Shipping that code, even disabled, makes Ninebrains a distributor of it and
  breaks D5 and the vendors' terms.
- Its defaults break our threat model: `0.0.0.0` with no key, the encryption key beside the
  database, and a management API that trusts every loopback caller, which includes every lane.
- It is a 452 MB Next.js app moving about 1,800 commits a month, with no library API.

| From OmniRoute we take | How we use it |
|---|---|
| Provider/model catalog shape (`RegistryEntry`) | Our `ModelProfile` record (§4.2) |
| Failure classification: transient errors fail over; auth and invalid-request errors stop | Fallback in the supervisor (R6) |
| Circuit breaker `closed / open / half_open` with a cooldown probe | Per-profile health (R6) |
| Price table with user overrides; LiteLLM's MIT price JSON as an opt-in pinned source | Per-profile prices, always visible (R5) |
| "Strict" budget semantics (refuse instead of "cheapest") | A run over its USD cap is refused, never moved to a cheaper model (R5) |
| Per-key daily and weekly caps | Per-profile, per-plan and global daily caps (R5) |
| Model tiers `cheap / standard / strong` | Routing policy (R3, R7) |

We take no OmniRoute code in v0.1. If we ever copy an OmniRoute file (MIT), its notice goes into
`NOTICE`. We copy nothing from the OAuth, cookie, relay, impersonation, compression, plugin,
tunnel, MITM, cloud-sync or credential import/export code.

**Credential scope, fixed for this plan:** the user's own paid API keys, legitimate free tiers
used with the user's own key, cloud providers Claude Code supports natively (Bedrock, Vertex,
Foundry), and local models (Ollama, LM Studio, vLLM). No OAuth, cookies, sessions, relays or
token-file import. "Coding plan" keys stay out unless a per-vendor terms review clears one.

## 2. What the CLIs support (verified 2026-09-12)

| Fact | Source | Consequence |
|---|---|---|
| `ANTHROPIC_AUTH_TOKEN` takes precedence over a saved claude.ai login at once; usage is billed per token to the key's owner. `ANTHROPIC_API_KEY` needs a one-time interactive approval | code.claude.com/docs/en/llm-gateway-connect, /gateways | An API-key run never touches the user's subscription |
| Setting **only** `ANTHROPIC_BASE_URL` keeps the saved claude.ai login and sends it through the gateway | same | **A subscription run must never get a base URL** (SEC-39) |
| Gateway credentials placed in project settings cause repeated login prompts; a user's settings `env` block applies to the session | /llm-gateway-connect | Launch env alone does not prove the active credential (SEC-41) |
| `CLAUDE_CODE_SUBAGENT_MODEL` sets the model for all subagents, agent teams and workflow agents. Resolution order: that env var, then per-invocation parameters, then frontmatter `model:`, then the main model | /model-config, /sub-agents | One env var picks the subagent tier on any auth mode |
| `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL` map the aliases (`ANTHROPIC_SMALL_FAST_MODEL` is deprecated) | /model-config | Pin tiers to exact model IDs |
| Codex: `-c model_providers.<id>={ name, base_url, wire_api="responses", env_key }` and `-c model_provider=<id>` per launch | openai/codex config tests, responses-api-proxy README | Codex API-key runs route without touching `~/.codex` |
| Anthropic does not support Claude Code on non-Claude models through any gateway | /llm-gateway | Non-Claude profiles are best-effort; the UI says so |

R0 re-verifies each of these against the installed CLI versions.

## 3. Two savings levers

**Lever A: subscription lanes, no new credential risk.** A lane on the user's own `claude` login
keeps it. We only choose which **Claude** model its subagents use, through
`CLAUDE_CODE_SUBAGENT_MODEL` (for example `haiku` for exploration subagents, `inherit` for
reviewers). No gateway, key, base URL or non-Claude model ID. This cuts subscription quota burn.
It ships first (R1).

**Lever B: API-key profiles, real per-token savings.** The user adds model profiles with their own
keys. A run in API-key mode gets the variables in §4.3. Opt-in: a user with no profiles sees no
change. Behind the fork flag `MODEL_PROFILES_ENABLED` (on in dev builds, off in release builds until
Lucas decides §9.1).

One Claude Code session has one base URL, so mixing vendors inside a session (a strong main model
with cheap subagents on another vendor) needs a local router. That is R8, gated.

## 4. Design

### 4.1 Where it lives

New slice `apps/emdash-desktop/src/core/features/routing/`. Only manifest registrations touch
upstream files.

```
routing/
  api/contract.ts        profiles CRUD, test connection, cost queries (zod)
  api/node/profile.ts    ModelProfile schema + vendor allowlist check (SEC-44)
  api/node/price.ts      usd(usage, price); unpriced detection (SEC-43)
  node/profile-repo.ts   Brain DB rows (model_profiles, profile_health, run_costs, spend_caps)
  node/keys.ts           ninebrains.model.<id> in encryptedAppSecretsStore (SEC-40)
  node/policy.ts         resolveRoute(job, lane, purpose); tiers; reviewer pin (SEC-42)
  node/launch-env.ts     env/argv per profile kind; the one place SEC-39 is enforced
  node/health.ts         failure classes + circuit breaker (R6)
  node/vendors.json      bundled, reviewed vendor allowlist
  browser/…              Settings → Models, lane/job badge, cost view
```

Our own files it changes: exec-runs `types.ts` (`ExecRunSpec.route`, `RunBudgets.maxUsd`,
`AgentOutcome.apiKeySource`), `run-env.ts` (a routing layer; `CLAUDE_CODE_SUBAGENT_MODEL` allowed
only from it), `claude-print.ts` (`--model`, parse `apiKeySource`), `codex-exec.ts` (provider
overrides on the SEC-12 trusted list), `run-supervisor.ts` (USD budget, SEC-41 check, persisted
cost, fallback event), brain `unattended.ts` and `launch-config.ts`, `reviewer-route.ts`,
`keychain-secret-resolver.ts`, pack role presets (`tier`).

### 4.2 Data model (Brain DB)

```
model_profiles(id, label, kind, vendor_id, base_url, protocol, model, tier,
               price_in_per_mtok, price_out_per_mtok, price_cache_read_per_mtok,
               price_cache_write_per_mtok, context_window, enabled, created_at)
               -- the key lives in the keychain as ninebrains.model.<id>, never here
profile_health(profile_id, state, opened_at, next_probe_at, last_error_class)
run_costs(run_id, job_id, plan_id, profile_id, input, output, cache_read, cache_write,
          usd, priced_at_version, swapped_from_profile_id)   -- written by the supervisor only
spend_caps(scope, scope_id, period, usd)   -- scope: profile | plan | global; period: run | day
```

`kind` is one of `anthropic-api`, `openai-api`, `anthropic-compatible`,
`openai-responses-compatible`, `bedrock`, `vertex`, `foundry`, `local`. IDs follow SEC-14.

`vendors.json` is bundled and pinned: `{id, hosts[], protocols[], docsUrl, termsUrl, reviewedAt}`.
Only reviewed vendors ship; R0 fills the first list (`docs/research/VENDORS.md`). Users may add
only `local` loopback URLs.

### 4.3 Env and argv per profile kind

| Kind | Claude (`claude` / `claude -p`) | Codex (`codex exec`) |
|---|---|---|
| subscription (Lever A) | `CLAUDE_CODE_SUBAGENT_MODEL=<Claude alias or Claude ID>` only | nothing |
| `anthropic-api` | `ANTHROPIC_API_KEY` | n/a |
| `anthropic-compatible`, `local` (Anthropic protocol) | `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` pinned to the profile, `CLAUDE_CODE_SUBAGENT_MODEL` if a subagent tier is set | n/a |
| `bedrock`, `vertex`, `foundry` | Claude Code's native switches (R0 lists the exact variables) | n/a |
| `openai-api`, `openai-responses-compatible`, `local` (Responses) | n/a | `--config=model_providers.nb={…base_url, wire_api="responses", env_key="NB_MODEL_KEY"}`, `--config=model_provider=nb`, `--model`; the key in `NB_MODEL_KEY` |

A profiled run gets no `CLAUDE_CONFIG_DIR` that holds a login.

### 4.4 Policy

`resolveRoute(job, lane, purpose)` returns `'subscription'` unless a profile applies. Order: the
job's explicit profile (set by the user in the planner or a pack role, never by a Brain session),
then the pack role's tier, then project defaults, then app defaults (`ninebrains.routing`), then
filtered by health and caps.

Defaults: worker `standard`; subagent `cheap`; reviewer `strong`, pinned (SEC-42), keeping
`routeReviewer`'s provider preference; Brain session `subscription`. If no profile exists for a
tier, the run uses the user's own login, as today.

A Brain session may request a tier in `create_job` if Lucas agrees (§9.5): main maps the tier to a
profile and can only lower cost within the caps. It cannot choose a vendor or raise a cap (as
SEC-08 and SEC-32).

## 5. Security requirements (added to THREAT-MODEL when R1 lands; every rule is a test)

- **SEC-39 Subscription runs are never routed to another host.** A run on the user's own login
  gets no `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, alias variable
  pointing at a non-Claude model, or Codex `model_providers`/`model_provider` override. It may get
  `CLAUDE_CODE_SUBAGENT_MODEL` with a Claude alias or ID (Lever A). Enforced in `launch-env.ts`,
  which every launch path goes through. Test `SEC-39 subscription runs carry no routing`: env and
  argv snapshots for attended, Brain session, unattended claude, unattended codex and reviewer.
- **SEC-40 Keys stay in the keychain.** Stored as `ninebrains.model.<id>` in the safeStorage-backed
  store (SEC-27), decrypted only into one spawn's env (or R8's upstream request), never in a file,
  log, transcript, evidence or the renderer. The redactor (SEC-35) gets their literal values. The
  renderer can set, replace, test and delete a key, never read it.
- **SEC-41 The active credential is checked at run start.** A user's settings `env` block can
  override the env we inject. For unattended claude runs the supervisor reads `apiKeySource` (and
  `model`) from the stream-json `init` event: a subscription run must not report a gateway token or
  API key, and a profiled run must report the variable we set and the profile's model. Otherwise
  the run is killed before any work and a security event is recorded. Attended lanes get the
  closest enforceable check (resolved settings `env` inspected before launch, a lane warning), and
  the gap is documented. Codex gets the equivalent once R0 finds the field.
- **SEC-42 Reviewers are never downgraded.** The reviewer profile is pinned; no fallback to a lower
  tier. Unavailable means `blocked`, never `pass` and never retried on a cheaper model.
- **SEC-43 Budgets are in USD and computed by us.** USD = our stream `usage` × the profile's price.
  `--max-budget-usd` is a second layer only (R0 checks how the CLI prices non-Claude models). An
  unpriced profile cannot run unattended. A run or plan over its cap is refused, never moved to a
  cheaper model. Figures are labelled estimates.
- **SEC-44 Allowed credential kinds and vendors only.** The profile schema rejects OAuth, cookie,
  session and token-file kinds, any `baseUrl` host not in `vendors.json` (except loopback `local`),
  and claude.ai / chatgpt.com hosts.
- **SEC-45 Egress follows the profile.** Unattended claude runs' `egressAllowedDomains` include only
  the profile's API host (SEC-32); `local` adds loopback for that port only.
- **SEC-46 No gateway without hardening.** No code path starts an HTTP model gateway unless it meets
  the R8 checklist. A dependency check keeps `omniroute` and similar packages out of the graph.

New threats: **T37** a subscription token sent to a third-party base URL (SEC-39, SEC-41). **T38** a
lane's Bash reads the profile key from its env and spends directly: the guide tells users to set a
vendor-side spend limit per key; accepted risk R19. **T39** a reviewer silently downgraded
(SEC-42). **T40** a mispriced or unpriced model makes the budget meaningless (SEC-43).

Compression stays off. Any future "lite" compression needs its own eval and is never applied to
reviewer or tests-gate evidence (research §3).

## 6. Phases

| Phase | Work | Exit / tests | Effort |
|---|---|---|---|
| **R0 spike + vendors** | (1) `apiKeySource` values for AUTH_TOKEN, API_KEY and login under `-p`. (2) Codex provider overrides under `codex exec`, and which event shows the provider. (3) Whether our `--settings` file or the user's `settings.json` `env` wins. (4) How `--max-budget-usd` prices a non-Claude model. (5) `CLAUDE_CODE_SUBAGENT_MODEL` under `-p` and in attended sessions. (6) Each candidate vendor's endpoint, protocol, streaming usage fields, free tier and terms (DeepSeek, Moonshot/Kimi, Z.ai, MiniMax, OpenRouter, Groq, Together, Fireworks, Bedrock/Vertex/Foundry, Ollama/LM Studio). Results in `docs/research/VENDORS.md` and `docs/SPIKE-EXEC-PATHS.md` §Routing | vendor list SAFE/REVIEW | 1–2 d |
| **R1 Lever A** | Per-lane/role `subagentModel` (Claude alias or ID), persisted, emitted as `CLAUDE_CODE_SUBAGENT_MODEL` for attended and unattended claude; lane badge | SEC-39 snapshots | 1–2 d |
| **R2 profiles + keys** | Schema, `vendors.json`, repo + migration, `keys.ts`, Settings → Models (add, test, delete; write-only key). SEC-39–46 and T37–T40 into the threat model | SEC-40, SEC-44 | 2–3 d |
| **R3 exec + lane wiring** | `launch-env.ts` per §4.3; `ResolvedRoute` through `ExecRunSpec`; lane auth mode "subscription / API key: <profile>"; SEC-12 trusted values and SEC-13 env allowlist updated deliberately; SEC-41 check in the supervisor | SEC-39, SEC-41, SEC-45; a run against a local mock Anthropic-compatible server | 3–4 d |
| **R4 policy** | `policy.ts`, tiers, pack role `tier`, planner per-job profile, reviewer pin via `reviewer-route.ts` | SEC-42, policy table | 2–3 d |
| **R5 budgets + cost** | `usd()`, `maxUsd` in the supervisor, `run_costs` persisted (survives restart, SEC-29), daily/plan caps, cost view per job/lane/plan/day | SEC-43, SEC-29 extended | 3–4 d |
| **R6 fallback** | Error classes from stream events and exit codes; per-profile circuit breaker; worker fallback within tier or lower, never for reviewers; swaps in `run_costs.swapped_from` and security events | fallback matrix, SEC-42 | 3 d |
| **R7 Brain tier request** | If §9.5 is yes: `create_job` tier hint mapped in main within caps | SEC-08-style test | 1 d |
| **R8 local router (gated)** | Only if R0 shows users need mixed vendors in one session or a vendor lacks a native endpoint. Loopback Anthropic-protocol router in main: per-launch token (Brain endpoint pattern: random token, Host check, rate-limited auth), dispatch by `model` to profiles, streaming passthrough, usage capture, R6 fallback. **No** management API, **no** web fetch, **no** compression; egress only to profile hosts with connect-time pinning. A pruned OmniRoute fork is a later fallback only under research §7 rank 2 in full | SEC-46 | decide after R0 |
| **R9 compression (deferred)** | Red-team eval of RTK/Caveman on canned diffs and reviewer prompts; only `lite` for worker subagents, and only if no reviewer-visible text changes | eval | later |

Wave 1 = R0–R3 (`routing-builder`). Wave 2 = R4–R7. R8 and R9 are separate decisions. About 3–4
weeks for R0–R7.

## 7. UI and docs

- **Settings → Models:** vendor picker (allowlist only), write-only key with a Test button, prices
  prefilled from `vendors.json` and editable, tier. No "sign in with…" button anywhere (D5).
- **Lane cell and job card:** a badge for profile and tier, or "your login". Non-Claude models under
  Claude Code get "not supported by Anthropic; some features may not work".
- **Cost view:** per job, plan, lane and day, with caps and refusals.
- **Guide:** `docs/guide/models.md`; `accounts.md` and `unattended-runs.md` updated. Copy: "use your
  own API keys for cheaper models"; never "save on your subscription", never "unlimited", never
  OmniRoute features we don't ship. Tell users to set a spend limit on each key at the vendor.

## 8. Risks

1. Non-Claude models under Claude Code are unsupported: labels, per-vendor R0 tests, reviewers stay
   on strong Claude/GPT-class profiles.
2. Stale prices: visible and editable, `priced_at_version` stored, unpriced refused.
3. A lane spends a key directly (T38): accepted risk R19, bounded by vendor-side limits.
4. Scope creep toward OmniRoute's feature set: anything beyond this plan needs a new decision.

## 9. Decisions for Lucas

1. Ship Lever B (Settings → Models, the user's own keys) in v0.1, or only Lever A.
2. The first vendor allowlist, after R0.
3. Default tiers and caps (for example worker `standard`, subagent `cheap`, reviewer `strong`, a
   global daily cap of $X).
4. Routing for attended lanes in v0.1, or unattended and Brain-dispatched runs only (smaller, safer).
5. Whether a Brain session may request a tier (proposed: yes, tier only, within caps).
6. Non-Claude models under Claude Code: show with an "unsupported" badge, or hide behind a flag.
7. The R8 router: build it only if R0 shows the need.

## 10. Out of scope

Subscription pooling, account rotation and any login other than the user's own CLI login (D5);
hosted gateways run by us; reselling or metering inference; media, embedding and search models.
