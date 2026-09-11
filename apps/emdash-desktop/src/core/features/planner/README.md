# Planner canvas (Phase 3)

A visual plan for a project. Nodes are jobs and notes, edges are dependencies,
module group nodes hold other nodes, and double-clicking a module drills into
it. **Run plan** compiles the canvas into Brain jobs and edges through
`Brain.compilePlan` (brain-core), which is idempotent per node id, archives
removed nodes, and rejects cycles with the cycle path.

## Wiring (integrator)

`createPlannerService(deps)` in `node/planner-service.ts` is the only thing to
construct. Three ports, all in `node/ports.ts`:

| Port | v0.1 implementation | Later |
|---|---|---|
| `PlanTarget` | `createBrainPlanTarget(brain)` (`node/brain-plan-target.ts`) | unchanged |
| `CanvasStore` | `createMementoCanvasStore(rowPort)` (`node/canvas-store.ts`) | Brain DB `canvases` table |
| `BriefDrafter` | `createUnavailableBriefDrafter()` (the default) | an unattended Brain run |

```ts
// services.ts
const planner = createPlannerService({
  canvasStore: createMementoCanvasStore(mementoRowPort),
  planTarget: createBrainPlanTarget(brain),
});
// wiring.ts -> createDesktopWireOptions(): planner: services.planner
```

- `mementoRowPort` is a `MementoRowPort` (`read(key)`, `write(key, row)`) over
  the mementos runtime. **Not written here:** reading and saving a row from main
  goes through the `mementos.memento` live model (`remote(...)` + lease +
  `mutations.save`, as `primitives/mementos/browser/memento-client.ts` does), and
  that belongs next to the runtime client in main. Rows use memento id
  `planner.canvas-doc` (subject kind `planner-canvas`, key `<projectId>/<canvasId>`)
  plus `planner.canvas-index` (kind `planner-project`) for `listCanvases`.
- Until `planner` is passed, `DesktopControllerContext.planner` is optional and
  the controller serves `createUnwiredPlannerService()`: canvases live in memory
  and Run plan says the Brain is not connected. No crash, no silent success.
- `planTarget.subscribe` hooks `brain.events` `jobChanged`, which feeds the
  `nodeStates` live model (live state colour per node).

## Decisions made without asking

- **Drill-down is a scope, not a second document.** A module's children are
  nodes with `parentId`; drilling in shows that module's descendants on their
  own with breadcrumbs. One document per canvas keeps compile and persistence
  simple. `canvasId` still exists for separate top-level canvases.
- **An edge that touches a module stands for every job inside it**, at any
  depth (`api/flatten.ts`). Notes and modules are never jobs. Proposed
  (unaccepted) drafts never compile.
- **Plan id** = `plan-` + 32 hex of sha256(`projectId canvasId`). brain-core keys
  plans globally by `(planId, node id)`, so a bare canvas id like `main` would
  collide across projects, and brain-core caps ids at 64 characters.
- **Viewport** is a registered renderer memento (`planner.viewport`, 90 days,
  500 entries). The default `(0, 0, 1)` means "never moved" and fits the view.
- **Canvas document limits** (`api/schema.ts`): 500 nodes (= brain-core's plan
  limit), 2,000 edges, 512 KB serialized, path-safe ids. Every load re-validates;
  a corrupt or oversized stored doc comes back empty with `recovered: true`
  and a toast, never an exception.
- **Keyboard:** Delete/Backspace, Cmd/Ctrl+Z (session undo, no redo),
  Cmd/Ctrl+C/V (in-memory clipboard), Cmd/Ctrl+Enter (Run plan), Escape (up one
  module). Shift-drag box-selects; Cmd/Ctrl-click multi-selects.
- Nodes inside a module are bounded by it (`extent: 'parent'`). Moving a node
  between modules is not supported in v0.1; copy and paste into the other
  module instead.

## Upstream files touched

Append-only registrations: `manifests/browser/view-catalog.ts` (+ its test's id
list), `manifests/browser/browser-contributions.ts`,
`manifests/shared/domain-contracts.ts`, `manifests/node/controllers.ts`,
`manifests/shared/memento-catalog.ts`. One type widening:
`primitives/telemetry/api/telemetry.ts` adds `'planner'` to `FocusView`,
because navigation telemetry passes any view id as `from_view`.

## Tests

```bash
pnpm --dir apps/emdash-desktop exec vitest run --project node src/core/features/planner
pnpm --dir apps/emdash-desktop exec vitest run --project browser src/core/features/planner
```

## Screenshots

The browser test project does not compile Tailwind in imported CSS, so the
screenshot test (`src/renderer/tests/browser/planner-screenshots.test.tsx`) loads
a precompiled copy of `src/renderer/index.css` from an untracked
`__generated__/` folder. To regenerate `docs/screenshots/planner-*.png`, run from
`apps/emdash-desktop`:

1. Compile the stylesheet with `@tailwindcss/node` `compile` + `@tailwindcss/oxide`
   `Scanner` into `src/renderer/tests/browser/__generated__/planner-tailwind.css`.
2. `VITE_PLANNER_SCREENSHOTS=1 pnpm exec vitest run --project browser src/renderer/tests/browser/planner-screenshots.test.tsx`
