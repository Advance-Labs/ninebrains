# Roadmap: a headless Brain the CLI can run on its own

Status: **not built.** `packages/brain-cli` v1 attaches to a Brain the desktop app
is already running (SEC-47). This records what it would take to drop that
requirement, and why it was not v1.

## Where v1 stops

`brain` is a client. It reads
`<userData>/ninebrains/brain-cli.json`, opens the loopback endpoint the app
published, and POSTs `{ v: 1, op, args }` with a user-role token. No app running,
no Brain: the CLI exits 3 and says so.

That was the right v1 because the endpoint, the token model and the protocol
already existed and are the hardened part. The CLI added a role, not a runtime.

## What actually blocks a headless Brain

Not the database, and not brain-core. `SqliteBrainStore.open()` already supports
the direct path — `node:sqlite`, WAL, `busy_timeout`, brain-core's own migration
runner, `BEGIN IMMEDIATE` on every transaction — and `test/concurrency.test.ts`
races six processes for one job and four draining a 40-job queue. A second process
can share the file safely today.

What blocks it is that **the things a Brain does to the world live in the app**.
The DAG is portable; the effects are not:

| Effect | Where it lives now |
|---|---|
| Spawn an unattended run, budget it, kill it | `src/core/features/exec-runs/api/node/run-supervisor.ts` |
| Resolve a launch's model, profile, env | `src/core/features/routing/api/node/launch-env.ts` |
| Build a lane's launch (prompt, MCP config, pack role) | `src/core/features/packs/api/launch`, `brain/node/launch-config.ts` |
| Drive an attended lane's PTY | `BrainLanesPort`, implemented by `LaneService` |
| Run gates, take screenshots, host evidence | `features/gates/node`, Electron CDP for screenshots |
| Start a Brain session (a task, a conversation, a worktree) | `brain/node/brain-sessions.ts` over the projects/tasks/conversations ports |

`BrainService` is the seam that ties those together, and its `deps` are almost all
app services. `brain/node/cli-host.ts` already proves the shape: every host op is a
pass-through to `BrainService`, so whatever provides `BrainHostOps` is what a
headless Brain would have to become.

## The work, in order

1. **Move the portable half down.** `dispatcher.ts`, `unattended.ts`,
   `verification.ts`, `job-prompt.ts` and `stop.ts` are already written against
   ports (`BrainLanesPort`, `BrainRoutingPort`, `BrainSupervisorPort`). Lift them
   into a package with those ports as its public surface. Nothing should change
   behaviourally; the test is that the desktop keeps passing with the package
   swapped in.
2. **Give the supervisor and routing a non-Electron implementation.** The
   supervisor's process control is plain Node already; what it needs is a
   `userDataDir` and a binary resolver that does not come from
   `HostDependencies`. Screenshot gates cannot follow — they need a browser — so a
   headless Brain refuses `ui`-kind gates rather than passing them unverified
   (`unverified` already exists as a verdict status for exactly this).
3. **A `brain daemon` command.** Opens the DB with `SqliteBrainStore.open()`,
   constructs the Brain, starts the endpoint, publishes a handshake with its own
   pid, and serves the host ops from the package in step 1. It must refuse to start
   when a live handshake already points at an app, so two Brains never share one
   database with different lifecycles.
4. **Attach or self-host.** `connect()` already returns a reason when nothing is
   found; give it a second branch that starts (or adopts) a daemon. `findBrainHandshake`
   returns the file it used, so the CLI can say which Brain it talked to — worth
   printing once a machine can have two.

## What is deliberately not on this list

- **Two writers of one DB with different migration versions.** Step 3's refusal is
  the guard. Do not relax it into "newest migration wins": core owns the app's
  migrations and brain-core owns the direct path's, and they are allowed to be at
  different versions between releases.
- **Remote access.** SEC-04 pins the endpoint to `127.0.0.1` and the handshake
  schema refuses any other url. A remote Brain is a different design with a
  different threat model, not a flag on this one.
- **Dropping the user token.** A headless Brain still mints one and still writes it
  0600. "It is my own machine" is how the loopback endpoint stops being the boundary.
