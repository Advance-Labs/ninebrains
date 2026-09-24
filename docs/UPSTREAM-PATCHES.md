# Upstream patches

Every change Ninebrains makes to files inherited from Emdash (`generalaction/emdash`, forked at
`dbf690c`). Keep this list current: it is what makes an upstream rebase cheap. New Ninebrains-only
files are listed at the end. Code comments on patched lines start with `Ninebrains:`.

Paths are relative to `apps/emdash-desktop/` unless they start with `.github/`, `apps/`, `tooling/`
or are root files.

## 1. Emdash-hosted infrastructure cut (task 0.1 / W0)

| File | What | Why |
|---|---|---|
| `src/core/primitives/app-identity/api/fork-flags.ts` (new) | `UPDATES_ENABLED`, `HOSTED_ACCOUNT_ENABLED`, `TELEMETRY_SETTINGS_ENABLED`, `USER_PACKS_ENABLED`, `MODEL_PROFILES_ENABLED`; `UPDATES_ENABLED` is `true`, the rest `false` | One switch per feature that needs an external service. Updates run against Ninebrains' own signed GitHub pipeline (patch 43), not Emdash's feed |
| `src/main/lib/telemetry.ts` | PostHog key/host forced to `undefined`; telemetry is opt-in (`storedEnabled !== 'true'`) | No telemetry to Emdash's PostHog; off by default and pointed at nothing. `isEnabled()` is false, so capture, identify, `/decide` feature flags, DAU, perf vitals and crash `$exception` events never send |
| `.github/actions/setup-build/action.yml` | `posthog-key` / `posthog-host` inputs and the `VITE_POSTHOG_*` env lines removed; `pnpm/action-setup`, `actions/setup-node` and `actions/setup-python` pinned to commit SHAs (W7 CI) | No telemetry key is ever baked into a build. The release and e2e builds run through this action, so its actions are pinned like the workflows' |
| `src/core/features/settings/browser/pages/general-settings-page.tsx` | Account section, UpdateCard and TelemetryCard gated by fork-flags | Remove UI that needs Emdash servers instead of leaving it broken |
| `src/core/features/settings/browser/search/settings-search.ts` | `withoutForkHiddenEntries` drops the `version`, `privacy-telemetry`, `emdash-account` entries | Search must not land on hidden settings |
| `src/main/lib/telemetry.test.ts` (new) | Asserts that a fresh profile is opted out and that nothing is fetched, even with PostHog keys in the env and the user opted in | Guards the telemetry defaults below. The upstream code fails the second case. Note: the `TELEMETRY_ENABLED` env kill switch in `bootstrap/core/config.ts` keeps its upstream default; the stored user preference is what now defaults to off |
| `src/main/host/updates/*` | Replaced electron-updater with a custom pipeline (`update-service.ts`, `feed.ts`, `download.ts`, `staging.ts`, `integrity.ts`, `apply/`, `version.ts`, `types.ts`) | Store-bought update flows (Emdash's feed, R2 manifests, electron-updater's signature checks) matched nothing we sign, so `initialize` short-circuits unless `UPDATES_ENABLED` and the real work reads `api.github.com` releases directly, verifies `SHA256SUMS.json` against Ninebrains' embedded Ed25519 key, and only then offers + applies. Tests: `src/main/host/updates/*.test.ts` |
| `dev-app-update.yml`, `dev-app-update.canary.yml` | Deleted | electron-updater is gone; nothing reads these files anymore (replaced by patch 43's direct-release pipeline) |
| `electron-builder.config.ts`, `electron-builder.canary.config.ts` | `publish: null` (both); Emdash's Azure signing profile removed; `copyright` added; Info.plist usage strings renamed; `runAfterFinish: true` on Windows | No publishing to or updating from Emdash's R2; no `app-update.yml` in the bundle (SEC-36); after a staged NSIS install the app relaunches itself |
| `src/main/host/menu.ts` | "Check for Updates…" items gated by `UPDATES_ENABLED`; install-ID header uses `app.name` | No dead update entry points |
| `src/core/features/account/node/config.ts` | auth server base URL `''` (was `https://auth.emdash.sh`) | Emdash account sign-in/link/health can never reach Emdash |
| `src/renderer/App.tsx` | Onboarding "Sign in" step only when `HOSTED_ACCOUNT_ENABLED` | First-run flow does not push users to Emdash's account |
| `src/core/features/settings/browser/components/github-connect-modal.tsx` | OAuth-via-Emdash-account card gated; device flow always offered | GitHub connect still works through GitHub CLI import and device flow |
| `src/main/core/app/submit-feedback.ts` | Default relay (`emdash-feedback-relay.real-general-action.workers.dev`) removed; throws if no relay is configured | Feedback never reaches General Action's Cloudflare Worker |
| `src/core/features/workbench/browser/window-scope.tsx`, `.../sidebar/left-sidebar.tsx`, `.../contributions/commands.ts` | "Give feedback" (sidebar, menu, palette) opens a new GitHub issue on `Advance-Labs/ninebrains` | Working entry point instead of the cut relay |
| `src/core/primitives/urls/api/urls.ts` | Docs/releases/issues URLs → `Advance-Labs/ninebrains` | Help menu and in-app links go to us |
| `src/core/features/settings/browser/components/SettingsPage.tsx`, `TelemetryCard.tsx`, `projects/.../shareable-project-settings-section.tsx` | `docs.emdash.sh` / `emdash.sh/docs` links → our README | Same |
| `src/core/services/hosts/node/settings.ts`, `.../workspace-server/provision/installer.ts`, `apps/workspace-server/install.sh` | Workspace-server artifact base URL → `github.com/Advance-Labs/ninebrains/releases/download/workspace-server` (was `releases.emdash.sh`) | Remote hosts never download from Emdash's R2. No release exists yet, so installs fail with `artifact-download-failed` until one does, or `EMDASH_WORKSPACE_SERVER_ARTIFACTS_URL` points at a mirror |
| `scripts/release/lib/config.ts` | `GITHUB_OWNER`/`GITHUB_REPO` → `Advance-Labs`/`ninebrains` | Release scripts target our repo |
| `scripts/release/build.ts` | Calls `scrubBlankSigningEnv(process.env)` (ours, in `lib/signing.ts`) just before `electronBuild()` | An unset GitHub secret reaches the step as `''`, and electron-builder reads `process.env.CSC_LINK` directly: it took `''` as a certificate path and failed the first v0.1.0 mac build with "<deploy dir> not a file". Blank must mean absent before electron-builder looks. Test: `scripts/release/release-config.test.mjs` |
| `src/core/primitives/app-identity/api/app-identity.ts`, `.canary.ts` | `R2_BASE_URL` → our GitHub Releases download base (now unused by builder configs); `COPYRIGHT` added | No `releases.emdash.sh` left in the build |

Left in place on purpose: MCP catalog entries for the PostHog and Sentry MCP servers, skills.sh and GitHub skill sources. These are third-party services the user opts into, not Emdash infrastructure.

## 1b. GitHub OAuth App (branch `w0/gh-oauth`)

| File | What | Why |
|---|---|---|
| `packages/plugins/src/integrations/impl/github/index.ts` | `oauth-device` `clientId` `'Ov23…'` → `''` | Emdash's GitHub OAuth App client ID is another company's credential, and GitHub's consent page would say "Emdash" |
| `src/core/primitives/app-identity/api/github-oauth-app.ts` (new) | `readGitHubOAuthClientId()` from `import.meta.env.NINEBRAINS_GITHUB_OAUTH_CLIENT_ID`; shared "needs a Ninebrains OAuth App" message | One source for the client ID and the fallback copy |
| `electron.vite.config.ts` | `define` bakes `NINEBRAINS_GITHUB_OAUTH_CLIENT_ID` (default `''`) into the main and renderer bundles | Build-time, empty by default |
| `src/main/bootstrap/boot/phases/services.ts` | Device-flow service gets `readGitHubOAuthClientId()` instead of the plugin's ID | Same |
| `src/core/features/github/node/services/github-device-flow-service.ts` | `start()` returns the "needs a Ninebrains OAuth App" error without calling GitHub when the ID is empty | Fail closed |
| `src/core/features/settings/browser/components/github-connect-modal.tsx` | Device-flow card hidden when the ID is empty; message shown; GitHub CLI import stays (upstream has no PAT flow) | Clean fallback |
| `src/core/features/settings/browser/github-device-flow-modal.tsx` | "Authorize Emdash" copy → Ninebrains | The consent page now names our app |
| `.github/workflows/build-matrix.yml` | Passes `vars.NINEBRAINS_GITHUB_OAUTH_CLIENT_ID` to builds | CI builds pick up the ID once it exists |
| Tests | New `github-device-flow-service.test.ts` (empty ID refuses without contacting GitHub; env read and trim); `github-connect-resume.test.tsx` stubs an ID for device-flow cases and asserts the empty-ID fallback | Regression guards |

## 2. State isolation: never share Emdash's data (task 0.5 follow-up)

| File | What | Why |
|---|---|---|
| `app-identity.ts` | `USER_DATA_DIR_NAME` `ninebrains` / `ninebrains-dev` / `ninebrains-canary` | Electron `userData` holds the DB, logs, keychain-backed secrets and settings |
| `src/main/db/default-path.ts` | `USER_DATA_DIR_NAME = 'ninebrains'` (was pinned to `emdash` regardless of product) | Out-of-Electron tools (`db:reset`, drizzle-kit) can never open or delete a real Emdash DB. The DB file keeps its upstream name `emdash4.db`, inside the Ninebrains directory |
| `src/core/primitives/project-settings/api/worktree-root.ts` | Built-in worktree root `<home>/ninebrains/worktrees` | No worktree-path collisions with Emdash |
| `src/core/features/projects/node/worktree-defaults.ts` | `LOCAL_WORKTREE_ROOT_DIR_NAME = 'ninebrains'` | Same |
| `src/core/features/projects/node/settings.ts`, `src/core/features/workspaces/api/node/placement/placement-defaults.ts` | Default repositories root `~/ninebrains/repositories` | Same |
| `src/core/services/hosts/node/workspace-server/layout.ts` | Remote root `~/.ninebrains/workspace-server` | A remote host running both apps keeps two separate servers |
| `src/main/db/default-path.test.ts` (new) | Asserts the userData/DB directory, worktree root and remote root contain `ninebrains`, not `emdash` | Regression guard |
| Tests updated for the new defaults | `worktree-root.test.ts`, `layout.test.ts`, `provisioner.test.ts`, `workspace-placement-resolver.test.ts` (pool hash changes because the repo path changes) | Fixtures only |

Checked and **not** changed: the log file lives in `userData/logs` (isolated by the userData rename). Electron `safeStorage` keys its keychain entry by app name ("Ninebrains Safe Storage"). The internal `app://` renderer scheme and the `emdash-recovery://` in-window navigation are not OS-registered, so there is no protocol handler to collide. `EMDASH_HOOK_*` env vars and the agent hook commands are per-process and exit when those vars are unset. `.emdash.json` team config and the `emdash` branch-prefix default stay for compatibility (see docs/FORK.md, open items).

## 3. Rebrand, user-visible only (task 0.5)

Directories, package names and TS identifiers are unchanged (`apps/emdash-desktop`, `@emdash/*`, `EmdashLogo`).

| File | What |
|---|---|
| `app-identity.ts`, `app-identity.canary.ts` | `APP_ID` `dev.advancelabs.ninebrains[.canary]`, `PRODUCT_NAME` Ninebrains, `APP_NAME_LOWER`/`ARTIFACT_PREFIX` `ninebrains` |
| `src/main/bootstrap/boot/phases/apply-identity.ts` | `app.setAboutPanelOptions` with Ninebrains name and copyright |
| `src/renderer/index.html` | `<title>`, boot-splash mark (the website's nine-square loading mark, with a delayed ring sweep) and splash strings |
| `src/core/primitives/app-identity/browser/emdash-logo.tsx`, `emdash-shimmer-logo.tsx` | Emdash wordmark paths replaced with the Ninebrains mark + wordmark (`LogoShapes`) |
| `src/assets/images/emdash/*.png`, `*.icns`, `build/dmg-background.tiff` | File contents replaced with the original Ninebrains mark (same filenames). The DMG background lost Emdash's three-dash motif |
| `package.json` (desktop) | description, homepage, author (Advance Labs Inc.) |
| 32 source files | User-visible "Emdash" strings → "Ninebrains" (recovery dialogs and `recovery.html`, notifications, settings copy, theme names, quit dialogs, tray labels, etc.). Exact list: `git diff dbf690c --stat -- apps/emdash-desktop/src` |
| `src/core/services/notifications/node/producers/update-producer.test.ts`, `project-availability-presentation.test.ts`, `settings-search.test.ts`, `renderer/tests/browser/github-connect-resume.test.tsx` | Assertions follow the new copy and the hidden OAuth / telemetry entries |

Left as "Emdash" on purpose: copy that is only reachable through the gated account UI; and the legacy-import screens, which describe importing data from a previous *Emdash* install.

### 3a. Black and white (W9 `brand-bw`)

The mark became a 3×3 grid of nine squares and the default themes lost their colour. Geometry and
every raster now come from `tooling/brand/` (`pnpm brand`); see `docs/brand/README.md`.

| File | What | Why |
|---|---|---|
| `src/core/primitives/app-identity/browser/emdash-logo.tsx` | `LogoShapes` draws the nine-square grid instead of the octopus arms; all fills, no strokes | The mark is geometric now, and shares its metrics with `tooling/brand/glyph.mjs` |
| `packages/theme/src/themes/light.theme.ts`, `dark.theme.ts` | `accent` is an explicit monochrome `scales.accent` ramp (upstream's generated jade/teal seed and its step tweaks are gone) | The accent only drives the primary button, the selected row and the focused-lane border, so it is black in light and white in dark |
| `packages/theme/src/__generated__/theme.css`, `semantic.css` | Regenerated by `pnpm --filter @emdash/theme build:theme` | Follows the ramp above |
| `src/assets/images/emdash/*.png`, `*.icns`, `build/dmg-background.tiff` | Regenerated black and white; canary wears a ring and dev inverts | Same filenames, so upstream's asset wiring is untouched |
| `src/assets/images/ytbanner.webp` | Desaturated once (`grayscale(1) contrast(1.08)`) | The welcome backdrop was the last colour surface in the app |
| `src/renderer/tests/browser/routing-screenshots.test.tsx` | Passes `agentStatus` to the Models render | Without it the published screenshot read "Loading…"; the panel takes its data as a prop |
| `src/assets/images/emdash/emdash.icns`, `src/assets/images/emdash/emdash-canary.icns` | Rebuilt from the new tile by `iconutil` | The packaged macOS icons; same filenames, so upstream's packaging is untouched |
| `README.md` | Rewritten around the new banner, a keyword-first summary and a longer FAQ | The fork's own front page, and the repo's main search surface |
| `package.json` (root) | `+brand`, `+brand:check` scripts | Entry points for `tooling/brand` |
| `tooling/scripts/check.mjs` | `brand:check` added to the gate, with its own failure hint | A generated asset that drifts from `glyph.mjs` should fail the merge gate |
| `.gitignore` | `+.vercel/` | The Vercel CLI's local project link for the landing page |
| `pnpm-lock.yaml` | `@ninebrains/site` and its two dev dependencies (oxfmt, oxlint) | The new landing-page workspace |

The Solarized themes keep their colour: only the default light and dark themes are monochrome.

## 4. CI and repo files

| File | What | Why |
|---|---|---|
| `.github/workflows/release-{canary,prod,linux,workspace-server}.yml` | Deleted | They publish to Emdash's R2/GitHub and need Emdash's signing and PostHog secrets |
| `.github/workflows/code-consistency-check.yml` | `workflow_dispatch` only (was PR + push to `main`); `permissions` (`contents: read`, `actions: read`), a per-PR `concurrency` group and `timeout-minutes: 30` (W7 CI) | Superseded by `.github/workflows/ci.yml`, which runs the same checks and more; running both doubles the minutes. `nrwl/nx-set-shas` needs `actions: read`; without it every run failed in about 20 s with "Resource not accessible by integration" |
| `.github/workflows/workspace-server-package-check.yml` | `workflow_dispatch` only | Save Actions minutes on the private repo |
| `.github/ISSUE_TEMPLATE/config.yml` | Links → our repo | |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | "emdash Version" field → "Ninebrains Version" (W8 launch prep) | Leftover Emdash branding; the app is Ninebrains |
| `package.json` (root), `tooling/scripts/check.mjs` | `licenses` script, added to `pnpm check` | Licence gate (task 0.4) |
| `tooling/scripts/check.mjs`, `package.json` (root) | `check` runs `format:check` (was `format`, which rewrote files) and the new `test:tooling` step; `--write` / `check:write` restores the writing mode; `test:tooling` script runs the node tests in `tooling/scripts`, `tooling/fake-agent/test` and `scripts/release`; `hooks:install`, `merge`, `require-green`, `labels:sync` and `release:prepare` scripts for the merge guard and releases (W7 CI) | `pnpm run check` now matches what CI runs and never edits the tree, so a green local check means a green `static` job |
| `README.md` | Replaced with a short Ninebrains placeholder; later (`53253af4c`, W7 docs) the feature list and quick start corrected to match the code: unwired features listed as "in the code, not yet reachable from the app", a "Set up gates" step, and the Brain started from the Lanes title bar; later still (W7 `w7/testsgate-prefs`) the "not yet reachable" list was retired, since the Planner, lane roles and modes and the per-project rigor override all have entry points now; later still (W8 `w8/readme`) rewritten as the public front page: licence and CI badges, and screenshots of the Brain drawer, a gate's verification result, the planner canvas and the add-lane role picker added next to the features they show; later still (same PR) given a centered HTML header (mark, name, tagline, badges, hero screenshot) using the new `docs/brand/ninebrains-mark.svg` (copied from `apps/docs/public/favicon.svg` so the README doesn't depend on the docs app's internals), and the feature list split into "In this build" and an illustrated "A closer look" table, so the illustrated bullets no longer broke the list in two; later still (v0.1.0) the status line and Install section changed from "being built" / "will be on GitHub Releases" to the shipped release, with a per-OS file table and the checksum and attestation commands | The README must not claim what the app cannot do yet |
| `apps/emdash-desktop/vitest.config.ts` | `EMDASH_TEST_BROWSER=1` forces the `browser` project on under `CI`; new `node-spawn` project (`maxWorkers: 2`, `sequence.groupOrder: 1`) takes the spawn-heavy suites out of `node`; `browser` gets `testTimeout: 15_000` and `optimizeDeps.include` for the JSX runtime (W7 CI) | CI can run real-browser tests. Spawn-heavy suites (gates capabilities, exec-runs, brain stop/unattended, override-launch) get less contention instead of looser deadlines (SEC-30 keeps its 5 s). The late JSX-runtime discovery reloaded Vite mid-run and failed browser tests |
| `packages/chat-ui/vite.config.ts` | `EMDASH_TEST_BROWSER=1` forces the `browser` project on under `CI` (W7 CI) | Same switch as the desktop app |
| `CONTRIBUTING.md` | "Before you open a PR" rewritten (non-mutating `check`, `hooks:install`, browser-test switches); new "Sign your commits (DCO)", "CI and merging" and "End-to-end tests" sections; commands list and security section updated (W7 CI); later a note that the pre-push hook skips the Playwright `browser` projects and how to opt back in (W7 `w7/prepush-skip-browser`); later still, the `pr-hygiene` row notes that a Dependabot-opened PR whose diff is an in-place `@ref`/comment-only pin swap (`tooling/scripts/bot-pr.mjs`) skips only the upstream-patch log step (W7 `w7/verified-bot-pr`) | The old text said CI ran checks on PRs, which was false, and had no DCO, merge flow or e2e guidance. The hook note matches what `pre-push.mjs` now does. Dependabot PRs that bump inherited-workflow action pins always failed the upstream-patch step because a bot can't write the row; the exemption checks the unforgeable PR author plus the diff shape (git-computed, each hunk an equal-count pin-for-pin swap with only the ref/comment free to change), not commit metadata, which GitHub signs identically for anyone who pushes through its Contents/Git Data API with Dependabot's author email |
| `.github/PULL_REQUEST_TEMPLATE.md` | Replaced: checklist for `pnpm run check`, DCO and title, the upstream-patch log, new dependencies and licences, security areas with SEC-IDs, local browser tests, 1440/390 screenshots, real-CLI use (W7 CI); later, a note that full e2e runs weekly/on `release/**` and a maintainer adds the `run-e2e` label sooner if needed (W8 launch prep) | Matches what `ci.yml` and `pnpm run merge` enforce, plus what they cannot check |
| `nx.json` | `EMDASH_TEST_BROWSER` added to the `test` target's env inputs (W7 CI) | A forced browser run must not reuse a cached result from a run that skipped the browser project |

## 5. Unattended exec path (W2 `exec-runs`)

| File | What | Why |
|---|---|---|
| `packages/core/package.json`, `packages/core/tsdown.config.ts` | New export and build entry `./primitives/agent-env/api` (additive) | The `exec-runs` slice builds the allowlisted agent env (`buildAllowlistedAgentEnv`, `mergeAgentEnvLayers`) for `claude -p` / `codex exec` spawns (SEC-13). Upstream has no print path, so nothing outside core imported it before |

## 6. Lanes (W1 `lanes`, Phase 1)

| File | What | Why |
|---|---|---|
| `src/core/manifests/shared/domain-contracts.ts` | `+[lanesDomain]: lanesContract` | Register the `lanes` wire contract |
| `src/core/manifests/node/controllers.ts` | `readonly lanes: LaneService` on the context + `lanes` controller entry | Serve the `lanes` contract |
| `src/main/bootstrap/boot/wiring.ts` | `lanes: services.ninebrains.lanes` | Pass LaneService into the controller context |
| `src/main/bootstrap/boot/phases/services.ts` | One `createNinebrainsServices({...})` call, `ninebrains` on `ServicesBundle`, late-bound `resolveLaneLaunch` in `tuiConversationDependencies`, bound `createConversation`/`launchTuiConversation` | Construct lanes; conversation verbs live in `conversations/node/`, which other slices may not import, so the composition root binds them |
| `src/core/features/conversations/node/tui-conversation-provider.ts` | Optional `resolveLaneLaunch(conversationId)` dependency, merged into `extraArgs` and `providerVars` in `buildStartInput` | SEAMS §3.7 launch hook; Phase 1 returns `undefined`, Phase 2 fills it |
| `src/core/manifests/shared/memento-catalog.ts` | `+lanesGridMemento` | Persist lane config and grid membership |
| `src/core/manifests/browser/view-catalog.ts` + `view-catalog.test.ts` | `+lanesViewDef`; expected ids gain `'lanes'` | Register the `lanes` view |
| `src/core/manifests/browser/browser-contributions.ts` | `+...lanesBrowserContributions.views` | Mount the lanes view runtime |
| `src/core/manifests/shared/command-catalog.ts`, `command-palette-catalog.ts` | `+LANES_COMMAND_DEFS`, `+LANES_COMMAND_PALETTE_ITEMS` | Lane shortcuts and the Open Lanes palette command |
| `src/core/manifests/browser/scope-catalog.ts` | Window scope gains `LANES_WINDOW_COMMAND_DEFS`; `+lanesViewScope` | Bind Open Lanes globally and lane shortcuts in the view |
| `src/core/features/workbench/browser/window-scope.tsx` | `'lanes.open'` handler (navigate to the lanes view) | Window-scope commands must be implemented here |
| `src/core/primitives/telemetry/api/telemetry.ts` | `FocusView` gains `'lanes'` | Navigation telemetry types view ids; drop with telemetry removal |
| `package.json` (desktop), `pnpm-lock.yaml` | `playwright` 1.60.0 devDependency; `e2e` and `e2e:run` scripts | Electron e2e harness (`e2e/`), kept out of CI |

## 7. Packs (W2 `packs`)

Append-only registrations. The slice does not touch `services.ts` or `wiring.ts`: the `packs`
controller falls back to `createFallbackPacksService` until Phase 2 wires a real one
(`src/core/features/packs/README.md`, "Wiring").

| File | What | Why |
|---|---|---|
| `src/core/manifests/shared/domain-contracts.ts` | `+[packsDomain]: packsContract` | Register the `packs` wire contract |
| `src/core/manifests/node/controllers.ts` | Optional `packs?: PacksService` on the context + `packs` controller entry (fallback service when absent) | Serve the `packs` contract with contract/controller key parity and no `wiring.ts` edit |
| `src/core/manifests/shared/memento-catalog.ts` | `+packsProjectPrefsMemento`, `+packsPrefsIndexMemento` | Per-project pack prefs and the app-level index |
| `src/core/manifests/browser/settings-page-contributions.ts` | `+packsSettingsPage` | Packs settings page |
| `src/core/features/settings/contributions/views.ts` | `'packs'` in `settingsPageTabSchema` | Settings tab id |
| `src/core/features/settings/browser/search/settings-search.ts` | `+packs` search entry (integration fix) | `settings-search.test.ts` requires every settings tab to have at least one search entry |
| `package.json` (desktop), `pnpm-lock.yaml` | `@emdash/gates-core` and `@emdash/citations` workspace dependencies | The `seo-evidence` gate and the gate capabilities type against the packages directly |

## 8. Planner canvas (W3 `planner`, Phase 3)

All append-only registrations for `src/core/features/planner/` except the last row.

| File | What | Why |
|---|---|---|
| `src/core/manifests/browser/view-catalog.ts` (+ `view-catalog.test.ts`) | `plannerViewDef` appended | New `planner` view |
| `src/core/manifests/browser/browser-contributions.ts` | `plannerBrowserContributions.views` appended | View runtime |
| `src/core/manifests/shared/domain-contracts.ts` | `[plannerDomain]: plannerContract` | Wire contract |
| `src/core/manifests/node/controllers.ts` | optional `planner?: PlannerService` on the context + `planner` controller (falls back to an in-memory, Brain-less service when unset) | Keeps typecheck green until `services.ts`/`wiring.ts` pass the real service |
| `src/core/manifests/shared/memento-catalog.ts` | `plannerViewportMemento` | Persisted pan/zoom retention |
| `src/core/primitives/telemetry/api/telemetry.ts` | `'planner'` added to `FocusView` | Navigation telemetry passes any `ViewId` as `from_view` |
| `package.json` (desktop), `pnpm-lock.yaml` | `@xyflow/react` (MIT), `@ninebrains/brain-core` (workspace) | Canvas + compile |

## 9. Release pipeline (W4 `release`, plan 7.1/7.2)

Full rationale in `docs/RELEASING.md`.

| File | What | Why |
|---|---|---|
| `electron-builder.config.ts`, `electron-builder.canary.config.ts` | `publish: null` (was GitHub draft); mac dmg+zip for arm64 **and x64**, signing from `resolveMacSigning(env)` (`identity: '-'` ad-hoc, `notarize: false` with no env); win nsis only (msi dropped), `resolveWinSigning(env)`; linux AppImage+deb (rpm dropped); `nsis.differentialPackage: false`, `nsis.runAfterFinish: true`; `artifactName` `Ninebrains-${version}-${os}-${arch}.${ext}` | SEC-36: no `app-update.yml` or `latest*.yml` — the updater (patch 43) reads GitHub Releases directly and has no manifest to be hijacked. `runAfterFinish` relaunches the app after a staged NSIS install on Windows; OS signing still switches on from env only and never fails without it |
| `scripts/release/build.ts` | `--release-id` optional: without it, no GitHub token or draft check (local mode); default targets drop rpm and msi; `cpSync(..., { verbatimSymlinks: true })` when copying `release/` out of the deploy dir | Build jobs run with `contents: read`, and the same path works on a laptop. Without `verbatimSymlinks`, the `.framework` symlinks in the copied app pointed into the deleted deploy dir, so `codesign --verify` (and `verify-mac.ts`) failed. This is an upstream bug |
| `package.json` (desktop) | `version` 1.2.4 → 0.1.0 | Ninebrains' first version; nothing keys state or migrations off it (RELEASING.md, Versioning) |

New files: `.github/workflows/release.yml`, `docs/RELEASING.md`,
`scripts/release/checksums.mjs`, `scripts/release/checksums.test.mjs`,
`scripts/release/release-config.test.mjs`, `scripts/release/lib/signing.ts`.

Upstream release scripts left in place but unused by our workflow: `prepare-release.ts`,
`upload-github-assets.ts`, `finalize-release.ts` (R2 promotion), `notarize-mac.ts`,
`verify-linux.ts` (keyed to upstream's artifact names), `verify-win.ts` (needs a valid signature).

## 10. Gates wiring (W5 `gates-wiring`, Phase 4)

Append-only registrations, plus one accessor. The slice doesn't touch `services.ts` or
`wiring.ts`; the `gates` controller falls back to an "unavailable" verification service until
the composition root passes one (`src/core/features/gates/README.md`, "Wiring").

| File | What | Why |
|---|---|---|
| `src/main/host/browser/browser-webcontents-registry.ts` | `+getWebContents(browserId)` (5 lines) | The CDP gate host attaches to a lane's webview by browserId (SEAMS §3.12) |
| `src/core/manifests/shared/domain-contracts.ts` | `+[gatesDomain]: gatesContract` | The `gates` wire contract (Job verification modal) |
| `src/core/manifests/node/controllers.ts` | Optional `gates?: GatesVerificationService` on the context + `gates` controller entry | Serve the contract with key parity and no `wiring.ts` edit |
| `src/core/manifests/browser/browser-contributions.ts` | `+...gatesBrowserContributions.modalDefs` | The `jobVerificationModal` modal |
| `src/renderer/tests/browser/modal-catalog.test.ts` | `'jobVerificationModal'` in `expectedModalIds` | The test pins every registered modal id |
| `src/core/manifests/shared/settings-contributions.ts` | `+'ninebrains.gates': gatesSettingsContribution` | Rigor sliders and evidence retention |
| `src/core/manifests/browser/settings-page-contributions.ts` | `+gatesSettingsPage` | Settings → Gates |
| `src/core/features/settings/contributions/views.ts` | `'gates'` in `settingsPageTabSchema` | Settings tab id |
| `src/core/features/settings/browser/search/settings-search.ts` | `+gates` search entry | Every settings tab needs a search entry |
| `src/core/manifests/shared/memento-catalog.ts` | `+gatesProjectPrefsMemento`, `+gatesPrefsIndexMemento` | Per-project rigor override and test command |
| `src/core/manifests/shared/command-catalog.ts`, `src/core/manifests/browser/scope-catalog.ts` | `+GATES_COMMAND_DEFS`, `+GATES_WINDOW_COMMAND_DEFS` | `gates.openJobVerification({ jobId })`, so other slices open the modal without importing this one |
| `src/core/features/workbench/browser/window-scope.tsx` | `'gates.openJobVerification'` handler (`openModal`) | Window-scope commands must be implemented here |
| `package.json` (desktop), `pnpm-lock.yaml` | `@ninebrains/brain-core` workspace dependency | The runner, rigor resolver and verification service type against the Brain |

## 11. Brain wiring (W5 `brain`, Phase 2)

| File | What | Why |
|---|---|---|
| `src/main/bootstrap/boot/phases/services.ts` | `await createNinebrainsServices({...})` from `boot/ninebrains/` (adds `hostDependencies`); `resolveLaneLaunch` late-binds to `ninebrains.resolveLaneLaunch(id, upstream)` | One composition root for lanes, Brain, packs, planner, supervisor |
| `src/main/bootstrap/boot/wiring.ts` | `brain`, `packs`, `planner` from `services.ninebrains` | Real services instead of the fallbacks |
| `src/core/features/conversations/node/tui-conversation-provider.ts` | `resolveLaneLaunch` also receives `{ extraArgs, autoApprove, cwd }` | The Brain guards the full flag list (SEC-12) and scopes the sandbox to the cwd |
| `src/core/manifests/shared/domain-contracts.ts` | `+[brainDomain]: brainContract` | Register the `brain` contract |
| `src/core/manifests/node/controllers.ts` | `readonly brain: BrainService` + `brain` controller | Serve the `brain` contract |
| `src/core/manifests/shared/memento-catalog.ts` | `+brainSessionsMemento` | Persist Brain sessions |
| `src/core/manifests/shared/command-catalog.ts`, `command-palette-catalog.ts`, `browser/scope-catalog.ts` | `+BRAIN_COMMAND_DEFS`, `+BRAIN_COMMAND_PALETTE_ITEMS`, window scope `+BRAIN_WINDOW_COMMAND_DEFS` | Global STOP command |
| `src/core/features/workbench/browser/window-scope.tsx` | `'brain.stopAll'` handler | Window-scope commands are implemented here |
| `src/main/host/chromium-command-line.ts` | `use-mock-keychain` when `NINEBRAINS_E2E=1` | e2e runs never touch or prompt for the real login keychain |
| `electron.vite.config.ts` | `copyBrainMcpPlugin` → `out/main/brain-mcp/` | Bundle the brain-mcp shim like the adapter assets (SEAMS §3.6) |
| `electron-builder.config.ts`, `electron-builder.canary.config.ts` | `asarUnpack` `out/main/brain-mcp/**` | Electron-as-Node runs the shim from a real file |
| `package.json` (desktop) | `e2e:brain` script | The fan-out demo |
| `src/main/bootstrap/boot/phases/services.ts` | Also passes `appSettings`, `previewServers` and a late-bound `notifications` getter to `createNinebrainsServices` (W7 integration) | The gates: rigor settings, a lane's preview URL, blocked-job notifications. The notification service is built after the call |
| `src/main/bootstrap/boot/wiring.ts` | `gates` from `services.ninebrains` (W7 integration) | The Job verification modal gets the real service instead of the "unavailable" fallback |

Ninebrains files also touched: `lanes/node/{lane-ports,lane-service,agent-feed,ninebrains-services}.ts`
(Brain port, job override, `activeJobId`, launch release, hook detail), `lanes/browser/grid/{lanes-view,lane-cell,lane-side-panel}.tsx`
and `lanes/browser/lane-terminal.tsx` (drawer, side-panel source, badge), `lanes/api/lane-side-panel.ts` (`badge`),
`packs/node/packs-service.ts` + `app-identity/api/fork-flags.ts` (`USER_PACKS_ENABLED`, SEC-26),
`e2e/harness.mjs` (`--use-mock-keychain`, `NINEBRAINS_E2E`, extra env), `tooling/fake-agent/src/steps.mjs`
(`{{prompt:<regex>}}` in `callTool` args).

## 12. Daily-use fixes (W7 `w7/daily-use`)

| File | What | Why |
|---|---|---|
| `src/core/manifests/shared/command-catalog.ts` | `+PLANNER_COMMAND_DEFS` | The `planner.open` command |
| `src/core/manifests/shared/command-palette-catalog.ts` | `+PLANNER_COMMAND_PALETTE_ITEMS` | "Open Planner" in the command palette |
| `src/core/manifests/browser/scope-catalog.ts` | Window scope gains `PLANNER_WINDOW_COMMAND_DEFS` | `planner.open` works from any view |
| `src/core/features/workbench/browser/window-scope.tsx` | `'planner.open'` handler: the given, current or first project's canvas | Window-scope commands are implemented here |
| `src/main/host/menu.ts` | An **Agents** submenu from `agentStopMenuItems({ accelerator: true })`; rebuilt on `onAgentStopStateChange` | SEC-30: STOP and Clear STOP answered in main, so they work with a hung renderer |
| `src/main/host/tray.ts` | The tray menu is built by `buildTrayMenu()` and gains the STOP items; rebuilt on the latch | Same |

Ninebrains files also touched: `lanes/api/{lane-model,contract,index}.ts` (`runMode`, `roleId`,
`setLaneMode`), `lanes/node/{lane-service,wire-controller}.ts`,
`lanes/browser/grid/{add-lane-form,lane-header,lanes-view}.tsx`, `brain/api/*` (lane run mode from
the lanes api, `unattendedBudgets`), `brain/node/{brain-service,dispatcher,unattended}.ts`,
`brain/browser/{brain-drawer,use-brain}.tsx`, `brain/contributions/lanes-drawer.ts`,
`packs/api/{contract,index}.ts` (`setSecret`, `clearSecret`, `storedInApp`, role provider/model),
`packs/node/{packs-service,secrets,wire-controller}.ts`, `packs/browser/packs-view.tsx`,
`main/bootstrap/boot/ninebrains/{create-ninebrains-services,keychain-secret-resolver}.ts`.

## 13. Git hardening against lane-written repo config (T36, `w7/sec-review-fixes`)

A lane can write its repo's config and `info/attributes`, and upstream runs git against lane
worktrees unsandboxed (THREAT-MODEL T36). Each helper gains one import and one
`hardenGitExec(…)` wrap. The logic lives in the new `hardened-git.ts`.

| File | What | Why |
|---|---|---|
| `packages/core/src/runtimes/git/node/exec/git-exec.ts` | `createGitExec` returns `hardenGitExec(createBoundExec(…), 'user-write')` | The git worker: automatic `status` on every watch event, the diff/blame/log views, and user-initiated commit, push and pull (these keep the user's hooks) |
| `packages/core/src/runtimes/workspace-registry/node/git-context.ts` | The registry exec's inner `createBoundExec` wrapped with `'app-write'` | The automatic scan's `status` and `diff`, and app-driven create/update/delete/fetch/push: no hooks, no repo `core.sshCommand` |
| `packages/core/src/services/exec/node/git-exec.ts` | `createNonInteractiveGitExec` wrapped with `'app-write'` | `measure-usage` and `worktree-path-safety` |
| `packages/core/src/runtimes/workspace-registry/node/inspect-path.ts` | The inline `rev-parse` exec wrapped with `'app-write'` | Runs on every path the registry inspects |
| `packages/core/src/runtimes/workspace-registry/node/update-worktree.ts` | `fetch` gains `--refmap=` | The fetch also updated `refs/remotes/<remote>/*` and raced the create path's background `fetch --prune` ("incorrect old value provided"). The hardening's extra filter-listing process made the race deterministic in `update-worktree.contract.test.ts`. The fetch only needs its private `refs/emdash/update/<uuid>` ref |
| `packages/core/src/runtimes/git/node/exec/git-exec.test.ts`, `.../workspace-registry/node/git-context-env.test.ts` | `T36` real-git describes appended | Proof per helper kind, with controls |

Ninebrains files also touched: `exec-runs/api/node/{sandbox-settings,run-supervisor}.ts` and
`brain/node/launch-config.ts` (the T36 write deny).

## 14. Model routing (W7 `routing`, wave 1)

Append-only registrations. Lever B was behind the fork flag `MODEL_PROFILES_ENABLED`
(`app-identity/api/fork-flags.ts`, a Ninebrains file: `import.meta.env.DEV`, so on in dev builds
and off in release builds) until 14b, which replaces it with a user setting.

| File | What | Why |
|---|---|---|
| `src/core/manifests/shared/domain-contracts.ts` | `+[routingDomain]: routingContract` | The `routing` wire contract (Settings → Models) |
| `src/core/manifests/node/controllers.ts` | Optional `routing?: RoutingService` on the context + `routing` controller entry (disabled service when absent) | Key parity without requiring the service |
| `src/main/bootstrap/boot/wiring.ts` | `routing: services.ninebrains.routing` | The real service from the composition root |
| `src/core/features/settings/contributions/views.ts` | `'models'` in `settingsPageTabSchema` | Settings tab id |
| `src/core/manifests/browser/settings-page-contributions.ts` | `+modelsSettingsPage` | Settings → Models |
| `src/core/features/settings/browser/search/settings-search.ts` | `+models` search entry | Every settings tab needs a search entry |

Ninebrains files also touched: `exec-runs/api/node/{types,run-env,run-supervisor,claude-print,codex-exec,redact}.ts`,
`brain/node/{launch-config,unattended,dispatcher,brain-service,brain-db}.ts`, `lanes/{api/lane-model,api/contract,node/lane-service,node/lane-ports,node/wire-controller}.ts`,
`lanes/browser/grid/{lane-header,add-lane-form}.tsx`, `packs/{api/pack-schema,api/launch,api/contract,node/resolve-launch,node/packs-service}.ts`,
`main/bootstrap/boot/ninebrains/create-ninebrains-services.ts`, `packages/brain-core` migration 3 (`model_profiles`),
and `tooling/fake-agent/src/events.mjs` (`apiKeySource` follows `ANTHROPIC_API_KEY`, as the real CLI).
New files: `src/core/features/routing/**`, `src/main/bootstrap/boot/ninebrains/routing-launch.e2e.test.ts`,
`src/renderer/tests/browser/routing-screenshots.test.tsx`, `docs/screenshots/routing-*.png`,
`docs/research/VENDORS.md`, `docs/guide/models.md`.

### 14a. Reviewer routing wired (W7 `w7/routing-wave2`, R4, decided 2026-09-15)

The reviewer pin reuses the existing app-settings mechanism (14's Settings → Models page; §10
already registered `ninebrains.gates` on this same inherited file). No new wire contract.

| File | What | Why |
|---|---|---|
| `src/core/manifests/shared/settings-contributions.ts` | `+'ninebrains.routing': routingSettingsContribution` | The reviewer pin (`reviewerProfileId`), read by `reviewer-route.ts` |

Ninebrains files touched: `exec-runs/api/node/types.ts` (`ExecRunSpec.reviewerRoute`),
`exec-runs/api/node/run-supervisor.ts` (routes a `reviewer` preset on `reviewerRoute`, refuses a
spec that mixes it with `routing`), `routing/node/routing-service.ts` (`prepareReviewerRoute`),
`gates/node/capabilities/spawn-reviewer.ts` (`ReviewerRoute.routing`, `deps.route` may now be
async), `main/bootstrap/boot/ninebrains/reviewer-route.ts` (reads the pin, calls
`prepareReviewerRoute`), `main/bootstrap/boot/ninebrains/create-ninebrains-services.ts` (wires
`deps.appSettings.get('ninebrains.routing')`, folding `MODEL_PROFILES_ENABLED` in before
`reviewer-route.ts` ever sees a pin), `routing/browser/models-settings-view.tsx` (the "Reviewer
model" picker).

New files: `routing/contributions/settings.ts`,
`main/bootstrap/boot/ninebrains/reviewer-route.test.ts`.

### 14b. Lever B reaches release builds (T47, `w8/routing-ux`, 2026-09-15)

No inherited-file registrations: `ninebrains.routing` was already registered (14a), so this pass
only adds a field to its schema and changes how existing Ninebrains files read it. No table row.

Ninebrains files touched: `app-identity/api/fork-flags.ts` (`MODEL_PROFILES_ENABLED` → always
`true`), `routing/contributions/settings.ts` (`+profilesEnabled`, default `false`),
`routing/node/routing-service.ts` (`RoutingServiceDeps.enabled` → a live `() => boolean |
Promise<boolean>` resolver, read fresh on every call instead of captured once at construction),
`main/bootstrap/boot/ninebrains/create-ninebrains-services.ts` (the `profilesEnabled()` closure
read from `deps.appSettings`, used for both `routing`'s `enabled` and the reviewer route's fold),
`lanes/node/{lane-ports,lane-service,ninebrains-services}.ts` (the client-side
`modelProfilesEnabled` fast-fail becomes the same kind of live resolver, so it can't accept an
`authProfileId` the now-live `prepareLaunch` check would then refuse), `main/bootstrap/boot/ninebrains/reviewer-route.ts`
(doc comment only, no behavior change).

New files: `routing/browser/profiles-enabled-toggle.tsx` (the Settings → Models toggle),
`routing/contributions/settings.test.ts`.

## 15. UI jobs and the test command (W7 `w7/self-heal-e2e`)

| File | What | Why |
|---|---|---|
| `src/core/manifests/node/controllers.ts` | `gates?: GatesWireService` (verification plus project prefs) and the `unavailableGatesWireService` fallback | Settings → Gates reads and saves the per-project test command over the existing `gates` domain; `wiring.ts` is unchanged |
| `src/core/features/settings/browser/components/SettingsPage.tsx` | `navItemFor('packs')`, `navItemFor('gates')` in the sidebar | Both pages were registered contributions, but the fixed sidebar list left them out, so neither could be opened |

Ninebrains files also touched: brain-core `types.ts` and `protocol/{ops,execute,scope}.ts`
(`gateKind`, SEC-08 agent kinds), brain-mcp `tools.ts`, `gates/api/contract.ts`,
`gates/node/{project-prefs-service,wire-controller}.ts`, `gates/node/runner/{gate-registry,gate-runner}.ts`,
`gates/node/capabilities/run-command.ts` (a gate command may run in a lane worktree root itself),
`gates/browser/{gates-settings-view,test-command-section}.tsx`, `planner/api/{schema,index}.ts`,
`planner/node/{ports,brain-plan-target,planner-service}.ts`, `brain/api/contract.ts`,
`brain/node/brain-service.ts`, `main/bootstrap/boot/ninebrains/create-ninebrains-services.ts`,
`e2e/{harness,brain-fanout.e2e,self-heal.e2e}.mjs`.

## 16. Tests-gate project settings (W7 `w7/testsgate-prefs`)

The only upstream (forked-from-Emdash) file changed is `README.md`, logged in its §4 row. `gates/**`
(beyond `capabilities/`) and `main/bootstrap/boot/ninebrains/**` are already Ninebrains-only (§ New
Ninebrains-only files below), so the feature itself landed entirely inside files this fork owns:

- `gates/api/contract.ts`: `gatesProjectPrefsViewSchema` gains `rigorLevel`, `allowNetwork`,
  `allowUnsandboxed`; new `setProjectSettings` op.
- `gates/node/project-prefs-service.ts`: `setProjectSettings`, and `getProjectPrefs`/
  `setTestCommand` now also return the new fields.
- `gates/node/wire-controller.ts`: wires `setProjectSettings` into the existing `gates` domain
  controller (no new domain registration, so `manifests/*` needed no change this time).
- `gates/node/rigor/project-prefs.ts`, `gates/contributions/mementos.ts`: `ProjectGatePrefs` and
  its memento schema gain `allowNetwork`/`allowUnsandboxed`, both defaulting to false. The memento
  bumps to schema version '2' with a real `up()` migration (not a same-version `.default(false)`)
  so a v1 row stored before this change still reads both flags as strictly `false` in production
  (2026-09-13 security-review fix; SEC-08, `gates/node/rigor/project-prefs-schema.test.ts`).
- `gates/node/rigor/rigor.ts`: `RigorResolver.testsGateSettingsFor(projectId)`.
- `gates/browser/{test-command-section,gates-settings-view}.tsx`: the rigor-override select and
  the two warning-labelled toggles in Settings → Gates.
- `main/bootstrap/boot/ninebrains/create-ninebrains-services.ts`: `createRunCommand`'s
  `projectSettings` hook now resolves the running job's lane worktree to a project id and reads
  `rigor.testsGateSettingsFor` (was previously unwired, so the opt-ins were unreachable).

## New Ninebrains-only files

`NOTICE`, `docs/FORK.md`, `docs/UPSTREAM-PATCHES.md`, `docs/screenshots/w0-rebrand.png`,
`tooling/scripts/check-licenses.mjs`, `tooling/scripts/check-licenses.test.mjs`,
`tooling/scripts/allowlist-exceptions.json`,
`.github/workflows/build-matrix.yml`, `src/core/primitives/app-identity/api/fork-flags.ts`,
`src/main/db/default-path.test.ts`, `src/core/features/exec-runs/**`,
`src/core/features/gates/node/capabilities/**`, `tooling/fake-agent/**` (moved from `spikes/`),
`src/core/features/lanes/**`, `e2e/**`, `docs/screenshots/lanes-grid-*.png`,
`src/core/features/packs/**`, `packages/brain-core/**`, `packages/brain-mcp/**`,
`src/core/features/planner/**`, `src/renderer/tests/browser/planner-screenshots.test.tsx`,
`docs/screenshots/planner-*.png`,
`.github/workflows/release.yml`, `.github/release-notes/install.md`, `docs/RELEASING.md`, `scripts/release/checksums.mjs`,
`scripts/release/checksums.test.mjs`, `scripts/release/release-config.test.mjs`,
`scripts/release/lib/signing.ts`, `src/core/features/gates/**` (beyond `capabilities/`),
`src/main/host/ninebrains/**`, `src/renderer/tests/browser/gates-screenshots.test.tsx`,
`src/renderer/tests/browser/.gitignore`, `docs/screenshots/gates-*.png`, `src/core/features/brain/**`,
`src/main/bootstrap/boot/ninebrains/**`, `src/main/host/mock-keychain.test.ts`,
`e2e/brain-fanout.e2e.mjs`, `tooling/fake-agent/test/interpolate-args.test.mjs`,
`docs/screenshots/brain-*.png`, `src/core/features/planner/contributions/{commands,palette}.ts`,
`src/main/bootstrap/boot/ninebrains/keychain-secret-resolver.test.ts`,
`src/renderer/tests/browser/daily-use-screenshots.test.tsx`,
`docs/screenshots/{lanes-run-mode,lanes-add-lane-role,packs-secrets}-*.png`,
`packages/core/src/services/exec/api/hardened-git{,.test}.ts`,
`packages/core/src/services/exec/node/hardened-git.test-fixtures.ts`,
`e2e/brain-e2e.mjs`, `src/core/features/gates/node/project-prefs-service{,.test}.ts`,
`src/core/features/gates/browser/test-command-section.tsx`.

`.github/workflows/ci.yml`, `.github/workflows/e2e.yml`, `.github/actions/ci-setup/action.yml`,
`tooling/scripts/{check-upstream-patches,pr-hygiene,ci-ok,nx-affected,vitest-flaky-reporter}.mjs`
and their `*.test.mjs` (W7 CI).

`tooling/scripts/bot-pr.mjs` and its test (W7 `w7/verified-bot-pr`): the verified-bot-PR check the
`pr-hygiene` job's upstream-patch step now runs first, so a Dependabot PR can skip that step without
a human writing its row. Exempts only a PR opened by the bot account (from the API, unforgeable)
whose diff (computed locally with git) touches only workflow/composite-action YAML and, in every
hunk, swaps an equal, non-zero count of `uses:` pins one-for-one in place — each removed/added pair
keeps the same indentation, list marker and `owner/repo[/path]`, so only the `@ref` and its trailing
comment can change. Commit-level metadata is deliberately not trusted, since GitHub signs a commit
identically for anyone who pushes it through the Contents/Git Data API with the author email set to
Dependabot's.
Merge guard: `tooling/scripts/{pre-push,require-green,merge-pr}.mjs` and their `*.test.mjs`,
`tooling/git-hooks/pre-push`, `.github/CODEOWNERS` (W7 CI).
Repo hygiene: `.github/dependabot.yml`, `tooling/scripts/sync-labels.mjs` and its test (W7 CI).
Releases: `tooling/scripts/changelog.mjs` and its test; `CHANGELOG.md` (written by
`release:prepare`). `.github/workflows/release.yml` (Ninebrains-only since W4) gained the ref and
`ci-ok` gates, the `channel` input, `--prerelease`, changelog notes, the e2e job and SHA pins (W7 CI).

Retired: `.github/workflows/licenses.yml` (W7 CI). The licence gate runs in `ci.yml`'s `static` job.

Dogfood matrix: `docs/testing/DOGFOOD-MATRIX.md`,
`e2e/{stop-halts-lanes.e2e,lane-run-mode.e2e,lane-from-pack-role.e2e}.mjs` (W7
`w7/dogfood-matrix`).

## 17. Dogfood matrix and e2e (W7 `w7/dogfood-matrix`)

No upstream (Emdash) file was patched for this work. `.github/workflows/e2e.yml` and
`CONTRIBUTING.md` are Ninebrains-only already (see above); adding the three new suites to the
`for suite in ...` list and the suite lists in `CONTRIBUTING.md` needed no patch-log entry beyond
naming the new files, done above under "New Ninebrains-only files".

## 18. Load-flaky tests and the SEC-30 reap hang (W7 `w7/flaky-tests`)

The product fix (T44) is in Ninebrains-only files (`exec-runs/api/node/{process-group,run-supervisor}.ts`).
Two tests inherited from Emdash changed so they pass under the load of a full `nx affected` run; no
assertion changed in either.

| File | Change | Why |
|---|---|---|
| `packages/core/src/runtimes/workspace-registry/node/scan/scheduler.test.ts` | "drops a failed watch and retries it from the polling floor" runs on fake timers (`vi.useFakeTimers` + `advanceTimersByTimeAsync`) instead of racing the scheduler's real 25 ms retry with a real-timer poll | Under load the retry re-added the watch before the test observed the dropped state; 12/12 under load after |
| `packages/core/src/runtimes/workspace-registry/node/api/activation.contract.test.ts` | `createRegistryRuntime()` takes an optional `teardownTimeoutMs`; the "deactivate kills sessions, runs teardown exactly once" test gets its own 4 s bound and a 15 s test timeout, while the hanging-teardown test keeps 500 ms | The two tests shared one 500 ms bound tuned for the hanging case; spawning a real PTY shell under load took longer, so a real teardown was cut off as if it hung (3/8 failed under load before, 16/16 after) |

## 19. The welcome screen's Emdash wordmark (W8 `w8/welcome-banner`)

| File | Change | Why |
|---|---|---|
| `apps/emdash-desktop/src/assets/images/ytbanner.webp` | Replaced with the lower band of the same painting, cropped below the wordmark (2048×1152 → 2048×516, 139 KB → 58 KB) | The Emdash wordmark and logo are painted into the image itself, centred and fully legible. `welcome.tsx` renders it at 40% opacity under a gradient mask, which does not hide a mark that is part of the artwork, so every Ninebrains user saw "Emdash" on the welcome screen. The crop keeps the same painting and mood and carries no text. |

The file keeps its upstream name. It is no longer a YouTube banner, but renaming it would churn the
import in `welcome.tsx` for no user-visible gain.

## 20. Two more load-flaky tests (W8 `w8/reap-flake`)

No product code changed. Two tests inherited from Emdash changed so they pass under load; no
assertion loosened in either.

| File | Change | Why |
|---|---|---|
| `apps/emdash-desktop/src/core/features/exec-runs/api/node/run-supervisor.test.ts` | "does not hang a run and reports it when the reap signal fails for an unexpected reason" now scopes its injected `process.kill` throw to the run's own leader pid (learned from the `started` event), instead of throwing on the first negative-pid call system-wide — the same pattern the "STOP-path signal fails unexpectedly" test above it already used | `killAll()` races `terminateGroup`'s real signal chain against a fixed deadline (SEC-30) and can return before that chain's timer-delayed final SIGKILL fires. Under load a *previous* test's trailing SIGKILL landed after this test installed its mock, consuming the one-shot injected throw before the run's own post-close reap — `errors` came back empty (CI trace at `process-group.ts:201`). 10/10 alone, 5/5 whole-file under one parallel whole-file run after |
| `apps/emdash-desktop/src/core/features/browser/browser/browser-webview-events.test.ts` | Every test's `bindBrowserWebviewEvents()` call is now tracked by a `bind()` wrapper and disposed in `afterEach` | `bindBrowserWebviewEvents` schedules real `setTimeout`s for history-state resync, cleared only by its returned `dispose()`. No test awaited those delays out and only one called `dispose()`, so a test's timers outlived it; because every test reuses `browserId: 'browser-1'` and a live session always exists by then, a leaked timer firing mid-test elsewhere wrote a stale webview's `canGoBack`/`canGoForward` over the *current* test's session — a load-dependent flake ("refreshes history state when Electron updates navigation entries after load events" asserted `canGoBack` false before the test itself set it true). 15/15 alone, 6/6 whole-file under two parallel contending runs after |

## 21. Switch contrast under the monochrome accent (`fix/switch-contrast`)

| File | Change | Why |
|---|---|---|
| `packages/ui/src/react/primitives/switch/switch.css.ts` | Unchecked track gets a `border-1` outline (`border-2` on hover) and a `foreground-muted` thumb; checked track and border use `primary-button-background` (`-hover` on hover) and the thumb uses `primary-button-foreground` instead of `foreground` | Section 3 made `accent.9` near-white in dark mode, but the thumb stayed on `foreground` (`#ededed`), so a checked switch rendered as a blank white pill app-wide. The off state had a transparent border on a surface close to the card and read as nothing. Pairing the thumb with the track's own contrast token keeps it legible in every theme, Solarized included |

## 22. Rebrand leftovers: branch prefix and copy (W8 `emdash/bud-fixes-carog`)

Follow-up to section 3. New task branches were still named `emdash/<task>` (and their worktree
folders `emdash-<task>`) because the project settings default said `'emdash'`. User-visible strings
now go through two channel-independent constants. `PRODUCT_NAME` / `APP_NAME_LOWER` gain a
"Canary" suffix, which would have given canary users `ninebrains-canary/` branches.

| File | What | Why |
|---|---|---|
| `src/core/primitives/app-identity/api/app-identity.ts` | `BRAND_NAME = 'Ninebrains'`, `BRAND_SLUG = 'ninebrains'` added | One place for the brand in copy and generated names, same on every channel |
| `src/core/features/projects/contributions/settings.ts`, `src/core/features/settings/browser/components/RepositorySettingsCard.tsx` | Default `branchPrefix` `'emdash'` → `BRAND_SLUG`; the reset-to-default label follows | Task branches were `emdash/<task>`. Defaults resolve live, so installs without a stored prefix switch on upgrade |
| `packages/core/src/runtimes/automations/node/scheduling/scheduler.ts` | Automation run name `emdash-<id>` → `ninebrains-<id>` | That name becomes the run's branch. Literal, because packages cannot import the desktop identity module |
| `src/core/features/settings/browser/components/AccountTab.tsx`, `github-connect-modal.tsx`, `src/core/features/settings/browser/search/settings-search.ts`, `src/core/features/account/node/account-errors.ts`, `src/core/features/workbench/browser/onboarding/sign-in-step.tsx` | "Emdash account" / "Sign in to Emdash" copy → `BRAND_NAME` | Hidden behind `HOSTED_ACCOUNT_ENABLED` today, but must not say Emdash if it returns. Test: `src/core/features/account/node/services/emdash-account-service.test.ts` |
| `src/core/features/settings/browser/agents-page/InstallationOverrideCard.tsx`, `src/core/features/machines/browser/components/host-settings-card.tsx`, `src/core/features/dev-perf/contributions/commands.ts` | "emdash's ability", "emdash data directory", `~/emdash/worktrees` placeholder, "every emdash process" → brand constants | User-visible copy. The placeholder now matches the real default worktree root |
| `src/core/features/workbench/browser/feedback-modal/use-feedback-submit.ts` | Report metadata `Emdash Version:` → `${PRODUCT_NAME} Version:` | Issue reports named the wrong app. Test: `use-feedback-submit.test.ts` |
| `src/main/host/file-logger.ts`, `src/main/host/dev-perf/controller-operations.ts`, `src/main/lib/logger.ts`, `src/core/features/catalog/node/catalog-service.ts` | `emdash.log`, `emdash-diagnostics.log`, `emdash-trace-*.json`, logger name `emdash-main`, User-Agent `emdash-catalog` → `BRAND_SLUG` | File names users attach to bug reports, and the name we send to the catalog host |
| `packages/core/src/workspace-server/versions/index.ts`, `packages/core/src/workspace-server/versions/versions.test.ts` | "update the Emdash app" → "Ninebrains app" | Remote-host upgrade message named the wrong app |
| `packages/plugins/src/integrations/impl/notion/index.ts` | Notion token help "you want Emdash to access" → Ninebrains | User-visible help text |

Left as `emdash` on purpose, because renaming breaks existing users or data: `.emdash.json`,
`EMDASH_*` env vars, secret keys (`emdash-*-token`), database, localStorage and IPC names,
`emdash-file://` and other URI schemes, the tmux `emdash-` prefix, the browser partition,
`TERM_PROGRAM`, the ACP `clientInfo` name, the legacy Emdash importer copy, and the Apache-2.0
attribution.

Release notes: `.github/workflows/release.yml` (Ninebrains-only) renders the new
`.github/release-notes/install.md` into every release, so the Gatekeeper, SmartScreen and Linux
steps and the docs links are on the release page instead of only in `docs/RELEASING.md`.

## 23. First conversation named after its task (`feat/first-conversation-task-name`)

| File | Change | Why |
|---|---|---|
| `src/core/features/tasks/browser/create-task-modal/build-create-task-params.ts` | `buildInitialConversation` takes an optional `taskName` and uses it, trimmed, as the title; blank falls back to `nextDefaultConversationTitle` | Every task opened on a tab called "Claude (1)", which says nothing when several tasks are open. Custom titles do not match the `claude (N)` pattern, so later conversations still number from 1. Test: `build-create-task-params.test.ts` |
| `src/core/features/tasks/browser/create-task-modal/use-create-task-callback.ts` | Passes `state.taskName.effectiveTaskName` (typed or generated) into `buildInitialConversation` | Same. Automation-adopted tasks keep the run's own conversation title |

## 24. Build brain-mcp before the desktop app's tests (`fix/brain-mcp-build-order`)

| File | Change | Why |
|---|---|---|
| `package.json` | `nx.implicitDependencies: ["@ninebrains/brain-mcp"]` | The app runs `packages/brain-mcp/dist` in its build (copied to `out/main/brain-mcp`) and in `brain/node/unattended.test.ts`, but never declared the package, so `^build` skipped it. In any checkout where brain-mcp had not been built (a fresh worktree, a clean clone) the pre-push hook's `nx affected -t test` failed that test with the job ending `failed` instead of `verifying`. An implicit dependency avoids a lockfile change |

## 25. PDF preview in the file editor (`feat/editor-pdf-viewer`)

| File | Change | Why |
|---|---|---|
| `src/core/features/editor/api/browser/renderers/fileKind.ts`, `src/core/features/editor/browser/renderers/types.ts` | New `'pdf'` file kind (`PDF_EXTS`); `pdf` leaves `BINARY_EXTS`; `isBinaryForDiff` still treats it as binary | PDFs opened as "Binary file — no preview available". The text diff must still not load them into Monaco. Test: `src/core/features/editor/browser/renderers/fileKind.test.ts` |
| `src/core/features/files/api/browser/file-content.ts` | New `readFileBlob(ref, { maxBytes, mimeType })` | `readBytes` defaults to a 200 KB cap, which truncates nearly every real PDF. A Blob plus object URL avoids a base64 data URL several MB long |
| `src/core/features/editor/browser/task-editor/file-content-types.tsx`, `src/core/features/editor/browser/renderers/pdf-renderer.tsx` (new) | `PdfPreview` reads up to `PDF_MAX_BYTES` (50 MB) and renders an iframe on a revoked-on-unmount `blob:` URL; distinct "too large" and "could not load" states | In-editor PDF viewing with Chromium's viewer (zoom, search, thumbnails, print) |
| `src/main/host/window.ts` | Main window `webPreferences.plugins: true` | Electron's built-in PDF viewer is an internal plugin and stays off without it. It is Electron's only plugin; `<webview>` guests keep their own prefs, so the in-app browser is unchanged |

## 26. Prompt drop highlight stays on the composer (`emdash/drag-n-drop-5iikf`)

| File | Change | Why |
|---|---|---|
| `src/core/features/tasks/contributions/browser/task-config/initial-conversation-section.tsx` | `usePromptFileDrop` handlers move from the wrapper around the agent selector, toggles and composer onto a plain `div` around `ChatComposer` alone; the wrapper's `bg-accent/10 ring-2 ring-accent/50 ring-inset` drag class and the unused `cn` import are removed | Dragging a file into the Create Task modal drew a square ring around the whole block, cutting across the agent selector and the composer's rounded corners. Section 3 made `accent` near-white, so the ring read as a white highlight spilling over the other controls. The composer already draws its own rounded drag state (`composerShell({ dragActive })`), so it is now the only highlight. Drops on the selector or toggles no longer insert a path; drop on the prompt box |

## 27. Agent status uses `thinking-orbs` (`feat/thinking-orbs`)

| File | Change | Why |
|---|---|---|
| `packages/ui/src/react/components/agent-status/agent-status.tsx` | `working` renders `<ThinkingOrb state="working" size={20}>` and `awaiting-input` renders `state="breathing"`, both `aria-hidden` inside the existing labelled `role="img"` wrapper; theme pinned from `THEME_MANIFEST` polarity via `useOrbTheme()` because the app themes with `.emdark`/`.emlight`, which the orb's `auto` mode cannot see. `idle`, `completed` and `error` keep their static glyphs | Advance Labs standard agent-status indicator (advance-labs `DESIGN.md`, "Agent status"). "Busy" and "needs you" become distinct shapes (orbiting cluster vs closed ring) at list-row size. One component, so every sidebar, tab, palette and automation row changes together |
| `packages/ui/src/react/components/agent-status/agent-status.css.ts` | Hand-rolled nine-dot shimmer keyframes, dot styles and the awaiting-input diamond styles removed | Dead once the orb replaces them; reduced motion is now handled by the library's static frame |
| `packages/ui/package.json`, `pnpm-lock.yaml` | `thinking-orbs@^0.3.1` added (MIT, zero dependencies, React >=18 peer) | Runtime dependency of the change above |

## 28. Usage limit hit: offer to continue in Freebuff (`emdash/freebuff-okr7s`)

| File | Change | Why |
|---|---|---|
| `packages/core/src/runtimes/tui-agents/node/runtime/usage-limit-detector.ts` (new) | Per-spawn detector over PTY output: splits lines, strips ANSI (cursor-forward reads as a space, cursor positioning as a line break), fires once. `matchUsageLimit` matches Claude Code's and Codex's own notices, anchored at the line start after an optional TUI glyph | When a subscription ran out mid-task nothing in the app noticed; the user had to spot the notice and switch agents by hand. Anchoring keeps diffs, greps and source that quote a notice from matching. Test: `usage-limit-detector.test.ts` (notices, lookalikes, split chunks, cursor redraws) |
| `packages/core/src/runtimes/tui-agents/api/schemas.ts` | Optional `usageLimit: { message, detectedAt }` on `TuiSessionState` | The sessions live model already reaches the renderer; agent state does not |
| `packages/core/src/runtimes/tui-agents/node/runtime/runtime.ts` | `onData` feeds the detector; the notice is held in a `usageLimits` map and merged by `syncSessionState`; cleared on respawn (`onProcess`), eviction (`usage-limit` step) and dispose | `onStateChange` rewrites the whole session cell per chunk, so the runtime owns the flag. Read-only on output: no PTY writes, env or spawn change |
| `src/core/features/conversations/api/browser/conversation-manager.ts` | Observable `usageLimits` map synced from the TUI session list | Renderer state for the banner |
| `src/core/features/conversations/browser/usage-limit-banner.tsx` (new), `conversations-panel.tsx` | Warning banner over the terminal: "Continue in Freebuff" copies a handoff note (task name, notice, read `git status`/`git diff`) and opens a Freebuff conversation in the same worktree; "Install Freebuff" when it is missing; dismissible per detection | Freebuff is free and already a registered provider, but `pty-only` (no prompt argument), so the handoff goes by clipboard |

## 29. PR list hover action no longer covers the row metadata (`emdash/pr-ui-fix-ze8gw`)

| File | Change | Why |
|---|---|---|
| `src/core/features/projects/browser/components/pr-view/pr-row.tsx` | The `RelativeTime` and `PrDiffStat` spans get `transition-opacity group-hover:opacity-0` (and `shrink-0` on the time) | The "Review in Task" button is absolutely positioned over the row's right edge and fades in on hover, but the timestamp and `+N -N` diff stat stayed visible under its translucent `secondary` background, so the three overlapped. Same hover swap as `pr-entry.tsx` and the tab items |

## 30. "New version available" notice, not auto-update (`feat/update-notice`) — superseded

This slice (`src/core/features/release-check/`) was the opt-in *notice* that pointed users at a
manual download. Patch 43 replaced it with the real updater and **deleted** the slice: the
`ninebrains.releaseCheck` setting, the `releaseCheck` Wire domain, the sidebar notice and the
Settings card are gone. The reference is kept so a rebase knows the files were intentionally
removed, not lost. History: the notice was opt-in because SEC-38 allows no unprompted traffic on
first run; that rule still holds, and patch 43's check is packaged-build-only (no first-run
traffic), so it does not violate SEC-38.

## 31. Release 0.2.0 (`release/prepare-0.2.0`)

| File | Change | Why |
|---|---|---|
| `apps/emdash-desktop/package.json` | `version` 0.1.0 → 0.2.0 | Written by `pnpm run release:prepare 0.2.0`; `release.yml` refuses a version that does not match |

## 32. Signed macOS builds must be notarized to pass verification (`emdash/release-system-id7ap`)

| File | Change | Why |
|---|---|---|
| `scripts/release/verify-mac.ts` | New `--expect-notarized` flag (requires `--expected-team-id`): per app bundle, `xcrun stapler validate` and `spctl --assess --type execute` must report `source=Notarized Developer ID` | The release workflow passes it once `CSC_LINK` and notarization credentials exist, so a half-configured signing setup fails the build instead of shipping a release that still warns in Gatekeeper. Unsigned builds run exactly as before. Rollout: `docs/SIGNING.md` |

## 33. New-task terminals re-send a resize the runtime dropped before spawn (`emdash/turnicated-terminals-0yhnw`)

| File | Change | Why |
|---|---|---|
| `src/core/features/conversations/api/browser/conversation-manager.ts` | The TUI connector remembers the last size the pane requested; `handleTuiSessionListChanged` calls `reconcileSize` for running sessions, which re-sends that size once per (`startedAt`, target) when the runtime reports a different `cols`/`rows` | A task created from the Create Task modal mounts its terminal while the worktree provisions, so the pane's resize reaches `tuiAgents.resize` before the PTY exists and is dropped as `not-found`. The agent then spawns at the seeded size, which ignores the ContextBar inset and custom fonts, and draws truncated until a task switch remounts the pane |
| `src/core/features/conversations/browser/conversation-manager.test.ts` | Regression test: a dropped resize is replayed once, and never again once sizes match | Covers the race without a live runtime |

## 34. Freebuff and Codebuff get MCP servers and project context (`emdash/freebuff-connectors-9scgv`)

| File | Change | Why |
|---|---|---|
| `packages/core/src/services/agent-plugins/api/plugins/helpers/mcp.ts` | New `codebuffMcpAdapter`, a `passthroughMcpAdapter('.agents/mcp.json')` | Both CLIs load MCP servers globally from `~/.agents/mcp.json` in the standard `mcpServers` shape |
| `packages/core/src/services/agent-plugins/api/plugins/helpers/mcp.test.ts` | Write, merge, read and remove tests for the adapter | Covers the file path and key |
| `packages/plugins/src/agents/impl/freebuff/index.ts`, `packages/plugins/src/agents/impl/codebuff/index.ts` | `mcp` capability (`global`, stdio and http) and the adapter as behavior | Freebuff and Codebuff show up as MCP targets instead of unsupported |
| `packages/core/src/runtimes/tui-agents/node/runtime/runtime.ts` | Before building the command, best-effort `ensureKnowledgeContext` for the provider's cwd | Freebuff and Codebuff read `knowledge.md` and `AGENTS.md` but not `CLAUDE.md`; a missing `knowledge.md` is seeded from `CLAUDE.md` (else `AGENTS.md`), never overwriting one. `/knowledge.md` is first added to the repo's `info/exclude` (common dir for linked worktrees, resolved by reading `.git` and `commondir`, no `git` spawn) so agents cannot commit the generated copy; written with default permissions |
| `packages/core/src/runtimes/tui-agents/node/runtime/runtime.test.ts` | Seeds for freebuff, does not seed for claude | Guards the provider gate |
| `src/core/features/mcp/browser/components/useMcps.ts`, `McpToolbar.tsx`, `src/core/features/mcp/contributions/browser/McpPanel.tsx` | "Seed from Claude" toolbar button: adds freebuff and codebuff to every Claude-synced server, enabled when either CLI is installed | One click reuses the Claude MCP setup; strictly additive, so codex or opencode assignments stay |
| `src/core/features/mcp/browser/mcp-slice.browser.test.tsx` | Button renders, gates on `canSeedFromClaude`, calls the handler | UI coverage |
| `src/core/primitives/telemetry/api/telemetry.ts` | `mcp_seeded_from_claude: { count }` event | Typed telemetry map requires it |
| `agents/integrations/mcp.md`, `agents/integrations/providers.md` | Document the adapter, the seed button and the `knowledge.md` seed | Agent docs match behavior |

New Ninebrains-only files: `src/core/features/mcp/browser/seed-mcp.ts` (+ test), `packages/core/src/runtimes/tui-agents/node/runtime/ensure-context-file.ts` (+ test), `packages/plugins/src/agents/impl/{freebuff,codebuff}/index.test.ts`.

## 35. Option+drag text selection in TUIs that capture the mouse (`emdash/drag-copy-freebuff-s8xer`)

| File | Change | Why |
|---|---|---|
| `src/core/features/terminals/api/browser/pty/pty.ts` | Enable macOS `macOptionClickForcesSelection` so Option+drag forces a text selection even while the TUI runs its own mouse capture | Terminal TUIs (htop, lazygit, vim) grab the mouse, so plain drag selects nothing; Option+drag restores selection without breaking TUI mouse handling (#44) |
| `src/core/features/settings/browser/agents-page/AgentSignInModal.tsx` | Add the same Option+drag affordance hint when an agent sign-in modal hosts a TUI preview | Keeps the selection behavior consistent where a terminal renders inside the modal |

## 36. Keyboard shortcuts for the task context menu (`ninebrains/ripe-points-chew-ghl65`)

| File | Change | Why |
|---|---|---|
| `src/core/features/tasks/contributions/commands.ts` | New `task.rename` (F2), `task.delete` (Mod+Backspace), `task.copyBranchName` (Mod+Alt+C, via a `code()` chord since Alt cannot combine with a printable key token) commands; `task.pin` gains a `Mod+Shift+P` keybinding | Pin, Rename, Archive, Copy branch name and Delete in the task context menu had no keyboard shortcuts; Archive and bulk-delete already did |
| `src/core/features/tasks/browser/task-scope.tsx` | Implements `task.rename` (opens the rename modal), `task.copyBranchName` (copies the checked-out branch name), and `task.delete` (opens the delete modal, deletes, navigates back to the project view if the task was open) in `view.task` scope | Mirrors the existing local handlers in the sidebar/task-list rows so the shortcuts work wherever a task is open |
| `src/core/features/tasks/contributions/browser/task-context-menu.tsx` | Shows a `BoundShortcut` hint next to each menu item | Lets the shared context menu (used by both the sidebar and the project task-list view) surface the new bindings |

## 37. Brand-mark and colored agent-status icons, `thinking-orbs` dependency removed (`ninebrains/loading-state-3hkz5`)

| File | Change | Why |
|---|---|---|
| `packages/ui/src/react/components/agent-status/agent-status.tsx` | `working` now renders a local `WorkingMarkIcon` (the nine-square brand mark, animated as a ring sweep around the eight arm squares) instead of `<ThinkingOrb state="working">`; `awaiting-input` now renders a local `AwaitingInputIcon` (a warning-colored breathing circle) instead of `<ThinkingOrb state="breathing">`. The now-unused `useOrbTheme()`/`THEME_MANIFEST` polarity plumbing from §27 was removed. `idle`, `completed` and `error` are unchanged | Ninebrains' site redesign made the flat, hard-edged nine-square mark the brand identity, and the dotted `thinking-orbs` `working` glyph read as off-brand next to it. Separately, the monochrome `breathing` ring for `awaiting-input` was too easy to miss in a task list next to the working glyph; it is a distinct warning-colored dot again (the pre-`thinking-orbs` behavior, as a circle instead of a diamond). Supersedes §27's approach for these two states; documented as a Ninebrains-only exception (not a change to the shared standard) in advance-labs `DESIGN.md` → Components → "Agent status" and `docs/operating-system/systems/17-agent-status-indicators.md` |
| `packages/ui/package.json`, `pnpm-lock.yaml` | `thinking-orbs` dependency removed | Nothing in Ninebrains renders it anymore |

New Ninebrains-only files: `packages/ui/src/react/components/agent-status/working-mark-icon.tsx` (+ `.css.ts`), `packages/ui/src/react/components/agent-status/awaiting-input-icon.tsx` (+ `.css.ts`).

## 38. Hardstyle theme, and per-task/cross-task activity views (`ninebrains/loading-state-3hkz5`)

| File | Change | Why |
|---|---|---|
| `src/core/primitives/app-settings/api/app-settings.ts` | `Theme` union gains `'emhardstyle'` | New selectable theme id |
| `src/core/features/workbench/contributions/settings.ts` | `themeSchema` enum gains `'emhardstyle'` | The persisted setting must validate and store the new value |
| `src/core/primitives/theme/browser/theme-classes.ts`, `theme-classes.test.ts` | `THEME_CLASS_HARDSTYLE = 'emhardstyle'` added to `THEME_CLASSES` | New theme selector class, kept in convergence with `THEME_MANIFEST` |
| `src/renderer/index.html` | Boot pre-paint script recognizes `'emhardstyle'` and treats it as dark for the splash background/foreground colors | No flash of the wrong theme before the stylesheet loads |
| `src/core/features/settings/browser/components/ThemeCard.tsx` | New "Hardstyle" option (Zap icon) alongside System/Light/Dark | User-facing toggle, same place as light/dark/auto |
| `src/main/host/window.ts` | `applyNativeTheme` treats `'emhardstyle'` as dark for Windows native chrome | Was falling through to the `'system'` branch for the new id |
| `src/main/core/terminal-shell/color-env.ts` | `resolveEffectiveTheme` treats `'emhardstyle'` as dark for `COLORFGBG` | Same class of gap as the native-theme mapping above |
| `src/core/primitives/telemetry/api/telemetry.ts` | `FocusView` gains `'arena'`; `arena_viewed: { from_view: FocusView \| null }` event added | New view needs a telemetry id, same pattern as `lanes`/`planner` |
| `src/core/manifests/browser/browser-contributions.ts` | `+...arenaBrowserContributions.views` | Mount the Arena view runtime |
| `src/core/manifests/browser/view-catalog.ts` (+ `view-catalog.test.ts`) | `+arenaViewDef`; expected ids and the telemetry-event map gain `'arena'` | Register the `arena` view, same pattern as `lanes`/`planner` |
| `src/core/features/workbench/browser/sidebar/left-sidebar.tsx` | New "Arena" sidebar entry (Activity icon), modeled on the existing Automations entry | Global nav entry point for the new cross-task view |
| `src/core/manifests/browser/task-tab-contributions.ts` | `+...pulseTaskTabContributions` | Register the new per-task Pulse tab |
| `src/core/features/tasks/contributions/commands.ts`, `src/core/features/tasks/browser/task-scope.tsx` | New `task.openPulse` command (no keybinding), opens the `pulse` tab via `paneLayout.open('pulse', {})` | Discoverable entry point (command palette) for a tab kind with no per-instance open args, mirroring `task.openBrowser` |
| `src/core/features/tasks/contributions/browser/lifecycle-strip.tsx`, `git-diff-pulse.tsx` (new) | Small presentational components rendering `TaskStore.workspaceLifecycle` and `useTaskGitDiffStats` | Shared by the new Pulse tab and Arena view; live in `tasks`'s own contributions surface because the `core-module-boundaries` lint rule forbids one feature importing another feature's `browser/` internals directly |
| `packages/theme/src/core/codegen/run.ts` | `hardstyleTheme` imported and appended to `ALL_THEMES` | New theme must be included in the generated CSS build |
| `packages/theme/src/__generated__/theme.css`, `semantic.css` | Regenerated by `pnpm theme:build` to include the `.emhardstyle` selector block | Build output, not hand-edited; regenerating after `registry.ts`/`codegen/run.ts` change is required, not optional |

New Ninebrains-only files: `src/core/features/pulse/**` (per-task tab: provider, content, tab contribution), `src/core/features/arena/**` (cross-task view: view def, runtime, dashboard, browser contribution), `src/core/features/tasks/contributions/browser/{lifecycle-strip,git-diff-pulse}.tsx`, `packages/theme/src/themes/hardstyle.theme.ts` (+ its `registry.ts`/`codegen/run.ts` registration and regenerated `__generated__/{theme,semantic}.css`).

## 39. Home tiles and sidebar deep-links to Lanes and Planner (`ninebrains/curly-pumas-wave-vpv1q`)

| File | Change | Why |
|---|---|---|
| `src/core/features/workbench/browser/home-view.tsx` | `HomeMainPanel` is now an observer that adds "Open Lanes" and "Open Planner" action tiles under a separator; arrow-key navigation and the add-project actions are kept, Planner is disabled until a project exists (title falls back to "Add a project first"), and a first-run hint explains where to start | Home previously only offered project actions with no way in that never explained the Lanes/Planner flow; tiles now deep-link into the Lanes view and the Planner on the first project, so first-run discovery works without hunting through the tab strips |
| `src/core/features/workbench/browser/sidebar/left-sidebar.tsx` | New "Lanes" `SidebarMenuButton` (before "Automations", after the "Arena" entry from §38) navigates to `lanesViewDef({})` | A persistent entry point in the sidebar alongside the other Manage views, matching the new home tile |

New Ninebrains-only files: `src/core/features/workbench/browser/home-view.browser.test.tsx`.

## 40. Brain discoverability and a cross-project view (`ninebrains/viral-ai-r9k9c`)

| File | Change | Why |
|---|---|---|
| `README.md` | The Brain feature-table row, the "In this build" bullets for Brain and Planner, and a new "Arena" glossary row now mention Settings discoverability, the Arena cross-project view, and Planner's partial-accept flow; two new screenshot cards in "A closer look" | Docs match the new Settings card, Arena's Brain section, and Planner's partial accept, added below |
| `src/core/features/settings/browser/pages/general-settings-page.tsx` | New "Brain" `SettingsSection` rendering `BrainSettingsCard`; page description mentions the Brain | The Brain becomes discoverable from Settings, not only the Lanes drawer's "Start Brain" button |

New Ninebrains-only files: `src/core/features/brain/contributions/{arena,settings}.ts` (what the Arena and Settings slices reach into the Brain slice for), `src/core/features/lanes/browser/grid/brain-drawer-state.ts` (drawer open/close state, extracted so the Lanes first-run intro can open it too, without a circular import), `src/core/features/planner/browser/canvas-model.test.ts`, `src/core/features/settings/browser/components/BrainSettingsCard.tsx`.

## 41. Release 0.2.1 (`chore/release-0.2.1`)

| File | Change | Why |
|---|---|---|
| `apps/emdash-desktop/package.json` | `version` 0.2.0 → 0.2.1 | Written by `pnpm run release:prepare 0.2.1`; `release.yml` refuses a version that does not match |

## 42. Boot splash uses the website's loading mark (`ninebrains/loading-55uqq`)

| File | Change | Why |
|---|---|---|
| `src/renderer/index.html` | Boot splash: the old radial logo and "ninebrains" wordmark are replaced by the website's nine-square `#intro` mark, centred and sized the same (`clamp(96px, 12vmin, 120px)`); the indeterminate progress bar is replaced by `WorkingMarkIcon`'s clockwise arm sweep and core pulse, starting at 1.2s (when the bar used to appear); static under reduced motion. Theme background/foreground tokens are kept, not the site's `#000`/`#fafafa` | The splash still showed the retired branding; the app's first paint now matches the site, and keeping the theme colours avoids a flash when the splash hands off |

<<<<<<< HEAD
## 43. Clean Artifacts cleans artifacts; archived worktrees expire after 30 days (`ninebrains/archived-uxcqd`)

| File | Change | Why |
|---|---|---|
| `packages/core/src/runtimes/workspace-registry/api/contract.ts`, `packages/core/src/runtimes/workspace-registry/api/errors.ts`, `packages/core/src/runtimes/workspace-registry/api/index.ts`, `packages/core/src/runtimes/workspace-registry/api/schemas/usage.ts` | New `cleanArtifacts` host verb with its input, result and error schemas | The worktree page's Clean Artifacts button had no verb that removed only ignored files |
| `packages/core/src/runtimes/workspace-registry/node/runtime.ts`, `packages/core/src/runtimes/workspace-registry/node/api/controller.ts` | `cleanArtifacts`: under the per-workspace claim, deactivate (sessions + teardown), then remove ignored roots under the worktree writer lock; worktrees only | Same locking and deactivation as `deleteWorktree`, so nothing holds the files being removed |
| `packages/core/src/runtimes/workspace-registry/node/measure-usage.ts`, `packages/core/src/runtimes/workspace-registry/node/copy-artifacts.ts` | `listIgnoredArtifactRoots`, `resolvePatternMatches`, `isSafePattern` exported | The clean removes exactly what `measureUsage` reports as reclaimable and keeps `preservePatterns` matches with the same resolver the copy uses |
| `src/core/features/workspaces/api/wire-contract.ts`, `src/core/features/workspaces/node/wire-controller.ts`, `src/core/features/workspaces/node/workspace-mutation-service.ts`, `src/core/features/workspaces/api/node/operations/workspace-removal.ts` | Desktop `archive` mutation (and `archiveWorkspaceThroughRegistry`) replaced by `cleanArtifacts` | `archive` ran `git worktree remove --force` while the dialog promised "the worktree and its tasks stay intact" |
| `src/core/features/workspaces/contributions/browser/workspace-detail-page.tsx` | Clean Artifacts calls `cleanArtifacts`; dialog copy states what stays; toast reports removed and kept roots | The UI says what the action does |
| `src/core/features/workspaces/node/operations/list-project-workspaces.ts` | `canCleanArtifacts` only for registered worktrees | The verb refuses repository roots, whose ignored files are the user's own |
| `src/main/bootstrap/boot/phases/services.ts` | Hourly `sweepArchivedWorktrees` periodic sweep | Worktrees of tasks archived over 30 days are removed; branch and mirror row stay, so Restore replays the creation |
| `src/core/features/tasks/contributions/settings.ts`, `src/core/primitives/app-settings/api/app-settings.ts`, `src/core/features/tasks/api/browser/hooks/useTaskSettings.ts`, `src/core/features/settings/browser/components/TaskSettingsRows.tsx`, `src/core/features/settings/browser/pages/general-settings-page.tsx` | `tasks.cleanUpArchivedWorktrees` setting (default on) and its General settings row | An off switch for the automatic removal |
| `src/core/features/workspaces/node/wire-controller.test.ts`, `src/core/features/workspaces/node/workspace-mutation-service.test.ts` | Tests follow the `archive` → `cleanArtifacts` rename | |

New Ninebrains-only files: `packages/core/src/runtimes/workspace-registry/node/clean-artifacts.ts` (+ test),
`src/core/features/tasks/node/archived-worktree-cleanup.ts` (+ `.db.test.ts`).

## 44. Signed auto-update with our own Ed25519 key (`ninebrains/auto-update-*`)

The diy updater replaces both electron-updater and patch 30's notice. `UPDATES_ENABLED` is `true`.
The trust anchor is an Ed25519 key pair: `scripts/release/sign-update-digest.mjs` signs the
release's `SHA256SUMS.json` with the private key (repo secret `NINEBRAINS_UPDATE_SIGNING_KEY`),
and the app verifies that signature against the public key baked into the build. Marking patches 30
dead and pulling electron-updater out is what made the check match what the release actually signs
(THREAT-MODEL SEC-36). See `docs/RELEASING.md` → In-app updates and `agents/risky-areas/updater.md`.

| File | Change | Why |
|---|---|---|
| `src/core/primitives/app-identity/api/update-signing-key.ts` (new) | Embedded Ed25519 public key for update signatures | The only identity an update must match; a hijacked release or feed cannot satisfy it |
| `src/main/host/updates/feed.ts` | Reads `api.github.com/repos/Advance-Labs/ninebrains/releases/{latest\|a canary scan}` (unauthenticated), reduces to SemVer-newer releases for the app's channel, maps a release to its platform artifact and signed `SHA256SUMS.json` | The feed is GitHub Releases; nothing else (no R2, no first-run traffic on dev builds) |
| `src/main/host/updates/integrity.ts` | Derives, encodes and verifies the Ed25519 signature over the release's checksum JSON | Byte-for-byte trust gate before a download is offered |
| `src/main/host/updates/download.ts` | Streams the selected installer or checksum to disk with size + hash checks | Never holds the whole file in memory; partial download is discarded |
| `src/main/host/updates/staging.ts` | Stages artifacts under the userData cache dir with a marker (`requestedAt`, `installKind`, `signature`); `isSafeArtifactName` limits names to a plain basename; clear-by-name never trusts the marker's stored path | Path-safety for artifacts that come from a network feed (write path and delete path both derive from the validated artifact name) |
| `src/main/host/updates/apply/index.ts` | Applies a staged update on next launch: replaces the `.app` or AppImage/`.deb` for mac/Linux, relaunches; Windows spawns the staged NSIS installer from `will-quit` (`electron-builder` `runAfterFinish: true` restarts it) | Running binaries cannot swap themselves; the user's **Restart now** is the moment of truth |
| `src/main/host/updates/update-service.ts` | Owns check → offer ⇒ download → stage ⇒ verify → apply-on-launch state; `initialize` applies a pending update once, right after the main window is up, then relaunches | Boot stays window-first; the updater never runs before the app is usable |
| `src/core/features/updates/` (new; `api/`, `node/`, `browser/`) | Wire domain over the update service; bottom-right pill ("Download now", then "Restart now"), sidebar is untouched | The only UI surface; idle splits idle/"Download" and never auto-installs |
| `scripts/release/sign-update-digest.mjs` (+ test) | Signs the release's `SHA256SUMS.json`; the `release` job in `release.yml` runs it and fails closed when the secret is unset | One signing gate in the whole pipeline |
| Deletions | `src/core/features/release-check/`; `dev-app-update.yml` / `dev-app-update.canary.yml`; the builder configs' publish provider (now `publish: null`) | Anything that could feed or patch the app outside the signed path is gone |
| `src/renderer/tests/browser/workspace-view-slots.test.tsx` | Stubs `UpdateStatusPill` alongside the sidebar, window scope and layout stubs | The titlebar now renders the pill, and this test replaces `@emdash/ui/react/primitives` with a `Toaster`-only factory, so the pill's `Button` import could not link and the file failed to import at all |

New Ninebrains-only files: `src/core/primitives/app-identity/api/update-signing-key.ts`,
`src/core/features/updates/**`, `src/main/host/updates/{feed,integrity,download,staging,update-service,version,types}.ts`,
`src/main/host/updates/apply/**`, `apps/emdash-desktop/scripts/release/sign-update-digest.mjs`,
and their tests.

## 45. Agent docs map gains a `plans/` section (`ninebrains/auto-update-*`)

Staged build plans that span several PRs need a home agents can find. The first one documents how
TUI agent sessions already survive the app closing, and what is missing before that can be the
default.

| File | Change | Why |
|---|---|---|
| `agents/README.md` | Adds a `plans/` entry to the directory layout, pointing at `agents/plans/detached-sessions.md` | The docs map is how agents discover topic pages; an unlisted plan does not get read |

New Ninebrains-only files: `agents/plans/detached-sessions.md`.

## 46. Easier-to-read terminal font (`ninebrains/text-changes-zewlr`)

| File | Change | Why |
|---|---|---|
| `src/core/features/settings/browser/components/TerminalSettingsCard.tsx` | Adds bundled Atkinson Hyperlegible Mono under an always-visible "Easier to read" font group and explains its softer, distinctive letter shapes | The installed-font picker only surfaced fonts already present on the host, so users who need less square, more distinguishable terminal text had no reliable built-in option |
| `src/renderer/main.tsx` | Loads the variable font's normal and italic CSS | The font must be available to xterm on every supported host and retain ANSI italic styling |
| `package.json` (desktop), `pnpm-lock.yaml` | Adds `@fontsource-variable/atkinson-hyperlegible-mono` 5.3.0 (OFL-1.1) | Bundles the fixed-width accessibility font without relying on an OS font installation |
## 47. Gate tmux on the binary being available (`ninebrains/auto-update-*`)

Requesting tmux on a host where the `tmux` binary is not installed used to fail the session
outright (`/bin/sh -c 'tmux has-session … || tmux new-session …'` exits non-zero). This is T1 of
`agents/plans/detached-sessions.md`: a missing binary now degrades to a plain PTY instead.

| File | Change | Why |
|---|---|---|
| `apps/emdash-desktop/src/core/features/tasks/api/node/task-session-launch-context.ts` | The launch context's `Promise.all` now also resolves tmux availability per host via `runtime.data.hostDependencies.resolver.resolve({ id: 'tmux' })` (a lookup failure or thrown error is treated as absent, never a hard error); `resolveSessionTmux` is called with `tmux.value && tmuxAvailable`; the result carries an optional `tmuxWarning` computed by the new `resolveTmuxWarning` helper | `resolveSessionTmux` stays pure and synchronous; the async availability check happens once, in the resolver's existing `Promise.all`, and is resolved against the session's own host so SSH hosts consult their own machine |
| `apps/emdash-desktop/src/core/features/tasks/node/task-session-launch-context.test.ts` | Adds a `tmux availability gate` suite covering: binary present, binary absent (falls back to plain PTY with `tmux_missing`), local Windows (unchanged, `tmux_unsupported_on_windows`), remote host (resolved against that host), and a dependency-lookup failure (treated as absent) | Covers the five acceptance rows from the plan's T1 |
| `packages/core/src/services/pty/api/local-spawn.ts` | `LocalPtySpawnWarning` gains `'tmux_missing'`; new exported `resolveTmuxWarning({ requested, available, isLocalWindows })` picks between no warning, `tmux_missing`, and `tmux_unsupported_on_windows` | The renderer needs to tell "install tmux and it will work" apart from "your OS cannot run tmux" |
| `packages/core/src/services/pty/api/local-spawn.test.ts`, `packages/core/src/services/pty/api/index.ts` | Unit tests for `resolveTmuxWarning`; re-exports it alongside the existing local-spawn exports | |

No new Ninebrains-only files.
