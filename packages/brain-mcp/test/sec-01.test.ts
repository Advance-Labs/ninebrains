import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

describe('SEC-01 brain-mcp has no DB access', () => {
  it('shipped sources never import the store, SQLite or migrations, nor read DB/role/mode env', () => {
    const forbidden = [
      /SqliteBrainStore/,
      /InMemoryBrainStore/,
      /openNodeSqliteConnection|nodeSqliteDriver/,
      /node:sqlite|better-sqlite3/,
      /\bMIGRATIONS\b|\bmigrate\(/,
      /executeBrainRequest/,
      /new Brain\(/,
      /NINEBRAINS_(BRAIN_DB|MODE|ROLE)/,
    ];
    const offenders = sources(path.join(packageDir, 'src')).flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return forbidden
        .filter((pattern) => pattern.test(text))
        .map((pattern) => `${path.basename(file)}: ${pattern}`);
    });
    expect(offenders).toEqual([]);
  });

  it('the built bin contains no SQLite code at all', () => {
    const bundle = readFileSync(path.join(packageDir, 'dist', 'bin.mjs'), 'utf8');
    for (const marker of [
      'node:sqlite',
      'DatabaseSync',
      'better-sqlite3',
      'CREATE TABLE jobs',
      'BEGIN IMMEDIATE',
      'brain.sqlite',
    ]) {
      expect(bundle, marker).not.toContain(marker);
    }
  });

  it('declares no SQLite dependency', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(packageDir, 'package.json'), 'utf8')
    ) as Record<string, Record<string, string>>;
    const deps = Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies });
    expect(deps.filter((d) => /sqlite/i.test(d))).toEqual([]);
  });
});
