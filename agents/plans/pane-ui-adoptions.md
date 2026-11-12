# Plan: UI ideas worth taking from Pane

An audit of the visual design, interaction model and code structure of Pane
([github.com/dcouple/Pane](https://github.com/dcouple/Pane)), checked against what Ninebrains
already has. The output is a ranked list of ideas to adopt, each mapped to the slice that would
own it here.

**License rule: Pane is AGPL-3.0, Ninebrains is Apache-2.0. Take ideas, never code.** Nobody
copies, ports or closely paraphrases Pane source, CSS or artwork into this repo. Build each item
from our own primitives.

Written 2026-11-11 against `main` at `372ed5c07`, from a read-only clone of Pane (v2.4.216,
2026-11-08). Pane paths below are in their repo; `D` = `apps/emdash-desktop/src/core`.
Companion plan: [`cross-machine-handoff.md`](cross-machine-handoff.md) covers Pane's handoff and
remote features.

## Pane at a glance

- **Model.** Repository, then Pane (one worktree and branch), then Panel (a tab). Panel types:
  terminal, diff, explorer, editor, logs, dashboard, setup-tasks, browser, notes. Rule: reviews
  and QA are tabs, not new panes (`docs/TOOL_PANEL_SYSTEM.md`).
- **Layout.** Three regions:
  - left sidebar of repos with panes nested under them;
  - centre tab strip over a full-bleed agent terminal, with a bottom terminal dock showing one
    chip per running agent;
  - right Git inspector (Branch, Actions, History, Changes).

  Splits are a recursive layout tree on `allotment`, with drag-to-split drop zones.
- **Visual.**
  - Semantic CSS variables mapped into Tailwind 3; each theme is a root class.
  - About 25 themes in six families (Standard, Neon, Editorial, Retro, Atmosphere,
    Accessibility).
  - System font for the UI, Geist Mono for terminals, lucide icons.
  - Compact rows of about 28px, tiny uppercase section labels.
  - Motion only on state change, respecting `prefers-reduced-motion`.
- **Stack.** React 19, about 25 small Zustand stores, Electron 43, xterm 6.1 beta,
  `@git-diff-view` with shiki, Monaco, `match-sorter`, `@assistant-ui/react` for chat tabs.
- **UX principles** (`docs/UX_PRINCIPLES.md`):
  - prompt-first, so creating a pane needs nothing typed;
  - opinionated defaults;
  - never hide destructive or security actions;
  - status stays minimal, preferring dots and text to spinners;
  - debounce status at 300ms.

## Already at parity or ahead (do not rebuild)

| Area | Ninebrains | Source |
|---|---|---|
| Command palette | `cmdk` palette (Mod+K) with command, file and task providers | `D/primitives/palette/`, `D/features/workbench/browser/command-palette/` |
| Rebindable shortcuts | Overrides-only storage, conflict detection, recorder | `D/primitives/keybindings/`, `KeyboardSettingsCard.tsx` |
| Splits and tabs | Drag tabs, split-drop zones, up to 8 panes | `D/primitives/workbench-shell/browser/tabs/` |
| Diff review | Monaco stacked diff with inline line comments; Pane has no inline comments | `D/features/source-control/browser/diff-view/` |
| Browser tab | Electron webview with preview-server start page | `D/features/browser/browser/` |
| Chat | ACP chat is first-class; Pane's chat tabs are opt-in and experimental | `D/features/conversations/browser/acp/` |
| Theme tokens | TS-defined tokens generated into CSS, so one styling system; Pane mixes Tailwind with 1,300 lines of hand CSS | `packages/theme/` |
| Flash-free first paint | Window `backgroundColor` follows the OS, plus a static splash | `apps/emdash-desktop/src/main/host/window.ts:48` |
| Multi-agent grid | Lanes 2×2 with status lights | `D/features/lanes/` |

## Ideas to adopt, ranked by value over effort

| # | Idea | What Pane does | Gap here | Owner slice | Effort |
|---|---|---|---|---|---|
| U1 | **One status grammar, with "done, unseen"** | One table drives the dots on sidebar rows, tabs and palette items: blocked (red, pulsing), working (blue, pulsing), done-unseen (static), idle (green). "Done, unseen" clears when you open the pane. | `AgentStatus` has `working`, `awaiting-input`, `error`, `completed`, `idle` (`packages/ui/src/react/components/agent-status/agent-status.tsx:8`). Lane lights are a separate vocabulary (`D/features/lanes/browser/status-light.tsx`). Check whether `completed` clears on view. | `agents` primitives, `packages/ui` | S |
| U2 | **Keyboard-only sidebar and region focus** | `⌘0` focuses the sidebar, `j`/`k` or arrows move, F6 and Shift+F6 cycle regions, regions minimise and maximise | No arrow or roving focus in the sidebar tree. Focused region is only `main \| bottom`. | `workbench` | S–M |
| U3 | **Attention inbox** | Optional sidebar mode that lists only panes needing you (blocked, then done-unseen), numbered for quick jump | No equivalent. Mod+1–9 is taken by tabs, so the inbox needs its own jump keys or palette entries. | `workbench` sidebar | M |
| U4 | **Approvals inbox plus a `notify` MCP tool** | Agents send typed cards (options, approve, ask, info) and get the answer back as the tool result. Cards collect in one Approvals view per session and can float over other apps. | ACP permission prompts are inline per chat. Claude `PermissionRequest` becomes an OS notification. There is no central inbox and no way for TUI agents to ask a structured question. | `brain-mcp` tool + new `approvals` slice | M–L |
| U5 | **Light and dark slots for System mode** | System mode has one light slot and one dark slot, and any palette can fill either | System mode follows the OS but only between fixed pairs | `packages/theme`, `ThemeCard.tsx` | S |
| U6 | **Theme contrast test in CI** | `themeContrast.test.ts` checks text and status tokens against WCAG | None | `packages/theme` | S |
| U7 | **Accessibility palettes** | Colorblind Safe (Okabe-Ito status colours), Low Fatigue, High Legibility (AAA) | Five themes, none accessibility-specific | `packages/theme` | S each |
| U8 | **Density setting** | Switchable sidebar row layout | `comfortable` and `compact` densities exist in `packages/theme/src/densities/registry.ts` but no app setting uses them | `settings`, `workbench` | S |
| U9 | **Diff counts and PR number on sidebar rows** | Rows show `+307 −22` and `#125` | Status or relative time only | `workbench` sidebar, `source-control` | S |
| U10 | **Ports panel and per-task resource chip** | Listening ports grouped by pane; a resource chip in the tab strip (`2.5 GB`) | Ports appear only on the browser start page. Resource cards exist for remote machines, not per task. | `preview-servers`, `machines` | M |
| U11 | **Mission Control grid** | Grid of live agent tiles across every pane; a hovered tile becomes a real terminal after 250ms | Lanes are 2×2 within one tab | `lanes` | L |
| U12 | **Mobile key bar** | Paste, Stop, Esc, Tab, Enter and Up buttons for terminals on touch screens | Only matters with a remote phone client; see handoff plan non-goals | — | L, later |

Do better than Pane in two places: the theme picker should show colour swatches, not just names
and descriptions, and sidebar rows need a clearer hierarchy than bold, truncated names.

## Things to avoid

- **Theme sprawl.** About 25 themes make `colors.css` over 4,400 lines. Add palettes only where
  they serve a need (accessibility first), and keep them generated from ramps.
- **Two styling systems.** Pane mixes Tailwind utilities with a large hand-written stylesheet.
  Keep everything in `packages/theme` tokens and vanilla-extract.
- **Giant components and a flat folder.** `CommandPalette.tsx` is 806 lines and `NotifyCard.tsx`
  1,140, and `components/` holds about 70 flat files. Keep new UI inside its owning slice under
  `contributions/` and `browser/`.
- **Pinned beta dependencies.** Pane pins xterm and its webgl addon to beta builds.
- **Two agent UIs drifting apart.** Pane keeps a terminal path and an experimental chat path
  bridged by "Switch to chat". Any new status or approval surface here must serve both TUI and
  ACP from one source.

## Task sequence

| # | Task | Done when |
|---|---|---|
| P1 | U1: status table in `packages/ui`, used by sidebar, tabs, palette and lane lights; add done-unseen | **Mostly existed (#181).** `AgentStatus` already drives sidebar rows, tabs and palette rows; `completed` already clears on view through the per-conversation seen flag; animations already respect reduced motion. #181 relabels `completed` "Agent finished, not yet viewed" and adds the first test. Remaining: map lane lights onto `AgentStatus` (security-reviewed path) |
| P2 | U5 + U6: light/dark slots and contrast test | **Done (#182).** Contrast test caught Light and Solarized Light status colours at 2.70–2.98:1; fixed in the ramps, allowlist empty |
| P3 | U2: sidebar roving focus and F6 region cycling | The whole app works without a mouse; browser test covers it |
| P4 | U8 + U9: density setting and diff/PR metadata on rows | Settings toggle changes row height; rows show counts |
| P5 | U3: attention inbox mode | Toggle in sidebar; jump keys documented in `docs/guide/keyboard-shortcuts.md` |
| P6 | U4: `notify` MCP tool and approvals inbox | A TUI agent asks a multiple-choice question and receives the answer |
| P7 | U7, U10 | As needed |

U11 and U12 wait until the handoff plan and P1–P6 have shipped.
