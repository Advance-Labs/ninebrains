# OmniRoute: research for Ninebrains

Status: research, 2026-09-12. Not a decision. Input to plan task "Write the OmniRoute integration plan".

Subject: `github.com/diegosouzapw/OmniRoute`, shallow clone at commit `152d951` (2026-09-11),
`package.json` version 3.8.51, MIT. All file paths below are relative to that repo's root unless
they start with `docs/SEAMS.md` or `docs/THREAT-MODEL.md` (ours). "Verified" means I read the code
or ran the command. "Not verified" means I did not.

Read first: `docs/THREAT-MODEL.md` §1–§5, `docs/SEAMS.md`, plan decisions D5 and D6.

## 0. Answer in five lines

1. OmniRoute is a whole Next.js 16 application with a SQLite database, a dashboard, and about 450 MB
   of npm install. It is not a library. It can only run as a sidecar process.
2. Most of what it is known for is subscription pooling. It reuses consumer OAuth logins (Claude
   Code, Codex/ChatGPT, Copilot, Antigravity, Kiro, Cursor and others) and browser session cookies.
   It also ships code that forges Claude Code's client integrity token and hides competitor names
   from Anthropic's filters. D5 forbids all of that.
3. Its defaults conflict with our threat model. The CLI binds `0.0.0.0` with no API key required.
   The stored keys can be decrypted by any process running as the user. Its management API trusts
   loopback, and every lane is loopback.
4. The parts we want (model profiles, fallback, cost accounting, budgets) are small ideas, and the
   exec supervisor already sees the data they need.
5. Recommendation: **(c) port the routing, fallback and cost pieces into Ninebrains.** Use only
   BYOK API keys, legitimate free tiers and local models. Do not bundle OmniRoute. §7 has the
   ranking.

## 1. Architecture

| Question | Finding | Evidence |
|---|---|---|
| Language / runtime | TypeScript. Next.js `16.3.3` app with React 19 dashboard; Node `>=22.22.2 <23 \|\| >=24 <27` | `package.json` (`engines`, `dependencies.next`) |
| Streaming engine | Workspace package `@omniroute/open-sse` (executors, translators, combo engine, compression, MCP server). `"private": true`, not published. It imports app code (`@/lib/db/*`), so it cannot be lifted out alone | `open-sse/package.json`; `src/lib/modelAliasResolver.ts:11-14` |
| Process model | One Node server (custom Next server). Default port `20128`. Optional split `API_PORT=20129`. Live WebSocket `20132` on `127.0.0.1` | `.env.example` §3; `src/lib/runtime/ports.ts`; `scripts/dev/run-next.mjs:106,251` |
| CLI start path | `omniroute serve` spawns the standalone server with `process.execPath`, and the bind host defaults to `0.0.0.0` | `bin/cli/runtime/processSupervisor.mjs:77`; `bin/cli/commands/serve.mjs:257`; `bin/cli/utils/serverHost.mjs:16-26` |
| Config | `~/.omniroute/.env` (the reference file documents about 2,600 lines of variables), plus settings in the DB edited from the dashboard | `.env.example`; `bin/omniroute.mjs:222-280` |
| Database | SQLite at `~/.omniroute/storage.sqlite` (`DATA_DIR` overrides). `better-sqlite3` is optional with a `sql.js` fallback. Redis is optional | `src/lib/db/core.ts:113`; `package.json` `optionalDependencies` |
| Client protocols | OpenAI `/v1/chat/completions`, `/v1/responses`, `/v1/models`; Anthropic `/v1/messages`; also embeddings, images, audio, rerank, search, web fetch, A2A, MCP | `src/app/api/v1/` (dirs `messages`, `responses`, `chat`, `web`, …) |
| Claude Code | `ANTHROPIC_BASE_URL=http://host:20128` (no `/v1`) plus `ANTHROPIC_AUTH_TOKEN=<omniroute key>`. Non-Claude models can be exposed as `claude/<id>` so they show in `/model` | `docs/guides/CLAUDE-CODE-CONFIGURATION.md` |
| Codex | `config.toml` provider block: `base_url=http://host:20128/v1`, `wire_api="responses"`, `env_key="OMNIROUTE_API_KEY"`. For us this would be `-c model_providers.omniroute.*` overrides | `docs/guides/CODEX-CLI-CONFIGURATION.md` |
| Install footprint | npm `omniroute@3.8.50` unpacked size 452,524,798 bytes. 82 production dependencies (including `playwright`, `sharp`, `monaco-editor`, `mermaid`, `@aws-sdk/client-bedrock-runtime`, `@ngrok/ngrok`, `ioredis`, `update-notifier`). Optional dependencies include `onnxruntime-node`, `@huggingface/transformers`, `keytar` and native `wreq-js`. The lockfile has 1,052 non-dev packages | `npm view omniroute dist.unpackedSize`; `package.json`; `package-lock.json` |
| Embeddable? | No. The CLI and the upstream Electron shell both spawn the server as a child process. Their Electron build runs it on Electron's Node and pins `HOSTNAME=127.0.0.1`. That is the pattern a sidecar would copy | `electron/main.js:833-846` |
| Pace / bus factor | 64,955 stars, 9,084 forks, 545 open issues. About 1,820 commits between 2026-08-12 and 2026-09-12. 30 releases from 2026-06-12 to 2026-08-26. The top contributor has 4,727 commits; the next has 226 | `gh api repos/diegosouzapw/OmniRoute`, `/commits`, `/releases`, `/contributors` |

