# W2 — Evidence viewer and exports

| | |
|---|---|
| **Lane** | L1 Evidence architect |
| **Model** | Sonnet |
| **Wave** | 2–3 |
| **Risk tier** | Standard |
| **Depends on** | [W1](./W1-evidence-bundle-schema.md) |
| **Blocks** | [W7](./W7-verified-delivery-bench.md) |

## Intent

W1 makes the bundle real. W2 makes it visible. A schema and a recorder nobody looks at is
an internal status screen with extra steps. The strategy is explicit: the bundle is the
**central product artifact**, and its job is to be opened, shared, screenshotted, linked
from a PR, and cited by a teammate who was never in the room when the job ran.

This workstream does not touch the schema. It renders it, four ways, and gives the app a
permanent place to show it. Where this page and [W1](./W1-evidence-bundle-schema.md)
disagree about what a field means, W1 wins; this page only consumes.

## Where the code is today

- `apps/emdash-desktop/src/core/features/gates/browser/job-verification-modal.tsx` and
  `job-verification.tsx` — the current evidence surface: a modal, opened per job, backed by
  `getGatesClient().getVerification()` and `readEvidence()`. This is the seed of the viewer,
  not the viewer. It is modal and per-job; the strategy asks for a permanent, browsable one.
- `apps/emdash-desktop/src/core/features/gates/api/contract.ts` — `gatesContract`:
  `getVerification`, `readEvidence` (base64, per file), `deleteEvidence`. `readEvidence` is
  the existing pattern for handing a stored artifact to the renderer without a filesystem
  path leaking into it.
- `apps/emdash-desktop/src/core/features/gates/node/wire-controller.ts` and
  `apps/emdash-desktop/src/core/features/gates/node/verification-service.ts` — the node side
  of that contract.
- `apps/emdash-desktop/src/core/manifests/browser/browser-contributions.ts` — aggregates
  `gatesBrowserContributions.modalDefs` from
  `apps/emdash-desktop/src/core/features/gates/contributions/browser.ts`. A new modal or view
  is added here the same way.
- `apps/emdash-desktop/src/core/manifests/browser/task-tab-contributions.ts` — aggregates
  per-feature `contributions/tabs.ts` arrays (see
  `apps/emdash-desktop/src/core/features/conversations/contributions/tabs.ts` and
  `apps/emdash-desktop/src/core/features/source-control/contributions/tabs.ts` for the
  pattern). A permanent, always-there evidence surface is a task tab, not a one-shot modal.
- `apps/emdash-desktop/src/core/manifests/node/controllers.ts` — aggregates Wire controllers;
  `gates: { create: ({ gates }) => createGatesWireController(...) }` at line ~498 is the
  existing registration this workstream extends rather than duplicates.
- `apps/emdash-desktop/src/core/manifests/shared/desktop-wire-contract.ts` — where a
  controller's contract is wired into the desktop gateway.
- `packages/chat-ui/src/` — the existing transcript/diff renderer patterns (`ChatRoot.tsx`,
  `core/`, `components/`) to match for rendering diffs and command output, rather than
  building a second diff renderer.
- `packages/ui/src/react/primitives` — `Dialog`, `Button`, `Text` and the rest of the
  component kit already used by `job-verification-modal.tsx`; the viewer uses these, not new
  primitives.

## Deliverables

### D1 — Human-readable HTML export

One `.html` file per bundle. Non-negotiable properties, because "share it with a teammate"
only works if every property below holds:

- **Self-contained.** No external `<script src>`, `<link>`, font, or image fetch. Everything
  — styling, fonts, screenshots, diff — is inlined (base64 for binary, inline `<style>` for
  CSS). A `file://` open with no network must render identically to a served one.
- **No network fetches at render time.** Anything currently rendered live (e.g. a preview
  URL) is captured as a static screenshot or omitted with a note, never linked as `<iframe>`.
