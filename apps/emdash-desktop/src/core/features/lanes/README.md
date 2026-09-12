# Lanes

A lane is one Emdash Task (its worktree) plus one PTY Conversation in it. A tab holds a 2×2
grid of lanes. The Brain's unit of work is a Job; lanes only carry `activeJobId`.

- `api/`: the `lanes` contract (`board` and `statuses` live models, `events`, procedures) and
  `LaneSidePanelSource`, which Phase 2 implements.
- `node/lane-service.ts`: owns lane state in main and persists it in the `lanes.grid` memento.
  Sleep hides a lane and never stops its PTY.
- `node/ninebrains-services.ts`: `createLaneService` plus the port builders. The Ninebrains
  composition root (`app/main/bootstrap/boot/ninebrains/`) calls it with the Brain's
  `LaneBrainPort`: per-launch config, job-state light override, `activeJobId`, launch release.
- `browser/grid/`: the view, grid, lane cells and add-lane form.

## Decisions made while blocked

- **Conversation verbs are injected.** `createConversation` and `launchTuiConversation` live in
  `conversations/node/`, which other slices may not import. `services.ts` binds them and passes
  them to `createNinebrainsServices()`, so that patch is about 40 lines rather than 3.
- **Browser toggle reuses the browser slice's tab content.** `BrowserPane` sits in
  `browser/browser/`, which lanes may not import. `lane-browser.tsx` renders
  `browserTaskTabContributions[0].TabContent` with a one-tab host carrying the lane's stable
  `browserId`. BrowserPane needs the task's preview servers, so until the lane task's workspace
  has loaded in this window the cell shows "Browser not ready" with an Open task button.
- **Editor toggle opens the task view** rather than embedding Monaco.
- **Persistence is main-owned.** LaneService writes the memento through the mementos runtime
  client; grid sizes use the standard `workbench.panel-layouts` memento through the Resizable
  layout storage, keyed per tab. The maximized arrangement is not persisted.
- **Unit tests use port fakes.** LaneService depends on narrow ports (`node/lane-ports.ts`), so
  its tests fake those rather than the TUI/PTY runtime fakes.
- **Agent feed is local only** and does not re-subscribe if the TUI worker restarts; a restart
  leaves lights stale until the app reloads. Fine for v0.1 local lanes.
- **Run mode and role live in the lane config.** `runMode` (absent = attended) and `roleId`
  (`pack:role`) are optional fields, so older grids load unchanged. `setLaneMode` persists the mode;
  the Brain's dispatcher reads it back through the composition root. The header's mode control
  and the add-lane form's role picker come from the brain and packs slices' `api`/`contributions`.
