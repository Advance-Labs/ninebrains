import { describe, expect, it } from 'vitest';
import { isLoginHost } from '../api/profile';
import { VENDORS, vendorProblem } from './vendors';
import vendorsJson from './vendors.json';

describe('SEC-44 vendor allowlist', () => {
  it('accepts OpenRouter on its own host with the anthropic-compatible kind', () => {
    const problem = vendorProblem({
      kind: 'anthropic-compatible',
      vendorId: 'openrouter',
      protocol: 'anthropic',
      baseUrl: 'https://openrouter.ai/api',
    });
    expect(problem).toBeNull();
  });

  it('rejects a host off the vendor allowlist', () => {
    const problem = vendorProblem({
      kind: 'anthropic-compatible',
      vendorId: 'openrouter',
      protocol: 'anthropic',
      baseUrl: 'https://evil.test/api',
    });
    expect(problem).toMatch(/must use/);
  });

  it('rejects a kind the named vendor does not offer', () => {
    const problem = vendorProblem({
      kind: 'anthropic-api',
      vendorId: 'openrouter',
      protocol: 'anthropic',
      baseUrl: 'https://openrouter.ai/api',
    });
    expect(problem).toMatch(/is not a anthropic-api vendor/);
  });

  it('rejects an unknown vendor id', () => {
    const problem = vendorProblem({
      kind: 'anthropic-api',
      vendorId: 'not-a-real-vendor',
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
    });
    expect(problem).toMatch(/names no reviewed vendor/);
  });

  it('parses every vendors.json entry', () => {
    expect(VENDORS.length).toBe(vendorsJson.vendors.length);
  });

  it('lowercases every vendor host', () => {
    for (const vendor of VENDORS) {
      for (const host of vendor.hosts) {
        expect(host).toBe(host.toLowerCase());
      }
    }
  });

  it('never lists a consumer login host as a vendor host', () => {
    for (const vendor of VENDORS) {
      for (const host of vendor.hosts) {
        expect(isLoginHost(host)).toBe(false);
      }
    }
  });

  it('needs no vendor for a local profile', () => {
    const problem = vendorProblem({
      kind: 'local',
      vendorId: null,
      protocol: 'anthropic',
      baseUrl: 'http://127.0.0.1:11434',
    });
    expect(problem).toBeNull();
  });
});