- **Renders every bundle section legibly**, not just links to raw JSON:
  - the diff (reuse chat-ui's diff rendering conventions, not a second implementation);
  - commands with their exit codes, in run order, failures visually distinct from passes;
  - screenshots with their viewport label and URL metadata attached, not just the image;
  - the reviewer's verdict, identity, independence level, and findings;
  - retry history — what failed on each attempt and what changed before the next one;
  - the risk section: untested areas, assumptions, waivers (actor, reason, timestamp),
    residual risks.
- **Works in light and dark.** Respect `prefers-color-scheme`; do not assume the viewer's
  OS matches the machine that generated the file.
- **Carries the status prominently** — one of the four terminal states from W1 (`verified`,
  `verified-with-waiver`, `blocked`, `inconclusive`) — and visually distinguishes
  `verified-with-waiver` from `verified`. This is the same rule W1 states for the app UI:
  a waived job must never look clean.

Implementation note: generate this from the same validated bundle W1's `BundleRecorder`
writes, not from a second in-memory model of the run. Two renderers reading one bundle stay
honest with each other; a renderer with its own state drifts from what actually happened.

### D2 — Machine-readable JSON export

The bundle **is** JSON already, against
`spec/evidence-bundle/v0.1/evidence-bundle.schema.json` (W1 D1). This deliverable is the
export affordance, not a new format: a one-click "Export JSON" that copies the validated
bundle file to a user-chosen location, re-validates before writing, and refuses to write
data that fails validation. Do not add fields here that are not in the schema; a field that
exists only in the export and not the schema is exactly the drift W1 forbids.

### D3 — GitHub Check and PR summary

- A GitHub Check run, one per verified job, whose summary is generated from the bundle:
  status, gate pass/fail counts, reviewer verdict, retry count, residual risk count — the
  same facts the badge (D5) states, rendered as Markdown instead of one line.
- A link from the Check to the HTML export (D1) or, once hosting exists, a hosted copy of it.
  Until then, link to the bundle path in the repository or attach it to the Check as an
  artifact; do not fabricate a URL that is not live.
- A PR comment or summary section that surfaces the same facts inline, so a reviewer does
  not have to leave the PR to learn what ran.
- This is additive to CI, not a replacement: the Check reports what Ninebrains's own gates
  found. It has no authority to mark a deterministic CI check green or red.

### D4 — Signed artifact attached to the commit or release

Attach the bundle (or a reference to it) to the commit or release as an artifact. **Signing
itself is out of scope for this workstream** — W1 explicitly defers it, and this page does
not implement it either. What this deliverable does:

- Attach the bundle file, unsigned, with its W1 integrity hash intact and visible.
- Structure the attachment so a signature can be added later without changing where the
  bundle lives or how it is referenced (a stable artifact slot, not a one-off upload path).
- State plainly, in the UI and the attachment's own metadata, that the artifact is
  **tamper-evident, not signed** — anyone who can write the artifact can currently rewrite
  it and its hash together. Do not call it "signed" or imply cryptographic non-repudiation
  before a signing key exists. R2 will reject an implied signature.

### D5 — Permanent local evidence viewer

A durable, always-reachable view in the app — not a modal a user has to know to open per
job. Concretely:

- A new browser surface under
  `apps/emdash-desktop/src/core/features/gates/browser/` (or a sibling feature if the
  surface area grows past what belongs in `gates/`; decide by reading
  `apps/emdash-desktop/src/core/features/gates/README.md` first and escalate to L0 before
  splitting a slice that already exists), contributed as a task tab through that feature's
  `contributions/tabs.ts` and aggregated by
  `apps/emdash-desktop/src/core/manifests/browser/task-tab-contributions.ts`, following the
  pattern in `apps/emdash-desktop/src/core/features/conversations/contributions/tabs.ts`.
- The existing modal (`job-verification-modal.tsx`) stays as the quick-look surface; the new
  tab is the durable one a user returns to, browses history in, and exports from. Do not
  delete the modal without checking every call site through `defineModal` usage.
- New Wire procedures (list bundles for a project, fetch one bundle's full record, trigger an
  export) belong in `apps/emdash-desktop/src/core/features/gates/api/contract.ts` (or a new
  `api/` file in the same slice) with a controller in
  `apps/emdash-desktop/src/core/features/gates/node/`, registered through
  `apps/emdash-desktop/src/core/manifests/shared/desktop-wire-contract.ts` and
  `apps/emdash-desktop/src/core/manifests/node/controllers.ts` — the same seam `gatesContract`
  and `createGatesWireController` already use. Do not add a second Wire domain for the same
  slice.
- The renderer calls these through a typed domain client the same way
  `getGatesClient()` is used today, never through a new `window.electronAPI` surface.
- Reuse `readEvidence`'s base64-handoff pattern for any new artifact reads; it already keeps
  filesystem paths out of the renderer.

### D6 — The badge

The strategy's exact requirement, quoted in full because the wording is load-bearing:

> `Ninebrains: 8/8 configured checks passed · independent review passed · 1 retry ·
> 2 residual risks disclosed`

Ship it with one word changed, for the reason below:

> `Ninebrains: 8/8 configured checks passed · review passed (fresh context, different
> provider) · 1 retry · 2 residual risks disclosed`

**The word "independent" is conditional and the badge must treat it that way.**
[W4](./W4-independent-review.md) defines four independence axes and a degradation ladder,
and states that the UI must not print "independent" below the `full` level. `PROVIDERS` in
`packages/brain-core/src/types.ts` is `['claude', 'codex']`, so a one-provider machine is
the common case, not the edge case. The badge therefore renders W4's per-level sentence —
`review passed (fresh context, different provider)`, `review passed (fresh context,
different model)`, `review passed (fresh context)` — never a bare "independent review
passed". A badge that prints a stronger word than the run earned is the failure this whole
export exists to prevent.


Binding rules:

- **Factual and itemised, always.** Every clause in the badge must be a direct read of the
  bundle: configured-check pass count over total, reviewer verdict, retry count, residual
  risk count. No clause may be inferred, estimated, or rounded up.
- **Never a generic green "AI verified" badge.** A bare "Verified ✓" is explicitly forbidden,
  not merely discouraged. The reason is the product thesis itself: verification is only
  meaningful if an observer can inspect *which* checks ran and *what they did not establish*.
  A green checkmark asserts the opposite — that inspection is unnecessary.
- The badge is generated from the same bundle as every other export (D1–D4). A badge string
  computed from a different code path than the HTML/JSON exports is exactly the kind of
  drift this workstream must not introduce.
- `verified-with-waiver` and `blocked` states get their own honest badge text, not a
  suppressed or softened version of the `verified` one.

### D7 — The distribution loop

Build the app-side half of the loop the strategy describes:

```
run job → bundle → GitHub Check → reviewer sees evidence link
        → public repos expose real examples → benchmark aggregates → better policies
```

Concretely, this workstream is responsible for steps one through three landing correctly:
the bundle exists, the Check carries it, and the link a reviewer clicks actually opens
something inspectable — the HTML export, or, once a partner or public repo hosts it, that
hosted copy. Steps four through six belong to [W7](./W7-verified-delivery-bench.md) and
[W10](./W10-external-corroboration.md); this page does not implement them, but it must not
break the handoff — the bundle format and the link shape are the contract those later
workstreams depend on.

State the framing plainly in any developer-facing doc this workstream writes: **the export
is simultaneously proof and acquisition content.** A team that shares a real evidence bundle
is doing their own job (showing their reviewer what ran) and Ninebrains's job (showing a
prospective user what verification actually looks like) in the same act. Do not oversell
this — it is a description of the mechanism, not a claim that any specific bundle will
convert anyone.

