import { quoteArg, type IExecutionContext } from '#primitives/exec/api';
import { decodeTmuxIdentity, encodeTmuxIdentity, TMUX_IDENTITY_OPTION } from './tmux-identity';
import { tmuxArgs, tmuxShellCommand } from './tmux-socket';

/**
 * Scrollback lines tmux retains per pane when the app does not say otherwise.
 *
 * tmux holds scrollback in the server's own address space, so this is a live memory
 * cost per pane for as long as the session exists, not a disk buffer — and agent panes
 * are exactly the panes that produce a lot of output. 100k lines across many concurrent
 * agent sessions is how a single shared server grows without bound, so this is now a
 * default the host can lower rather than a constant nobody can reach.
 */
export const DEFAULT_TMUX_HISTORY_LIMIT = 10_000;
const TMUX_LIST_FORMAT = `#{session_name}\t#{session_activity}\t#{${TMUX_IDENTITY_OPTION}}\t#{pid}`;

export type TmuxSessionInventoryEntry = {
  name: string;
  activity: number;
  identity: string | null;
  /**
   * Pid of the tmux *server* hosting this session — the server generation token.
   * A change means the server was replaced, so every session's scrollback is gone:
   * tmux keeps history only in the server's address space.
   */
  serverPid: number | null;
};

/**
 * Whether a tmux server is reachable. A running tmux server always owns at least one
 * session (it exits when the last one ends), so `absent` covers both "never started"
 * and "died" — they are the same observable state, and neither is an error.
 */
export type TmuxServerState = 'running' | 'absent' | 'unavailable';

export type TmuxInventory = {
  server: TmuxServerState;
  serverPid: number | null;
  sessions: TmuxSessionInventoryEntry[];
};

export function buildTmuxShellLine(
  sessionName: string,
  commandLine: string,
  identity?: string,
  historyLimit: number = DEFAULT_TMUX_HISTORY_LIMIT
): string {
  const tmux = tmuxShellCommand();
  const exactTarget = quoteArg(`=${sessionName}`, 'posix');
  const exactOptionTarget = quoteArg(`=${sessionName}:`, 'posix');
  const quotedName = quoteArg(sessionName, 'posix');
  const quotedCmd = quoteArg(commandLine, 'posix');
  const checkExists = `${tmux} has-session -t ${exactTarget} 2>/dev/null`;
  const newSession = `${tmux} -u new-session -d -s ${quotedName} ${quotedCmd}`;
  const setIdentity = identity
    ? `${tmux} set-option -t ${exactOptionTarget} ${TMUX_IDENTITY_OPTION} ${quoteArg(encodeTmuxIdentity(identity), 'posix')} 2>/dev/null || true`
    : null;
  const enableMouse = `${tmux} set-option -t ${exactOptionTarget} mouse on 2>/dev/null || true`;
  const setHistoryLimit = `${tmux} set-option -t ${exactOptionTarget} history-limit ${resolveHistoryLimit(historyLimit)} 2>/dev/null || true`;
  // Nobody opened tmux here: it is how an agent session outlives the app, and the user sees the
  // pane, not the multiplexer. Its stock status line is a green bar across the bottom of that
  // pane, naming a session the app already names in its own UI, and it costs a row of the
  // agent's screen to do it. Off is the honest default for a detail the user did not choose.
  const hideStatus = `${tmux} set-option -t ${exactOptionTarget} status off 2>/dev/null || true`;
  const ensureSession = `(${checkExists} || ${newSession})`;
  const configure = [setIdentity, enableMouse, setHistoryLimit, hideStatus]
    .filter((command): command is string => command !== null)
    .map((command) => `(${command})`)
    .join(' && ');
  const attach = `${tmux} -u attach-session -t ${exactTarget}`;
  return `/bin/sh -c ${quoteArg(`${ensureSession} && ${configure} && ${attach}`, 'posix')}`;
}

/**
 * The one tmux probe: session inventory *and* server liveness from a single call.
 *
 * `listTmuxSessions` used to collapse "the server is gone" into an empty array,
 * which is the knowledge the crash handler needs and the only place it is available
 * for free. Callers that only want sessions keep using the wrapper below.
 */
export async function inspectTmuxSessions(ctx: IExecutionContext): Promise<TmuxInventory> {
  try {
    const result = await ctx.exec('tmux', tmuxArgs(['list-sessions', '-F', TMUX_LIST_FORMAT]));
    const sessions = parseTmuxSessionInventory(result.stdout);
    // A server with no sessions has already exited, so a parsed session always
    // carries the live server's pid.
    const serverPid = sessions.find((session) => session.serverPid !== null)?.serverPid ?? null;
    return { server: sessions.length > 0 ? 'running' : 'absent', serverPid, sessions };
  } catch (error) {
    const failure = readExecFailure(error);
    if (failure && (failure.executableMissing || failure.exitCode === 127)) {
      return { server: 'unavailable', serverPid: null, sessions: [] };
    }
    if (isNoServerFailure(failure)) return { server: 'absent', serverPid: null, sessions: [] };
    throw error;
  }
}

