# routing

Model routing for Ninebrains (`docs/plans/2026-09-12-model-routing.md`), wave 1 (R0–R3) plus the
start of wave 2 (`policy.ts`, `api/node/price.ts`; R4/R5). Lever A (subagent model) is always on.
Lever B (model profiles, your own API keys) is behind the `MODEL_PROFILES_ENABLED` build flag.

## Layout

| File | What it does |
|---|---|
| `api/contract.ts` | The `routing` wire contract: list/save/delete profiles, set/clear the key, test connection. Zod-typed, shared between main and renderer. |
| `api/profile.ts` | `ModelProfile` schema, kinds, protocols, tiers, prices, the login-host and base-URL checks. No key ever appears in these shapes; the renderer only sees `hasKey`. |
| `api/subagent-model.ts` | Lever A: `SubagentTier`, `resolveSubagentModel` (lane beats role, `inherit` emits nothing), and the model-id shape. |
| `api/node/launch-env.ts` | `routeLaunch` and `assertLaunchPolicy`: turns a lane's routing into env, `--settings` env and Codex config, and is the one place SEC-39 is enforced. |
| `api/node/managed-settings.ts` | Reads Claude Code's managed (enterprise) settings files and reports any gateway variable they set (SEC-39 refusal). |
| `api/node/price.ts` | R5: `usd(usage, price)`, `checkBudget`, `refusesUnpriced` — a profile's own USD cost and cap check, never the CLI's `--max-budget-usd` (SEC-43). Pure; `run_costs` persistence and supervisor wiring are not built yet. |
| `node/policy.ts` | R4: `resolveRoute(role, …)` — the tier a worker, subagent or reviewer runs at, and the SEC-42 pin (a reviewer blocks rather than falls back once every `strong`-tier profile is unavailable). Pure; nothing calls it yet (below). |
| `node/vendors.json` | The bundled, reviewed vendor allowlist (SEC-44). |
| `node/vendors.ts` | Loads and validates `vendors.json`, and checks a profile's base URL against it. |
| `node/keys.ts` | `ninebrains.model.<id>` in the keychain-backed secret store (SEC-40). |
| `node/profiles-repo.ts` | Brain DB rows for profiles. |
| `node/routing-service.ts` | The contract's implementation: CRUD, `testConnection`, and `prepareLaunch` (a lane's route for one launch). |
| `node/test-connection.ts` | The one GET of a profile's model list, with SEC-21-style address pinning and no redirects. |
| `node/wire-controller.ts` | Wires `routingContract` to `routingService` for IPC. |
| `browser/lane-routing.tsx` | The lane header badge and add-lane fields for subagent model and auth profile. |
| `browser/models-settings-view.tsx`, `browser/add-profile-form.tsx` | Settings → Models. |
| `contributions/lanes.ts`, `contributions/settings-page.tsx` | Registers the lane badge and the settings page into their host slices. |

## Flow

1. A lane's config (`RoutingLane`: provider, `subagentModel`, `authProfileId`) is read by
   `RoutingService.prepareLaunch`, which resolves a profile (decrypting its key, SEC-40) or falls
   back to `{ auth: { mode: 'subscription' } }`. It throws rather than silently falling back when a
   profile is missing, disabled, keyless, or profiles are off.
2. The result (`LaunchRouting`) goes to whichever builder is launching:
   - `brain/node/launch-config.ts` `buildLaneLaunch`, for attended lanes and Brain sessions;
   - `exec-runs/api/node/run-supervisor.ts`, for unattended claude/codex runs and reviewers (which
     never take a profile).
3. Each builder calls `routeLaunch(provider, routing)` to get env, `--settings` env and Codex
   config, then `assertLaunchPolicy(...)` right before spawning, on the argv and env it actually
   built. `assertLaunchPolicy` throws `LaunchPolicyError` rather than let a half-built or wrongly
   neutralized launch reach a child process.

## Two env layers, and why

Claude Code merges several sources of `env`, and the route has to win regardless of which layer it
lands in:

