import { describe, expect, it } from 'vitest';
import {
  ALIAS_ENV,
  assertLaunchPolicy,
  CODEX_PROFILE_KEY_ENV,
  GATEWAY_ENV,
  LaunchPolicyError,
  routeLaunch,
  SUBAGENT_MODEL_ENV,
  type LaunchRouting,
  type ProfileLaunch,
} from './launch-env';
import { gatewayVarsInSettings, managedGatewaySettings } from './managed-settings';

const KEY = 'sk-or-v1-abcdefghijklmnop';
const openrouter: ProfileLaunch = {
  id: 'or1',
  kind: 'anthropic-compatible',
  protocol: 'anthropic',
  baseUrl: 'https://openrouter.ai/api',
  model: 'deepseek/deepseek-chat',
};
const local: ProfileLaunch = {
  id: 'ollama',
  kind: 'local',
  protocol: 'anthropic',
  baseUrl: 'http://127.0.0.1:11434',
};
const codexProfile: ProfileLaunch = {
  id: 'lm',
  kind: 'local',
  protocol: 'openai-responses',
  baseUrl: 'http://127.0.0.1:1234/v1',
  model: 'qwen3-coder',
};
const profile = (p: ProfileLaunch, key?: string): LaunchRouting => ({
  auth: { mode: 'profile', profile: p, ...(key ? { key } : {}) },
});

