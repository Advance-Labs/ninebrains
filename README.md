# Ninebrains

Ninebrains is an open-source desktop workbench for running parallel Claude Code and Codex agents.
Each agent gets its own git worktree, terminal, editor and browser.

**Status:** early fork, not released. It is not ready for daily use yet.

## Relationship to Emdash

Ninebrains is a fork of [Emdash](https://github.com/generalaction/emdash) by General Action, Inc.,
used under the Apache License 2.0. It is not affiliated with or endorsed by General Action.

Unlike upstream, Ninebrains ships with no telemetry endpoint, no hosted account, no feedback relay,
and no update feed pointed at Emdash's servers. [docs/FORK.md](docs/FORK.md) covers the fork
baseline and CI. [docs/UPSTREAM-PATCHES.md](docs/UPSTREAM-PATCHES.md) lists every change to
upstream files.

## Development

```bash
pnpm install
pnpm run dev
```

See [docs/FORK.md](docs/FORK.md) for the tested toolchain and [CONTRIBUTING.md](CONTRIBUTING.md)
(inherited from Emdash) for the full developer guide.

## License

Apache-2.0. See [LICENSE.md](LICENSE.md) and [NOTICE](NOTICE).
Copyright 2026 Advance Labs Inc. Portions copyright General Action, Inc.