- **Process env** (`RoutedLaunch.env`). Upstream layers our `providerVars` over the user's
  allowlisted shell env. A layer can override a value but never delete it, so a subscription launch
  sets every gateway and alias variable to `''` rather than omitting it — the CLI treats an empty
  string as unset.
- **Our `--settings` file's `env` block** (`RoutedLaunch.settingsEnv`). Spike §13 found the
  precedence order is `--settings` > project settings > user settings > process env, so our
  `--settings` env is the only layer guaranteed to beat a gateway variable the user (or a stray
  shell export) set in their own settings files. It never carries a key; a key only ever lives in
  one spawn's process env (SEC-40).

Managed (enterprise-policy) settings outrank `--settings`. Since Ninebrains can't override those,
`managed-settings.ts` checks them ahead of launch and refuses rather than proceeding under an
unknown credential (SEC-39).

## SEC requirements

| SEC | What it is | Enforced in | `describe` |
|---|---|---|---|
| SEC-13 | The unattended env allowlist, updated for routing's variables | `exec-runs/api/node/run-env.ts` (`ROUTING_ENV_NAMES` from `launch-env.ts`) | `SEC-13 routing env comes only from the route` |
| SEC-39 | A subscription launch carries no gateway variable, alias to a non-Claude model, non-Claude subagent model, or Codex provider override | `api/node/launch-env.ts` (`routeLaunch`, `assertLaunchPolicy`) | `SEC-39 subscription runs carry no routing`, `SEC-39 profile routes` |
| SEC-40 | Keys live only in the keychain as `ninebrains.model.<id>`, write-only from the renderer, registered with the redactor | `node/keys.ts`, `node/routing-service.ts` | `SEC-40 keys are write-only`, `SEC-40 setProfileKey registers the redactor secret`, `SEC-40 no key bytes in the Brain DB` |
| SEC-41 | Managed Claude settings that set a gateway variable stop the launch outright | `api/node/managed-settings.ts` | `SEC-41 managed settings` |
| SEC-44 | Only the allowed profile kinds, protocols and vendor hosts; no OAuth, cookie, session or token-file kind; no consumer login host | `api/profile.ts`, `node/vendors.ts` | `SEC-44 allowed credential kinds and vendors`, `SEC-44 vendor allowlist`, `SEC-44` (routing-service) |
| SEC-45 | A profile launch's egress is the profile's host only (plus loopback for `local`) | `api/node/launch-env.ts` (`RoutedLaunch.egressHosts`) | covered inside the `SEC-39`/`R3` suites, no dedicated `describe` yet |
| SEC-42 | A reviewer pinned to a `strong`-tier profile is never downgraded: unavailable (missing, disabled or unhealthy) means blocked, never a pass, a lower tier or the subscription | `node/policy.ts` (`resolveRoute`) | `SEC-42 reviewers are never downgraded` |
| SEC-43 | USD cost is our own `usage × price`, never the CLI's `--max-budget-usd`; an unpriced profile refuses; a projected spend over its cap is refused, never moved to a cheaper model | `api/node/price.ts` (`usd`, `checkBudget`, `refusesUnpriced`) | `SEC-43 usd()`, `SEC-43 refusesUnpriced`, `SEC-43 checkBudget: refuse, never downgrade` |

## Tests

- `apps/emdash-desktop/src/core/features/routing/api/node/launch-env.test.ts` — `SEC-39 subscription
  runs carry no routing`, `SEC-39 profile routes`, `SEC-41 managed settings`.
- `apps/emdash-desktop/src/core/features/routing/api/profile.test.ts` — `SEC-44 allowed credential
  kinds and vendors`.
- `apps/emdash-desktop/src/core/features/routing/node/vendors.test.ts` — `SEC-44 vendor allowlist`.
- `apps/emdash-desktop/src/core/features/routing/node/routing-service.test.ts` — `SEC-40 keys are
  write-only`, `SEC-40 setProfileKey registers the redactor secret`, `SEC-44`.
