import { ID_PATTERN, assertLoopbackUrl } from '@ninebrains/brain-core';

/**
 * The shim's whole configuration.
 *
 * - SEC-01: there is no DB path and no direct mode. The shim can only forward.
 * - SEC-02: there is no role or identity setting. The token is the identity;
 *   main tells the shim its role (`discoverSession`). `laneHint` is only a
 *   cross-check that main uses to reject a mixed-up config.
 */
export interface BrainMcpConfig {
  url: string;
  token: string;
  laneHint: string | null;
}

export const ENV = {
  url: 'NINEBRAINS_BRAIN_URL',
  token: 'NINEBRAINS_TOKEN',
  laneHint: 'NINEBRAINS_LANE_ID',
} as const;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BrainMcpConfig {
  const url = env[ENV.url];
  if (!url) throw new ConfigError(`${ENV.url} is required; the Ninebrains app sets it when it launches a session`);
  try {
    assertLoopbackUrl(url);
  } catch (error) {
    throw new ConfigError((error as Error).message);
  }

  const token = env[ENV.token];
  // Never echo the value: a malformed token may still be a real one with a typo.
  if (!token || !TOKEN_PATTERN.test(token)) throw new ConfigError(`${ENV.token} is missing or malformed`);

  const laneHint = env[ENV.laneHint] || null;
  if (laneHint !== null && !ID_PATTERN.test(laneHint)) {
    throw new ConfigError(`${ENV.laneHint} must be 1-64 characters of letters, digits, _ or -`);
  }
  return { url, token, laneHint };
}
