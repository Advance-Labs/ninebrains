# Risky Area: Cowork Shared Editing

The `serve-cowork` role serves collaborative text for one worktree over a group-accessible Unix
socket. It holds a session token, writes into the user's repository, and is reachable by any local
account in the socket's group, so it is a trust boundary, not an internal service.

## Main Files

- `apps/workspace-server/src/cowork/server.ts` — socket listener, token check, per-peer frame
  handling, and the broadcast fan-out
- `apps/workspace-server/src/cowork/documents.ts` — canonical path resolution, the resident Yjs
  document store, persisted state, and the disk save
- `apps/workspace-server/src/cowork/protocol.ts` — wire schemas and the frame and document size
  limits
- `apps/workspace-server/src/cowork/serve.ts` — token-file and socket-directory preflight for the
  role
- `apps/workspace-server/docs/cowork.md` — operator-facing setup and the protocol description

## Core Risks

- a path escaping the worktree through traversal, an absolute path, or a symlink
- the socket, state directory, or token file being readable or replaceable by another local account
- unbounded memory: resident documents, frame size, and Yjs history growth
- overwriting a file that an agent or editor changed outside the shared session
- a peer reaching a document it never joined

## Rules

- resolve a path for an authorization check with `CoworkDocuments.canonicalize()`, never with
  `join()`. `join()` makes the document resident, and only a peer that joined it will ever release
  it, so resolving that way fills the resident cap permanently
- keep document identity canonical (post-`realpath`) inside the server and worktree-relative on the
  wire; never echo one peer's spelling of a path to another peer
- preserve the save sequence: `lstat`, then `O_NOFOLLOW` open, then a dev/ino recheck, then a
  `realpath` recheck, then the content-hash compare. It narrows the race with an outside writer and
  cannot close it, because no atomic compare-and-swap over an arbitrary writer exists
- keep the state directory outside the worktree and private to the server account, and keep the
  token file `0600` and owned by that account
- bound each frame and the unterminated remainder, not the accumulated read buffer, so two legal
  frames arriving in one read are both served
- keep the resident-document cap and the peer cap; both are the only backstop against a
  token-holding peer exhausting the process
- drop a misbehaving peer immediately. Reporting the reason is best-effort: a reset can discard the
  error, and closing gracefully instead lets a peer that ignores the FIN hold the connection open
- do not let a document's persisted Yjs state grow unchecked. The record is capped at
  `MAX_DOCUMENT_BYTES * 4`, and a document that crosses it stops accepting updates rather than
  compacting, which is a known sharp edge rather than a designed behavior
