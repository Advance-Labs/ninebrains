# W1 — Evidence Bundle v0.1: schema and recorder

| | |
|---|---|
| **Lane** | L1 Evidence architect |
| **Model** | Opus |
| **Wave** | 1 |
| **Risk tier** | High (`packages/gates-core/` — `security-reviewed` label required) |
| **Depends on** | — |
| **Blocks** | W2, W4, W8, W11 |

## Intent

Make the evidence bundle the product's central artifact rather than an internal status
screen. Today evidence is a per-attempt directory with a manifest. It needs to become a
portable, immutable, schema-validated record that a teammate can open, a CI system can
consume, and a stranger can audit without trusting us.

This is the highest-leverage job in the program. Every downstream claim — the viewer, the
GitHub Check, the open standard, the benchmark, the case studies — is a projection of this
schema. Getting a field wrong here is a versioned, public migration later.

## Where the code is today

Read these before writing anything:

- `packages/gates-core/src/evidence-store.ts` — filesystem store, `<root>/<jobId>/<attempt>/`,
  0700 dirs, 0600 files, `manifest.json`, name sanitisation, SEC-14 job-id rule, SEC-24.
- `packages/gates-core/src/evidence-redact.ts` — every non-screenshot artifact is redacted
  on the way in. This must keep working; the bundle must not become a redaction bypass.
- `packages/gates-core/src/types.ts` — `Evidence`, `EvidenceKind`, `EvidenceInput`,
  `EvidenceStore`, `GateResult`, `GateJob`.
- `packages/brain-core/src/types.ts` — `JobVerification`, `VERIFICATION_STATUSES`
  (`passed | failed | unverified`), `JobResult`, `Job`, `JOB_STATES`.
- `packages/gates-core/src/run-gates.ts` and `self-heal.ts` — where attempts and retries
  are produced.

Two facts that shape the design:

1. `JobVerification.evidencePath` already points at a manifest. The bundle should live at
   that boundary, so existing call sites keep working.
2. `VERIFICATION_STATUSES` has three values and the strategy requires four, with different
   meanings. This is a **breaking change to persisted data**, not a rename. Plan a
   migration, not a find-and-replace.

## Deliverables

### D1 — `evidence-bundle.v0.1.schema.json`

A JSON Schema (draft 2020-12) published at `spec/evidence-bundle/v0.1/` and consumed by the
recorder. The schema does **not** reference Ninebrains types; it must be implementable by a
tool that has never seen this repository. That constraint is what makes
[W8](./W8-open-evidence-standard.md) possible later.

Required top-level sections:

| Section | Contents |
|---|---|
| `bundle` | `schemaVersion`, `bundleId`, `createdAt`, `producer` (name, version) |
| `provenance` | repository URL, `baseCommit`, `finalCommit`, branch, worktree path (redacted to a relative form), `isDirty` |
| `agent` | agent id, provider, model id, harness version, run mode (`attended`/`unattended`) |
| `brief` | original brief text and explicit acceptance criteria as a list |
| `changes` | files changed with add/delete line counts, and the diff's own hash |
| `commands` | ordered list: command, argv when not shell, cwd, exit code, duration, truncated output hash |
| `gates` | per gate: id, title, pass/fail, metrics, evidence refs, feedback |
| `screenshots` | path, label, viewport (label/width/height), URL, console errors, failed requests |
| `review` | reviewer identity, provider, model, tool permissions, checkout mode, verdict, findings |
| `attempts` | full retry history: what failed, what changed afterwards |
| `risk` | untested areas, assumptions, waivers (who, why, when), residual risks |
| `integrity` | per-artifact SHA-256, plus a bundle-level hash over the canonicalised JSON |
| `status` | one of `verified`, `verified-with-waiver`, `blocked`, `inconclusive` |

Design rules, all of them binding:

- **Additive evolution only.** New fields are optional. This mirrors the existing rule on
  `SpawnReviewerOptions`: the contract grows by optional fields, never by required ones.
- **No free-form status.** `status` is a closed enum. A consumer must be able to switch on
  it exhaustively.
- **Absence is explicit.** `"review": null` and a missing `review` key mean different
  things; say which in the schema description. A consumer must be able to tell "no reviewer
  ran" from "a reviewer ran and said nothing."
- **Paths are relative and redacted.** Absolute paths leak usernames and directory layout.
  The bundle is meant to be shared.
- **Hashes cover what was written, not what was intended.** Hash the redacted artifact on
  disk, so the hash a third party recomputes is the hash we published.

### D2 — Four terminal states

Replace `VERIFICATION_STATUSES` (`passed | failed | unverified`) with the four the strategy
requires. Mapping and migration:

