import {
  createHttpBrainClient,
  findBrainHandshake,
  handshakeProcessAlive,
  type BrainHandshake,
  type HttpBrainClient,
} from '@ninebrains/brain-core';

/**
 * Finding the Brain.
 *
 * v1 attaches to the Brain the desktop app is already running: the app owns the
 * database (SEC-01 keeps every other process off it), so the CLI is a client of
 * the same hardened endpoint the lanes use, with a user-role token. A headless
 * Brain that the CLI could start on its own is the roadmap item, not this.
 */

export interface Connection {
  client: HttpBrainClient;
  handshake: BrainHandshake;
  file: string;
}

export type ConnectResult = { ok: true; connection: Connection } | { ok: false; message: string };

export function connect(env: NodeJS.ProcessEnv = process.env): ConnectResult {
  const found = findBrainHandshake(env);
  if (!found.ok) {
    return { ok: false, message: explainMissing(found, env) };
  }
  if (!handshakeProcessAlive(found.handshake)) {
    return {
      ok: false,
      message: [
        `The Ninebrains app that wrote ${found.file} (pid ${found.handshake.pid}) is no longer running.`,
        'Start the app and try again. The stale handshake is harmless: its token is already dead.',
      ].join('\n'),
    };
  }
  return {
    ok: true,
    connection: {
      // assertLoopbackUrl runs inside the client, so a tampered handshake that
      // slipped past the schema still cannot point the CLI off the loopback.
      client: createHttpBrainClient({
        url: found.handshake.url,
        token: found.handshake.token,
        timeoutMs: readTimeout(env),
      }),
      handshake: found.handshake,
      file: found.file,
    },
  };
}

function readTimeout(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env.NINEBRAINS_BRAIN_TIMEOUT_MS;
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** A missing handshake is the common case on a fresh machine, so say what to do. */
function explainMissing(
  found: Extract<ReturnType<typeof findBrainHandshake>, { reason: 'none' }> | { ok: false },
  env: NodeJS.ProcessEnv
): string {
  const lines = ['No running Ninebrains Brain found.'];
  if (env.NINEBRAINS_BRAIN_HANDSHAKE) {
    lines.push(`NINEBRAINS_BRAIN_HANDSHAKE points at ${env.NINEBRAINS_BRAIN_HANDSHAKE}.`);
  }
  if ('tried' in found && Array.isArray(found.tried)) {
    lines.push('Looked in:');
    for (const attempt of found.tried) {
      const attemptWithReason = attempt as { file: string; reason?: string; detail?: string };
      const detail = attemptWithReason.detail ? ` (${attemptWithReason.detail})` : '';
      lines.push(`  ${attemptWithReason.file} - ${attemptWithReason.reason}${detail}`);
    }
  }
  lines.push('');
  lines.push('Start the Ninebrains desktop app; it publishes the handshake at boot.');
  lines.push('Set NINEBRAINS_BRAIN_HANDSHAKE to point at a specific one.');
  return lines.join('\n');
}
