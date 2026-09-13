import { describe, expect, it } from 'vitest';
import {
  baseUrlProblem,
  modelProfileInputSchema,
  profileKindSchema,
  type ModelProfileInput,
} from './profile';
import { resolveSubagentModel, subagentModelSchema } from './subagent-model';

describe('SEC-44 allowed credential kinds and vendors', () => {
  it.each(['oauth', 'cookie', 'session', 'token-file', 'claude-ai'])(
    'rejects the %s kind',
    (kind) => {
      expect(profileKindSchema.safeParse(kind).success).toBe(false);
    }
  );

  it.each([
    ['https://claude.ai/api', 'anthropic-api'],
    ['https://sub.claude.ai/api', 'anthropic-api'],
    ['https://chatgpt.com/backend-api', 'openai-api'],
    ['https://chat.openai.com/backend-api', 'openai-api'],
  ] as const)('baseUrlProblem rejects the login host %s', (url, kind) => {
    expect(baseUrlProblem(url, kind)).toMatch(/login/);
  });

  it('rejects http for a remote kind', () => {
    expect(baseUrlProblem('http://api.anthropic.com', 'anthropic-api')).toMatch(/https/);
  });

  it('rejects a user name and password in the URL', () => {
    expect(baseUrlProblem('https://user:pass@api.anthropic.com', 'anthropic-api')).toMatch(
      /user name or password/
    );
  });

  it('rejects a query string', () => {
    expect(baseUrlProblem('https://api.anthropic.com?x=1', 'anthropic-api')).toMatch(
      /query or fragment/
    );
  });

  it('rejects a fragment', () => {
    expect(baseUrlProblem('https://api.anthropic.com#frag', 'anthropic-api')).toMatch(
      /query or fragment/
    );
  });

  it('rejects loopback for a remote kind', () => {
    expect(baseUrlProblem('https://127.0.0.1:8443', 'anthropic-api')).toMatch(/this machine/);
  });

  it('rejects a non-loopback host for a local profile', () => {
    expect(baseUrlProblem('http://example.com:11434', 'local')).toMatch(/must be on this machine/);
  });

  it('accepts loopback http for a local profile', () => {
    expect(baseUrlProblem('http://127.0.0.1:11434', 'local')).toBeNull();
  });
});

describe('modelProfileInputSchema', () => {
  const base: ModelProfileInput = {
    label: 'A profile',
    kind: 'anthropic-api',
    vendorId: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
  };

  it('requires a vendorId for a remote kind', () => {
    const { vendorId: _drop, ...withoutVendor } = base;
    const parsed = modelProfileInputSchema.safeParse(withoutVendor);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.includes('vendorId'))).toBe(true);
    }
  });

  it('requires a protocol for a local kind', () => {
    const parsed = modelProfileInputSchema.safeParse({
      label: 'Local',
      kind: 'local',
      baseUrl: 'http://127.0.0.1:11434',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.includes('protocol'))).toBe(true);
    }
  });

  it('rejects a protocol that contradicts the kind', () => {
    const parsed = modelProfileInputSchema.safeParse({
      ...base,
      protocol: 'openai-responses',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.includes('protocol'))).toBe(true);
    }
  });

  it('accepts a well-formed remote profile with no protocol given', () => {
    expect(modelProfileInputSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a well-formed local profile naming its protocol', () => {
    const parsed = modelProfileInputSchema.safeParse({
      label: 'Local',
      kind: 'local',
      protocol: 'anthropic',
      baseUrl: 'http://127.0.0.1:11434',
    });
    expect(parsed.success).toBe(true);
  });
});

describe('subagentModelSchema', () => {
  it.each(['haiku', 'claude-sonnet-5[1m]'])('accepts %s', (value) => {
    expect(subagentModelSchema.safeParse(value).success).toBe(true);
  });

  it.each(['a b', 'x\ny'])('rejects %s', (value) => {
    expect(subagentModelSchema.safeParse(value).success).toBe(false);
  });
});

describe('resolveSubagentModel', () => {
  it('prefers the lane over the role', () => {
    expect(resolveSubagentModel('opus', 'haiku')).toBe('opus');
  });

  it('falls back to the role when the lane has none', () => {
    expect(resolveSubagentModel(undefined, 'haiku')).toBe('haiku');
  });

  it('emits nothing when the lane is explicitly inherit', () => {
    expect(resolveSubagentModel('inherit', 'haiku')).toBeUndefined();
  });

  it('emits nothing when both are inherit or absent', () => {
    expect(resolveSubagentModel(undefined, undefined)).toBeUndefined();
    expect(resolveSubagentModel('inherit', undefined)).toBeUndefined();
  });
});
