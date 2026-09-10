# Packs (plan tasks 5.1–5.4)

A **discipline pack** is a per-project bundle of lane **roles**, **skills**, **MCP servers** and
**gates**. Packs are toggled per project in Settings → Packs. A lane launched in a project gets
the servers, role prompt and default gates of that project's enabled packs, and nothing from the
others.

## Layout

| Path | What |
|---|---|
| `api/pack-schema.ts` | `pack.json` zod schema (strict; licence allowlist; secrets by name only) |
| `api/contract.ts` | Wire contract: `list({ projectId })`, `setEnabled({ projectId, packId, enabled })` |
| `api/launch.ts` | `McpServerEntry`, `PackLaunch` (what a pack gives one lane launch) |
| `node/loader.ts` | Loads bundled packs, then `<userData>/ninebrains/packs/<id>/pack.json`; per-pack errors |
| `node/resolve-launch.ts` | Merges enabled packs into a `PackLaunch`; resolves secrets |
| `node/prefs-store.ts` | `PackPrefsStore` port + memento implementation (per project + app index) |
| `node/skills-sync.ts` | Installs `nb-<pack>-<skill>` skills; removes them when a pack is enabled nowhere |
| `node/gates/` | The `seo-evidence` gate and the `seo-findings.json` contract |
| `node/packs-service.ts` | `createPacksService(deps)`: the one object the app wires |
| `node/bundled/` | `coding`, `research`, `seo` |
| `browser/packs-view.tsx` | The settings page (Emdash design-system components only) |

## `pack.json`

```jsonc
{
  "id": "seo", "version": "0.1.0", "title": "…", "description": "…", "license": "Apache-2.0",
  "roles": [{ "id": "seo-lead", "title": "…", "kind": "seo", "systemPrompt": "…",
              "provider": "claude", "model": "…", "gates": ["seo-evidence"] }],
  "skills": [{ "id": "seo-traffic-drop", "path": "skills/seo-traffic-drop/SKILL.md",
               "license": "Apache-2.0", "source": "upstream origin, for attribution" }],
  "mcpServers": [
    { "name": "aeo-search", "transport": "http", "url": "https://…",
      "headers": { "Authorization": { "secret": "GOOGLE_ACCESS_TOKEN", "prefix": "Bearer " } },
      "optional": false, "description": "…", "homepage": "https://…", "license": "Apache-2.0" },
    { "name": "supabase", "transport": "stdio", "command": "npx", "args": ["-y", "pkg@1.2.3"],
      "env": { "SUPABASE_ACCESS_TOKEN": { "secret": "SUPABASE_ACCESS_TOKEN" } }, "…": "…" }
  ],
  "gates": ["seo-evidence"],
  "requiredSecrets": [{ "name": "GOOGLE_ACCESS_TOKEN", "description": "…", "howToGet": "…", "optional": false }],
  "catalogLinks": [{ "name": "Vercel", "description": "…", "url": "https://mcp.vercel.com", "auth": "oauth" }]
}
```

- `kind` is `code | ui | research | seo | video`. Gate ids must be gates-core built-ins (`tests`,
  `screenshot`, `reviewer`, `security-review`, `fact-check`) or `seo-evidence`; the loader rejects
  anything else.
- A secret is `{ "secret": NAME, "prefix"?, "optional"? }`. Every referenced NAME must be listed in
  `requiredSecrets`. `optional: true` on a reference drops just that header/env/arg when missing.
- Licences must be MIT, Apache-2.0, ISC, BSD-2/3-Clause or 0BSD.
- A user pack's directory name must equal its `id`, and it may not reuse a bundled id. Files are
  read with a realpath check, so a symlink cannot reach outside the pack directory.

## `resolvePackLaunch(projectId, roleId?)`

```ts
{
  mcpServers: McpServerEntry[];     // { name, type: 'stdio', command, args, env } | { name, type: 'http', url, headers }
  appendSystemPrompt?: string;      // the role's systemPrompt, when a role was found
  defaultGates: string[];           // role gates, else the pack's gates; union of packs when no role
  role?: { packId, roleId, kind, provider?, model? };
  warnings: { packId, server?, message, missingSecrets[] }[];
}
```

