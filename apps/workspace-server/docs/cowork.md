# Cowork shared text editing

The cowork module in this package synchronizes text in one remote worktree for Ninebrains
desktop users with separate SSH accounts on the same Linux host. It is a separate, narrower
service from the wire daemon: sharing the workspace socket across accounts would also share
agents, terminals, and other host capabilities. Cowork needs only text documents and file saves,
so it owns a dedicated socket and protocol and never mounts the `workspaceWireContract`.

## Run it

The module ships inside the workspace-server artifact and is launched through the same entry
point, but as its own role:

```text
emdash-workspace-server serve-cowork <worktree-root> <socket-path> <state-dir> <token-file>
```

From the monorepo the same role runs through the built entry:

```bash
pnpm --dir apps/workspace-server run build
node apps/workspace-server/dist/index.mjs serve-cowork \
  /srv/repos/project /srv/ninebrains-cowork/cowork.sock \
  /srv/ninebrains-cowork/state /srv/ninebrains-cowork/token
```

The token file must be a regular file owned and readable only by the server account and contain
at least 32 bytes of capability text. The worktree files must be readable and writable by the
server account. The socket's parent directory must already exist, be owned by the server account,
and must not be group or world writable. The socket is created with mode `0660`; the host
administrator must set its parent directory and group/ACL so intended SSH users can reach it. Do
not put the socket in `/tmp`. The state directory must be private to the server account and
outside the worktree because it holds unsaved converged text.

## Host setup

For a worktree at `/srv/repos/project`, an administrator first creates `/srv/ninebrains-cowork`
owned by the server account, with the shared group and mode `2750`. Run the following as that
server account, which also needs write access to the worktree:

```bash
install -d -m 0700 /srv/ninebrains-cowork/state
umask 077
openssl rand -hex 32 > /srv/ninebrains-cowork/token
emdash-workspace-server serve-cowork /srv/repos/project \
  /srv/ninebrains-cowork/cowork.sock /srv/ninebrains-cowork/state \
  /srv/ninebrains-cowork/token
```

The socket inherits the directory's shared group. Group members can traverse the directory and
connect to the socket but cannot replace it. The token file and state directory must remain
private to the server account; distribute the token text to participants separately. Keep this
process running with the host's service manager.

## Desktop usage

In each desktop, open the same worktree through that person's SSH account, open a text file,
then choose **Cowork** in the file toolbar. Enter the socket path and token. Save writes the
converged document to the shared worktree. If SSH disconnects, local edits remain in the
buffer; use **Reconnect** to merge them after the server is available again. A server restart
uses the persisted Yjs state. Files changed on disk by another program are rejected at Save
and require the users to review and resolve the conflict.

## Protocol

UTF-8 JSON messages separated by newlines. A client first sends
`{"type":"join","token":"...","path":"relative/file.txt"}`. The response contains a base64 Yjs
document update. The client sends base64 incremental Yjs updates with
`{"type":"update","path":"relative/file.txt","update":"..."}`. The server broadcasts updates to
all joined clients. `{"type":"save","path":"relative/file.txt"}` writes the converged text to
disk, or reports `external-change` when the file no longer matches the disk version observed at
join. The client must use Yjs to apply updates; plain text replacement messages are unsupported.

The desktop imports the typed message schemas from `@emdash/workspace-server/cowork-protocol`
(the `cowork-protocol.mjs` bundle, which has no native or workspace dependencies).

## Limits and known races

Current limits: eight simultaneous socket peers, 128 open documents, 1 MiB text documents, and
2 MiB request frames. Disk writes from other processes are detected before Save, but arbitrary
external writers do not honor a cowork lock; a write racing within the final check and write
cannot be made atomic with ordinary POSIX files. The current desktop shows a save error and
preserves the local buffer; a dedicated shared conflict resolution UI is still needed.

## Code map

- `src/cowork/serve.ts` is the `serve-cowork` CLI role: it validates the token file and wires the
  nested `startCoworkServer(...)` handle into the process signal lifecycle.
- `src/cowork/server.ts` owns the Unix socket, the token check, per-peer join state, and the
  document operation serialization.
- `src/cowork/documents.ts` stores converged Yjs documents in the private state directory and
  writes saves back to the worktree with escape and external-change checks.
- `src/cowork/protocol.ts` defines the wire messages with zod and the size caps; it is also the
  standalone `cowork-protocol` export.

See `apps/workspace-server/docs/daemon.md` for how `serve-cowork` relates to the wire serve roles.