### D8 — Privacy and redaction

An export leaves the machine more easily than a bundle sitting in `.ninebrains/evidence/`
ever did. That changes the bar.

- **No absolute host paths.** W1's bundle already forbids these (acceptance criterion:
  scanned for the home-directory prefix); this workstream's job is to confirm every export
  path (HTML, JSON, Check summary, artifact attachment) preserves that guarantee and does
  not reintroduce a path by, for example, embedding a raw stack trace or an unredacted
  command line in the HTML template.
- **No secrets.** W1's redaction (`packages/gates-core/src/evidence-redact.ts`) runs on the
  way into the store; this workstream must not read around it. Any new text surfaced in an
  export — a Check summary line, a badge string — is built from already-redacted bundle
  fields, never from a fresh read of raw command output.
- **No customer code beyond what the bundle already legitimately contains.** An export must
  not pull in additional worktree files "for context" that were not already part of the
  bundle's diff or evidence.
- **An explicit redaction pass runs on every export path**, not only on ingestion. Treat
  export as a second, independent checkpoint: even if ingestion redaction has a gap, the
  export step re-checks for the same patterns before anything is written to a location the
  user could hand to a third party.
- **A pre-publish confirmation is mandatory** before anything leaves the machine: sharing the
  HTML file, attaching the artifact, or posting the GitHub Check. The confirmation states
  what will be sent and where. This is a UI requirement, not a suggestion — no export path
  may skip the confirmation step, including ones triggered by automation; automated paths
  (e.g. CI-triggered Check posting) require the redaction pass to run unattended and fail
  closed (block the post) rather than send unredacted content if redaction cannot confirm.

## Acceptance criteria

