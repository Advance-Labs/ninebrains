# Routing usability: four asks from Lucas

Status: plan + first slice done, 2026-09-15. Lucas asked for visibility into "the oauth tools the
user has" plus three related usability gaps in the routing/lane experience. This file covers all
four: what's built now, and a design sketch for what's left. Inputs:
`docs/plans/2026-09-12-model-routing.md` (the routing plan this extends), `docs/THREAT-MODEL.md`
(D5, §1, SEC-42/44), the routing slice's own README.

## 1. CLI/auth visibility — DONE, this pass

Built: a read-only "Agents" panel in Settings → Models showing, per CLI (`claude`, `codex`),
whether it's installed and where, and per role (worker/subagent/reviewer) which auth mode
`resolveRoute` would give it today (your subscription login, an API-key profile with its label and
tier, or blocked with the reason).

Files:
- `apps/emdash-desktop/src/core/features/routing/api/contract.ts` — `agentCliStatusSchema`,
  `agentRoleModeSchema`, the `agentCliStatus` wire procedure.
- `apps/emdash-desktop/src/core/features/routing/node/routing-service.ts` — `agentCliStatus()`,
  the `resolveInstalled` dependency.
- `apps/emdash-desktop/src/core/features/routing/node/wire-controller.ts` — wires the procedure.
- `apps/emdash-desktop/src/main/bootstrap/boot/ninebrains/create-ninebrains-services.ts` — supplies
  `resolveInstalled` via the same `hostDependencies.resolver` call already used for the reviewer's
  `installed` set (no new probing mechanism, D5).
- `apps/emdash-desktop/src/core/features/routing/browser/agent-cli-status.tsx`,
  `models-settings-view.tsx` — the panel and its place in Settings → Models.
- Tests: `routing-service.test.ts`'s `agentCliStatus` suite,
  `browser/agent-cli-status.browser.test.tsx`.

**Blocker for the profile half of this feature reaching production, flagged explicitly:**
`MODEL_PROFILES_ENABLED` (`apps/emdash-desktop/src/core/primitives/app-identity/api/fork-flags.ts:30`)
is `import.meta.env.DEV` — on in dev builds, off in every release build, per plan §9.1 ("Lucas
decides"). The CLI-detection half of this panel (installed/path) works in any build and needs no
flag decision. But the profile half — a role showing `kind: 'profile'` with a label and tier — can
never be true for a real user until Lucas turns Lever B on for release builds. Until then, this
panel is dev-only-useful for anything beyond "is the CLI installed." That decision (plan §9 item 1)
is unchanged by this pass; it's just now more visibly blocking than before, because there's finally
a UI that would show the result.

## 2. MCP servers shared/scoped across lanes

Not built. The ask: let a user add one MCP server once (not from a pack) and apply it to lanes,
with visibility into which servers are "Brain's" (bundled pack servers) vs "the user's own."

Sketch: pack-sourced MCP server config lives under
`apps/emdash-desktop/src/core/features/packs/` today (not fully read for this pass — treat as the
likely home for wherever a "user-added server" concept would plug in, since packs already own the
per-lane `mcp.json` shape and the reserved-name check). A user-added server is a new kind
alongside a pack server, not a replacement: it still needs to go through the same rules a pack
server does — SEC-10 (per-lane `mcp.json`, not a global file lanes could poison each other through)
and SEC-28 (reserved server names, so a user server can't shadow `brain` or a pack's own tools).
The UI question (which lanes get it, one add vs per-lane opt-in) is unresolved.

**Next free ids:** check `docs/THREAT-MODEL.md` for the next free T-number before adding rows for
this; do not reuse T46 (taken by this pass, §5 below) or invent numbers speculatively.

## 3. Shared `AGENTS.md`/`CLAUDE.md`-style instructions across lanes

Not built. The ask: one set of project-level instructions a lane picks up automatically, instead of
copy-pasting a role's prompt into every lane.

Sketch: a pack role's system prompt is passed today as `--append-system-prompt` argv
(`exec-runs/api/node/claude-print.ts:82`, guarded against injection by
`exec-runs/api/node/argv-guard.ts:83`), built from a pack's own `appendSystemPrompt` field in two
call sites: `packs/api/launch.ts` and `brain/node/launch-config.ts:183` (the latter is what a
Brain-dispatched lane actually goes through). The smallest design: one project-level instructions
file (analogous to a repo's own `AGENTS.md`/`CLAUDE.md`, but Ninebrains-managed so it's visible and
editable from Settings rather than requiring a file edit) plus optional per-lane extra text,
concatenated into the same `--append-system-prompt` value at launch — no new argv surface, no new
trust boundary, since it flows through the same guarded path a pack role's prompt already does.

**Next free ids:** check `docs/THREAT-MODEL.md` for the next free T-number if this turns out to
need one (for example, if the project-level file becomes writable by something other than the
user through Settings); do not invent one now.

## 4. CLI reproducibility docs (exact command/flags/env, secrets redacted)

Not built. The ask: for a given lane or run, show the exact command that was actually run — binary,
args, env — so a user can reproduce it outside Ninebrains, with secrets redacted.

Sketch: the e2e harness already captures this shape for test doubles —
`apps/emdash-desktop/e2e/harness.mjs`'s `installFakeClaude` wires `FAKE_AGENT_ARGV_LOG` /
`argvLog` so a fake CLI records its own argv to a file the test then reads back
(`apps/emdash-desktop/e2e/stub-claude.mjs` is the fake binary itself). A real-run version would
need to capture from the launch builder side instead (the same place `routeLaunch`/`launch-env.ts`
already assembles env and argv for a run), not from the child process, since a real CLI won't
cooperate the way the fake one does. Before any of that assembled command reaches a UI or gets
persisted, it must pass through the SEC-35 redactor
(`apps/emdash-desktop/src/core/features/exec-runs/api/node/redact.ts`) — the same one that already
runs over transcripts, logs and evidence — so a profile's API key (SEC-40: it lives only in one
spawn's env) never surfaces in a "here's what ran" view.

**Next free ids:** check `docs/THREAT-MODEL.md` for the next free T-number before adding a row for
a new persistence or display surface this would introduce; do not invent one now.

## 5. Threat model

See `docs/THREAT-MODEL.md` T46 (added this pass) for the security note on item 1's new
information-disclosure surface. Items 2-4 above are future work with no new T/R ids claimed yet.
