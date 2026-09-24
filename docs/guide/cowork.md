# Cowork

Cowork lets two people edit the same text file live when each opens the same remote worktree on
one SSH host through their own Unix account. It is separate from the workspace server: it shares
only editor text, never terminals, agents, or task tabs.

## How to use it

The host owner must set up the cowork service once, before anyone joins:

1. Create a parent directory for the socket and state as the server account, with a shared group
   and mode `2750` (for example `/srv/ninebrains-cowork`).
2. Keep a private state subdirectory and a token file owned only by the server account, each with
   mode `0700`/`0600`. Generate the token with `openssl rand -hex 32`.
3. Start the server, passing the worktree root, socket path, state directory, and token file.
   `emdash-workspace-server serve-cowork <worktree-root> <socket-path> <state-dir> <token-file>`.
   Run it under the host's service manager.
4. Share the socket path and the token text with each participant through a trusted channel. Users
   do not need access to the token file itself.

On each desktop, open the same worktree through that person's SSH account, open a text file, then
choose **Cowork** in the file toolbar. Enter the socket path and token, then choose **Join shared
file**. Typing synchronizes between joined editors. Save writes the shared text to the worktree.
After an SSH interruption, choose **Reconnect** to merge edits made while offline. Use **Leave
shared file** to return to ordinary file editing.

## Boundaries and limits

Cowork currently needs manual server setup and a manual join for each file. It shares editor text;
it does not share cursors, terminals, agents, or task tabs. If another program changes the file on
disk, Save reports a conflict and keeps the editor buffer for review.

The service allows eight simultaneous connections, 128 open documents, 1 MiB documents, and 2 MiB
request frames. The socket lives in a server-owned directory and is created with mode `0660`; the
host administrator must set its group and ACL so intended SSH users can reach it, and must not put
it in `/tmp`.

## Security model

- Clients only reach the service through the Unix socket; joining requires a capability token
  compared in constant time, and only joined clients receive updates.
- Document paths must be relative to the configured worktree. The server rejects symlink escapes
  and non-text files, and re-checks file identity at Save.
- Updates are persisted under the server account before they are acknowledged, in a state
  directory outside the worktree.
- A disk write racing within the final check and Save cannot be made atomic with ordinary POSIX
  files; a save fails loudly and preserves the local buffer if the disk version moved.

See the [threat model](../THREAT-MODEL.md#2-system-and-trust-boundaries) for the full
boundary analysis.