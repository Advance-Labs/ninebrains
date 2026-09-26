import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { BRAIN_ENDPOINT } from './endpoint';
import { TOKEN_BYTES } from './tokens';

/**
 * How the CLI finds a running Brain (SEC-10).
 *
 * The endpoint binds an ephemeral loopback port and mints a fresh token each
 * launch, so neither is knowable in advance. Main writes both to one file under
 * userData with mode 0600 in a 0700 directory: reading it already requires the
 * operator's OS account, which is the same bar as reading the Brain database.
 *
 * The file is not a lock and not a source of truth about liveness. It records the
 * writing process's pid so the CLI can tell "the app is gone and left this
 * behind" from "the app is up but refused me". A stale file fails closed: the
 * token it names is revoked on a clean exit, and after a crash the port is dead
 * or belongs to someone who cannot resolve that token, so the answer is 401.
 */

/** Bump when the shape changes. The CLI refuses a version it does not know. */
export const BRAIN_HANDSHAKE_VERSION = 1 as const;

export const BRAIN_HANDSHAKE_FILENAME = 'brain-cli.json';

/**
 * Where the handshake lives relative to userData. Matches the app's other
 * userData-relative paths (`<userData>/ninebrains/packs`, `.../evidence`).
 */
export const BRAIN_HANDSHAKE_SUBDIR = 'ninebrains';

/**
 * The userData directory names the app can use, most likely first. They come
 * from `USER_DATA_DIR_NAME` in the app's `app-identity.ts`, which varies by
 * build: a release, a canary and a dev run each have their own directory and so
 * their own Brain. The CLI tries them in this order unless told otherwise.
 */
export const BRAIN_USER_DATA_DIR_NAMES = [
  'ninebrains',
  'ninebrains-canary',
  'ninebrains-dev',
] as const;

const TOKEN_CHARS = Math.ceil((TOKEN_BYTES * 4) / 3);

/** SEC-04 again, at rest: a handshake may only ever name the loopback endpoint. */
const loopbackUrl = z
  .string()
  .regex(
    new RegExp(`^http://${BRAIN_ENDPOINT.bindHost.replace(/\./g, '\\.')}:\\d{1,5}$`),
    `url must be http://${BRAIN_ENDPOINT.bindHost}:<port>`
  );

export const brainHandshakeSchema = z.object({
  version: z.literal(BRAIN_HANDSHAKE_VERSION),
  url: loopbackUrl,
  token: z.string().length(TOKEN_CHARS),
  /** The pid that wrote this file, for a clear "app is not running" message. */
  pid: z.number().int().positive(),
  startedAt: z.number().int().nonnegative(),
});

export type BrainHandshake = z.infer<typeof brainHandshakeSchema>;

/**
 * The platform's userData directory for one app directory name, resolved without
 * Electron so the CLI can find it too. Mirrors the app's
 * `resolveDefaultUserDataPath()`.
 */
export function resolveBrainUserDataDir(
  dirName: string = BRAIN_USER_DATA_DIR_NAMES[0],
  env: NodeJS.ProcessEnv = process.env
): string {
  const home = env.HOME ?? homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', dirName);
  }
  if (process.platform === 'win32') {
    return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), dirName);
  }
  return path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), dirName);
}

/** The handshake path for a userData directory (what Electron calls `userData`). */
export function brainHandshakePath(userDataDir: string): string {
  return path.join(userDataDir, BRAIN_HANDSHAKE_SUBDIR, BRAIN_HANDSHAKE_FILENAME);
}

/**
 * Every handshake path to try, in order: an explicit override first, then one per
 * known userData directory name.
 */
export function brainHandshakeCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const override = env.NINEBRAINS_BRAIN_HANDSHAKE;
  if (override) return [override];
  return BRAIN_USER_DATA_DIR_NAMES.map((name) =>
    brainHandshakePath(resolveBrainUserDataDir(name, env))
  );
}

/** Writes the file 0600 inside a 0700 directory. Overwrites any earlier launch's. */
export function writeBrainHandshake(
  handshake: Omit<BrainHandshake, 'version'>,
  file: string
): string {
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdirSync ignores `mode` when the directory already exists, so set it too.
  chmodSync(dir, 0o700);
  const body: BrainHandshake = { version: BRAIN_HANDSHAKE_VERSION, ...handshake };
  // Write then chmod: `mode` in writeFileSync is only applied when the file is
  // created, so an existing file from an earlier launch would keep its mode.
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

export function removeBrainHandshake(file: string): void {
  rmSync(file, { force: true });
}

export type ReadHandshakeResult =
  | { ok: true; handshake: BrainHandshake; file: string }
  | { ok: false; reason: 'missing' | 'unreadable' | 'malformed'; file: string; detail?: string };

/** Never throws: a missing, truncated or foreign file is a reason, not an exception. */
export function readBrainHandshake(file: string): ReadHandshakeResult {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    const code = (error as { code?: string }).code;
    return { ok: false, reason: code === 'ENOENT' ? 'missing' : 'unreadable', file };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'malformed', file, detail: 'not valid JSON' };
  }
  const result = brainHandshakeSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, reason: 'malformed', file, detail: z.prettifyError(result.error) };
  }
  return { ok: true, handshake: result.data, file };
}

/**
 * The first candidate that reads cleanly, or the reasons every candidate failed.
 * Order matters: a release install wins over a dev run, so a CLI on a machine
 * with both talks to the real one unless `NINEBRAINS_BRAIN_HANDSHAKE` says otherwise.
 */
export function findBrainHandshake(
  env: NodeJS.ProcessEnv = process.env
): ReadHandshakeResult | { ok: false; reason: 'none'; tried: ReadHandshakeResult[] } {
  const tried: ReadHandshakeResult[] = [];
  for (const file of brainHandshakeCandidates(env)) {
    const result = readBrainHandshake(file);
    if (result.ok) return result;
    tried.push(result);
  }
  return { ok: false, reason: 'none', tried };
}

/** Whether the pid in the handshake is still alive. Signal 0 only probes. */
export function handshakeProcessAlive(handshake: BrainHandshake): boolean {
  try {
    process.kill(handshake.pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as { code?: string }).code === 'EPERM';
  }
}