`roleId` is `role` (must be unique across enabled packs) or `pack:role`. A server with a missing
required secret is **left out** with a warning, never launched half-configured. Warnings never
contain secret values.

## Secrets

Secrets are resolved through the injected `SecretResolver { resolve(name), describeLocation(name) }`.
`createEnvSecretResolver(process.env)` reads `NINEBRAINS_SECRET_<NAME>`; a keychain-backed resolver
should replace it. No secret value is ever stored in a pack file or in prefs.

## Skills

Pack skills install through the upstream skills manager (SEAMS §3.16) as `nb-<pack>-<skill>`,
with the frontmatter `name` rewritten to match. Installation is idempotent (unchanged content is
not rewritten). A skill is removed once its pack is enabled in no project. **The `nb-` namespace
is reserved:** sync removes any `nb-*` skill it does not want. Skills install globally
(`~/.agentskills`), so a pack's skills are visible to lanes in other projects too (accepted for
v0.1, SEAMS §3.16).

## The `seo-evidence` gate

The SEO team writes `seo-findings.json` (the contract is in every SEO role prompt and in
`node/gates/seo-findings.ts`). Every finding needs at least one evidence item: a `query` (server,
tool, exact args, and the numbers cited), a `crawl` (URL + observation) or a `citation` (URL +
exact quote).

The gate spawns a read-only reviewer with the SEO pack's MCP servers, which re-runs each query and
re-fetches each URL, then replies with strict JSON: `confirmed | contradicted | unverifiable` per
finding. The gate fails on any contradicted finding, or when more than 20% are unverifiable
(`maxUnverifiableRatio`). A malformed reply fails. Feedback names each failing finding.

**Requirement on the app:** `spawnReviewer` must honour an extra `mcpServers` option
(`SeoReviewerOptions = SpawnReviewerOptions & { mcpServers?: McpServerEntry[] }`) by writing them
into the reviewer's `--mcp-config=`. gates-core is unchanged; the wider type lives in this slice.
An app that ignores the option leaves the reviewer unable to query, which shows up as
`unverifiable` and fails the gate, never as a false pass.

## Bundled packs

| Pack | Roles | Servers | Gates |
|---|---|---|---|
| `coding` | builder (code), ui-builder (ui), reviewer (code) | github (hosted, MIT), supabase (Apache-2.0), cloudflare (Apache-2.0), all optional; Vercel as an OAuth catalog link | tests, reviewer; ui-builder adds screenshot |
| `seo` | seo-lead, technical-seo, content-strategist, link-researcher, search-analyst, fact-checker | aeo-search, aeo-visibility, aeo-backlink (Apache-2.0, hosted); dataforseo (Apache-2.0, optional) | seo-evidence; lead adds reviewer |
| `research` | research-lead, researcher (one role, many lanes), fact-checker | none | fact-check, reviewer |
| `video` | Deferred to v0.3 (plan 5.5). Not built. | | |

All role prompts were written for this project from scratch.

> ⚠️ **Hand-verify the first SEO audits** before sending them to anyone. The aeo-toolkit scoring
> engine had accuracy bugs that were only fixed in aeo-toolkit PR #34, and the seo-evidence gate
> checks that cited numbers match the data, not that the data is the right data.

### SEO servers: facts checked on 2026-09-10

- **The `aeo-*-mcp` servers are not on npm.** `npm view aeo-search-mcp` (and `-visibility`,
  `-backlink`) returns 404; the names are the servers' `serverInfo.name` only. They run as hosted
  Streamable-HTTP endpoints in the aeo-toolkit console:
  - `https://aeo.advancelabs.dev/api/mcp/search/mcp`: headers `Authorization: Bearer <Google
    access token>` and optional `X-Bing-Api-Key`, both per request (19 tools).
  - `https://aeo.advancelabs.dev/api/mcp/ai-visibility/mcp`: no auth; tools take a Perplexity key
    as an argument (5 tools).
  - `https://aeo.advancelabs.dev/api/mcp/backlink/mcp`: no auth (7 tools).
- The hosted routes pass `checkEntitlement(req, 'mcp')`. That is open while aeo-toolkit billing is
  dormant, and will require a plan with MCP access once billing is switched on.
