### What and why

What changed, why it is needed, and anything a reviewer should look at first.

Fixes #

### How it was tested

The commands you ran, and what you checked by hand.

### Screenshots (UI changes)

At 1440 px and 390 px wide.

### Checklist

- [ ] `pnpm run check` passes locally (it edits nothing; `pnpm run check:write` fixes formatting)
- [ ] Every commit is signed off (`git commit -s`) and the PR title is a Conventional Commit
- [ ] Tests added or updated for the behaviour change, or I said why not
- [ ] UI change: browser tests run locally (`pnpm --dir apps/emdash-desktop exec vitest run --project browser`) and screenshots at 1440 and 390 px added above, or this is not a UI change
- [ ] Every edit to a file inherited from Emdash is logged in `docs/UPSTREAM-PATCHES.md` (CI checks this), or there are none
- [ ] New dependency: named here with its licence, and `pnpm run licenses` passes, or there is none
- [ ] Security-sensitive area (Brain, gates, packs, lanes, exec runs, anything that spawns a process, release, CI): the SEC-IDs are listed here and a security review is requested, or none is touched
- [ ] A real `claude` or `codex` CLI was used: said so here, with what I ran, or only the fake agent was used
- [ ] Docs in `docs/guide/` updated when behaviour or setup changed
