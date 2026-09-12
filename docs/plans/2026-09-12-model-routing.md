# Model routing: cheaper inference for lanes and subagents

Status: plan, 2026-09-12. Inputs: `docs/research/OMNIROUTE.md` (OmniRoute at `152d951`, MIT),
Claude Code's gateway and model-config docs (checked 2026-09-12), Codex's `model_providers` config,
`docs/THREAT-MODEL.md`, plan decisions D5/D6.

## 1. The decision

**We do not bundle or fork OmniRoute.** We port the parts that save money (model profiles,
failure-classified fallback, a circuit breaker, cost accounting) into a new Ninebrains slice, with
MIT attribution in `NOTICE` for any code we copy. Research §7 has the ranking.

Why not bundle:
- Most of OmniRoute is subscription pooling. It replays Claude Code's OAuth client, forges its
  integrity token (`claudeCodeCCH.ts`), fingerprints billing headers and hides competitor names
  from filters. It also proxies ChatGPT, Copilot, Kiro and Antigravity logins and scrapes 22 web
  apps with cookies. Shipping that code, even disabled, makes Ninebrains a distributor of it, and
  it breaks D5 and the vendors' terms.
- Its defaults break our threat model: it binds `0.0.0.0` with no key, stores the encryption key
  beside the database, and trusts every loopback caller, which includes every lane.
- It is a 452 MB Next.js app moving about 1,800 commits a month, and it has no library API.

**Credential scope, fixed for this whole plan:** the user's own paid API keys, legitimate free
tiers used with the user's own key, and local models (Ollama, LM Studio, vLLM). No OAuth, no
cookies, no relays, no credential import. "Coding plan" subscription keys are excluded unless a
per-vendor terms review clears one.

## 2. What the CLIs support (verified 2026-09-12)

| Fact | Source | Consequence |
|---|---|---|
| `ANTHROPIC_AUTH_TOKEN` takes precedence over a saved claude.ai login at once; usage is billed per token to the key's owner | code.claude.com/docs/en/llm-gateway-connect, /gateways | An API-key lane never touches the user's subscription |
| Setting **only** `ANTHROPIC_BASE_URL` keeps the saved claude.ai login and sends it through the gateway | same | **A subscription lane must never get a base URL.** Test it (§6) |
| `CLAUDE_CODE_SUBAGENT_MODEL` sets the model for all subagents, agent teams and workflow agents, overriding frontmatter unless `inherit` | /model-config, /sub-agents | One env var picks the subagent tier, on any auth mode |
| `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL` map the aliases | /model-config | Pin tiers to exact model IDs, or to a vendor's model names behind a router |
| Subagent frontmatter `model:` accepts an alias, a full ID or `inherit` | /sub-agents | Packs can ship role subagents with a tier |
| Codex: `-c model_providers.<id>={ name, base_url, wire_api="responses", env_key }` and `-c model_provider=<id>` per launch | openai/codex config tests, responses-api-proxy README | Codex API-key lanes route without touching `~/.codex` |
| Anthropic does not support Claude Code on non-Claude models through any gateway | /llm-gateway | Cheap non-Claude profiles are "works, unsupported". Say so in the UI |

## 3. Two savings levers

**Lever A: subscription lanes, zero new risk.** A lane on the user's own `claude` login keeps it,
and we only choose which Claude model its subagents use, with `CLAUDE_CODE_SUBAGENT_MODEL` (for
example `haiku` for exploration subagents, `sonnet` for workers, `inherit` for reviewers). There
is no gateway, key or base URL. This cuts subscription quota burn, not dollars, and it ships first.

**Lever B: API-key lanes and runs, real per-token savings.** The user adds model profiles with
their own keys. A lane or unattended run in API-key mode gets `ANTHROPIC_BASE_URL` plus
`ANTHROPIC_AUTH_TOKEN` (or a Codex provider override). One Claude Code session has one base URL,
so mixing vendors inside a session (a strong main model plus cheap subagents on another vendor)
needs a local router that dispatches by model name. That router is where the ported OmniRoute
logic lives (phase R4).

## 4. Architecture

New slice `apps/emdash-desktop/src/core/features/routing/` (Ninebrains-only, no upstream patch):

```
routing/
  api/        contract (profiles CRUD, test-connection, cost views), zod schemas
  node/
    profiles.ts        ModelProfile store (Brain DB table), validation
    keys.ts            keyRef → encryptedAppSecretsStore (safeStorage); never to the renderer
    policy.ts          pickProfile(job, lane, purpose) → { profile, subagentModel }
    launch-env.ts      env/flags per profile for buildLaneLaunch and exec runs (D5 checks)
    router/            R4: loopback Anthropic-protocol router (ported fallback + breaker)
    pricing.ts         price table: user overrides, then an opt-in pinned LiteLLM price JSON
    cost.ts            usage × price → runs.cost_usd; aggregates per job/lane/plan
  browser/    Settings → Models page, per-lane model/tier picker, cost panel
```

`ModelProfile = { id, label, auth: 'subscription' | 'api-key' | 'local', protocol: 'anthropic' |
'openai-responses', baseUrl?, model, keyRef?, price?: { inPerMTok, outPerMTok, cacheReadPerMTok },
contextWindow?, tier: 'cheap' | 'standard' | 'strong', supported: boolean }`.