- The published aeo-toolkit npm packages are `@advance-labs/{crawler,html-parser,net-guard,
  schema-validator,scoring,types}`. **`@advance-labs/pdf` is not published**, so the SEO lead writes
  `seo-report.md` (Markdown) instead of a PDF.
- Google access tokens expire after about an hour: the secret store has to mint fresh ones.

### Skills

- `seo-cannibalization`, `seo-content-decay`, `seo-traffic-drop` are copied from
  `Advance-Labs/aeo-toolkit` @ `dc17e99` (Apache-2.0, © Advance Labs Inc.) with an attribution
  comment added after the frontmatter. They refer to the search server as `ga-gsc`; the SEO role
  prompts tell lanes it is registered as `aeo-search`.
- **`ai-seo` is not bundled.** `~/.claude/skills/ai-seo` is third-party
  (`coreyhaines31/marketingskills` @ `07cb466`, MIT), not ours. MIT would allow it with
  attribution, but its SKILL.md links files under `references/`, and the upstream skills manager
  installs a single SKILL.md, so the bundled copy would carry dead links. Revisit when the skills
  manager can install a directory.

## Wiring (for the integrator)

This slice does not touch `services.ts` or `wiring.ts`. To finish wiring:

1. In boot services, construct:
   ```ts
   createPacksService({
     prefs: createMementoPackPrefsStore(getMementosRuntimeClient),
     secrets: <keychain resolver>,          // or createEnvSecretResolver(process.env)
     skills: createRuntimeSkillsPort(runtimes),
     userPacksDir: join(app.getPath('userData'), 'ninebrains', 'packs'),
     onWarning: (m) => logger.warn(m),
   })
   ```
   and pass it as `packs` in `DesktopControllerContext`. Until then the controller falls back to
   `createFallbackPacksService` (memento prefs + skills manager, no secret store, bundled packs
   only), so the settings page works, but every secret shows as missing.
2. The Phase-2 launch builder calls `packs.resolvePackLaunch(projectId, roleId)` and merges
   `mcpServers` into the lane's `mcp.json` next to brain-mcp (using `--mcp-config=<path>`).
3. The gate runner registers `packs.createGates()` alongside the gates-core built-ins, and the
   app's `spawnReviewer` honours `mcpServers` (above).

## Upstream files touched (append-only registrations)

- `core/manifests/shared/domain-contracts.ts`: `[packsDomain]: packsContract`
- `core/manifests/node/controllers.ts`: `packs` controller + optional `packs?: PacksService` context field
- `core/manifests/shared/memento-catalog.ts`: the two pack mementos
- `core/manifests/browser/settings-page-contributions.ts`: `packsSettingsPage`
- `core/features/settings/contributions/views.ts`: `'packs'` in the settings tab enum
- `apps/emdash-desktop/package.json` + `pnpm-lock.yaml`: `@emdash/gates-core` dependency

## Decisions made while blocked

1. **`transport` added to the MCP server schema.** The brief's `{ command, args, env }` shape can't
   express the aeo-toolkit servers, which are hosted HTTP only. `http` servers carry `url` +
   `headers`; stdio servers keep `command` + `args` + `env`.
2. **Secrets can appear in args** (Cloudflare's server takes the account id as an argument). Prefer
   env; args are visible in the process list.
3. **GitHub uses the hosted endpoint** (`api.githubcopilot.com/mcp/`, PAT as a Bearer header), the
   one launch form that needs neither Docker nor a local binary. The README of github-mcp-server
   documents the binary (`github-mcp-server stdio`) for self-hosting.
4. **Prefs live in two mementos**: one per project (deleted with the project) plus an app-level
   index of project ids, because mementos can't be listed by id and skill sync needs "enabled
   anywhere". Both use a 10-year retention so the default 60-day sweep can't drop user choices.
5. **The controller has a fallback service** so the domain contract and controller stay in key
   parity without editing `wiring.ts`.
6. **`seo-evidence` fails on configuration problems** (a cited server the reviewer can't use), with
   feedback that says so, rather than passing unverified work.
7. **Role kinds vs job kinds.** gates-core's `JobKind` has no `video`; pack role kinds do, for the
   deferred video pack. The Brain maps a role kind to a job kind when it creates a job.
