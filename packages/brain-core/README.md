# @ninebrains/brain-core

The Brain: the job DAG, its state machine, lane-scoped authorization, the
store-and-forward mailbox, the routing policy, the SQLite store, and the
hardened endpoint contract that brain-mcp talks to. It has no Electron or
React imports. Its only runtime dependency is `zod`.

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
- If a gate fails, the job goes back to `running` and `attempts` goes up by 1.
  The feedback goes to the lane's inbox. On the third failure the job goes to
  `blocked` and a `jobBlocked` event fires.
- `requeueJob` puts a `blocked` or `failed` job back with 0 attempts.
- **Verdicts.** The gate runner calls `recordGateResult(brain, jobId, { pass,
  feedback, status, attempt, evidencePath })`. `status` is `passed | failed |
  unverified` and lands on `result.verification` with `verified: status ===
  'passed'`, the attempt and the evidence manifest path. `attempt` is a
  compare-and-set: it must equal `attempts + 1`, so a verdict replayed after a
  crash can never count an attempt twice. `unverified` passes the job to `done`
  but must never be shown as passed.
- `resolveGateFloor(projectId, kind, requested)` also receives the requested
  spec, so the app can read a gate-level job kind (`gateSpec.kind`) from it.
- Every other transition throws `IllegalTransitionError`.
- `compilePlan` upserts a planner graph keyed by `(planId, node id)`. It is
  idempotent, archives removed nodes rather than deleting them, and rejects a
  cycle with `CycleError.path`.

## Security model

These requirements come from `docs/THREAT-MODEL.md`. Each has a test whose
title starts with the SEC ID, so a grep for the ID finds its proof.

| ID | What this package does | Proof |
|---|---|---|
| SEC-01 | brain-mcp never opens the DB. It only forwards over HTTP. | `packages/brain-mcp/test/sec-01.test.ts`, stdio test |
| SEC-02 | Identity and role come only from the token (`TokenRegistry`). The lane hint is cross-checked and can only cause a 401. | `http.test.ts`, brain-mcp `stdio.test.ts` |
| SEC-03 | 256-bit base64url tokens. Only SHA-256 digests are stored, compared with `timingSafeEqual`. | `tokens.test.ts` |
| SEC-04 | The endpoint binds `127.0.0.1` only. The client accepts only `http://127.0.0.1:<port>`. | `http.test.ts` |
| SEC-05 | Browser-shaped requests are rejected. | `http.test.ts` |
| SEC-06 | 64 KiB body cap, 5 s timeouts, 64 connections, 20 req/s per token with a burst of 60. | `http.test.ts`, `tokens.test.ts` |
| SEC-07 | Unexpected errors become a bare `INTERNAL`. Details go to `onInternalError`. | `boundary.test.ts` |
| SEC-08 | Gates are `union(floor, requested)`. Callers can only add. | `gate-floor.test.ts` |
| SEC-09 | Inbox messages are structured and carry `from`. Anything a lane wrote is `untrusted: true`. | `boundary.test.ts` |
| SEC-14 | Every ID matches `^[A-Za-z0-9_-]{1,64}$`. | `ids.test.ts` |

**SEC-06 body cap:** the threat model says 256 KiB, but this package uses
**64 KiB**, the stricter limit from the security review. A 32 KB job body
plus 20 attachment paths still fits.

### Identity (SEC-02, SEC-03)

Main mints one token per launch with `TokenRegistry.issue(grant)` and puts it
only in that launch's MCP config entry. The grant holds the role, the lane or
brain ID, the project ID, the attachment roots and an optional run ID. The
`brain` role exists only on tokens minted for a Brain session.

Nothing the caller sends can change its identity: not env, not headers, not
tool arguments. The shim learns its own role with the `whoami` operation,
and that answer only decides which tools it lists.

Revoke tokens when a lane stops or relaunches, or when its run ends:
`revoke(token)` or `revokeWhere(grant => ...)`.

### Endpoint contract (SEC-04 to SEC-06)

`src/protocol/endpoint.ts` has the constants and a zod schema for the
request headers. `handleBrainHttpRequest` enforces the contract, and
`startBrainHttpServer` adds the socket-level limits.

| Rule | On violation |
|---|---|
| `POST /brain/v1/call` only, including a 405 for `OPTIONS` | 404 / 405 |
| `Host` is exactly `127.0.0.1:<port>` (DNS-rebinding defence) | 421 |
| No `Origin`, `Referer` or `Sec-Fetch-*` header | 403 |
| `Content-Type` is exactly `application/json` | 415 |
| `Authorization: Bearer <43-char token>`, compared in constant time | 401 |
| Optional `X-Ninebrains-Lane-Hint` matches the token's lane | 401 |
| At most 20 req/s per token, burst 60 | 429 |
| Body at most 64 KiB. `Content-Length` is checked before reading, and a streamed body is cut at the cap. | 413 |

