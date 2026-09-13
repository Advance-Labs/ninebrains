import { describe, expect, it } from 'vitest';
import { buildUnattendedEnv } from './run-env';

const POLLUTED = {
  PATH: '/usr/bin',
  HOME: '/home/u',
  ANTHROPIC_BASE_URL: 'https://parent-gateway.example',
  ANTHROPIC_AUTH_TOKEN: 'parent-token-should-not-leak',
  ANTHROPIC_DEFAULT_SONNET_MODEL: 'parent-sonnet-alias',
  CLAUDE_CODE_SUBAGENT_MODEL: 'parent-subagent-model',
  CLAUDE_CODE_ENTRYPOINT: 'parent-cli',
  NB_MODEL_KEY: 'parent-model-key-should-not-leak',
};

describe('SEC-13 routing env comes only from the route', () => {
  it('carries none of the parent env routing variables when no route is given', () => {
    const env = buildUnattendedEnv(POLLUTED, { provider: 'claude', platform: 'posix' });
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBeUndefined();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(env.NB_MODEL_KEY).toBeUndefined();
  });

  it('passes exactly the routing env the route provides', () => {
    const env = buildUnattendedEnv(POLLUTED, {
      provider: 'claude',
      platform: 'posix',
      routing: {
        ANTHROPIC_BASE_URL: 'https://x',
        ANTHROPIC_AUTH_TOKEN: 'tok-12345678',
        CLAUDE_CODE_SUBAGENT_MODEL: 'haiku',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      },
    });
    expect(env.ANTHROPIC_BASE_URL).toBe('https://x');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('tok-12345678');
    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('haiku');
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
  });

  it('drops a routing variable set to an empty string', () => {
    const env = buildUnattendedEnv(POLLUTED, {
      provider: 'claude',
      platform: 'posix',
      routing: { ANTHROPIC_BASE_URL: '' },
    });
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it('an empty routing value also drops the same-named auth variable', () => {
    const env = buildUnattendedEnv(POLLUTED, {
      provider: 'claude',
      platform: 'posix',
      auth: { ANTHROPIC_API_KEY: 'sk-ant-parent-chosen-key' },
      routing: { ANTHROPIC_API_KEY: '' },
    });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('still throws for CLAUDE_CODE_ENTRYPOINT arriving through routing', () => {
    expect(() =>
      buildUnattendedEnv(POLLUTED, {
        provider: 'claude',
        platform: 'posix',
        routing: { CLAUDE_CODE_ENTRYPOINT: 'cli' },
      })
    ).toThrow(/CLAUDE_CODE_ENTRYPOINT/);
  });

  it('does not throw for the two route-exempt CLAUDE_CODE_* names', () => {
    expect(() =>
      buildUnattendedEnv(POLLUTED, {
        provider: 'claude',
        platform: 'posix',
        routing: {
          CLAUDE_CODE_SUBAGENT_MODEL: 'opus',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        },
      })
    ).not.toThrow();
  });
});