describe('SEC-39 subscription runs carry no routing', () => {
  it('neutralizes every gateway and alias variable, in env and in --settings env', () => {
    const route = routeLaunch('claude', { auth: { mode: 'subscription' } });
    for (const name of [...GATEWAY_ENV, ...ALIAS_ENV]) {
      expect(route.env[name]).toBe('');
      expect(route.settingsEnv[name]).toBe('');
    }
    expect(route.codexConfig).toEqual([]);
    expect(route.secrets).toEqual([]);
    expect(route.egressHosts).toEqual([]);
    expect(route.expect).toEqual({ apiKeySource: 'none' });
  });

  it('allows a Claude subagent tier or Claude id (Lever A), and nothing else', () => {
    expect(
      routeLaunch('claude', { auth: { mode: 'subscription' }, subagentModel: 'haiku' }).env[
        SUBAGENT_MODEL_ENV
      ]
    ).toBe('haiku');
    const id = routeLaunch('claude', {
      auth: { mode: 'subscription' },
      subagentModel: 'claude-sonnet-5[1m]',
    });
    expect(id.env[SUBAGENT_MODEL_ENV]).toBe('claude-sonnet-5[1m]');
    expect(() =>
      routeLaunch('claude', { auth: { mode: 'subscription' }, subagentModel: 'deepseek-flash' })
    ).toThrow(LaunchPolicyError);
  });

  it('inherit emits no subagent variable, and a lane choice beats its role default', () => {
    const inherit = routeLaunch('claude', {
      auth: { mode: 'subscription' },
      subagentModel: 'inherit',
      roleSubagentModel: 'haiku',
    });
    expect(inherit.env[SUBAGENT_MODEL_ENV]).toBeUndefined();
    const role = routeLaunch('claude', {
      auth: { mode: 'subscription' },
      roleSubagentModel: 'haiku',
    });
    expect(role.env[SUBAGENT_MODEL_ENV]).toBe('haiku');
  });

  it('Codex has no subagent setting, so Lever A emits nothing for it', () => {
    const route = routeLaunch('codex', { auth: { mode: 'subscription' }, subagentModel: 'haiku' });
    expect(route.env[SUBAGENT_MODEL_ENV]).toBeUndefined();
    expect(route.settingsEnv).toEqual({});
  });

  it('the policy refuses a layered subscription env that leaves a parent value in place', () => {
    const route = routeLaunch('claude');
    for (const name of GATEWAY_ENV) {
      const env = { ...route.env };
      delete env[name];
      expect(() =>
        assertLaunchPolicy({
          provider: 'claude',
          mode: 'subscription',
          env,
          argv: [],
          envKind: 'layered',
        })
      ).toThrow(LaunchPolicyError);
    }
  });

  it('the policy refuses gateway values, non-Claude aliases and settings that do not blank the gateway', () => {
    const base = {
      provider: 'claude' as const,
      mode: 'subscription' as const,
      argv: [],
      envKind: 'complete' as const,
    };
    expect(() =>
      assertLaunchPolicy({ ...base, env: { ANTHROPIC_BASE_URL: 'https://gw.test' } })
    ).toThrow();
    expect(() => assertLaunchPolicy({ ...base, env: { ANTHROPIC_AUTH_TOKEN: 'x' } })).toThrow();
    expect(() => assertLaunchPolicy({ ...base, env: { ANTHROPIC_API_KEY: 'x' } })).toThrow();
    expect(() =>
      assertLaunchPolicy({ ...base, env: { ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5' } })
    ).toThrow();
    expect(() =>
      assertLaunchPolicy({ ...base, env: { [SUBAGENT_MODEL_ENV]: 'kimi-k3' } })
    ).toThrow();
    expect(() =>
      assertLaunchPolicy({
        ...base,
        env: {},
        settingsEnv: { ANTHROPIC_BASE_URL: 'https://gw.test' },
      })
    ).toThrow();
    // A Claude alias pinned to a Claude id is fine on a subscription.
    expect(() =>
      assertLaunchPolicy({ ...base, env: { ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5' } })
    ).not.toThrow();
  });

  it('the policy refuses any Codex model_provider override or --profile on a subscription, however spelled', () => {
    const base = {
      provider: 'codex' as const,
      mode: 'subscription' as const,
      env: {},
      envKind: 'complete' as const,
    };
    for (const argv of [
      ['-c', 'model_provider="x"'],
      ['--config=model_providers.x={base_url="https://gw.test"}'],
      ['-cmodel_provider=x'],
      ['--config', '"MODEL_PROVIDER"="x"'],
      ['-c', '"model\\u005fprovider"="x"'],
      ['--profile=gw'],
      ['-p', 'gw'],
    ]) {
      expect(() => assertLaunchPolicy({ ...base, argv }), argv.join(' ')).toThrow(
        LaunchPolicyError
      );
    }
    // A pack prompt that merely mentions the word is not a config value.
    expect(() =>
      assertLaunchPolicy({
        ...base,
        provider: 'claude',
        argv: ['--append-system-prompt=mention model_provider'],
      })
    ).not.toThrow();
  });
});

describe('SEC-39 profile routes', () => {
  it('an anthropic-compatible profile gets its base URL and token, an empty API key and quiet traffic', () => {
    const route = routeLaunch('claude', profile(openrouter, KEY));
    expect(route.mode).toBe('api-key');
    expect(route.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
      ANTHROPIC_AUTH_TOKEN: KEY,
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek/deepseek-chat',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    });
    expect(route.secrets).toEqual([KEY]);
    expect(route.egressHosts).toEqual(['openrouter.ai']);
    expect(route.expect).toEqual({ apiKeySource: 'none', model: 'deepseek/deepseek-chat' });
    // SEC-40: the settings file never holds the key.
    expect(JSON.stringify(route.settingsEnv)).not.toContain(KEY);
    expect(route.settingsEnv.ANTHROPIC_API_KEY).toBe('');
  });

  it('an anthropic-api profile uses the key only, with no base URL or gateway token', () => {
    const route = routeLaunch(
      'claude',
      profile(
        {
          id: 'a',
          kind: 'anthropic-api',
          protocol: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
        },
        KEY
      )
    );
    expect(route.env).toMatchObject({
      ANTHROPIC_API_KEY: KEY,
      ANTHROPIC_BASE_URL: '',
      ANTHROPIC_AUTH_TOKEN: '',
    });
    expect(route.expect?.apiKeySource).toBe('ANTHROPIC_API_KEY');
    expect(JSON.stringify(route.settingsEnv)).not.toContain(KEY);
  });

  it('a local profile with no key gets a placeholder token that is not treated as a secret', () => {
    const route = routeLaunch('claude', profile(local));
    expect(route.mode).toBe('local');
    expect(route.env.ANTHROPIC_AUTH_TOKEN).toBeTruthy();
    expect(route.secrets).toEqual([]);
    expect(route.egressHosts).toEqual(['127.0.0.1']);
  });

  it('a Codex profile is one nb inline table plus model_provider, with the key only in NB_MODEL_KEY', () => {
    const route = routeLaunch('codex', profile(codexProfile, KEY));
    expect(route.codexConfig).toEqual([
      'model_providers.nb={name="Ninebrains lm",base_url="http://127.0.0.1:1234/v1",wire_api="responses",env_key="NB_MODEL_KEY"}',
      'model_provider="nb"',
      'model="qwen3-coder"',
    ]);
    expect(route.env).toEqual({ [CODEX_PROFILE_KEY_ENV]: KEY });
    expect(route.codexConfig.join(' ')).not.toContain(KEY);
  });

  it('refuses protocol mismatches, missing keys, deferred kinds, login hosts and non-loopback local URLs', () => {
    expect(() => routeLaunch('codex', profile(openrouter, KEY))).toThrow(LaunchPolicyError);
    expect(() => routeLaunch('claude', profile(codexProfile, KEY))).toThrow(LaunchPolicyError);
    expect(() => routeLaunch('claude', profile(openrouter))).toThrow(/no API key/);
    expect(() => routeLaunch('claude', profile({ ...openrouter, kind: 'bedrock' }, KEY))).toThrow(
      /not supported/
    );
    expect(() =>
      routeLaunch('claude', profile({ ...openrouter, baseUrl: 'https://claude.ai/api' }, KEY))
    ).toThrow();
    expect(() =>
      routeLaunch('claude', profile({ ...local, baseUrl: 'http://10.0.0.5:11434' }))
    ).toThrow();
    expect(() =>
      routeLaunch('claude', profile({ ...openrouter, baseUrl: 'http://openrouter.ai/api' }, KEY))
    ).toThrow();
    expect(() => routeLaunch('claude', profile(openrouter, 'has space key'))).toThrow();
  });

  it('the policy accepts a complete profile route and refuses a half-built one', () => {
    const route = routeLaunch('claude', profile(openrouter, KEY));
    const base = {
      provider: 'claude' as const,
      mode: 'api-key' as const,
      argv: [],
      envKind: 'layered' as const,
    };
    expect(() =>
      assertLaunchPolicy({ ...base, env: route.env, settingsEnv: route.settingsEnv })
    ).not.toThrow();
    expect(() =>
      assertLaunchPolicy({ ...base, env: { ...route.env, ANTHROPIC_AUTH_TOKEN: '' } })
    ).toThrow();
    expect(() =>
      assertLaunchPolicy({ ...base, env: { ...route.env, ANTHROPIC_API_KEY: 'sk-parent' } })
    ).toThrow();
    expect(() =>
      assertLaunchPolicy({
        ...base,
        env: route.env,
        settingsEnv: { ...route.settingsEnv, ANTHROPIC_AUTH_TOKEN: KEY },
      })
    ).toThrow(/never hold/);
    const codex = routeLaunch('codex', profile(codexProfile, KEY));
    const argv = codex.codexConfig.map((v) => `--config=${v}`);
    expect(() =>
      assertLaunchPolicy({
        provider: 'codex',
        mode: 'local',
        env: codex.env,
        argv,
        envKind: 'complete',
      })
    ).not.toThrow();
    expect(() =>
      assertLaunchPolicy({
        provider: 'codex',
        mode: 'local',
        env: codex.env,
        argv: [...argv, '-c', 'model_provider="x"'],
        envKind: 'complete',
      })
    ).toThrow();
  });
});

describe('SEC-41 managed settings', () => {
  it('finds gateway variables in a managed settings env block and ignores blanks and bad JSON', () => {
    expect(
      gatewayVarsInSettings({ env: { ANTHROPIC_BASE_URL: 'https://gw', ANTHROPIC_API_KEY: '' } })
    ).toEqual(['ANTHROPIC_BASE_URL']);
    const files: Record<string, string> = {
      '/m/a.json': JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 't' } }),
      '/m/b.json': '{not json',
    };
    expect(
      managedGatewaySettings(['/m/a.json', '/m/b.json', '/m/none.json'], (p) => files[p])
    ).toEqual([{ path: '/m/a.json', names: ['ANTHROPIC_AUTH_TOKEN'] }]);
  });
});
