import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { assertSafeId, resolveRunCwd, runPaths } from './run-paths';

const root = mkdtempSync(join(tmpdir(), 'nb-run-paths-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('SEC-14 ids cannot traverse', () => {
  it.each(['..', '.', 'a:b', 'a/b', 'a\\b', '', 'x'.repeat(65)])('rejects %j', (id) => {
    expect(() => assertSafeId(id)).toThrow(/Unsafe/);
  });

  it('builds run paths only from safe ids', () => {
    expect(runPaths('/ud', 'run_1-a').transcript).toBe('/ud/ninebrains/runs/run_1-a.jsonl');
    expect(() => runPaths('/ud', '../x')).toThrow();
  });
});

describe('SEC-31 unattended scope', () => {
  const worktrees = join(root, 'worktrees');
  const lane = join(worktrees, 'lane-a');
  const outside = join(root, 'elsewhere');
  mkdirSync(lane, { recursive: true });
  mkdirSync(outside, { recursive: true });

  it('accepts a worktree inside an allowed root and returns its realpath', async () => {
    await expect(resolveRunCwd(lane, [worktrees])).resolves.toBe(realpathSync(lane));
  });

  it('refuses a path outside every root, the root itself, and a relative path', async () => {
    await expect(resolveRunCwd(outside, [worktrees])).rejects.toThrow(/not inside/);
    await expect(resolveRunCwd(worktrees, [worktrees])).rejects.toThrow(/not inside/);
    await expect(resolveRunCwd('lane-a', [worktrees])).rejects.toThrow(/absolute/);
  });

  it('refuses a symlinked root', async () => {
    const link = join(root, 'linked-root');
    symlinkSync(worktrees, link);
    await expect(resolveRunCwd(join(link, 'lane-a'), [link])).rejects.toThrow(/not inside/);
  });

  it('refuses a worktree that is a symlink out of the root', async () => {
    const escape = join(worktrees, 'escape');
    symlinkSync(outside, escape);
    await expect(resolveRunCwd(escape, [worktrees])).rejects.toThrow(/not inside/);
  });
});

describe('T43 exactRootsAllowed: a run at its own single-owner root', () => {
  const roots = join(root, 't42-roots');
  const checkoutRoot = join(roots, 'checkouts');
  const laneRoot = join(roots, 'lane-b');
  const sibling = join(roots, 'lane-c');
  const escape = join(root, 't42-elsewhere');
  mkdirSync(checkoutRoot, { recursive: true });
  mkdirSync(laneRoot, { recursive: true });
  mkdirSync(sibling, { recursive: true });
  mkdirSync(escape, { recursive: true });

  it('allows a cwd exactly at a root listed in exactRootsAllowed (its own lane worktree)', async () => {
    await expect(resolveRunCwd(laneRoot, [laneRoot, checkoutRoot], [laneRoot])).resolves.toBe(
      realpathSync(laneRoot)
    );
  });

  it('still refuses a shared root exactly, even when other roots allow it', async () => {
    await expect(resolveRunCwd(checkoutRoot, [laneRoot, checkoutRoot], [laneRoot])).rejects.toThrow(
      /not inside/
    );
  });

  it('still refuses a sibling root that was never listed', async () => {
    await expect(resolveRunCwd(sibling, [laneRoot, checkoutRoot], [laneRoot])).rejects.toThrow(
      /not inside/
    );
  });

  it('still refuses an escape outside every root', async () => {
    await expect(resolveRunCwd(escape, [laneRoot, checkoutRoot], [laneRoot])).rejects.toThrow(
      /not inside/
    );
  });
});
