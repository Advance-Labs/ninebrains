# Upstream patches

Every change Ninebrains makes to files inherited from Emdash (`generalaction/emdash`, forked at
`dbf690c`). Keep this list current: it is what makes an upstream rebase cheap. New Ninebrains-only
files are listed at the end. Code comments on patched lines start with `Ninebrains:`.

Paths are relative to `apps/emdash-desktop/` unless they start with `.github/`, `apps/`, `tooling/`
or are root files.

## 1. Emdash-hosted infrastructure cut (task 0.1 / W0)

| File | What | Why |
|---|---|---|
| `src/core/primitives/app-identity/api/fork-flags.ts` (new) | `UPDATES_ENABLED`, `HOSTED_ACCOUNT_ENABLED`, `TELEMETRY_SETTINGS_ENABLED`, all `false` | One switch per feature that needs Emdash servers |
| `src/main/lib/telemetry.ts` | PostHog key/host forced to `undefined`; telemetry is opt-in (`storedEnabled !== 'true'`) | No telemetry to Emdash's PostHog; off by default and pointed at nothing. `isEnabled()` is false, so capture, identify, `/decide` feature flags, DAU, perf vitals and crash `$exception` events never send |
| `.github/actions/setup-build/action.yml` | `posthog-key` / `posthog-host` inputs and the `VITE_POSTHOG_*` env lines removed; `pnpm/action-setup`, `actions/setup-node` and `actions/setup-python` pinned to commit SHAs (W7 CI) | No telemetry key is ever baked into a build. The release and e2e builds run through this action, so its actions are pinned like the workflows' |
| `src/core/features/settings/browser/pages/general-settings-page.tsx` | Account section, UpdateCard and TelemetryCard gated by fork-flags | Remove UI that needs Emdash servers instead of leaving it broken |
| `src/core/features/settings/browser/search/settings-search.ts` | `withoutForkHiddenEntries` drops the `version`, `privacy-telemetry`, `emdash-account` entries | Search must not land on hidden settings |
| `src/main/host/updates/update-service.ts` | `initialize` returns early unless `UPDATES_ENABLED`; release-notes URL → `Advance-Labs/ninebrains`; `autoInstallOnAppQuit` `true` → `false` (`autoDownload` was already `false`) | No update polling of Emdash's feed; ours stays off until a release exists (the repo is private, so electron-updater could not read it anyway). Even with updates enabled, nothing downloads or installs without an explicit user action, because builds are unsigned until plan 7.1. Test: `src/main/host/updates/update-service.test.ts` |
| `src/main/lib/telemetry.test.ts` (new) | Asserts that a fresh profile is opted out and that nothing is fetched, even with PostHog keys in the env and the user opted in | Guards the telemetry defaults below. The upstream code fails the second case. Note: the `TELEMETRY_ENABLED` env kill switch in `bootstrap/core/config.ts` keeps its upstream default; the stored user preference is what now defaults to off |
| `dev-app-update.yml`, `dev-app-update.canary.yml` | owner/repo → `Advance-Labs/ninebrains`, cache dir `ninebrains-updater` | Updater feed points at our GitHub Releases |
| `electron-builder.config.ts`, `electron-builder.canary.config.ts` | publish → GitHub `Advance-Labs/ninebrains` only (R2 generic feed removed); Emdash's Azure signing profile removed; `copyright` added; Info.plist usage strings renamed | No publishing to or updating from Emdash's R2; no Emdash signing identity |
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
| `src/renderer/index.html` | `<title>`, boot-splash logo (Ninebrains mark + wordmark) and splash strings |
| `src/core/primitives/app-identity/browser/emdash-logo.tsx`, `emdash-shimmer-logo.tsx` | Emdash wordmark paths replaced with the Ninebrains mark + wordmark (`LogoShapes`) |
| `src/assets/images/emdash/*.png`, `*.icns`, `build/dmg-background.tiff` | File contents replaced with the original Ninebrains mark (same filenames). The DMG background lost Emdash's three-dash motif |
| `package.json` (desktop) | description, homepage, author (Advance Labs Inc.) |
| 32 source files | User-visible "Emdash" strings → "Ninebrains" (recovery dialogs and `recovery.html`, notifications, settings copy, theme names, quit dialogs, tray labels, etc.). Exact list: `git diff dbf690c --stat -- apps/emdash-desktop/src` |
| `src/core/services/notifications/node/producers/update-producer.test.ts`, `project-availability-presentation.test.ts`, `settings-search.test.ts`, `renderer/tests/browser/github-connect-resume.test.tsx` | Assertions follow the new copy and the hidden OAuth / telemetry entries |

Left as "Emdash" on purpose: copy that is only reachable through the gated account UI; and the legacy-import screens, which describe importing data from a previous *Emdash* install.

## 4. CI and repo files

