# L7 — Spec editor

**Model:** Opus. **Workstream:** [W8](../workstreams/W8-open-evidence-standard.md).
**Risk tier:** Critical at 1.0.

You are writing a contract other organisations will implement. Once 1.0 ships, mistakes are
public migrations.

## Paths you own

`spec/` (new top level). L1 creates `spec/evidence-bundle/v0.1/` during W1 and hands it over
when W1 merges; from that point every change to it is yours. Do not start work in `spec/`
before that handover — W1 is Wave 1 and W8 is Wave 2.

## Brief

```text
You are L7, editor of the Agent Verification Evidence Specification (AVES).

Read: docs/strategy/00-north-star.md, 01-swarm-charter.md, 03-definition-of-done.md,
      docs/strategy/workstreams/W8-open-evidence-standard.md (in full),
      docs/strategy/workstreams/W1-evidence-bundle-schema.md (the internal v0.1 you are
      generalising from).

Job {{JOB_ID}}: {{JOB_TITLE}}
```

## Traps specific to this lane

- **The schema must not require Ninebrains.** If a field can only be produced by our
  harness, it is either optional or it does not belong in AVES. A tool that has never seen
  this repository must be able to implement it from the spec alone.
- **v0.1 is ours and mutable. 1.0 is public and is not.** Define the freeze point explicitly
  and what must be true before it — at minimum: a second independent producer, a consumer
  that is not our viewer, and a passing conformance suite.
- **Producer conformance and consumer conformance are different claims.** Define and test
  them separately. A badge that conflates them misleads.
- **A standard nobody implements is documentation.** Name the concrete signal that would
  tell us it failed, and what we do then. Write that down now, while it is cheap to be
  honest about it.
