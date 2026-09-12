import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createBoundExec } from '#services/exec/api';
import { makeHostileRepo } from '#services/exec/node/hardened-git.test-fixtures';
import { createRegistryGitContext } from './git-context';
import { inspectWorkspacePath } from './inspect-path';

let temporaryDirectory: string | undefined;

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

describe('createRegistryGitContext environment', () => {
  it('loads the current environment and composes non-interactive overrides per spawn', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'emdash-registry-git-env-'));
    const binDirectory = path.join(temporaryDirectory, 'bin');
    await mkdir(binDirectory);
    await writeFile(
      path.join(binDirectory, 'git'),
      '#!/bin/sh\nprintf "%s|%s|%s" "$EMDASH_ENV_REVISION" "$LC_ALL" "$GIT_TERMINAL_PROMPT"\n'
    );
    await chmod(path.join(binDirectory, 'git'), 0o755);
    let env = { PATH: binDirectory, EMDASH_ENV_REVISION: 'before-refresh' };
    const git = createRegistryGitContext({ env: async () => env });

    const before = await git.exec(temporaryDirectory).exec(['version']);
    env = { PATH: binDirectory, EMDASH_ENV_REVISION: 'after-refresh' };
    const after = await git.exec(temporaryDirectory).exec(['version']);

    expect(before.stdout).toBe('before-refresh|C|0');
    expect(after.stdout).toBe('after-refresh|C|0');
  });
});

describe('T36 registry git hardening (real git)', () => {
  it('scan reads run no fsmonitor, filter or lazy fetch; app writes run no hooks or ssh', async () => {
    const h = makeHostileRepo();
    try {
      const exec = createRegistryGitContext({ env: async () => h.env }).exec(h.repo);
      await exec.exec(['status', '--porcelain=v1', '--untracked-files=all', '-z']);
      await exec.exec(['diff', '--numstat', 'HEAD', '--']);
      await expect(exec.exec(['cat-file', '-p', 'HEAD:b.txt'])).rejects.toThrow();
      await exec.exec(['branch', 'app-branch']); // reference-transaction hook
      await expect(exec.exec(['fetch', 'origin'], { timeoutMs: 30_000 })).rejects.toThrow();
      expect(h.ran()).toEqual([]);

      // Control: plain git runs every planted path.
      const plain = createBoundExec({ file: 'git', cwd: h.repo, env: h.env });
      await plain.exec(['status', '--porcelain']);
      await plain.exec(['branch', 'plain-branch']);
      await plain.exec(['fetch', 'origin']).catch(() => undefined);
      expect(h.ran()).toEqual(
        expect.arrayContaining(['filter', 'fsmonitor', 'hook-reference-transaction', 'ssh'])
      );
    } finally {
      h.dispose();
    }
  }, 60_000);

  it('inspectWorkspacePath runs git with the read hardening', async () => {
    const h = makeHostileRepo();
    try {
      const bin = path.join(h.root, 'bin');
      const log = path.join(h.root, 'env.log');
      await mkdir(bin);
      const realGit = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
      await writeFile(
        path.join(bin, 'git'),
        `#!/bin/sh\nenv | grep -E '^GIT_(CONFIG_|NO_LAZY)' >> '${log}'\nexec '${realGit}' "$@"\n`
      );
      await chmod(path.join(bin, 'git'), 0o755);
      const inspection = await inspectWorkspacePath(h.repo, async () => ({
        ...h.env,
        PATH: `${bin}${path.delimiter}${h.env.PATH ?? ''}`,
      }));
      expect(inspection).toEqual({ kind: 'repository' });
      const lines = (await readFile(log, 'utf8')).split('\n');
      expect(lines).toEqual(
        expect.arrayContaining([
          'GIT_NO_LAZY_FETCH=1',
          'GIT_CONFIG_KEY_0=core.fsmonitor',
          'GIT_CONFIG_VALUE_0=false',
          'GIT_CONFIG_KEY_1=core.hooksPath',
        ])
      );
    } finally {
      h.dispose();
    }
  });
});
