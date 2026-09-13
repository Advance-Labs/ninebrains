/**
 * The model route of every agent launch, and SEC-39 (plan §4.3, §5).
 *
 * `routeLaunch` is the one function that turns a lane's or run's routing (subscription or a
 * model profile, plus Lever A's subagent tier) into env, `--settings` env and Codex config, and
 * `assertLaunchPolicy` is the one check that a subscription launch carries no gateway. Every
 * launch builder calls both, right before it hands off argv and env:
 *
 * - `brain/node/launch-config.ts` `buildLaneLaunch`: attended lanes and Brain sessions;
 * - `exec-runs/api/node/run-supervisor.ts` `launch`: unattended claude and codex runs and
 *   reviewers (which never take a profile).
 *
 * Two layers carry the route for Claude, because each can be overridden by something else:
 * - process env: upstream merges our `providerVars` over the user's allowlisted shell env. A
 *   layer can override but not delete, so a subscription launch sets each gateway and alias
 *   variable to `''`, which the CLI treats as unset (checked on claude 2.1.269);
 * - our per-launch `--settings` `env` block, which outranks user, project and local settings
 *   files (spike §13 Q2). It never holds a key: a key only ever lives in one spawn's env (SEC-40).
 */
import {
  baseUrlProblem,
  DEFERRED_KINDS,
  PROFILE_ID,
  profileKeySchema,
  protocolOfKind,
  type ProfileKind,
  type ProfileProtocol,
  type TierModels,
} from '../profile';
import { resolveSubagentModel, SUBAGENT_TIERS } from '../subagent-model';

export type LaunchProvider = 'claude' | 'codex';

/** The launch-time slice of a profile. The key travels separately and only into `env`. */
export interface ProfileLaunch {
  id: string;
  kind: ProfileKind;
  protocol: ProfileProtocol;
  baseUrl: string;
  model?: string;
  tierModels?: TierModels;
}

export type LaunchAuth =
  | { mode: 'subscription' }
  | { mode: 'profile'; profile: ProfileLaunch; key?: string };

export interface LaunchRouting {
  auth: LaunchAuth;
  /** The lane's own subagent choice (Lever A), `inherit` included. */
  subagentModel?: string;
  /** The lane role's default, used when the lane has none. */
  roleSubagentModel?: string;
}

export const SUBSCRIPTION: LaunchRouting = { auth: { mode: 'subscription' } };

export type RouteMode = 'subscription' | 'api-key' | 'local';

export interface RoutedLaunch {
  mode: RouteMode;
  kind?: ProfileKind;
  /** Layered last into the child env: values to set, and `''` for values to neutralize. */
  env: Record<string, string>;
  /** Claude only: merged into our `--settings` file's `env`. Never holds a key. */
  settingsEnv: Record<string, string>;
  /** Codex `--config` values (without the flag), trusted by the argv guard. */
  codexConfig: string[];
  /** `--model` for unattended Claude runs, when the profile names one. */
  model?: string;
  /** Literal values the redactor must hide (SEC-40). */
  secrets: string[];
  /** SEC-41: what a Claude run's `system/init` event must report. */
  expect?: { apiKeySource: string; model?: string };
  /** SEC-45: the profile's API host, added to the run's sandbox egress. */
  egressHosts: string[];
}

/** SEC-39: a subscription launch never carries any of these with a value. */
export const GATEWAY_ENV = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
] as const;

/** Alias variables; on a subscription they may only be unset (SEC-39). */
export const ALIAS_ENV = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
] as const;

export const SUBAGENT_MODEL_ENV = 'CLAUDE_CODE_SUBAGENT_MODEL';

/** Profile runs: stops the CLI's own calls to api.anthropic.com (spike §13), so traffic follows the profile. */
export const NONESSENTIAL_TRAFFIC_ENV = 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC';

/** Codex reads the profile key from this variable (`env_key`). Not `NINEBRAINS_*`: run-env forbids it. */
export const CODEX_PROFILE_KEY_ENV = 'NB_MODEL_KEY';
/** The one Codex provider id a profile launch defines. Never a reserved id (`openai`, `ollama`, `lmstudio`). */
export const CODEX_PROVIDER_ID = 'nb';

/** Local servers ignore the token, but Claude Code needs a non-empty one to skip its login. */
const LOCAL_PLACEHOLDER_TOKEN = 'ninebrains-local';

