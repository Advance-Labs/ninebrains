/**
 * Child environments for unattended runs and the tests gate.
 *
 * SEC-13: unattended and reviewer runs get a narrower env than attended lanes. We start from
 * upstream's allowlist (so parent-session markers like CLAUDECODE never leak, spike gotcha 9)
 * and then keep only what a CLI needs to find itself, its account and the network.
 *
 * SEC-20: the tests gate gets the same base minus every provider credential.
 */
import {
  buildAllowlistedAgentEnv,
  currentAgentEnvPlatform,
  mergeAgentEnvLayers,
  type AgentEnvPlatform,
} from '@emdash/core/primitives/agent-env/api';
import type { ExecProvider, ProviderAuthEnv } from './types';

type EnvRecord = Readonly<Record<string, string | undefined>>;

const BASE_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'LANG',
  'TZ',
  'TMPDIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
] as const;

const WINDOWS_KEYS = [
  'SystemRoot',
  'windir',
  'ComSpec',
  'PATHEXT',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
] as const;

/** Never allowed into a child, whatever an allowlist upstream says. */
const FORBIDDEN_PREFIXES = ['NINEBRAINS_', 'EMDASH_', 'CLAUDECODE', 'CLAUDE_CODE_'];

function pick(env: EnvRecord, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = env[key];
    if (value) out[key] = value;
  }
  return out;
}

function assertNoForbidden(env: Record<string, string>): Record<string, string> {
  for (const key of Object.keys(env)) {
    if (FORBIDDEN_PREFIXES.some((p) => key.toUpperCase().startsWith(p))) {
      throw new Error(`Child env must not carry ${key}`);
    }
  }
  return env;
}

function baseEnv(parentEnv: EnvRecord, platform: AgentEnvPlatform): Record<string, string> {
  const allowlisted = buildAllowlistedAgentEnv(parentEnv, { platform });
  const keys = platform === 'windows' ? [...BASE_KEYS, ...WINDOWS_KEYS] : BASE_KEYS;
  return pick(allowlisted, keys);
}

export interface UnattendedEnvOptions {
  provider: ExecProvider;
  auth?: ProviderAuthEnv;
  platform?: AgentEnvPlatform;
}

/**
 * SEC-13. Account selection comes only from `auth`, never from the parent env, so a run can't
 * silently inherit the user's default account or an API key they did not choose for it.
 */
export function buildUnattendedEnv(
  parentEnv: EnvRecord,
  options: UnattendedEnvOptions
): Record<string, string> {
  const platform = options.platform ?? currentAgentEnvPlatform();
  const auth = options.auth ?? {};
  const providerLayer: Record<string, string | undefined> =
    options.provider === 'claude'
      ? {
          CLAUDE_CONFIG_DIR: auth.CLAUDE_CONFIG_DIR,
          ANTHROPIC_API_KEY: auth.ANTHROPIC_API_KEY,
          // MCP tools stay visible without a ToolSearch round trip (spike gotcha 4).
          ENABLE_TOOL_SEARCH: 'false',
        }
      : { CODEX_HOME: auth.CODEX_HOME };
  return assertNoForbidden(
    mergeAgentEnvLayers(platform, baseEnv(parentEnv, platform), providerLayer)
  );
}

/** SEC-20: the tests gate's env. No provider auth, no tokens, no app variables. */
export function buildScrubbedCommandEnv(
  parentEnv: EnvRecord,
  platform: AgentEnvPlatform = currentAgentEnvPlatform()
): Record<string, string> {
  return assertNoForbidden(
    mergeAgentEnvLayers(platform, baseEnv(parentEnv, platform), { CI: '1' })
  );
}