- `apps/emdash-desktop/src/core/features/routing/node/profiles-repo.db.test.ts` — `SEC-40 no key
  bytes in the Brain DB`.
- `apps/emdash-desktop/src/core/features/exec-runs/api/node/run-env-routing.test.ts` — `SEC-13
  routing env comes only from the route`.
- `apps/emdash-desktop/src/main/bootstrap/boot/ninebrains/routing-launch.e2e.test.ts` — `SEC-39
  subscription runs carry no routing` (e2e), `R3 a profile run reaches only its host, with only its
  key (SEC-40)`.
- `apps/emdash-desktop/src/core/features/routing/node/policy.test.ts` — `SEC-42 reviewers are never
  downgraded`.
- `apps/emdash-desktop/src/core/features/routing/api/node/price.test.ts` — `SEC-43 usd()`, `SEC-43
  refusesUnpriced`, `SEC-43 checkBudget: refuse, never downgrade`.

## Decisions made while blocked

1. **`vendors.json` lives in `node/`**, not `api/node/`: it's data the vendor-check module reads,
   not part of the wire contract, and nothing in `api/` imports it directly.
2. **`hasKey`, not a key reference, on the wire.** The renderer never learns whether a key exists by
   its shape or id, only a boolean; there is nothing for it to look up.
3. **A local-profile launch with no key sends a placeholder token** (`ninebrains-local`), not an
   empty header, because Claude Code needs a non-empty auth token to skip its own login flow even
   when the local server ignores it.
4. **The Codex provider id is `nb`, and its key env var is `NB_MODEL_KEY`**, not
   `NINEBRAINS_MODEL_KEY`: `run-env.ts`'s unattended allowlist bans any `NINEBRAINS_*` prefix from
   reaching a child process, so the routing key needed a different name.
5. **Managed settings refuse, they don't warn.** Managed Claude settings outrank our `--settings`
   file, so if one sets a gateway variable, Ninebrains cannot guarantee where the credential goes.
   The launch is refused rather than started with an unverifiable route.
6. **Attended lanes get no `--settings`-vs-user-settings warning.** Our own `--settings` env already
   outranks project and user settings (spike §13), so there is nothing for the lane chrome to warn
   about there; only the managed-settings case (item 5) needs a refusal.

## Deferred to wave 2

- R4: `policy.ts`'s `resolveRoute` and the SEC-42 pin are built and tested, but nothing calls
  `resolveRoute` yet. Still open: a pack role's tier default, the planner's per-job profile (the
  `explicitProfileId` input `resolveRoute` already accepts), and actually routing a reviewer run
  onto a pinned profile. That last one needs a decision first: `ExecRunSpec.routing`'s own contract
  says "reviewers never set it" (`exec-runs/api/node/types.ts`), so wiring a profile-based reviewer
  means either lifting that invariant or adding a reviewer-specific launch path — Lucas's call, and
  `reviewer-route.ts`'s `routeReviewer` TODO is untouched pending it.
- R5: `api/node/price.ts`'s `usd`, `checkBudget` and `refusesUnpriced` are built and tested, but
  nothing calls them yet: no `run_costs`/`spend_caps` tables, no supervisor wiring, no cost view.
  Spike §13 Q3 found the CLI's own `--max-budget-usd` prices an unrecognized model at Opus rates,
  so it's a coarse backstop only, never the real gate.
- R6: fallback and the per-profile circuit breaker. `policy.ts`'s `ProfileHealthState` already
  names the breaker's three states so R6 only has to start writing them; `resolveRoute` reads them
  today as "healthy" when absent.
- R7: a Brain session requesting a tier in `create_job`.
- R8: the local router (SEC-46), gated on whether R0 shows users actually need mixed vendors in one
  session.
- `bedrock`, `vertex`, `foundry` profile kinds (`DEFERRED_KINDS` in `api/profile.ts`).
- The Codex equivalent of the SEC-41 run-start check: Codex's `--json` stream names no provider: the
  data exists only in its rollout/session file, read after the fact.
- The `security_events` table (SEC-33) for a routing-caused refusal or run kill.