const TIER_ENV = [
  ['opus', 'ANTHROPIC_DEFAULT_OPUS_MODEL'],
  ['sonnet', 'ANTHROPIC_DEFAULT_SONNET_MODEL'],
  ['haiku', 'ANTHROPIC_DEFAULT_HAIKU_MODEL'],
] as const;

/** Every variable a route may set, for the unattended allowlist (SEC-13). */
export const ROUTING_ENV_NAMES: readonly string[] = [
  ...GATEWAY_ENV,
  ...ALIAS_ENV,
  SUBAGENT_MODEL_ENV,
  NONESSENTIAL_TRAFFIC_ENV,
  CODEX_PROFILE_KEY_ENV,
];

export class LaunchPolicyError extends Error {
  constructor(message: string) {
    super(`Refusing to launch: ${message}`);
    this.name = 'LaunchPolicyError';
  }
}

/** A Claude alias or a Claude model id: the only subagent models a subscription may use. */
export function isClaudeModel(value: string): boolean {
  return (
    (SUBAGENT_TIERS as readonly string[]).includes(value) ||
    /^claude-[A-Za-z0-9.-]+(\[1m\])?$/.test(value)
  );
}

const toml = (value: string): string => JSON.stringify(value);
const blank = (names: readonly string[]): Record<string, string> =>
  Object.fromEntries(names.map((name) => [name, '']));

function checkProfile(provider: LaunchProvider, profile: ProfileLaunch): URL {
  if (!PROFILE_ID.test(profile.id)) throw new LaunchPolicyError('the profile id is not safe');
  if (DEFERRED_KINDS.includes(profile.kind)) {
    throw new LaunchPolicyError(`${profile.kind} profiles are not supported in this version`);
  }
  const problem = baseUrlProblem(profile.baseUrl, profile.kind);
  if (problem) throw new LaunchPolicyError(`profile ${profile.id}: base URL ${problem}`);
  const fixed = protocolOfKind(profile.kind);
  if (fixed !== null && fixed !== profile.protocol) {
    throw new LaunchPolicyError(`profile ${profile.id}: ${profile.kind} speaks ${fixed}`);
  }
  const wanted = provider === 'claude' ? 'anthropic' : 'openai-responses';
  if (profile.protocol !== wanted) {
    throw new LaunchPolicyError(
      `profile ${profile.id} speaks ${profile.protocol}; a ${provider} lane needs ${wanted}`
    );
  }
  return new URL(profile.baseUrl);
}

function checkKey(profile: ProfileLaunch, key: string | undefined): string {
  if (key === undefined || key === '') {
    if (profile.kind === 'local') return LOCAL_PLACEHOLDER_TOKEN;
    throw new LaunchPolicyError(
      `profile ${profile.id} has no API key; add one in Settings → Models`
    );
  }
  const parsed = profileKeySchema.safeParse(key);
  if (!parsed.success) throw new LaunchPolicyError(`profile ${profile.id} has an unusable key`);
  return parsed.data;
}

/**
 * The env, settings env and Codex config for one launch (plan §4.3). Codex has no
 * subagent-model setting, so Lever A applies to Claude only.
 */
