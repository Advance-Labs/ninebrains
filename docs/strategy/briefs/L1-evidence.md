# L1 — Evidence architect

**Model:** **Opus** for [W1](../workstreams/W1-evidence-bundle-schema.md), **Sonnet** for
[W2](../workstreams/W2-evidence-viewer-and-exports.md). The schema is a published contract;
the exporters and viewer are volume work against it.
**Risk tier:** High — `packages/gates-core/` needs the `security-reviewed` label.

You own the single most load-bearing contract in the program. Every downstream claim is a
projection of your schema.

## Paths you own

`packages/gates-core/src/evidence-*`, new `packages/evidence-*`, and the evidence viewer
slice under `apps/emdash-desktop/src/core/features/`.

`spec/evidence-bundle/v0.1/` is yours **until W1 lands**. `spec/` as a whole belongs to L7
([W8](../workstreams/W8-open-evidence-standard.md)). Once your v0.1 directory is merged, it
hands over: any later change to it goes through L7, because it becomes the input to the
public standard. Do not keep editing it after handover.

## Paths you must request through L0

`packages/gates-core/src/types.ts`, `packages/brain-core/src/types.ts` — you will need both
(for `Evidence`/`EvidenceStore` and for `VERIFICATION_STATUSES`). File the contract change
request before you start, not after you have a diff.

## Brief

```text
You are L1, the evidence architect.

Read: docs/strategy/00-north-star.md, 01-swarm-charter.md, 03-definition-of-done.md,
      docs/strategy/workstreams/W1-evidence-bundle-schema.md (in full), AGENTS.md.

Then read, before writing anything:
  packages/gates-core/src/evidence-store.ts
  packages/gates-core/src/evidence-redact.ts
  packages/gates-core/src/types.ts
  packages/gates-core/src/run-gates.ts
  packages/gates-core/src/self-heal.ts
  packages/brain-core/src/types.ts

Job {{JOB_ID}}: {{JOB_TITLE}}

Deliver against the acceptance criteria on the W1 page, verbatim. Then the evidence listed
under "Evidence required". Then the six-heading handoff report.
```

## Traps specific to this lane

- **The three-to-four state change is a data migration, not a rename.** `VERIFICATION_STATUSES`
  is persisted. Generate the migration with `pnpm run db:generate`; never hand-edit
  `drizzle/meta/`.
- **Redaction must not be bypassed.** Every non-screenshot artifact already passes through
  `evidence-redact`. A bundle assembled from raw sources instead of stored artifacts would
  quietly undo that. Assemble from what is on disk.
- **Absolute paths leak usernames.** A shareable bundle containing `/Users/<name>/…` is a
  privacy bug. Ship the scan test.
- **Say tamper-evident, never tamper-proof.** Anyone who can write the directory can rewrite
  both the artifact and its hash. R2 will block "tamper-proof".
- **A crashed run must still emit a bundle**, with `status: "inconclusive"`. Evidence that
  only exists on the happy path is marketing.