- [ ] A bundle produced by W1's recorder exports to a single `.html` file that opens with
      `file://` and no network access, and renders correctly.
- [ ] The HTML export renders the diff, every command with its exit code, every screenshot
      with viewport and URL, the reviewer verdict with its independence level, the full
      retry history, and the risk section, from one bundle.
- [ ] The badge string is generated from the bundle's recorded independence level, and a
      test asserts that a bundle below W4's `full` level cannot produce a badge containing
      the word "independent".
- [ ] The HTML export is legible in both a light-scheme and a dark-scheme browser, verified
      by screenshot of both.
- [ ] A bundle exports to JSON that re-validates against
      `spec/evidence-bundle/v0.1/evidence-bundle.schema.json` after export.
- [ ] A GitHub Check is created for a verified job, with a Markdown summary stating status,
      gate counts, reviewer verdict, and retry count, and a working link to inspectable
      evidence.
- [ ] The commit or release artifact attachment exists, is unsigned, states "tamper-evident,
      not signed" in its own metadata, and its hash matches `verifyBundle`'s output for the
      same bundle.
- [ ] The permanent evidence viewer is reachable as a task tab, contributed through the
      owning slice's `contributions/tabs.ts` and aggregated by
      `apps/emdash-desktop/src/core/manifests/browser/task-tab-contributions.ts`, not only
      through a modal a user has to know to summon.
- [ ] New Wire procedures for the viewer are registered through
      `apps/emdash-desktop/src/core/manifests/shared/desktop-wire-contract.ts` and
      `apps/emdash-desktop/src/core/manifests/node/controllers.ts`, following the existing
      `gatesContract` / `createGatesWireController` pattern.
- [ ] The badge string is generated from the same bundle data as the HTML/JSON exports, is
      itemised (check count, reviewer verdict, retry count, residual-risk count), and no
      code path produces a bare "verified" or "AI verified" badge with no itemisation.
- [ ] A `verified-with-waiver` bundle produces a visually and textually distinct badge and
      HTML header from a `verified` bundle.
- [ ] A test asserts no absolute host path appears in any of the four export formats, run
      against a bundle whose worktree path is a temp directory with a realistic username.
- [ ] A test asserts a bundle carrying a recognised secret pattern (already redacted at
      ingestion) does not have that secret reappear in any export.
- [ ] Every export path (manual HTML/JSON export, Check posting, artifact attachment) either
      shows a pre-publish confirmation or, for unattended paths, runs the redaction check and
      fails closed on any redaction failure.
- [ ] `pnpm run check` passes.
- [ ] `docs/UPSTREAM-PATCHES.md` updated if any inherited file changed.

## Evidence required for review

1. A rendered HTML export, opened via `file://`, screenshotted in both light and dark mode.
2. The JSON export's re-validation run output against the v0.1 schema.
3. A real GitHub Check payload (or a recorded dry-run of one) for a job that retried once and
   disclosed at least one residual risk.
4. The artifact attachment's metadata showing the "tamper-evident, not signed" statement and
   a hash comparison against `verifyBundle`.
5. Test output for the path-leak scan and the redaction-survives-export test, run against all
   four export formats.
6. Screenshots of the permanent viewer as a task tab, and of the badge in its `verified`,
   `verified-with-waiver`, `blocked`, and `inconclusive` renderings.

## Limitations

- The HTML export is a point-in-time render of one bundle revision. It does not update if
  the underlying job is re-verified; a stale copy shared by a teammate can go out of date.
- The GitHub Check integration in this workstream covers posting and summarising. Merge
  policy, required-check configuration, and branch protection are the team's own GitHub
  settings, not something this workstream enforces.
- The signed-artifact deliverable produces an unsigned, tamper-evident attachment only.
  Signing is a distinct, later job; nothing here should be read as securing the supply chain.
- A passing gate set and a clean badge do not establish that the change is correct — only
  that the configured checks ran and what they found. The badge states counts, not
  correctness.
- Redaction is pattern-based, inherited from W1. It reduces, not eliminates, the chance of a
  secret or path reaching an export; it is not a guarantee.

## Follow-ups this job should file, not do

- Hosting for HTML exports so GitHub Check links point at a live page rather than an
  attached file.
- Actual signing of the artifact attachment (D4), once a signing key and process exist.
- Bundle-to-bundle diffing in the viewer, across attempts or across jobs.
- A public, shareable link flow with its own access controls, distinct from the local export.