export function routeLaunch(
  provider: LaunchProvider,
  routing: LaunchRouting = SUBSCRIPTION
): RoutedLaunch {
  const subagent =
    provider === 'claude'
      ? resolveSubagentModel(routing.subagentModel, routing.roleSubagentModel)
      : undefined;
  const subagentEnv: Record<string, string> = subagent ? { [SUBAGENT_MODEL_ENV]: subagent } : {};
  const { auth } = routing;

  if (auth.mode === 'subscription') {
    if (subagent && !isClaudeModel(subagent)) {
      throw new LaunchPolicyError(
        `a subscription lane's subagents must use a Claude model, not ${subagent}`
      );
    }
    const neutral = blank([...GATEWAY_ENV, ...ALIAS_ENV]);
    return {
      mode: 'subscription',
      env: { ...neutral, ...subagentEnv },
      settingsEnv: provider === 'claude' ? { ...neutral, ...subagentEnv } : {},
      codexConfig: [],
      secrets: [],
      ...(provider === 'claude' ? { expect: { apiKeySource: 'none' } } : {}),
      egressHosts: [],
    };
  }

  const { profile } = auth;
  const url = checkProfile(provider, profile);
  const key = checkKey(profile, auth.key);
  const mode: RouteMode = profile.kind === 'local' ? 'local' : 'api-key';
  const secrets = key === LOCAL_PLACEHOLDER_TOKEN ? [] : [key];
  const egressHosts = [url.hostname.replace(/^\[(.*)\]$/, '$1')];

  if (provider === 'claude') {
    const aliases: Record<string, string> = blank(ALIAS_ENV);
    for (const [tier, name] of TIER_ENV) {
      const model = profile.tierModels?.[tier] ?? profile.model;
      if (model) aliases[name] = model;
    }
    const expect = { ...(profile.model ? { model: profile.model } : {}) };
    if (profile.kind === 'anthropic-api') {
      // Anthropic itself, with the user's key: no base URL and no gateway token.
      const gateway = { ANTHROPIC_BASE_URL: '', ANTHROPIC_AUTH_TOKEN: '' };
      return {
        mode,
        kind: profile.kind,
        env: { ...gateway, ANTHROPIC_API_KEY: key, ...aliases, ...subagentEnv },
        settingsEnv: { ...gateway, ...aliases, ...subagentEnv },
        codexConfig: [],
        ...(profile.model ? { model: profile.model } : {}),
        secrets,
        expect: { apiKeySource: 'ANTHROPIC_API_KEY', ...expect },
        egressHosts,
      };
    }
    // Explicitly empty: a key from the user's shell never reaches a third-party host.
    const gateway = { ANTHROPIC_BASE_URL: profile.baseUrl, ANTHROPIC_API_KEY: '' };
    const quiet = { [NONESSENTIAL_TRAFFIC_ENV]: '1' };
    return {
      mode,
      kind: profile.kind,
      env: { ...gateway, ANTHROPIC_AUTH_TOKEN: key, ...aliases, ...quiet, ...subagentEnv },
      settingsEnv: { ...gateway, ...aliases, ...quiet, ...subagentEnv },
      codexConfig: [],
      ...(profile.model ? { model: profile.model } : {}),
      secrets,
      // `ANTHROPIC_AUTH_TOKEN` reports "none", like a login (spike §13 Q1), so the model decides.
      expect: { apiKeySource: 'none', ...expect },
      egressHosts,
    };
  }

  const codexConfig = [
    `model_providers.${CODEX_PROVIDER_ID}={name=${toml(`Ninebrains ${profile.id}`)},base_url=${toml(profile.baseUrl)},wire_api="responses",env_key=${toml(CODEX_PROFILE_KEY_ENV)}}`,
    `model_provider=${toml(CODEX_PROVIDER_ID)}`,
    ...(profile.model ? [`model=${toml(profile.model)}`] : []),
  ];
  return {
    mode,
    kind: profile.kind,
    env: { [CODEX_PROFILE_KEY_ENV]: key },
    settingsEnv: {},
    codexConfig,
    secrets,
    egressHosts,
  };
}

/** The values of every config flag in an argv: `-c X`, `-cX`, `--config X`, `--config=X`. */
function configValues(argv: readonly string[], provider: LaunchProvider): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--config' || (provider === 'codex' && token === '-c')) {
      if (i + 1 < argv.length) values.push(argv[++i]);
    } else if (token.startsWith('--config=')) {
      values.push(token.slice('--config='.length));
    } else if (provider === 'codex' && /^-c./.test(token)) {
      values.push(token.slice(2).replace(/^=/, ''));
    }
  }
  return values;
}