## 2. Routing

**Catalog format.** Each provider is TypeScript code, not data: one `index.ts` per provider under
`open-sse/config/providers/registry/<id>/` (274 files), typed as `RegistryEntry`
(`open-sse/config/providers/shared.ts:126`). Its fields are `id`, `alias`, `format`, `executor`,
`baseUrl(s)`, `authType`, `authHeader`, `headers`, `oauth{clientIdDefault,tokenUrl}` and
`models[{id, contextLength, maxOutputTokens, supportsReasoning, unsupportedParams…}]`. Adding a
provider means a code change and a rebuild.

**Model IDs and aliases.** Clients send `<alias>/<model>`, for example `cx/gpt-5.5` or
`glm/glm-5.2`. `resolveModelAlias` rewrites bare names through a DB `modelAliases` namespace and a
static seed, cached for 60 s (`src/lib/modelAliasResolver.ts`, `src/lib/modelAliasSeed.ts`). A combo
is addressed by its name, and `auto/<category>:<tier>` is zero-config (`docs/routing/AUTO-COMBO.md`).

**Combos (routing strategies).** There are 19 strategies (`src/shared/constants/routingStrategies.ts`,
table in `docs/routing/AUTO-COMBO.md` "All Routing Strategies"). They include `priority`,
`weighted`, `fill-first`, `cost-optimized`, `headroom`, `reset-aware`, `lkgp`, `auto` (16-factor
scoring), `fusion` and `pipeline`. `fusion` fans one request out to a panel of models and a judge,
so it multiplies cost.

**Fallback.** Failures are classified before any retry. Timeouts, network errors, 429 and 5xx fail
over. Auth, permission and invalid-request errors do not. The default is at most 3 provider
attempts, with a circuit breaker (`closed`/`open`/`half_open`) and probe on cooldown
(`docs/OMNIROUTE_PROVIDER_FAILOVER.md`). Inside one provider it rotates accounts and keys
(`open-sse/services/accountFallback.ts`, `accountSelector.ts`, `apiKeyRotator.ts`). Rotating across
several subscription accounts is the specific behaviour Anthropic and Google enforce against (§4).

**Quota awareness.** Per-provider quota fetchers and burn-rate tracking live in `src/lib/quota/`
(`burnRate.ts`, `providerQuotaState.ts`, `planRegistry.ts`) and `open-sse/services/*QuotaFetcher.ts`.
Most of them read subscription plan windows (Codex, Antigravity, Alibaba free tier).

**Cost accounting.** Cost is an estimate: tokens × a price table. The table is resolved in this
order: user overrides, then LiteLLM's public price JSON (opt-in sync), then hardcoded defaults
(`src/lib/pricingSync.ts:98`, `docs/guides/COST_TRACKING.md`). The docs call the figure "a savings
tracker, not a bill", and a model with no price entry costs `0`. Usage and call logs are stored in
SQLite and read through `/api/usage/*` (`docs/openapi.yaml:3405-3517`). Responses carry headers such
as `X-OmniRoute-Cost-Saved`, `X-OmniRoute-Fallback-Attempts` and `X-OmniRoute-Combo-Trace`.