| Old | New | Notes |
|---|---|---|
| `passed` | `verified` | Direct |
| `failed` | `blocked` | Direct |
| `unverified` | `inconclusive` | "No gate applied" becomes explicit rather than implied by a boolean |
| — | `verified-with-waiver` | New; requires a recorded waiver with actor and reason |

`JobVerification.verified` is a derived boolean today. Keep it, derive it as
`status === 'verified' || status === 'verified-with-waiver'`, and make the UI show which of
the two it is. A waived job must never be visually indistinguishable from a clean one — that
is precisely the misleading-badge failure the strategy warns about.

Write the SQLite migration through `pnpm run db:generate`. Do not hand-edit numbered Drizzle
migrations or `drizzle/meta/`. Update fixtures and migration tests.

### D3 — Recorder

A `BundleRecorder` in `packages/gates-core/` that accumulates the above during a job run and
emits a validated bundle at the end.

- It wraps, not replaces, the existing `EvidenceStore`. Artifacts still go through
  `evidence-redact` and land under the same 0700/0600 tree.
- It records **failed attempts**, not only the final one. Retry history is a headline
  feature; losing it because attempt 2 overwrote attempt 1 would be a silent regression.
- It records commands *as they run*, with exit codes, including commands that failed. A
  bundle that only contains successful commands is a marketing artifact, not evidence.
- On any abort, it emits a bundle with `status: "inconclusive"` and whatever it has. A run
  that crashes must still produce an inspectable record.
- It validates against the schema before writing and throws on failure. An invalid bundle
  is a bug in us, not a tolerable degradation.

### D4 — Immutability and tamper evidence

- The bundle directory becomes read-only after finalisation.
- `integrity.bundleHash` covers a canonicalised (sorted-key, stable-separator) serialisation
  of everything except the hash field itself. Document the canonicalisation precisely; a
  hash nobody else can recompute proves nothing.
- Provide `verifyBundle(dir)` that recomputes every artifact hash and the bundle hash and
  reports each mismatch individually.
- Be honest in the docs: this is **tamper-evident**, not tamper-proof. Anyone who can write
  the directory can rewrite both the artifact and its hash. Signing is a later job and must
  not be implied now. R2 will reject "tamper-proof."

## Acceptance criteria

- [ ] `spec/evidence-bundle/v0.1/evidence-bundle.schema.json` exists, is draft 2020-12, and
      validates with a standard validator that has no Ninebrains dependency.
- [ ] A real local job run emits a bundle that validates against it.
- [ ] The bundle records base commit, final commit, agent, provider, model, harness version,
      and run mode.
- [ ] Every command executed during the run appears with its exit code, including failures.
- [ ] A job that needed two attempts shows both, with what failed and what changed.
- [ ] `status` is one of exactly four values, and a `verified-with-waiver` bundle carries the
      waiver's actor, reason, and timestamp.
- [ ] `verifyBundle` detects a single flipped byte in any artifact and names that artifact.
- [ ] Absolute host paths do not appear anywhere in a bundle. Asserted by a test that scans
      the serialised bundle for the home-directory prefix.
- [ ] Redaction still applies: a bundle produced from a run whose output contained a
      recognised secret pattern does not contain that secret. Asserted by a test.
- [ ] The Drizzle migration is generated (not hand-edited), fixtures updated,
      `pnpm run test:migrations` passes.
- [ ] `pnpm run check` passes.
- [ ] `docs/UPSTREAM-PATCHES.md` updated if any inherited file changed.
- [ ] `security-reviewed` label applied after a real review of the path-safety and redaction
      behaviour.

## Evidence required for review

1. The schema file and the validator output for three bundles: one `verified`, one `blocked`,
   one `inconclusive`.
2. A bundle from a run that retried, showing both attempts.
3. Test output for the path-leak scan, the redaction test, and `verifyBundle` tamper
   detection.
4. `pnpm run test:migrations` output.
5. A written note on what the integrity hashes do **not** establish.

## Limitations to declare

- Hashes are tamper-evident only; no signing key exists yet.
- The schema is v0.1 and will change. Say so in the schema `description` and in the docs.
- A passing gate set does not establish correctness, only that configured checks passed.
- Command output is truncated and hashed, not stored whole; a consumer cannot replay a run
  from a bundle alone.

## Follow-ups this job should file, not do

- Signed bundles attached to a commit or release ([W2](./W2-evidence-viewer-and-exports.md)
  scope boundary, signing itself is later).
- Bundle diffing across attempts for the viewer.
- Bundle size budget and artifact retention policy.
