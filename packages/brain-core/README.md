# @ninebrains/brain-core

The Brain: the job DAG, its state machine, lane-scoped authorization, the
store-and-forward mailbox, the routing policy and the SQLite store. It has no
Electron or React imports. Its only runtime dependency is `zod`.

**Glossary:** a **Job** is a Brain work item: a unit of work routed to a lane.
It is not an Emdash **Task**, which is a worktree session. A **lane** is one
agent (Claude or Codex) working in a worktree.

## Job state machine

```
proposed -> ready -> claimed -> running -> verifying -> done
               ^                  ^           |
               |                  +-----------+  gate failed (attempts += 1)
blocked / failed --requeue--> ready | proposed
```

- A job is `ready` only when every inbound edge's source job is `done`.
  When a job reaches `done`, its dependents are promoted automatically.
- If a gate fails, the job goes from `verifying` back to `running` and
  `attempts` goes up by 1. The feedback goes to the lane's inbox. On the
  third failure the job goes to `blocked` and a `jobBlocked` event fires.
- `requeueJob` puts a `blocked` or `failed` job back in the queue with 0 attempts.
- Every other transition throws `IllegalTransitionError` (code `ILLEGAL_TRANSITION`).
- `compilePlan` upserts a planner graph keyed by `(planId, node id)`. It is
  idempotent. It archives removed nodes rather than deleting them. If the
  graph has a cycle, it rejects the plan with `CycleError.path`.

## Authorization

Every call takes an `Identity`: `{ role: 'lane', laneId, projectId }` or
`{ role: 'brain', brainId }`.

- A lane can see and claim only jobs in its own project.
- A lane can complete, block or release only jobs it holds.
- A lane can read only its own inbox.
- The `brain` role can create, link, assign and requeue any job. It assigns
  jobs; it does not claim them.

## Decision 1: transport. brain-mcp is a thin shim

`claude` and `codex` spawn brain-mcp. brain-mcp forwards each tool call to
the app's main process. Main is the only DB writer, and main decides the
caller's identity.

```
lane CLI --stdio--> brain-mcp (shim) --HTTP 127.0.0.1 + token--> main: executeBrainRequest -> Brain -> SQLite
```

- **Contract** (`src/protocol/`): a versioned zod `BrainRequest`
  `{ v: 1, op, args }` and a `BrainResponse`, which is
  `{ ok: true, result } | { ok: false, error: { code, message } }`.
  - Each op has an argument schema (`opArgs`) and a result schema (`opResults`).
  - `executeBrainRequest(brain, grant, input)` is the single implementation of every op. It never throws.
- **HTTP binding:**
  - `POST /brain/v1/call` with header `x-ninebrains-token: <token>`. The body cap is 256 KB.
  - Status codes: 200 for any executed request, including Brain errors; 400 for a malformed request; 401 for a bad token; 404 for a wrong path; 405 for a wrong method; 413 for a body that is too large.
  - `handleBrainHttpRequest` is transport-agnostic, so main can mount it on its existing hook server.
  - `startBrainHttpServer` is a reference 127.0.0.1 server, used by tests and for headless use.
- **Identity is the token.** Main mints one token per lane (`issueToken(grant)`).
  - The token goes into that lane's MCP config entry, and nowhere else.
  - A lane cannot impersonate another lane, even if it edits its own env or calls the endpoint directly.
  - Main also resolves attachment paths against the lane's roots, so the path guard holds even when a lane bypasses its shim.
- **Direct-DB mode** (`NINEBRAINS_MODE=direct`): the shim opens the SQLite file itself. It is for tests and headless use only. Identity then comes from env.

## Decision 2: storage and the better-sqlite3 ABI

Main uses upstream's `defineDurableSqliteStore` for the in-app DB. The store
takes an explicit `path`, so main passes it the `ninebrains-brain.db` path it
resolves itself.

```ts
const brainDb = defineDurableSqliteStore({ name: 'brain', driver: betterSqlite3Driver, migrations: BRAIN_BUNDLED_MIGRATIONS });
const handle = brainDb.open(path);
const brain = new Brain({ store: SqliteBrainStore.fromConnection(handle.connection, { path }) });
```

- `SqliteBrainStore` runs over any connection shaped like core's `SqliteConnection`.
- Core owns pragmas, migrations and backups. `core-store.test.ts` runs the real core runner against these migrations.
- **ABI:** the app's better-sqlite3 is rebuilt for Electron and crashes under plain `node`.
  - Forward mode avoids the problem entirely: the shim loads no SQLite at all.
  - Direct mode uses **`node:sqlite`**, which is built into Node 22.13 and later, and into Electron 35 and later.
  - The repo pins Electron 40.10.2, which embeds Node 24.15.0. `node:sqlite` works there under `ELECTRON_RUN_AS_NODE=1`, and the stdio test proves it.
  - So no native module ever has to match an ABI. The module loads lazily, so importing brain-core does not load SQLite.
- **Concurrency:** WAL, `busy_timeout`, and `BEGIN IMMEDIATE` on every transaction. Two processes can never claim the same job: `test/concurrency.test.ts` races six processes for one job, and four processes draining a 40-job queue.
- The brain runner also accepts files recorded by core's `__emdash_migrations`, so direct mode can open an app-managed file.

## Routing

`src/dispatch/route.ts` (`pickLane`) is the tuning point. It picks a lane in
this order:

1. Only idle lanes in the job's project.
2. For reviews, a lane whose provider differs from the author's.
3. Context affinity: lanes whose recent files overlap the job's paths, or whose last job is in this job's dependency chain.
4. The least-loaded lane.

`dispatchTick(state)` plans assignments without side effects.

## Events

`brain.events` is a typed emitter with `jobChanged`, `jobBlocked`,
`messageSent` and `laneChanged`. Events fire only after the transaction
commits. Each event is also written to `event_log` in the same transaction;
processes that did not make a change can read it with `brain.readEvents(afterSeq)`.

## Launching brain-mcp for a lane

`brainMcpServerEntry()` in `@ninebrains/brain-mcp` builds the entry. Run the
bin with the app's own binary:

```json
{ "mcpServers": { "brain": {
  "type": "stdio",
  "command": "<process.execPath of the app>",
  "args": ["<resources>/brain-mcp/bin.mjs"],
  "env": { "ELECTRON_RUN_AS_NODE": "1", "NINEBRAINS_MODE": "forward", "NINEBRAINS_ROLE": "lane",
           "NINEBRAINS_BRAIN_URL": "http://127.0.0.1:<port>", "NINEBRAINS_TOKEN": "<per-lane token>",
           "NINEBRAINS_LANE_ID": "<laneId>" } } } }
```

- Pass the file to Claude as `--mcp-config=<path>`. The flag is variadic, so a
  space-separated form swallows the prompt.
- A Brain session uses the same entry with `"NINEBRAINS_ROLE": "brain"` and a
  brain-role token.
- `NINEBRAINS_LANE_ID` is informational only; main trusts the token, not this value.

## Scripts

`pnpm build`, `pnpm test`, `pnpm typecheck` and `pnpm lint`. These are Nx
targets inferred from `package.json`, like the other workspace packages.