**Budgets.**
- Per request: this works only on the `auto` strategy, through `X-OmniRoute-Budget: <usd>`. The
  default fallback, `cheapest`, still sends the request when every candidate is over the cap. Only
  `X-OmniRoute-Budget-Fallback: strict` refuses, with HTTP 402
  (`open-sse/services/autoCombo/requestControls.ts`; `docs/routing/AUTO-COMBO.md` "Per-Request
  Controls").
- Per API key: daily and weekly USD limits (`src/lib/db/apiKeyUsageLimitFields.ts`,
  `src/lib/usage/apiKeyUsageLimits.ts:468`, `GET /api/usage/budget`).
- Both are based on estimated prices, so one unpriced or mispriced model makes the cap meaningless.
  SEC-29 says the run supervisor enforces budgets, not the agent. OmniRoute's budgets could at most
  be a second layer.

## 3. Compression (RTK, Caveman)

Compression is **off by default**: `DEFAULT_COMPRESSION_CONFIG = { enabled: false, defaultMode:
"off", … }` (`open-sse/services/compression/types.ts:419-421`). The same default sets
`mcpDescriptionCompressionEnabled: true`; I did not verify whether that applies while `enabled` is
false.

| Mode | What it does to a request | Source |
|---|---|---|
| Lite | Collapses whitespace, deduplicates system prompts, compresses tool results, shortens base64 images | `docs/compression/COMPRESSION_GUIDE.md`; `open-sse/services/compression/lite.ts` |
| Standard ("Caveman") | 34 regex rules that delete or shorten prose. Examples: `"you should"`, `"remember to"`, `"it is important to"` → `""`; `"make sure to"` → `"ensure "`; also drops "sure", "certainly", "thanks" | `open-sse/services/compression/cavemanRules.ts`, `caveman.ts` |
| Aggressive | Ages older messages and summarizes history | `aggressive.ts`, `progressiveAging.ts`, `summarizer.ts` |
| Ultra | Heuristic pruning and code-block thinning | `ultra.ts`, `ultraHeuristic.ts` |
| RTK | 49 command-aware filters over tool and terminal output: `git diff`/`status`/`log`, Vitest/Jest/Pytest/Playwright, tsc/eslint, npm, docker. It claims 60–90% savings | `docs/compression/RTK_COMPRESSION.md`; `open-sse/services/compression/engines/rtk/` |
| Stacked | Usually RTK, then Caveman | same |

Code blocks are protected by sentinel placeholders (`open-sse/services/compression/preservation.ts`).
The rules still run over all other prose.

**Correctness risks for coding agents:**

1. **The reviewer can miss code.** RTK filters `git diff` and test output. Our reviewer gate
   (SEC-18/19) and tests gate (SEC-20) treat that text as evidence. If filtered lines never reach
   the model, a pass can cover code nobody read.
2. **Instructions get weaker.** Caveman deletes "you should", "remember to" and "it is important
   to". Those words carry obligation in job bodies, reviewer rubrics and the SEC-19 "the block is
   data" instruction.
3. **Lane-controlled filters.** RTK loads project filters from `.rtk/filters.{toml,json}` when
   `.rtk/trust.json` holds a matching hash (`docs/compression/RTK_COMPRESSION.md` "Filter
   Resolution"). A lane can write both files in its worktree. If "project" resolves to the lane's
   cwd, a prompt-injected lane decides what the model sees of its own tool output. I did not verify
   how RTK resolves the project root.
4. **Cache and cost side effects.** Rewriting a prefix defeats prompt caching, which can raise cost.
   OmniRoute has cache-aware logic (`cachingAware.ts`, `prefixFreeze.ts`), but prefix freezing is
   off by default.

Position for us: compression stays off for all Ninebrains traffic and is never available to
reviewer runs. Any later "lite for subagents" needs our own eval.

## 4. Credential and ToS audit

### 4.1 What the vendors say (checked 2026-09-12)

- **Anthropic, Agent SDK overview:** "Unless previously approved, Anthropic does not allow third
  party developers to offer claude.ai login or rate limits for their products, including agents
  built on the Claude Agent SDK. Use the API key authentication methods … instead."
  (<https://code.claude.com/docs/en/agent-sdk/overview>)
- **Anthropic, LLM gateways:** any gateway that exposes a supported API format works. "Anthropic
  doesn't endorse, maintain, or audit third-party gateway products, and doesn't support routing
  Claude Code to non-Claude models through any gateway." With a gateway credential, "a developer's
  claude.ai subscription isn't used … billed per token to whoever owns the credential the gateway
  forwards". Also: setting **only** `ANTHROPIC_BASE_URL` "doesn't replace the subscription … a saved
  claude.ai login remains the active credential" (<https://code.claude.com/docs/en/llm-gateway>).
  So a lane pointed at a gateway without its own gateway token sends the user's claude.ai login
  through that gateway. That is a D5 problem.
- **Anthropic enforcement:** OAuth tokens from Free, Pro and Max plans are barred outside Claude
  Code and claude.ai. Server-side blocking started 2026-01-09. OpenCode removed its Claude OAuth
  code on 2026-02-19 ([The Register](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/),
  [AlternativeTo](https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use)).
  The plan help article (updated 2026-06-16) allows third-party apps only when they "authenticate
  with your Claude subscription through the Agent SDK"
  (<https://support.claude.com/en/articles/15036540>). OmniRoute does not use the Agent SDK. It
  replays Claude Code's OAuth client.
- **Google:** in February 2026 Google mass-suspended Antigravity and Gemini CLI accounts, including
  paid Ultra accounts, for proxying Antigravity OAuth into third-party tools
  ([openclaw.rocks](https://openclaw.rocks/blog/google-antigravity-ban),
  [gemini-cli #25743](https://github.com/google-gemini/gemini-cli/issues/25743)).
- **GitHub Copilot:** third-party proxies of Copilot's internal API are unsupported and risk
  suspension ([Copilot product terms](https://github.com/customer-terms/github-copilot-product-specific-terms),
  [community #178117](https://github.com/orgs/community/discussions/178117)).
- **OpenAI:** ChatGPT subscriptions are personal, and using ChatGPT to power third-party services is
  prohibited ([service terms](https://openai.com/policies/service-terms/)). Personal use of Codex
  OAuth in other harnesses is tolerated but not committed to
  ([manifest.build](https://manifest.build/blog/chatgpt-plus-tokens-third-party-harnesses/)). An app
  that ships and launches the proxy is not personal use.

### 4.2 OmniRoute auth modes, classified

Counts come from `authType` across `open-sse/config/providers/registry/` (274 providers). The
headline "352 providers" figure includes media, search and OCR registries.

| Mode | Providers (examples, with evidence) | What it does | Class |
|---|---|---|---|
| `apikey`, paid API | 186 registry entries: Anthropic, OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Together, Fireworks, Gemini API, Bedrock, Azure, Vertex… | The user's own platform API key | **SAFE** (BYOK) |
| `apikey`, legitimate free tier | `freeTierProviders.ts`, `freeModelCatalog.data.ts` (Gemini API free tier, Groq, OpenRouter `:free`, NVIDIA NIM, OVHcloud) | The user's own key within the vendor's published free tier | **SAFE**, if we check each vendor's terms before listing it |
| Local | Ollama, LM Studio, vLLM and other OpenAI-compatible URLs (`open-sse/config/ollamaModels.ts`). Needs the private-URL allowance (`src/shared/network/outboundUrlGuard.ts`) | Local model | **SAFE** |
| `apikey`, subscription-plan keys | "coding plan" style keys such as `kimi/coding`, GLM, MiniMax plans | Plan keys whose terms may limit which tools can use them | **REVIEW** each; default EXCLUDE |
| `oauth`: Claude | `registry/claude/index.ts`: `authType:"oauth"`, `tokenUrl: https://api.anthropic.com/v1/oauth/token`, Claude Code client ID embedded (`resolvePublicCred("claude_id")`), `getClaudeCliHeaders()` sets `User-Agent` to Claude Code's and `X-App: cli` (`shared.ts:760-777`) | Serves any client from a Pro/Max login while posing as Claude Code | **EXCLUDE** (D5; Agent SDK note; OAuth ban) |
| Claude Code impersonation | `open-sse/services/claudeCodeCCH.ts` ("computes an xxHash64 integrity token … The server verifies this to confirm the request came from a genuine Claude Code client"); `claudeCodeFingerprint.ts` (billing-header fingerprint with an embedded salt); `claudeCodeObfuscation.ts` (inserts zero-width joiners into "opencode", "cursor", "cline"… "to prevent detection by upstream content filters") | Forges client identity and evades detection | **EXCLUDE**. We must not ship this code at all, even disabled |
| `oauth`: Codex / ChatGPT | `registry/codex/index.ts` → `https://chatgpt.com/backend-api/codex/responses`, Codex CLI client ID (`src/lib/oauth/codexDeviceFlow.ts:36`); `codex-app-server` | ChatGPT subscription used by other clients | **EXCLUDE** |
| `oauth`: GitHub Copilot | `registry/github`, `ghe-copilot` → `api.githubcopilot.com`, Copilot client ID | Copilot seat used by other clients | **EXCLUDE** |
| `oauth`: Google Antigravity | `registry/antigravity`, `agy`, Antigravity client ID and secret | Antigravity/Gemini subscription proxy | **EXCLUDE** |
| `oauth`: Kiro | `registry/kiro` → CodeWhisperer, Kiro desktop refresh endpoint. `/api/oauth/kiro/auto-import` reads `~/.local/share/kiro-cli/data.sqlite3` and `~/.aws/sso/cache` (`route.ts:80,280`) | Subscription proxy that also harvests local credentials | **EXCLUDE** |
| `oauth`: other vendors' app logins | `cursor`, `devin-cli`, `devin-desktop`, `trae`, `zed-hosted`, `kilocode`, `cline`, `clinepass`, `codebuddy-cn`, `kimi-coding`, `grok-cli`, `xai-oauth`, `openference`, `gitlab-duo`, `qoder` (`src/lib/oauth/providers/`) | Each reuses one vendor app's login for other clients | **EXCLUDE** |
| Web session cookies | 22 web entries (`claude/web`, `chatgpt-web-codex`, `gemini/web`, `copilot-web`, `copilot-m365-web`, `perplexity/web`, `grok-web`, `deepseek/web`, `kimi/web`, `notion-web`, `t3-web`, …), plus `suno` (cookie). Chrome 124 TLS impersonation via `wreq-js` (`docs/security/STEALTH_GUIDE.md`, `open-sse/utils/tlsClient.ts`); Turnstile solver (`open-sse/services/claudeTurnstileSolver.ts`) | Scrapes consumer web apps | **EXCLUDE** |
| `none` / `optional`: anonymous scraping | `duckduckgo-web`, `veoaifree-web`, `cloudflare-playground`, `chipotle`, `zcode`, `auggie`, `g4f-*` (gpt4free) | Unofficial access to other companies' endpoints | **EXCLUDE** (`pollinations` and `kilo-gateway` are REVIEW) |
| Credential import and export | `/api/oauth/cliproxy-import` reads `~/.cli-proxy-api/` (`route.ts:14-22`). `/api/oauth/codex/import` accepts Codex `auth.json`. The dashboard exports and applies `claude-auth.json` and `codex-auth.json` (`useAuthFileHandlers.ts:46-173`) | Moves provider tokens between tools | **EXCLUDE** (SEC-34) |
| Embedded relays | CLIProxyAPI ("Anthropic CLI auth flows"), Dario ("Claude-subscription proxy"), 9Router (`docs/frameworks/EMBEDDED-SERVICES.md`) | Installs more subscription proxies | **EXCLUDE** |

**Result:** SAFE means BYOK paid API keys, legitimate free tiers used with the user's own key, and
local models. Everything built on logins, cookies, anonymous scraping or relays is EXCLUDE. Every
path that impersonates Claude Code is EXCLUDE. Pruning cannot be a runtime toggle. OmniRoute's
dashboard would let any user re-add a Claude OAuth account, and then our lanes would be serving
claude.ai rate limits through software we ship.

## 5. Security against our threat model

| Topic | Finding | Evidence | Conflicts with |
|---|---|---|---|
| Bind + auth | `omniroute serve` binds `0.0.0.0`, and `REQUIRE_API_KEY=false` is the default. The anonymous `/v1` is then reachable from the LAN. This is a known advisory (GHSA-wmgv-ph3p-rv57) and the code only logs a warning | `bin/cli/utils/serverHost.mjs:16-40`; `.env.example:393`; `src/lib/startup/nonLoopbackApiKeyGuard.ts` | SEC-04/05 posture, TB4 |
| Loopback trust | The management tier (`LOCAL_ONLY`) is open to any loopback caller, and `/api/mcp/` also accepts a key with the `manage` scope. Its surface includes plugin middleware compiled with `vm.Script`, service launchers that spawn docker/podman, the job registry, discovery probes and Kiro credential import. Every lane is a loopback caller. I did not verify whether each route also requires a dashboard session | `src/server/authz/routeGuard.ts:4-126` | THREAT-MODEL §1 boundary 2; T01, T25 |
| Egress bypass | `/v1/web/fetch`, the search tools and the MCP tools are an outbound HTTP path. A lane allowed to reach the sidecar could use it as a proxy around the unattended egress allowlist | `src/app/api/v1/web/fetch/route.ts`; `docs/frameworks/MCP-SERVER.md` | SEC-21, SEC-32 |
| Key storage | Provider credentials are AES-256-GCM in `storage.sqlite`. If `STORAGE_ENCRYPTION_KEY` is unset they are stored as plaintext. The CLI and Electron generate that key into `~/.omniroute/.env` next to the DB, so any same-uid process can decrypt them. `keytar` is optional | `src/lib/db/encryption.ts:7,28-30,187`; `bin/omniroute.mjs:222-280`; `electron/main.js:760-781` | SEC-27 (safeStorage required, no plaintext) |
| Dashboard auth | JWT session. `INITIAL_PASSWORD=CHANGEME` is the documented default | `.env.example` §1 | TB1 |
| CORS | No wildcard. Allowlist comes from `CORS_ALLOWED_ORIGINS`; `CORS_ALLOW_ALL=true` is opt-in. I did not verify Host-header or DNS-rebinding checks | `src/server/cors/origins.ts:1-20` | SEC-05 would need a Host check |
| Phone-home | No analytics SDK found. The CLI checks npm for updates daily. Radar feed (`radar.omniroute.online`) is off by default. LiteLLM and models.dev syncs are off by default. Cloud sync runs only when `CLOUD_URL` is set. Postinstall may download native prebuilds. Embedded services install from npm or GitHub at runtime. With 13.8k files this search is not exhaustive | `bin/omniroute.mjs:20-300`; `src/shared/constants/featureFlagDefinitions.ts:289-295`; `.env.example:1868,1909`; `src/lib/cloudSync.ts:5,89`; `scripts/build/postinstall.mjs:148-188` | SEC-38. We would need our own egress test with the sidecar running |
| Remote code | Runtime plugin marketplace and scanner (`src/lib/plugins/`), embedded-service installs, `.rtk` project filters | `docs/frameworks/PLUGIN_MARKETPLACE.md`; `EMBEDDED-SERVICES.md` | SEC-26 (pinned supply chain) |
| MITM | Traffic Inspector can install a root CA. TPROXY decrypt (Linux, root) is opt-in | `docs/security/MITM-TPROXY-DECRYPT.md` | A1 |
| Logs at rest | Call logs kept 7 days / 10k entries. Payload request logs are off by default. I did not verify whether stream chunks are captured by default | `.env.example:1728-1755` | SEC-24, SEC-35 (our redactor never sees them) |
| Env | Lanes would need `ANTHROPIC_BASE_URL` and a gateway token, and Codex needs `OMNIROUTE_API_KEY`. That is a deliberate change to the SEC-13 allowlist. A lane's Bash can read the token and call the sidecar directly | `docs/guides/*-CONFIGURATION.md` | SEC-13, A5, A8 |

## 6. Licences (production dependencies)

- Top level: MIT (`LICENSE`), which is compatible with our Apache-2.0 fork.
- I scanned the `license` field of the 1,052 non-dev packages in `package-lock.json`. Copyleft found:
  **LGPL-3.0-or-later** in the prebuilt libvips binaries under `sharp` (`@img/sharp-libvips-*`,
  `@img/sharp-win32-*`, `@img/sharp-wasm32`). That is normally acceptable for dynamic linking with a
  notice and a way to relink, but it needs legal sign-off for our installer. `dompurify` is
  `MPL-2.0 OR Apache-2.0`; we take Apache-2.0. No GPL, AGPL, SSPL, Commons Clause, BUSL or Elastic
  licences found.
- **No licence field** on 8 packages. Five are OmniRoute's own workspaces. The other three need a
  manual check: `@eloqnt/config`, `@eloqnt/format-json`, `@eloqnt/format-po`, and also `khroma`.
- Vendored and asset provenance: `THIRD_PARTY_NOTICES.md` lists a vendored `codex-chatgpt-web`
  (MIT) and provider icon sets that include 2 "brand-use" entries, 1 "Custom" and 1 "MISSING"
  (`THIRD_PARTY_NOTICES.md:303-334`). The common `chatgpt-web` provider was retired because its
  "provenance … could not be cleared" (`docs/providers/CHATGPT_WEB.md`).
- This scan read lockfile metadata only. Our plan 0.4 licence CI would have to run on the real
  bundle.

## 7. Integration options, ranked

These apply in all three options:
- **D5 line.** Routing applies only to lanes and jobs in API-key mode. A lane on the user's own
  `claude` or `codex` login is never given `ANTHROPIC_BASE_URL` or a Codex provider override,
  because per Anthropic's gateway doc that would send the claude.ai login through the gateway.
- **Supervisor authority.** SEC-29 budgets are enforced from stream-json `usage` and Codex events by
  our run supervisor. A gateway's own budgets can be a second layer at most.

### Rank 1: (c) Port only the routing, fallback and cost ideas. Recommended

Build `app/core/features/routing/` (new slice, no upstream patch):

- **Model profiles.** `{id, provider, protocol: anthropic|openai-responses, baseUrl, model, keyRef,
  price{in,out,cacheRead}, contextWindow, tier: cheap|standard|strong}` in the Brain DB. Validated
  with zod, and edited only in the UI (TB1).
- **Policy.** `pickProfile(job, lane)` sits next to `route.ts`. Defaults: reviewer gets `strong`,
  pinned, with no fallback to a weaker tier, so a reviewer that cannot run means `blocked`, never
  `pass`. Worker gets `standard`. Subagents get `cheap`. For subagent-level choice inside one Claude
  run, use Claude Code's per-subagent `model:` setting and model-alias env variables; verify the
  exact names in the Claude Code docs before building on them.
- **Fallback.** Copy OmniRoute's classification rule (transient means fail over; auth and invalid
  mean stop) and its circuit breaker. On failure, retry the job with the next profile in the
  supervisor. Log every model swap to `security_events` and show it on the job.
- **Launch.** In `buildLaneLaunch` and `claude-print.ts` / `codex-exec.ts`, set
  `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` for Anthropic-protocol vendors, or
  `-c model_providers.<id>.*` + `env_key` for OpenAI-Responses vendors. Also Claude Code's native
  Bedrock, Vertex and Foundry switches. Decrypt the key from safeStorage (SEC-27) only into that
  spawn's env.
- **Cost.** Per-run cost = stream-json `usage` × profile price, stored in `runs`. A dashboard view
  per job, lane and plan. An unpriced profile blocks unattended use, so cost is never silently $0.
- **Protocol gap.** Without a translator, we can only use vendors that expose an Anthropic-compatible
  or OpenAI-Responses-compatible endpoint themselves. Several vendors document Anthropic-compatible
  endpoints (for example DeepSeek, Moonshot, Z.ai); verify each before listing it. If translation
  becomes necessary, that is a separate decision (a small vetted translator, or rank 2).
- **Effort:** about 2–3 weeks for one developer, including tests (SEC-13 env snapshot, SEC-29
  budget, a D5 test that subscription lanes carry no base URL, reviewer no-downgrade).
- **Risks:** fewer providers than OmniRoute. Anthropic doesn't support Claude Code on non-Claude
  models, so some features may break on cheap profiles. Every vendor price must be kept current.

### Rank 2: (a) A pruned OmniRoute fork as a managed sidecar

Only worth it if we need broad protocol translation. It is a fork, not a sidecar of upstream.

- **Strip** every EXCLUDE provider and executor, `claudeCode{CCH,Fingerprint,Obfuscation,…}`, TLS
  stealth, MITM/TPROXY, embedded services, plugins and middleware, tunnels (ngrok, cloudflared),
  cloud sync, Radar, credential import/export and `update-notifier`. Leave compression compiled out.
  A `minimal` build profile exists (`build:secure`, `OMNIROUTE_BUILD_PROFILE=minimal`); I did not
  verify what it removes.
- **Run** it on Electron's Node the way `electron/main.js:833-846` does, with
  `OMNIROUTE_SERVER_HOST=127.0.0.1`, `REQUIRE_API_KEY=true`, a port lease (SEAMS §3.3), and a
  per-launch key per lane. Keep `DATA_DIR` under `<userData>/ninebrains/omniroute` (0700, on the
  lane deny-read list). Disable the dashboard or put it behind our UI.
- **Keys:** push provider keys in at launch from safeStorage, never into its `.env`. Or accept its
  AES store only under the deny-read list, as a documented risk.
- **Close** the loopback management tier and `/v1/web/fetch` to lane callers. Test SEC-21, SEC-32
  and SEC-38 with the sidecar running.
- **Effort:** 4–6 weeks to prune and harden, then an ongoing rebase against about 1,800 commits a
  month from one dominant maintainer. The install grows by hundreds of MB (npm unpacked size is
  452 MB) and needs Node 22.22 or later.
- **Risks:** pruning misses a path. Upstream re-adds a provider under a new id. The stealth code
  stays in our git history and SBOM.

### Rank 3: (b) Depend on an npm package. Not viable

`omniroute` on npm is the whole CLI and app (452 MB, 82 production dependencies). The engine
`@omniroute/open-sse` is private and depends on the app's DB layer. There is no library API.
Depending on it installs every EXCLUDE path. The related npm packages (`opencode-omniroute-*`,
`@omniroute/opencode-provider`, `omniroute-claude`) are client plugins, not engines.

### Not an option: bundling unmodified upstream

It ships every EXCLUDE mode reachable from its dashboard, the `0.0.0.0` default, a
loopback-trusted management API and the Claude Code impersonation code.

## 8. Top risks

1. **ToS / D5.** OmniRoute's headline value is subscription pooling: account rotation, reused
   consumer OAuth clients, web-cookie scraping and Claude Code impersonation (CCH, fingerprint,
   zero-width obfuscation). Anthropic, Google and GitHub all enforce against this. Shipping it,
   even disabled, makes Ninebrains a distributor of a circumvention tool and risks our users'
   accounts. Separately, pointing a subscription lane at any gateway sends the claude.ai login
   through it.
2. **Security boundary.** The defaults (`0.0.0.0`, no API key, encryption key beside the DB) and a
   loopback-trusted management and egress surface let any lane reach provider keys, run plugins,
   or fetch arbitrary URLs. That breaks THREAT-MODEL §1 boundary 2, SEC-21/27/32, and leaves SEC-38
   unproven.
3. **Correctness and cost.** Compression (RTK on diffs and test logs, Caveman on instructions) can
   hide code from the reviewer. Costs are estimates, and unpriced models count as $0. Automatic
   fallback can silently downgrade a reviewer. The upstream moves about 1,800 commits a month, so
   any fork is a permanent rebase job.

## 9. Not verified (follow-ups)

- Whether each `LOCAL_ONLY` route also requires a dashboard session, or loopback alone is enough.
- How RTK resolves the project root for `.rtk/` filters.
- What `OMNIROUTE_BUILD_PROFILE=minimal` removes.
- Whether call-log pipeline chunk capture (and so prompt text at rest) is on by default.
- Whether `mcpDescriptionCompressionEnabled` applies while compression is disabled.
- Licence of the four packages that have no `license` field.
- Which vendors really expose Anthropic-compatible or OpenAI-Responses endpoints (rank 1 protocol
  gap), and the exact Claude Code env and frontmatter names for subagent models.
