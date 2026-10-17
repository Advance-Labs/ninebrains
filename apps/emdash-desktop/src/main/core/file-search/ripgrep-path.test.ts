import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveBundledRipgrepPath } from './ripgrep-path';

describe('resolveBundledRipgrepPath', () => {
  let resources: string | undefined;
  afterEach(() => {
    if (resources) rmSync(resources, { recursive: true, force: true });
    resources = undefined;
  });

  function withBundledBinary(name: string): string {
    resources = mkdtempSync(path.join(tmpdir(), 'rg-resources-'));
    mkdirSync(path.join(resources, 'ripgrep'));
    writeFileSync(path.join(resources, 'ripgrep', name), '');
    chmodSync(path.join(resources, 'ripgrep', name), 0o755);
    return resources;
  }

  it('finds the binary packaging put in Resources', () => {
    const dir = withBundledBinary('rg');
    expect(resolveBundledRipgrepPath(dir, 'darwin')).toBe(path.join(dir, 'ripgrep', 'rg'));
  });

  it('uses rg.exe on Windows', () => {
    const dir = withBundledBinary('rg.exe');
    expect(resolveBundledRipgrepPath(dir, 'win32')).toBe(path.join(dir, 'ripgrep', 'rg.exe'));
  });

  it('falls back to PATH when nothing is bundled', () => {
    resources = mkdtempSync(path.join(tmpdir(), 'rg-resources-'));
    expect(resolveBundledRipgrepPath(resources, 'darwin')).toBeUndefined();
    expect(resolveBundledRipgrepPath(undefined, 'darwin')).toBeUndefined();
  });
});
