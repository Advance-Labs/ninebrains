# @ninebrains/brain-mcp

The MCP server that gives a Ninebrains lane, or a Brain session, its Brain tools. It speaks MCP over
stdio to Claude Code or Codex, and forwards every tool call to the Ninebrains app over loopback
HTTP.

It is a thin forwarder. It never opens the Brain database, and it has no direct mode. The app's
main process owns the database and decides who is calling from the token alone.

- Package: `@ninebrains/brain-mcp`, Apache-2.0.
- Binary: `ninebrains-brain-mcp` (`dist/bin.mjs`). The build bundles every dependency; only Node
  built-ins stay external.
- Node 22.13 or later. The app runs it with its own Electron binary and `ELECTRON_RUN_AS_NODE=1`.

## Environment

The app sets all of these when it launches a session. Nothing else configures the server.

| Variable | Required | Rule |
|---|---|---|
| `NINEBRAINS_BRAIN_URL` | yes | `http://127.0.0.1:<port>`. Any other host, or a missing port, is refused |
| `NINEBRAINS_TOKEN` | yes | 43 characters of `A-Z a-z 0-9 _ -`. Never printed, even in errors |
| `NINEBRAINS_LANE_ID` | no | 1 to 64 characters of letters, digits, `_` or `-`. Sent as a hint the app cross-checks; it grants nothing |

There is no role variable. The token decides whether the session is a lane or a Brain.

Exit codes:

- `2`: a configuration error, printed to stderr as `ninebrains-brain-mcp: <message>`.
- `1`: the session could not start. At startup the server asks the app which role the token has.
  It retries up to 10 times, a second apart, only while the app is unavailable or rate-limiting.

The server stops on SIGINT, SIGTERM, or when stdin closes.

## How it talks to the app

Each tool call is one `POST` to `<NINEBRAINS_BRAIN_URL>/brain/v1/call` with:

- `authorization: Bearer <token>` and `content-type: application/json`;
- `x-ninebrains-lane-hint`, when `NINEBRAINS_LANE_ID` is set;
- a body of `{ "v": 1, "op": "<tool>", "args": { … } }`.

Requests time out after 30 seconds. A Brain error reaches the agent as a tool error with the text
`CODE: message`. Messages written by agents are returned inside a fence with a random delimiter, so
the reading agent can tell data from instructions.

The endpoint side (loopback bind, Host and Origin checks, body limits, rate limits) is in
`@ninebrains/brain-core`.

## Tools

The tool list comes from the app's answer about the token's role, never from the environment.

| Tool | Lane | Brain | Arguments |
|---|---|---|---|
| `claim_job` | yes | no | `jobId?` |
| `complete_job` | yes | yes | `jobId`, `summary`, `artifacts[]` |
| `block_job` | yes | yes | `jobId`, `reason` |
| `send_message` | yes | yes | `to: { kind: "lane" \| "brain", id }`, `body`, `attachments[]` |
| `read_inbox` | yes | yes | `limit` (1 to 200, default 50); Brain only: `address` |
| `list_jobs` | yes | yes | `states[]?`, `mine`, `laneId?`, `limit` (1 to 500, default 100); Brain only: `projectId` |
| `add_note` | yes | yes | `body`, `jobId?`; Brain only: `projectId` |
| `create_job` | no | yes | `title`, `body`, `projectId?`, `dependsOn[]`, `gates[]?`, `kind?` (`work` or `review`), `paths[]?` |
| `link_jobs` | no | yes | `from`, `to` |
| `assign_job` | no | yes | `jobId`, `laneId` |
| `requeue_job` | no | yes | `jobId` |
| `list_lanes` | no | yes | `projectId?` |
| `broadcast` | no | yes | `body`, `projectId?`, `attachments[]` |

An attachment is `{ "kind": "file", "path": "…" }` or `{ "kind": "screenshot", "ref": "…" }`.
`list_jobs` and `list_lanes` are marked read-only.

## How the app launches it

For each lane launch, the app mints a token and writes the server entry into a per-launch
`mcp.json` under `<userData>/ninebrains/lanes/<launchId>/`. The folder is mode `0700` and the file
is created with mode `0600`. The entry is:

- `command`: the app's own Electron binary;
- `args`: the path to `bin.mjs`, unpacked from the app archive (in a dev checkout,
  `packages/brain-mcp/dist/bin.mjs`);
- `env`: `ELECTRON_RUN_AS_NODE=1`, `NINEBRAINS_BRAIN_URL`, `NINEBRAINS_TOKEN` and, for lanes,
  `NINEBRAINS_LANE_ID`.

Claude Code gets `--mcp-config=<path>` and `--strict-mcp-config`. Codex gets the same entry as
`--config=mcp_servers.brain.*` overrides, so on Codex the token is visible in the process list;
this is a documented accepted risk. The launch folder is deleted when the lane stops, and the
token is revoked.

## Development

```bash
pnpm --filter @ninebrains/brain-mcp build
pnpm --filter @ninebrains/brain-mcp test
```

User-facing docs: `docs/guide/brain-and-jobs.md` and `docs/guide/security.md`.