export async function listTmuxSessions(
  ctx: IExecutionContext
): Promise<TmuxSessionInventoryEntry[]> {
  return (await inspectTmuxSessions(ctx)).sessions;
}

/**
 * Sessions Ninebrains left behind on the user's default tmux socket.
 *
 * Before the app took its own socket, agent sessions were created on the default server.
 * Those sessions are still running and still attachable, but nothing on the new socket
 * can see them, so the app would otherwise appear to have lost them. This reports them
 * instead — deliberately read-only. Killing a user's running agents to tidy up a socket
 * migration would destroy the exact work the tmux design exists to protect.
 *
 * Returns an empty list when tmux is missing or no default server is running, which are
 * the ordinary cases and not errors.
 */
export async function findLegacyDefaultSocketSessions(
  ctx: IExecutionContext
): Promise<TmuxSessionInventoryEntry[]> {
  try {
    // No `tmuxArgs` here on purpose: this is the one call that must address the
    // default server, because that is where the sessions we are looking for live.
    const result = await ctx.exec('tmux', ['list-sessions', '-F', TMUX_LIST_FORMAT]);
    return parseTmuxSessionInventory(result.stdout).filter((session) => session.identity !== null);
  } catch {
    return [];
  }
}

export async function killTmuxSession(
  ctx: IExecutionContext,
  sessionName: string,
  onError?: (error: unknown) => void
): Promise<void> {
  try {
    await ctx.exec('tmux', tmuxArgs(['kill-session', '-t', `=${sessionName}`]));
  } catch (error) {
    onError?.(error);
  }
}

/**
 * Keep a host-supplied history limit inside what tmux will accept.
 *
 * The value reaches the shell line as a bare word, so a non-integer would be a syntax
 * error in a command whose failure is swallowed by `|| true` — the session would come up
 * silently unconfigured. Clamping here keeps that impossible rather than merely unlikely.
 */
function resolveHistoryLimit(requested: number): number {
  if (!Number.isFinite(requested)) return DEFAULT_TMUX_HISTORY_LIMIT;
  return Math.min(Math.max(Math.trunc(requested), 0), 1_000_000);
}

export function parseTmuxSessionInventory(output: string): TmuxSessionInventoryEntry[] {
  const sessions: TmuxSessionInventoryEntry[] = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const [name, seconds, encodedIdentity = '', rawServerPid = ''] = line.split('\t');
    if (!name || !seconds) continue;
    const parsed = Number(seconds);
    if (!Number.isFinite(parsed)) continue;
    const serverPid = Number(rawServerPid);
    sessions.push({
      name,
      activity: parsed * 1_000,
      identity: decodeTmuxIdentity(encodedIdentity),
      // Older servers (and any format tmux declines to expand) leave this blank;
      // a null pid degrades detection to "unknown", never to a false restart.
      serverPid: rawServerPid !== '' && Number.isInteger(serverPid) ? serverPid : null,
    });
  }
  return sessions;
}

/** tmux's several ways of saying "there is no server to talk to". */
function isNoServerFailure(failure: ReturnType<typeof readExecFailure>): boolean {
  if (!failure) return false;
  return (
    failure.exitCode === 1 &&
    /no server running|failed to connect to server|error connecting to .*\(no such file or directory\)/i.test(
      failure.stderr
    )
  );
}

/** Normalize the two execution-error shapes currently exposed by IExecutionContext. */
function readExecFailure(
  error: unknown
): { exitCode: number | null; stderr: string; executableMissing: boolean } | null {
  if (typeof error !== 'object' || error === null) return null;
  const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '';
  if ('exitCode' in error && (typeof error.exitCode === 'number' || error.exitCode === null)) {
    const cause = 'cause' in error ? error.cause : undefined;
    const executableMissing =
      error.exitCode === null &&
      typeof cause === 'object' &&
      cause !== null &&
      'code' in cause &&
      cause.code === 'ENOENT';
    return { exitCode: error.exitCode, stderr, executableMissing };
  }
  if ('code' in error) {
    if (error.code === 'ENOENT') return { exitCode: null, stderr, executableMissing: true };
    if (typeof error.code === 'number') {
      return { exitCode: error.code, stderr, executableMissing: false };
    }
  }
  return null;
}
