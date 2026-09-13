# Vendors: which endpoints a Ninebrains model profile can point at

Status: research, 2026-09-12. Phase R0 of `docs/plans/2026-09-12-model-routing.md`. Not a decision.

Scope (plan §1): the user's own pay-as-you-go API key, a free tier used with the user's own key,
or a local model. No OAuth, cookies or relays. "Coding plan" subscription keys are out of scope
unless their terms clearly allow a third-party launcher, and they are graded separately (§2.9).

Every link below was fetched or seen in search results on **2026-09-12**. "Secondary" marks a
non-vendor source. "Not verified" means I looked and could not confirm it, or did not look.

**What the labels mean**
- **SAFE**: the vendor documents the endpoint, a pay-as-you-go or free-tier key works with it, and
  I found no terms restricting tools or clients in the pages I checked. I did not read every
  vendor's full terms of service. A human should read them before a preset ships in the UI.
- **REVIEW**: something is uncertain or needs a human look. The one-line reason says why.
- **n/a**: the vendor has no such endpoint (none documented).
- **OUT**: excluded from scope.

Two facts shape the whole table:

1. **Codex speaks only the Responses API.** Codex's config reference lists `"responses"` as the
   only supported `wire_api` value, and it is the default
   ([Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference), 2026-09-12;
   `developers.openai.com/codex/config-reference` 308-redirects there). The deprecation notice
   said chat-completions support would turn into a hard error in February 2026
   ([openai/codex discussion #7782](https://github.com/openai/codex/discussions/7782), 2026-09-12).
   **Claim verified:** a vendor with only `/v1/chat/completions` does not work for Codex.
2. **Anthropic does not support Claude Code on non-Claude models.** Quote: "Anthropic doesn't
   endorse, maintain, or audit third-party gateway products, and doesn't support routing Claude
   Code to non-Claude models through any gateway"
   ([code.claude.com/docs/en/llm-gateway](https://code.claude.com/docs/en/llm-gateway), 2026-09-12).
   Every non-Claude profile on the `anthropic` protocol is "works, unsupported".

## 1. Summary

| Vendor | Anthropic `/v1/messages` (ANTHROPIC_BASE_URL) | Responses API (Codex base_url) | Free tier (vendor's own page) | Terms notes | Class |
|---|---|---|---|---|---|
| DeepSeek | Yes. `https://api.deepseek.com/anthropic`. Claude Code guide | None documented. Chat-completions only, so **no Codex** | None on pricing page | PRC law governs; training use not stated in the API terms | Anthropic: **REVIEW**. Responses: n/a |
| Moonshot / Kimi (Open Platform) | Yes. `https://api.moonshot.ai/anthropic`. Claude Code guide | Yes. `https://api.moonshot.ai/v1`. Codex guide | None. $1 minimum recharge. Tier0: 1 concurrent, 3 RPM | Open Platform ToS not verified | **REVIEW** (both) |
| Z.ai (GLM), pay-as-you-go | `https://api.z.ai/api/anthropic` is documented for the Coding Plan. Pay-as-you-go key on it: not verified | `https://api.z.ai/api/v1` is listed for the Coding Plan. Pay-as-you-go: not verified | GLM-4.7-Flash, GLM-4.5-Flash, GLM-4.6V-Flash priced "Free"; limits not stated | Free-tier data terms not verified | **REVIEW** (both) |
| MiniMax, pay-as-you-go | Yes. `https://api.minimax.io/anthropic` (China: `api.minimax.cn`) | Documented only on a Token Plan page. Pay-as-you-go: not verified | None found | ToS not verified | **REVIEW** (both) |
| OpenRouter (paid models) | Yes. `https://openrouter.ai/api`. Claude Code guide | Yes, **beta**, stateless. `https://openrouter.ai/api/v1` | n/a | Keeps no prompts by default | Anthropic: **SAFE**. Responses: **REVIEW** |
| OpenRouter (`:free` models) | Same endpoint | Same endpoint | 20 RPM. 50 RPD, or 1,000 RPD after $10 of credits | Downstream providers may train. Free models have their own opt-out setting | **REVIEW** |
| Groq | None documented | Yes. `https://api.groq.com/openai/v1`. Several fields unsupported | Yes. gpt-oss-120b: 30 RPM, 1K RPD, 8K TPM, 200K TPD | No training on inputs. Retains up to 30 days only for abuse/debugging. ZDR open to all | Anthropic: n/a. Responses: **REVIEW** |
| Together AI | None documented natively | None documented natively. TogetherLink runs a *local translation proxy* | "Start for free". One $0 model listed | Not verified | **REVIEW** (no native endpoint) |
| Fireworks AI | Yes. `https://api.fireworks.ai/inference`, Bearer auth. Claude Code page (via FireConnect) | Yes. `https://api.fireworks.ai/inference/v1`. Stored by default | $1 free credits | Responses have their own retention policy | Anthropic: **SAFE**. Responses: **REVIEW** |
| Ollama (local) | Yes, **v0.14.0+**. `http://localhost:11434` | Yes, **v0.13.3+**, non-stateful only. Codex built-in `ollama` provider | Local | Local | **SAFE** |
| LM Studio (local) | Yes, **0.4.1+**. `http://localhost:1234` | Yes, **0.3.29+**. `http://localhost:1234/v1`. Docs say Codex supported | Local | Local | **SAFE** |
| Z.ai GLM Coding Plan | Same endpoint | Same endpoint | Subscription | "Strictly limited to use within officially supported tools and products" | **OUT** |
| Kimi Code membership | Via API key in Claude Code, Roo Code, OpenCode | not verified | Subscription | Personal use only. Changing the User-Agent is a violation | **REVIEW** (excluded by plan scope) |
| MiniMax Token Plan | Same endpoint | `https://api.minimax.io/v1`, `wire_api="responses"` | Subscription | No tool restriction found. Key is "not interchangeable" with pay-as-you-go keys | **REVIEW** (excluded by plan scope) |

## 2. Per vendor

### 2.1 DeepSeek

| Claim | Evidence (accessed 2026-09-12) |
|---|---|
| Anthropic-format base URL is `https://api.deepseek.com/anthropic`. The OpenAI-format base is `https://api.deepseek.com` | [Using the Anthropic API](https://api-docs.deepseek.com/guides/anthropic_api); [Your First API Call](https://api-docs.deepseek.com/) |
| Official Claude Code guide. It sets `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` (`deepseek-flash[1m]` / `deepseek-flash`) and `CLAUDE_CODE_SUBAGENT_MODEL=deepseek-flash` | [Integrate with Claude Code](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code) |
| The server maps `claude-opus*` to `deepseek-v4-pro` and `claude-sonnet*`/`claude-haiku*` to `deepseek-flash`. Unknown names fall back to `deepseek-flash` | [Using the Anthropic API](https://api-docs.deepseek.com/guides/anthropic_api) |
| Some Anthropic fields and content types are unsupported: document and search-result content, MCP-server fields, code-execution results, container uploads, some headers. `top_k` is ignored | same |
| No Responses API. The docs list only the OpenAI and Anthropic formats and never mention `/v1/responses` | [Your First API Call](https://api-docs.deepseek.com/) |
| No free tier on the pricing page. `deepseek-flash` costs $0.15 in / $0.60 out per MTok off-peak, and double at peak (01:00–04:00 and 06:00–10:00 UTC, Mon–Fri) | [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing) |
| A "5M free tokens for new accounts" claim appears only in secondary sources. Not verified | [nxcode](https://www.nxcode.io/resources/news/deepseek-api-pricing-complete-guide-2026) (secondary) |
| The API terms put disputes under the laws of mainland China. I found no clause restricting third-party or coding tools. The terms page did not state training use of API data | [DeepSeek Open Platform Terms of Service](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html), effective 2026-04-29 |

**Class:** Anthropic **REVIEW**, because PRC jurisdiction and unclear training terms need a human
decision before we offer a preset. Responses **n/a**, so no Codex.

### 2.2 Moonshot / Kimi (Open Platform, pay-as-you-go)

| Claim | Evidence (accessed 2026-09-12) |
|---|---|
| Claude Code guide: `ANTHROPIC_BASE_URL=https://api.moonshot.ai/anthropic`, `ANTHROPIC_AUTH_TOKEN=<Moonshot key>`, models `kimi-k3[1m]` and `kimi-k2.7-code` | [Use Kimi in Claude Code](https://platform.kimi.ai/docs/guide/claude-code-kimi) (`platform.moonshot.ai` 301-redirects to `platform.kimi.ai`) |
| `kimi-k2.7-code` forces thinking on. A request without thinking gets `400 invalid thinking` | same |
| Codex guide: `base_url="https://api.moonshot.ai/v1"`, `wire_api="responses"`, `env_key="KIMI_API_KEY"`, model `kimi-k3`. Keys from platform.kimi.ai only work with `api.moonshot.ai/v1` | [Use Kimi K3 in Codex](https://platform.kimi.ai/docs/guide/codex-kimi) |
| No free tier. You must recharge at least $1. A $5 voucher follows $5 of cumulative recharge. Tier0 limits: concurrency 1, 3 RPM, 500,000 TPM, 1,500,000 TPD | [Recharge and Rate Limiting](https://platform.kimi.ai/docs/pricing/limits) |
| Open Platform terms of service and data-use terms | not verified |

**Class:** **REVIEW** for both protocols, because the endpoints are well documented but I did not read
the Open Platform terms. Tier0's single concurrency slot will also stall any lane with subagents.

### 2.3 Z.ai (GLM), pay-as-you-go

| Claim | Evidence (accessed 2026-09-12) |
|---|---|
| The general API base is `https://api.z.ai/api/paas/v4`. The intro page does not mention an Anthropic endpoint or `/responses` | [API Introduction](https://docs.z.ai/api-reference/introduction) |
| Claude Code guide: `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic`, `ANTHROPIC_AUTH_TOKEN=<Z.AI key>`, `API_TIMEOUT_MS=3000000`. The page speaks of "configuring the subscription" | [Claude Code](https://docs.z.ai/scenario-example/develop-tools/claude) |
| The Coding Plan quick start lists three endpoints: Anthropic `https://api.z.ai/api/anthropic`, OpenAI Chat `https://api.z.ai/api/coding/paas/v4` and OpenAI Responses `https://api.z.ai/api/v1` | [Quick Start](https://docs.z.ai/devpack/quick-start) |
| Whether a **pay-as-you-go** key works on `/api/anthropic` or `/api/v1` responses | not verified |
| GLM-4.7-Flash, GLM-4.5-Flash and GLM-4.6V-Flash are priced "Free". The page states no rate limits | [Pricing](https://docs.z.ai/guides/overview/pricing) |
| Data and training terms for free models | not verified |

**Class:** **REVIEW** for both, because pay-as-you-go access to the Anthropic and Responses
endpoints is only implied. A live test with a pay-as-you-go key would settle it. The free Flash
models are the most attractive free tier here, if their data terms check out.

### 2.4 MiniMax, pay-as-you-go

| Claim | Evidence (accessed 2026-09-12) |
|---|---|
| Pay-as-you-go and Token Plan keys are separate. Base URLs: Anthropic `https://api.minimax.io/anthropic`, OpenAI `https://api.minimax.io/v1` | [Prerequisites](https://platform.minimax.io/docs/guides/quickstart-preparation) |
| Claude Code guide (under the Token Plan docs): `ANTHROPIC_BASE_URL` is `https://api.minimax.io/anthropic` (international) or `https://api.minimax.cn/anthropic` (China), with `ANTHROPIC_AUTH_TOKEN` and model `MiniMax-M3[1m]` | [Claude Code](https://platform.minimax.io/docs/token-plan/claude-code) |
| The OpenAI SDK page documents chat completions only. It does not document a `/v1/responses` route | [OpenAI SDK](https://platform.minimax.io/docs/api-reference/text-openai-api) |
| The Codex guide uses `base_url="https://api.minimax.io/v1"` and `wire_api="responses"` with a **Token Plan** key | [Codex](https://platform.minimax.io/docs/token-plan/codex) |
| A MiniMax GitHub issue once asked for Responses support because only chat completions existed | [MiniMax-M2 #112](https://github.com/MiniMax-AI/MiniMax-M2/issues/112) (vendor repo, issue thread) |
| Free tier | none found on the pages above |
| ToS and data terms | not verified |

**Class:** **REVIEW** for both. The pay-as-you-go Anthropic endpoint is documented, but the
Responses route is documented only for Token Plan keys, and I did not read the terms.

### 2.5 OpenRouter

| Claim | Evidence (accessed 2026-09-12) |
|---|---|
| Claude Code guide: `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `ANTHROPIC_AUTH_TOKEN=<OpenRouter key>`, and `ANTHROPIC_API_KEY=""` set to an explicit empty string, because otherwise it is sent as `x-api-key` | [Claude Code integration](https://openrouter.ai/docs/guides/guides/claude-code-integration) |
| The guide says "Claude Code is optimized for Anthropic models and may not work correctly with other providers" | same |
| Responses API at `https://openrouter.ai/api/v1/responses`. It is beta and stateless. `store: true` or a non-null `previous_response_id` gets a `400` | [Responses API](https://openrouter.ai/docs/api/reference/responses/overview) |
| `:free` models allow 20 RPM and 50 RPD. After at least $10 of credit purchases, 1,000 RPD | [Limits](https://openrouter.ai/docs/api/reference/limits) |
| OpenRouter stores no prompts or responses unless you opt in | [Data Collection](https://openrouter.ai/docs/guides/privacy/data-collection) |
| "Each provider on OpenRouter has its own data handling policies". Opting out of training stops routing to providers that train. "There are separate settings for paid and free models" | [Provider Logging](https://openrouter.ai/docs/guides/privacy/provider-logging) |

**Class:** Anthropic with paid models is **SAFE**. It is the one gateway here that documents Claude
Code and also serves real Claude models. Responses is **REVIEW**: it is beta and stateless, and
whether Codex's requests avoid `store: true` is not verified, so it needs a live Codex turn. `:free`
models are **REVIEW**: whether a free model's provider trains depends on a separate account setting,
and 50 RPD is too few for an agent session.

### 2.6 Groq

| Claim | Evidence (accessed 2026-09-12) |
|---|---|
| Responses API base is `https://api.groq.com/openai/v1`. Unsupported fields: `previous_response_id`, `store`, `truncation`, `include`, `safety_identifier`, `prompt_cache_key`, `prompt`. Conversation state is client-side only. Codex is not mentioned | [Responses API](https://console.groq.com/docs/responses-api) |
| Anthropic `/v1/messages` | none documented. Only third-party proxies appear in search ([Bifrost article](https://www.getmaxim.ai/articles/route-claude-code-through-groq-using-bifrost/), secondary). A Groq community feature request exists but its URL now redirects to groq.com, so not verified |
| Free plan limits: `openai/gpt-oss-120b` gets 30 RPM, 1K RPD, 8K TPM, 200K TPD | [Rate Limits](https://console.groq.com/docs/rate-limits) |
| Groq keeps no inference data by default. It may keep logs up to 30 days for reliability or abuse checks. Any customer can turn on ZDR. The page draws no free-vs-paid difference | [Your Data in GroqCloud](https://console.groq.com/docs/your-data) |
| Groq may not train on Inputs or Outputs unless the customer permits it | [Services Agreement](https://console.groq.com/docs/legal/services-agreement) (seen in search results) |

**Class:** Responses is **REVIEW**. The terms look clean, but whether Codex sends fields Groq rejects
(`include`, `store`) is not verified, so it needs a live test. The free tier's 8K TPM is also far
below one Codex turn's context. Anthropic is **n/a**.

### 2.7 Together AI

| Claim | Evidence (accessed 2026-09-12) |
|---|---|
| The OpenAI-compatible base is `https://api.together.ai/v1`. The compatibility matrix lists chat completions, completions, embeddings, images and audio. It lists no Responses API and no Anthropic Messages | [OpenAI compatibility](https://docs.together.ai/docs/inference/openai-compatibility) |
| The docs index has no Responses or Anthropic-compatibility page | [llms.txt](https://docs.together.ai/llms.txt) |
| Claude Code and Codex are supported through TogetherLink, which uses "a shared local translation proxy daemon" | [TogetherLink](https://docs.together.ai/docs/how-to-use-togetherlink.md) |
| The pricing page says "Start for free, scale on demand" and lists one $0 model (Ternary Bonsai 27B). Signup credits: not verified | [Pricing](https://www.together.ai/pricing) |

**Class:** **REVIEW**. Together exposes no native Anthropic or Responses endpoint. Using it means
running their proxy, which falls outside our credential scope, or translating chat completions in our
R4 router, which it does not do.

### 2.8 Fireworks AI

| Claim | Evidence (accessed 2026-09-12) |
|---|---|
| Anthropic `/v1/messages` (streaming and not) at base `https://api.fireworks.ai/inference`, with no `/v1`. Auth is `Authorization: Bearer $FIREWORKS_API_KEY`. Models use Fireworks IDs, e.g. `accounts/fireworks/models/deepseek-v3p2`. Server-side tools (web search, code execution) are unsupported, as is `adaptive` thinking | [Anthropic compatibility](https://docs.fireworks.ai/tools-sdks/anthropic-compatibility) |
| The official Claude Code page uses the FireConnect CLI, which authenticates with an `X-Fireworks-Api-Key` custom header | [Claude Code](https://docs.fireworks.ai/ecosystem/integrations/claude-code) |
| Responses API at `https://api.fireworks.ai/inference/v1`. Responses are stored by default. It "has a different data retention policy than the chat completions endpoint". Codex is not mentioned | [Responses API](https://docs.fireworks.ai/guides/response-api) |
| New accounts get "$1 in free credits" | [Pricing](https://fireworks.ai/pricing) |

**Class:** Anthropic is **SAFE**. Bearer auth means `ANTHROPIC_AUTH_TOKEN` should work without
FireConnect, but that exact env setup is not verified, so test it in R3. Responses is **REVIEW**: it
stores responses by default under a separate retention policy, and Codex use is undocumented.

### 2.9 Coding-plan subscriptions (excluded by plan §1)

| Plan | What the terms say (accessed 2026-09-12) | Class |
|---|---|---|
| Z.ai GLM Coding Plan | "The GLM Coding Plan is strictly limited to use within officially supported tools and products" ([Quick Start](https://docs.z.ai/devpack/quick-start)). Plan quota only works in supported tools, on the plan endpoints, with GLM-5.3 / GLM-5.3-Flash ([FAQ](https://docs.z.ai/devpack/faq)). A secondary source quotes Z.ai detecting "SDK-based access or other third-party integrations" ([earendil-works/pi #4187](https://github.com/earendil-works/pi/issues/4187), secondary) | **OUT**. Claude Code is a listed tool, but a launcher wrapping it is not clearly covered, and detection is enforced |
| Kimi Code membership | Works in "Claude Code, Roo Code, and OpenCode". "Tampering with the client identifier (User-Agent) will be considered a violation". For personal development, not enterprise. Product integration belongs on the Open Platform ([Membership guide](https://www.kimi.com/en/help/kimi-code/membership-guide)) | **REVIEW**. It plausibly allows a real `claude` launched by Ninebrains for personal use, but a human should confirm the personal-use limit fits our users |
| MiniMax Token Plan | Lists Claude Code, Cursor, OpenClaw and others. I found no tool restriction. "The Subscription Key is not interchangeable with pay-as-you-go API Keys" ([Token Plan Overview](https://platform.minimax.io/docs/token-plan/intro)) | **REVIEW**. No restriction found, but the full plan terms were not read |

## 3. Local models

| Server | `/v1/messages` (Claude Code) | `/v1/responses` (Codex) | Evidence (accessed 2026-09-12) |
|---|---|---|---|
| **Ollama** | **v0.14.0+** (2026-01-16). `ANTHROPIC_BASE_URL=http://localhost:11434`, `ANTHROPIC_AUTH_TOKEN=ollama` (required, ignored). Unsupported: token counting, `tool_choice`, prompt caching, batches, citations, PDFs, URL images. `budget_tokens` is accepted but not enforced | **v0.13.3+**. Non-stateful only: no `previous_response_id`, no `conversation`. Streaming, tools and reasoning summaries work | [Ollama blog](https://ollama.com/blog/claude); [Anthropic compatibility](https://docs.ollama.com/api/anthropic-compatibility); [OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility) |
| **LM Studio** | **0.4.1+** (2026-01-30). `ANTHROPIC_BASE_URL=http://localhost:1234`, `ANTHROPIC_AUTH_TOKEN=lmstudio`. `x-api-key` or Bearer when auth is on | **0.3.29+**, stateful with `previous_response_id`. Base `http://localhost:1234/v1`. Docs: "Codex is supported because LM Studio implements the OpenAI-compatible POST /v1/responses endpoint" | [LM Studio blog](https://lmstudio.ai/blog/claudecode); [Anthropic compat](https://lmstudio.ai/docs/developer/anthropic-compat); [OpenAI compat](https://lmstudio.ai/docs/developer/openai-compat); [0.3.29 blog](https://lmstudio.ai/blog/lmstudio-v0.3.29) |
| Codex built-ins | `openai`, `ollama` and `lmstudio` are reserved provider IDs, selected with `oss_provider`. They cannot be overridden | | [Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference) |

Both local servers are **SAFE**. The profile validator should check the server version:
- Ollama needs 0.14.0 or later for a Claude Code lane, and 0.13.3 or later for Codex.
- LM Studio needs 0.4.1 or later for Claude Code, and 0.3.29 or later for Codex.

LM Studio's Claude Code guide asks for at least 25K context. A secondary source recommends at least
32K for Ollama ([Medium](https://medium.com/@markbabcock_79883/run-claude-code-with-open-source-models-via-ollamas-anthropic-api-compatibility-0eeeb3a415f4), secondary).

## 4. What this means for Ninebrains

**`anthropic` protocol presets** (Claude Code lanes; all non-Claude models "works, unsupported"):

| Preset | Class | Notes for `launch-env.ts` |
|---|---|---|
| Ollama, LM Studio | SAFE | Ship first. R3's exit test runs on Ollama |
| OpenRouter (paid) | SAFE | Set `ANTHROPIC_API_KEY=""` explicitly. It also serves real Claude models, so it can be a "supported" profile when the model is Claude |
| Fireworks | SAFE | Use Bearer via `ANTHROPIC_AUTH_TOKEN`, and verify it in R3. Model IDs are `accounts/fireworks/models/...`, so the `ANTHROPIC_DEFAULT_*_MODEL` mapping is required |
| Kimi, MiniMax, Z.ai (pay-as-you-go) | REVIEW | Documented endpoints. They wait on a terms read, and for Z.ai a pay-as-you-go key test |
| DeepSeek | REVIEW | Jurisdiction and training decision for Lucas. The server maps `claude-*` names itself |

**`openai-responses` protocol presets** (Codex lanes):

| Preset | Class | Notes |
|---|---|---|
| Ollama, LM Studio | SAFE | Codex has built-in `ollama` / `lmstudio` providers. Prefer those over a custom `model_providers` block |
| Kimi | REVIEW | Official Codex guide. Terms not read |
| Groq, OpenRouter, Fireworks | REVIEW | Documented `/v1/responses`. Each is stateless, beta, or stores data by default. **Test connection must run one real Codex turn**, not just a models list, before a profile is marked usable |
| Z.ai, MiniMax (pay-as-you-go) | REVIEW | Responses documented only for coding-plan keys |
| DeepSeek, Together | not offered | No native Responses endpoint |

Other consequences:
- **Plan open question 2 (free tiers).** Only Groq, OpenRouter `:free`, Z.ai Flash and the local
  servers have real free usage. Groq's 8K TPM and OpenRouter's 50 RPD are too small for agent
  lanes. Unless the Z.ai Flash data terms clear, "free" in practice means local.
- **Tier0 concurrency.** Kimi Tier0 allows 1 concurrent request. That breaks a lane with parallel
  subagents unless the R4 router queues requests. Record per-profile concurrency limits in the
  profile.
- **Coding-plan keys** stay out of v0.1. Z.ai's plan is OUT. Kimi Code and MiniMax Token Plan need
  a human terms read before any preset.

## 5. Method and date

- Date: 2026-09-12. Tools: WebFetch on vendor docs pages and WebSearch for discovery. I cite a page
  only when I fetched it or it appeared in search results. Redirects are noted where they happened.
- WebFetch returns a model summary of each page, not raw HTML. Quotes above come from those
  summaries. Recheck exact wording against the live page before quoting it in UI copy.
- I did not send any API requests. Every "works" claim is the vendor's documentation, not a test.
  R3 must confirm each preset with a real lane.
- I did not read every vendor's full terms of service. "No restriction found" means none in the
  pages listed.
- **Not verified:**
  - Kimi, MiniMax, Z.ai and Together terms of service.
  - Z.ai pay-as-you-go access to `/api/anthropic` and `/api/v1`.
  - MiniMax pay-as-you-go Responses.
  - Codex compatibility with Groq, OpenRouter and Fireworks Responses.
  - Fireworks with plain `ANTHROPIC_AUTH_TOKEN`.
  - DeepSeek training terms.
  - Together signup credits.
  - Data terms for free models at Z.ai.
