# Upstream patches

Every edit Ninebrains makes to a file that exists in upstream Emdash, so weekly rebases stay
cheap. Append only: add new entries at the bottom, never rewrite old ones. Paths are relative
to `apps/emdash-desktop/src/` unless they start with the repo root.

| Date | Phase | File | Change | Why |
|---|---|---|---|---|
| 2026-09-10 | 1 (lanes) | `core/manifests/shared/domain-contracts.ts` | `+[lanesDomain]: lanesContract` | Register the `lanes` wire contract |
| 2026-09-10 | 1 (lanes) | `core/manifests/node/controllers.ts` | `readonly lanes: LaneService` on the context + `lanes` controller entry | Serve the `lanes` contract |
| 2026-09-10 | 1 (lanes) | `main/bootstrap/boot/wiring.ts` | `lanes: services.ninebrains.lanes` | Pass LaneService into the controller context |
| 2026-09-10 | 1 (lanes) | `main/bootstrap/boot/phases/services.ts` | One `createNinebrainsServices({...})` call, `ninebrains` on `ServicesBundle`, late-bound `resolveLaneLaunch` in `tuiConversationDependencies`, bound `createConversation`/`launchTuiConversation` | Construct lanes; conversation verbs live in `conversations/node/`, which other slices may not import, so the composition root binds them |
| 2026-09-10 | 1 (lanes) | `core/features/conversations/node/tui-conversation-provider.ts` | Optional `resolveLaneLaunch(conversationId)` dependency, merged into `extraArgs` and `providerVars` in `buildStartInput` | SEAMS §3.7 launch hook; Phase 1 returns `undefined`, Phase 2 fills it |
| 2026-09-10 | 1 (lanes) | `core/manifests/shared/memento-catalog.ts` | `+lanesGridMemento` | Persist lane config and grid membership |
| 2026-09-10 | 1 (lanes) | `core/manifests/browser/view-catalog.ts` + `view-catalog.test.ts` | `+lanesViewDef`; expected ids gain `'lanes'` | Register the `lanes` view |
| 2026-09-10 | 1 (lanes) | `core/manifests/browser/browser-contributions.ts` | `+...lanesBrowserContributions.views` | Mount the lanes view runtime |
| 2026-09-10 | 1 (lanes) | `core/manifests/shared/command-catalog.ts`, `command-palette-catalog.ts` | `+LANES_COMMAND_DEFS`, `+LANES_COMMAND_PALETTE_ITEMS` | Lane shortcuts and the Open Lanes palette command |
| 2026-09-10 | 1 (lanes) | `core/manifests/browser/scope-catalog.ts` | Window scope gains `LANES_WINDOW_COMMAND_DEFS`; `+lanesViewScope` | Bind Open Lanes globally and lane shortcuts in the view |
| 2026-09-10 | 1 (lanes) | `core/features/workbench/browser/window-scope.tsx` | `'lanes.open'` handler (navigate to the lanes view) | Window-scope commands must be implemented here |
| 2026-09-10 | 1 (lanes) | `core/primitives/telemetry/api/telemetry.ts` | `FocusView` gains `'lanes'` | Navigation telemetry types view ids; drop with telemetry removal |