**Policy defaults** (`pickProfile`):
- Reviewer and security-review gates get `strong`, **pinned**. A pinned profile never falls back to
  a lower tier. If it cannot run, the gate result is `blocked`, never `pass`. This composes with
  `routeReviewer` (Lucas's open decision on provider).
- Workers get `standard`. Exploration/research subagents get `cheap` via `CLAUDE_CODE_SUBAGENT_MODEL`
  or the router.
- Pack roles may declare a tier. The user can override per lane and per project.
- An **unpriced** API-key profile may run attended but blocks unattended runs, so cost is never
  silently `$0` (research §2).

## 5. Phases

| Phase | Scope | Exit |
|---|---|---|
| **R0 Vendor check** (0.5 d) | Verify which vendors really expose Anthropic-compatible `/v1/messages` or OpenAI Responses endpoints (DeepSeek, Moonshot/Kimi, Z.ai GLM, MiniMax, OpenRouter, Groq, Together, Fireworks), their published free tiers and their terms on tool use. Record in `docs/research/VENDORS.md` with links and dates | Vetted vendor list, each SAFE/REVIEW |
| **R1 Lever A** (1–2 d) | `policy.ts` + `launch-env.ts` for subscription lanes: per-lane/role `subagentModel` setting (`inherit`/`haiku`/`sonnet`/`opus`), written as `CLAUDE_CODE_SUBAGENT_MODEL` in the lane's launch env and in unattended runs; Codex equivalent via profile pin where it exists. Lane chrome shows it | Test: subscription lane env has the subagent var and **no** `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` |
| **R2 Profiles + keys** (2–3 d) | Brain DB `model_profiles` table + migration, zod validation, `keys.ts` on `encryptedAppSecretsStore`, Settings → Models (add, test connection, delete). Write-only keys from the renderer's view | Keys never in renderer, logs, transcripts (SEC-35 redactor test) |
| **R3 Single-vendor API-key lanes** (2–3 d) | `launch-env.ts` for `api-key`/`local` profiles: `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_DEFAULT_*_MODEL` for Anthropic protocol; `-c model_providers.<id>` + `env_key` for Codex. Update SEC-12's trusted-value list and SEC-13's env allowlist deliberately (the token enters the spawn env only). Lane mode picker gets "API key: <profile>" | A lane runs end to end on a local Ollama profile with the fake agent and on one real vendor manually |
| **R4 Local router** (4–6 d) | Loopback Anthropic-protocol router in main: per-launch bearer token (reuse the Brain endpoint's SEC-03/05/06 pattern: random token, Host check, rate-limited auth), dispatch by `model` to an upstream profile, streaming passthrough, **ported** failure classification (timeout/network/429/5xx fail over; auth/permission/invalid stop) and circuit breaker (closed/open/half-open with probe), usage capture per request. **No** management API, **no** web fetch, **no** compression. Egress only to profile hosts, pinned at connect time (SEC-21 policy). A lane's subagent model names map to cheap upstreams | Mixed session: strong main on vendor X, subagents on vendor Y, one base URL |
| **R5 Budgets + cost** (2–3 d) | Cost per run from stream-json `usage` × price (Codex from `turn.completed`, R13), stored in `runs`; per job/lane/plan cost panel; supervisor-enforced USD budget (SEC-29 extends from tokens to dollars); every model swap or fallback logged to `security_events` and shown on the job | Budget test: a run over its USD cap is killed by the supervisor, not the router |
| **R6 Policy wiring** (1–2 d) | Brain dispatch calls `pickProfile`; pack roles declare tiers; reviewer pin enforced in `spawnReviewer`; docs pages | Test: reviewer never downgrades; blocked on failure |

About 2.5–3.5 weeks for one developer. R1 alone delivers value tonight-scale and carries no new
credential risk, so it ships first.

## 6. Security requirements (new SEC rows, all tests)

- **SEC-39 D5 base-URL rule.** A lane or run in `subscription` auth never has `ANTHROPIC_BASE_URL`,
  `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY` or a Codex `model_providers` override. Snapshot test
  over every launch builder.
- **SEC-40 Keys.** Profile keys live only in safeStorage, are decrypted only into one spawn's env or
  the router's upstream request, and never reach the renderer, logs, transcripts or evidence.
- **SEC-41 Router boundary.** Loopback only, per-launch token, Host check, no management or fetch
  routes, egress only to configured profile hosts with connect-time pinning, and the router's port
  and token on the lane deny-read list where the sandbox allows (R2 applies to Codex).
- **SEC-42 Reviewer pin.** A pinned profile never falls back to a lower tier; failure means blocked.
- **SEC-43 Honest cost.** An unpriced profile cannot run unattended; the UI marks estimates as
  estimates.
- Compression stays off. Any future "lite" compression needs its own eval and is never available to
  reviewer or tests-gate evidence (research §3).

## 7. What we take from OmniRoute (MIT, attributed)

| Take | From (OmniRoute `152d951`) | How |
|---|---|---|
| Failure classification rule | `docs/OMNIROUTE_PROVIDER_FAILOVER.md`, `open-sse/services/*` | Port the rule; rewrite in our style with tests |
| Circuit breaker states + probe | same | Port |
| Price table shape and LiteLLM price JSON as an opt-in pinned source | `src/lib/pricingSync.ts`, `docs/guides/COST_TRACKING.md` | Idea + data source (LiteLLM JSON is MIT); pin a version, no live sync by default |
| Model alias idea (`claude/<id>` exposure) | `docs/guides/CLAUDE-CODE-CONFIGURATION.md` | Map via `ANTHROPIC_DEFAULT_*_MODEL` |

We take nothing from the OAuth, cookie, relay, impersonation, compression, plugin, tunnel, MITM,
cloud-sync or credential import/export code.

## 8. Open questions for Lucas

1. Lever B is opt-in and uses the user's own paid keys. Should Settings → Models ship in v0.1, or
   only Lever A?
2. Free tiers: list them in the UI (after R0's terms check), or leave them for users to add?
3. Non-Claude models under Claude Code are unsupported by Anthropic. Show them with an
   "unsupported" badge, or hide them behind a flag?
