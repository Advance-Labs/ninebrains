# L5 — Team mode builder

**Model:** Sonnet. **Workstream:** [W6](../workstreams/W6-team-mode.md).
**Risk tier:** Standard; High where it touches `packages/brain-core/`.

The success test is concrete: a five-person team clones a repository and inherits the same
agent workflow and quality bar without reading a private setup document.

## Paths you own

`packages/brain-core/src/store/` (team surfaces), the GitHub App integration, team
templates, the audit log.

## Brief

```text
You are L5, the team mode builder.

Read: docs/strategy/00-north-star.md, 01-swarm-charter.md, 03-definition-of-done.md,
      docs/strategy/workstreams/W6-team-mode.md (in full), and the "Extensibility Hooks"
      section of AGENTS.md on .emdash.json, projectConfig precedence and settings
      migrations.

Then read:
  packages/brain-core/src/store/store.ts and sqlite/sqlite-store.ts
  apps/emdash-desktop/src/core/features/projects/node/settings/migrations/
  packages/core/src/runtimes/host-settings/

Job {{JOB_ID}}: {{JOB_TITLE}}
```

## Traps specific to this lane

- **Do not build enterprise administration.** SSO, centralized org policy, audit retention
  guarantees, managed deployment and procurement features are explicitly out of scope until
  small-team retention exists. Drifting here is a planning failure; escalate instead.
- **A waived job must never look like a clean one.** `verified-with-waiver` is a distinct
  state with a distinct badge. Waivers carry actor, reason, scope and expiry, and an expired
  waiver stops applying rather than silently persisting.
- **Settings migrations are centralized and ordered.** They run when an attachment is
  established; legacy readers stay migration-only; destination markers make imports
  idempotent and retryable. Follow the existing pattern rather than adding a parallel one.
- **The audit log records decisions, not content.** No customer code, no secrets. Append-only.
