import { quoteArg } from '#primitives/exec/api';

/**
 * The socket every Ninebrains tmux command runs on.
 *
 * Ninebrains used to share the user's default tmux server, which made one server process
 * hold every agent session across every project and worktree, alongside whatever else on
 * the machine happened to speak tmux. A single `kill-server` — ours, theirs, or a stray
 * script's — took all of it down at once, and nothing in the app could tell afterwards
 * whose it was. Naming our own socket makes that blast radius ours alone.
 *
 * Sessions started before this landed live on the default socket and are invisible here.
 * They are not destroyed; `findLegacyDefaultSocketSessions` reports them so the app can
 * say so rather than silently appear to have lost them.
 */
export const NINEBRAINS_TMUX_SOCKET = 'ninebrains';

/**
 * Prefix tmux CLI arguments with the socket selector.
 *
 * Every `exec('tmux', ...)` in the codebase goes through this. The point is that
 * forgetting it is not possible at a call site that uses it, and a call site that does
 * not use it is greppable: a bare `'tmux', [` is the bug.
 */
export function tmuxArgs(args: readonly string[]): string[] {
  return ['-L', NINEBRAINS_TMUX_SOCKET, ...args];
}

/**
 * The `tmux -L <socket>` command prefix for a POSIX shell line.
 *
 * The socket name is a fixed identifier, so quoting it is belt-and-braces rather than
 * load-bearing — but the shell line is assembled by string concatenation, and a quoted
 * constant keeps that assembly uniform with the rest of the builder.
 */
export function tmuxShellCommand(): string {
  return `tmux -L ${quoteArg(NINEBRAINS_TMUX_SOCKET, 'posix')}`;
}
