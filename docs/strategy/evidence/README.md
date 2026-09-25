# Evidence records

One file per completed program job: `<job-id>.md`, for example `W1-01.md`.

This directory is what
[`03-definition-of-done.md`](../03-definition-of-done.md) means by "recorded in the
deliverable's evidence record". It exists so that the program's own verification claims are
inspectable by someone who was not in the room — the same standard the product asks of its
users.

A record is written by the lane at handoff and completed by L0 with the reviewer verdicts.
It is never edited after the job is accepted; a correction is a new record that supersedes
it, and says so.

## Template

```markdown
# <job-id> — <job title>

| | |
|---|---|
| **Workstream** | W3 |
| **Lane** | L2 |
| **Model** | Opus |
| **Risk tier** | high |
| **Revision** | <full SHA the reviewers ran against> |
| **Status** | verified / verified-with-waiver / blocked / inconclusive |

## What changed

## How it was verified
<!-- commands with exit codes, screenshots with viewport and URL, test output -->

## What it does not establish

## Residual risks and waivers
<!-- a waiver names actor, reason, scope, expiry -->

## Follow-ups filed

## Reviewer verdicts

| Reviewer | Model | Provider | Verdict | Revision | Independence axes that held |
|---|---|---|---|---|---|
| R1 adversarial verifier | | | | | fresh context, read-only, … |
| R2 claims auditor | | | | | |
| R3 integration reviewer | | | | | |

<!-- All three must be `pass` on the same revision. Two passes and one fail is a fail.
     An `inconclusive` blocks; L0 resolves it from the evidence rather than averaging. -->
```

## Rules

- **Say which axes held.** A reviewer that shared the builder's provider is not
  provider-independent, and the record says so. The word "independent" is used only when all
  four axes in [W4](../workstreams/W4-independent-review.md) held.
- **Record the failed attempts.** A record that shows only the attempt that passed is a
  marketing artifact.
- **`inconclusive` is a legitimate outcome.** A program that never records one is guessing.