Other rules:

- The socket has 5 s header and request timeouts and at most 64 connections.
- Every response is a JSON `BrainResponse`, marked `no-store`, with no CORS headers.
- **Don't reuse upstream's hook-server auth:** it compares tokens with `!==`
  and has no Host check.
- The client runs on `node:http` rather than `fetch`, because Node's `fetch`
  adds `Sec-Fetch-Mode`, which the endpoint refuses.

### Forwarding contract

`src/protocol/ops.ts` defines the versioned zod request
`{ v: 1, op, args }` and the response
`{ ok: true, result } | { ok: false, error: { code, message } }`.

- `opArgs` holds the argument schema for each op; `opResults` in `results.ts` holds each result schema.
- `executeBrainRequest(brain, grant, input)` is the single implementation of every op, and it never throws.
- Addresses are structured `{ kind: 'lane' | 'brain', id }` objects on the wire, in the domain and in separate SQL columns. They are never a `lane:<id>` string.

### Gate floor (SEC-08)

Pass `resolveGateFloor(projectId, kind)` to `new Brain(...)`; it maps the
rigor settings to the minimum gates. Every job created through `createJob`,
the agent-facing `create_job` op or `compilePlan` gets `union(floor, requested)`,
floor first. A recompile cannot strip the floor either.

Only a project whose floor is empty (rigor 0) can have a job with no gates.
Only the user, in the UI, lowers rigor.

## Storage and the better-sqlite3 ABI

Main is the only process that opens the Brain DB. It uses upstream's
`defineDurableSqliteStore`:

```ts
const brainDb = defineDurableSqliteStore({ name: 'brain', driver: betterSqlite3Driver, migrations: BRAIN_BUNDLED_MIGRATIONS });
const handle = brainDb.open(path); // <userData>/ninebrains-brain.db, dir 0700, file 0600
const brain = new Brain({ store: SqliteBrainStore.fromConnection(handle.connection, { path }), resolveGateFloor });
```

- `SqliteBrainStore` runs over any connection shaped like core's `SqliteConnection`.
- Core owns pragmas, migrations and backups. `core-store.test.ts` runs the real core runner against these migrations.
- **ABI:** the shim loads no SQLite at all (SEC-01), so it never has to match an ABI.
  - brain-core's own `SqliteBrainStore.open()` uses the built-in `node:sqlite`, for tests and headless in-process tools.
  - It works under the pinned Electron 40.10.2 (Node 24.15) with `ELECTRON_RUN_AS_NODE=1`.
  - It loads lazily, so importing brain-core does not load SQLite.
  - It is not reachable through brain-mcp.
- **Concurrency:** WAL, `busy_timeout`, and `BEGIN IMMEDIATE` on every transaction. `test/concurrency.test.ts` races six processes for one job, and four processes draining a 40-job queue.

## Routing

`src/dispatch/route.ts` (`pickLane`) is the tuning point. It picks a lane in
this order:

1. Only idle lanes in the job's project.
2. For reviews, a lane whose provider differs from the author's.
3. Context affinity: overlapping files, or the lane's last job is in this job's dependency chain.
4. The least-loaded lane.

`dispatchTick(state)` plans assignments without side effects.

## Events

`brain.events` is a typed emitter with `jobChanged`, `jobBlocked`,
`messageSent` and `laneChanged`. Events fire only after the transaction
commits. Each event is also written to `event_log`; read it with
`brain.readEvents(afterSeq)`.

## Launching brain-mcp

Use `brainMcpServerEntry()` from `@ninebrains/brain-mcp`. It produces the
same entry for lanes and Brain sessions; only the token differs:

```json
{ "mcpServers": { "brain": {
  "type": "stdio",
  "command": "<process.execPath of the app>",
  "args": ["<resources>/brain-mcp/bin.mjs"],
  "env": { "ELECTRON_RUN_AS_NODE": "1",
           "NINEBRAINS_BRAIN_URL": "http://127.0.0.1:<port>",
           "NINEBRAINS_TOKEN": "<token minted for this launch>",
           "NINEBRAINS_LANE_ID": "<laneId, optional hint>" } } } }
```

- Write the file under userData with mode 0600 (SEC-10).
- Pass it to Claude as `--mcp-config=<path>`. The flag is variadic, so a space-separated form swallows the prompt.
- There is no role, mode or DB setting: SEC-01 and SEC-02 removed them.

## Scripts

`pnpm build`, `pnpm test`, `pnpm typecheck` and `pnpm lint` are Nx targets
inferred from `package.json`.
