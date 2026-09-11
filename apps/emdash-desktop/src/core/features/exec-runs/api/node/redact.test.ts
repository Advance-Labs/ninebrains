import { describe, expect, it } from 'vitest';
import { createRedactor, describeEnvForTranscript } from './redact';

describe('SEC-35 transcript redactor', () => {
  const redact = createRedactor(['nb-live-token-0123456789', 'short']);

  it.each([
    ['sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123'],
    ['sk-proj-abcdefghijklmnopqrstuvwxyz'],
    ['ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['github_pat_11ABCDEFG0123456789_abcdefghijklmnop'],
    ['AKIAABCDEFGHIJKLMNOP'],
    ['xoxb-1234567890-abcdefghijklmnop'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcdefghijklmnop'],
    ['Bearer abcdefghijklmnop0123'],
    ['-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----'],
    ['nb-live-token-0123456789'],
  ])('removes %s', (secret) => {
    const out = redact(JSON.stringify({ type: 'user', text: `value: ${secret} end` }));
    expect(out).not.toContain(secret);
    expect(out).toMatch(/REDACTED/);
  });

  it('ignores literal values too short to be safe to match', () => {
    expect(redact('a short word')).toBe('a short word');
  });

  it('dumps env names, with values only for known-safe keys', () => {
    expect(
      describeEnvForTranscript({
        PATH: '/bin',
        ANTHROPIC_API_KEY: 'sk-ant-x',
        CLAUDE_CONFIG_DIR: '/a',
      })
    ).toEqual({ ANTHROPIC_API_KEY: '[REDACTED]', CLAUDE_CONFIG_DIR: '/a', PATH: '/bin' });
  });
});
