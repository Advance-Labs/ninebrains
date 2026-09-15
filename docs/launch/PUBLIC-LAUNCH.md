# Public launch checklist

Status: readiness checklist, 2026-09-15 (branch `w8/launch-prep`). This is mechanics only — GitHub
settings and repo hygiene a human flips or approves before and after `Advance-Labs/ninebrains` goes
public. It does not cover the go/no-go decision itself; see the launch-prep report for that.

Note on ownership: this file lives under `docs/**`, which the docs-audit agent owns for structure
and cross-linking. It is written here because the launch-prep task needed somewhere to put it —
fold it into whatever docs layout that agent lands on, or leave it here if that layout has no better
home for it.

## Before flipping visibility to public

- [ ] **Secret scanning + push protection.** Settings → Code security. Both are free on public
  repos and cost nothing to turn on before the flip. Push protection blocks a secret-shaped commit
  before it lands; secret scanning re-checks history once public. Turn both on first.
- [ ] **Branch protection / rulesets on `main`.** Free on public repos (was a paid feature while
  private). At minimum: require the `ci.yml` status checks, require a linear history or squash
  merge (match whatever `pnpm run merge` already assumes), and require the DCO check to pass.
  Today `pnpm run merge` is the only gate — decide whether GitHub-native protection replaces it,
  runs alongside it, or stays off because the merge script already does the job.
- [ ] **Code Owners review.** `.github/CODEOWNERS` already lists the security-sensitive paths, but
  its own header says GitHub does not request or enforce these reviews on a single-owner repo — see
  `docs/UPSTREAM-PATCHES.md` history and the comment block at the top of `CODEOWNERS`. Turning on
  "Require review from Code Owners" with one owner blocks every PR that owner opens, since GitHub
  will not let anyone approve their own PR. Decide this only once there is a second maintainer, or
  leave `pnpm run merge`'s `security-reviewed` label as the real gate.
- [ ] **`security-reviewed` label: outside contributors must not be able to self-apply it.**
  `tooling/scripts/merge-pr.mjs` refuses to merge a PR touching a `CODEOWNERS`-listed path without
  this label, but on a public repo any triager with triage/write access — and by default, *nobody*
  external — can add labels; the real risk is a compromised or careless collaborator adding it
  without a review having happened. Two options: keep write access to a short list of trusted
  people so only they can add the label, or add a required-status-check bot that verifies a review
  thread exists before allowing the label. Pick one before opening the repo to outside PRs.
- [ ] **Actions minutes and secrets on forks.** Public repos get free Actions minutes, but
  `pull_request_target` and any workflow reading repo secrets must not run on untrusted fork PRs
  without approval. Check `ci.yml`, `e2e.yml`, `release.yml` and `build-matrix.yml` for any trigger
  that would hand a fork PR access to secrets, and set the org/repo setting that requires approval
  for first-time contributor workflow runs (Settings → Actions → General → Fork pull request
  workflows).
- [ ] **Dependabot behaves differently on forks.** `.github/dependabot.yml` already assumes GitHub
  Actions is enabled and free; re-check `open-pull-requests-limit: 0` on the npm block still matches
  intent (security updates only, no version-bump noise) once the repo is public and dependency
  graphs from forks start reporting.
- [ ] **`.github/FUNDING.yml`.** Not added. Optional — only add it if Lucas wants a funding link
    (GitHub Sponsors, Open Collective, etc.) on the repo sidebar.

## Right after flipping visibility to public

- [ ] Re-run (or confirm CI already ran) the licence gate (`pnpm run licenses`) and the upstream-
  patch check (`node tooling/scripts/check-upstream-patches.mjs`) on the first public-facing commit,
  since both are cheap regression guards against exactly the kind of mistake that matters more once
  the repo can't be quietly fixed before anyone notices.
- [ ] Watch the first few external PRs against the `security-reviewed` gate and the DCO check to
  confirm both behave as expected for a contributor who isn't `zordhalo`.
- [ ] Decide whether to publish a GitHub Release matching the current `package.json` version, since
  a public repo with no releases and no tags reads as unfinished.

## Explicitly out of scope here

- Making the repo public. That is Lucas's call, not this checklist's.
- Rewriting git history. The history scan in the launch-prep report found nothing that needs it;
  if something later does, that is a separate, deliberate decision (`git filter-repo` / BFG),
  never a side effect of this checklist.
- README and `docs/**` content quality — owned by the docs-audit and readme agents' work on this
  same branch effort.