/** Case, quotes, whitespace and TOML escapes can't hide a `model_provider(s)` key. */
function mentionsModelProvider(value: string): boolean {
  const decoded = value
    .replace(/\\U([0-9a-fA-F]{8})|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g, (_m, a, b, c) =>
      String.fromCodePoint(Number.parseInt(a ?? b ?? c, 16))
    )
    .replace(/["'\s\\]/g, '')
    .toLowerCase();
  return decoded.includes('model_provider');
}

export interface LaunchPolicyInput {
  provider: LaunchProvider;
  /** `account-api-key`: an unattended run on the account's own Anthropic key (`ProviderAuthEnv`). */
  mode: RouteMode | 'account-api-key';
  /** The env layer this builder controls. */
  env: Readonly<Record<string, string | undefined>>;
  /** Claude: the `env` block of our `--settings` file. */
  settingsEnv?: Readonly<Record<string, string>>;
  /** The full argv, the user's flags included. */
  argv: readonly string[];
  /**
   * `layered`: `env` goes over a parent env the builder does not control (upstream's attended
   * PTY), so each neutralized variable must be present and empty to override the parent.
   * `complete`: `env` is the whole child env (unattended runs), so absent or empty is fine.
   */
  envKind: 'layered' | 'complete';
}

const isSet = (value: string | undefined): boolean => value !== undefined && value !== '';

/**
 * SEC-39. Throws `LaunchPolicyError` when a subscription launch (or an account-key run) would
 * reach another host: a gateway variable with a value, an alias to a non-Claude model, a
 * non-Claude subagent model, a `--settings` env that doesn't blank the gateway, or a Codex
 * `model_provider(s)` override or `--profile`. For a profile launch, checks the route is
 * complete, so a half-built launch never falls back to the user's login.
 */
export function assertLaunchPolicy(input: LaunchPolicyInput): void {
  const { provider, mode, env, argv, envKind, settingsEnv } = input;
  const overrides = configValues(argv, provider).filter(mentionsModelProvider);
  const codexProfileFlag = provider === 'codex' && argv.some((t) => /^(--profile(=|$)|-p)/.test(t));
  const neutral = (value: string | undefined) =>
    envKind === 'layered' ? value === '' : !isSet(value);

  if (mode === 'subscription' || mode === 'account-api-key') {
    const gateway = mode === 'subscription' ? GATEWAY_ENV : GATEWAY_ENV.slice(0, 2);
    for (const name of gateway) {
      if (!neutral(env[name]))
        throw new LaunchPolicyError(`a ${mode} launch must not carry ${name}`);
    }
    for (const name of ALIAS_ENV) {
      const value = env[name];
      const ok = envKind === 'layered' ? value === '' : !isSet(value) || isClaudeModel(value!);
      if (!ok) throw new LaunchPolicyError(`a ${mode} launch must not alias ${name} to ${value}`);
    }
    const subagent = env[SUBAGENT_MODEL_ENV];
    if (isSet(subagent) && !isClaudeModel(subagent!)) {
      throw new LaunchPolicyError(`a ${mode} launch's subagents must use a Claude model`);
    }
    if (provider === 'claude' && settingsEnv) {
      for (const name of gateway) {
        if (settingsEnv[name] !== '') {
          throw new LaunchPolicyError(`the launch settings must blank ${name}`);
        }
      }
    }
    if (overrides.length > 0 || codexProfileFlag) {
      throw new LaunchPolicyError(`a ${mode} launch must not carry a Codex model provider`);
    }
    return;
  }

  if (provider === 'claude') {
    if (overrides.length > 0)
      throw new LaunchPolicyError('a Claude launch takes no model provider');
    for (const name of GATEWAY_ENV) {
      if (settingsEnv && isSet(settingsEnv[name]) && name !== 'ANTHROPIC_BASE_URL') {
        throw new LaunchPolicyError(`the launch settings must never hold ${name}`);
      }
    }
    if (isSet(env.ANTHROPIC_API_KEY)) {
      // anthropic-api: Anthropic's own host and the user's key, nothing else.
      if (!neutral(env.ANTHROPIC_BASE_URL) || !neutral(env.ANTHROPIC_AUTH_TOKEN)) {
        throw new LaunchPolicyError('an Anthropic API-key launch takes no gateway');
      }
      return;
    }
    if (!isSet(env.ANTHROPIC_BASE_URL) || !isSet(env.ANTHROPIC_AUTH_TOKEN)) {
      throw new LaunchPolicyError('a profile launch needs its base URL and token');
    }
    if (!neutral(env.ANTHROPIC_API_KEY)) {
      throw new LaunchPolicyError('a profile launch must blank ANTHROPIC_API_KEY');
    }
    return;
  }
  const selected = overrides.filter((value) => /^\s*model_provider\s*=/.test(value));
  if (selected.length !== 1 || !isSet(env[CODEX_PROFILE_KEY_ENV]) || codexProfileFlag) {
    throw new LaunchPolicyError(
      'a Codex profile launch needs exactly one model provider and its key'
    );
  }
}
