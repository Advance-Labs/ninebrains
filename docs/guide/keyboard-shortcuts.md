---
title: Keyboard shortcuts
description: >-
  Every default keyboard shortcut in Ninebrains: global commands, tabs and panes, the task view,
  the file tree, the Lanes view and STOP, and how to change them.
---

In the tables, **Mod** is ⌘ on macOS and Ctrl on Windows and Linux. **Alt** is ⌥ Option on macOS.
**Ctrl** means the Control key on every OS.

## Changing shortcuts

Open **Settings → Interface → Keyboard shortcuts**. Click a key, press the new keys, or reset it
to the default. A shortcut that is reserved or already in use is refused.

Shortcuts marked **fixed** below cannot be changed.

## While a terminal has focus

- **macOS:** every shortcut works while a terminal has focus.
- **Windows and Linux:** a shortcut does nothing while a terminal has focus, unless it is marked
  **works in terminal** below. The terminal gets the keys instead.

## Global

| Command | Keys |
|---|---|
| Command palette | Mod+K |
| Open settings | Mod+, |
| New project | Mod+Shift+N |
| New task | Mod+N |
| Go back / Go forward | Mod+[ / Mod+] |
| Open in editor | Mod+O |
| Confirm | Mod+Enter |
| Toggle left sidebar | Mod+B |
| Zen mode (not while the editor or browser has focus) | Ctrl+Z |
| **Stop all agent work** (fixed, works in terminal) | Mod+Shift+Backspace |

Toggle theme and Give feedback are in the command palette, with no key.

## Tabs and panes

| Command | Keys |
|---|---|
| Next tab / Previous tab | Mod+Alt+Right / Mod+Alt+Left |
| Close tab | Mod+W |
| Reopen closed tab | Mod+Shift+T |
| Rename tab | Mod+Shift+R |
| Split pane | Mod+\ |
| Cycle tabs (fixed, works in terminal) | Ctrl+Tab / Ctrl+Shift+Tab |
| Open tab 1 to 9 (fixed) | Mod+1 to Mod+9 |
| Close a dialog (fixed) | Esc |

## Task view

| Command | Keys |
|---|---|
| New conversation | Mod+T |
| New conversation in a right split | Mod+D |
| View changes | Mod+Shift+1 |
| View files | Mod+Shift+2 |
| View conversations | Mod+Shift+3 |
| Search file contents (works in terminal) | Mod+Shift+F |
| Toggle terminal drawer | Mod+J |
| Toggle right sidebar | Mod+. |
| New terminal | Mod+Shift+` |
| Open browser | Mod+Shift+B |
| Copy browser URL | Mod+Shift+C |
| Archive task (not in the editor) | Mod+Shift+E |
| Next task / Previous task | Mod+Alt+Down / Mod+Alt+Up |
| Delete selected tasks (task list focused) | Mod+Backspace |
| Add context | Mod+Shift+A |

These have no key, and are in the command palette: View terminals, the browser's Back, Forward,
Reload, Focus URL and Open externally, Git fetch, pull and push, Pin task, and Convert to regular
task.

## Editor and terminal

| Command | Keys |
|---|---|
| Save file (fixed) | Mod+S |
| Save all files (fixed) | Mod+Shift+S |
| Find in terminal (fixed) | Mod+F |
| Close terminal search (fixed) | Esc |

Inside a terminal:

| Keys | Does |
|---|---|
| Shift+Enter | Inserts a newline without sending |
| ⌘Backspace (macOS) | Deletes to the start of the line |
| Ctrl+Shift+C | Copies the selection |
| Ctrl+V or Ctrl+Shift+V (Windows), Ctrl+Shift+V (Linux) | Pastes |

## File tree

These do nothing while you are typing in a text field.

| Command | Keys |
|---|---|
| Rename | Mod+Shift+R |
| Cut / Copy / Paste | Mod+X / Mod+C / Mod+V |
| Delete | Mod+Backspace |

## Lanes view

All fixed, and all work while a terminal has focus.

| Command | Keys |
|---|---|
| Focus lane 1 to 4 | Mod+1 to Mod+4 |
| Maximize the focused lane (toggle) | Mod+Shift+Enter |

**Open Lanes** is in the command palette, with no key.

## Planner

See [Planner](planner.md#building-a-plan) for the canvas keys.

## Search boxes

Mod+F moves to the search box on the MCP, Skills, Automations and Prompts pages, the task list and
the pull request list. On the Settings page, `/` does the same.