| File | What | Why |
|---|---|---|
| `.github/workflows/release-{canary,prod,linux,workspace-server}.yml` | Deleted | They publish to Emdash's R2/GitHub and need Emdash's signing and PostHog secrets |
| `.github/workflows/code-consistency-check.yml` | `workflow_dispatch` only (was PR + push to `main`); `permissions` (`contents: read`, `actions: read`), a per-PR `concurrency` group and `timeout-minutes: 30` (W7 CI) | Superseded by `.github/workflows/ci.yml`, which runs the same checks and more; running both doubles the minutes. `nrwl/nx-set-shas` needs `actions: read`; without it every run failed in about 20 s with "Resource not accessible by integration" |
| `.github/workflows/workspace-server-package-check.yml` | `workflow_dispatch` only | Save Actions minutes on the private repo |
| `.github/ISSUE_TEMPLATE/config.yml` | Links → our repo | |
| `package.json` (root), `tooling/scripts/check.mjs` | `licenses` script, added to `pnpm check` | Licence gate (task 0.4) |
| `tooling/scripts/check.mjs`, `package.json` (root) | `check` runs `format:check` (was `format`, which rewrote files) and the new `test:tooling` step; `--write` / `check:write` restores the writing mode; `test:tooling` script runs the node tests in `tooling/scripts`, `tooling/fake-agent/test` and `scripts/release`; `hooks:install`, `merge`, `require-green`, `labels:sync` and `release:prepare` scripts for the merge guard and releases (W7 CI) | `pnpm run check` now matches what CI runs and never edits the tree, so a green local check means a green `static` job |
| `README.md` | Replaced with a short Ninebrains placeholder; later (`53253af4c`, W7 docs) the feature list and quick start corrected to match the code: unwired features listed as "in the code, not yet reachable from the app", a "Set up gates" step, and the Brain started from the Lanes title bar; later still (W7 `w7/testsgate-prefs`) the "not yet reachable" list was retired, since the Planner, lane roles and modes and the per-project rigor override all have entry points now | The README must not claim what the app cannot do yet |
| `apps/emdash-desktop/vitest.config.ts` | `EMDASH_TEST_BROWSER=1` forces the `browser` project on under `CI`; new `node-spawn` project (`maxWorkers: 2`, `sequence.groupOrder: 1`) takes the spawn-heavy suites out of `node`; `browser` gets `testTimeout: 15_000` and `optimizeDeps.include` for the JSX runtime (W7 CI) | CI can run real-browser tests. Spawn-heavy suites (gates capabilities, exec-runs, brain stop/unattended, override-launch) get less contention instead of looser deadlines (SEC-30 keeps its 5 s). The late JSX-runtime discovery reloaded Vite mid-run and failed browser tests |
| `packages/chat-ui/vite.config.ts` | `EMDASH_TEST_BROWSER=1` forces the `browser` project on under `CI` (W7 CI) | Same switch as the desktop app |
| `CONTRIBUTING.md` | "Before you open a PR" rewritten (non-mutating `check`, `hooks:install`, browser-test switches); new "Sign your commits (DCO)", "CI and merging" and "End-to-end tests" sections; commands list and security section updated (W7 CI) | The old text said CI ran checks on PRs, which was false, and had no DCO, merge flow or e2e guidance |
| `.github/PULL_REQUEST_TEMPLATE.md` | Replaced: checklist for `pnpm run check`, DCO and title, the upstream-patch log, new dependencies and licences, security areas with SEC-IDs, local browser tests, 1440/390 screenshots, real-CLI use (W7 CI) | Matches what `ci.yml` and `pnpm run merge` enforce, plus what they cannot check |
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
| `electron-builder.config.ts`, `electron-builder.canary.config.ts` | `publish: null` (was GitHub draft); mac dmg+zip for arm64 **and x64**, signing from `resolveMacSigning(env)` (`identity: '-'` ad-hoc, `notarize: false` with no env); win nsis only (msi dropped), `resolveWinSigning(env)`; linux AppImage+deb (rpm dropped); `nsis.differentialPackage: false`; `artifactName` `Ninebrains-${version}-${os}-${arch}.${ext}` | SEC-36: no `app-update.yml` or `latest*.yml` while builds are unsigned. Signing switches on from env only and never fails without it |
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

Append-only registrations. Lever B is behind the fork flag `MODEL_PROFILES_ENABLED`
(`app-identity/api/fork-flags.ts`, a Ninebrains file: `import.meta.env.DEV`, so on in dev builds
and off in release builds).

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
`.github/workflows/release.yml`, `docs/RELEASING.md`, `scripts/release/checksums.mjs`,
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
Merge guard: `tooling/scripts/{pre-push,require-green,merge-pr}.mjs` and their `*.test.mjs`,
`tooling/git-hooks/pre-push`, `.github/CODEOWNERS` (W7 CI).
Repo hygiene: `.github/dependabot.yml`, `tooling/scripts/sync-labels.mjs` and its test (W7 CI).
Releases: `tooling/scripts/changelog.mjs` and its test; `CHANGELOG.md` (written by
`release:prepare`). `.github/workflows/release.yml` (Ninebrains-only since W4) gained the ref and
`ci-ok` gates, the `channel` input, `--prerelease`, changelog notes, the e2e job and SHA pins (W7 CI).

Retired: `.github/workflows/licenses.yml` (W7 CI). The licence gate runs in `ci.yml`'s `static` job.
