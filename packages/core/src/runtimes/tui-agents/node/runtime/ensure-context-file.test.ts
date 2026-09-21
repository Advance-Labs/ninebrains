import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ensureKnowledgeContext,
  nodeKnowledgeContextIo,
  renderKnowledgeContext,
  resolveGitExcludePath,
  shouldSeedKnowledgeContext,
  type KnowledgeContextIo,
} from './ensure-context-file';

function memoryIo(
  initial: Record<string, string> = {},
  dirs: string[] = []
): KnowledgeContextIo & {
  files: Map<string, string>;
} {
  const files = new Map<string, string>(Object.entries(initial));
  const directories = new Set(dirs);
  return {
    files,
    // Mirrors the node io: reading a directory yields null.
    async readFile(filePath) {
      return files.get(filePath) ?? null;
    },
    async exists(filePath) {
      return files.has(filePath) || directories.has(filePath);
    },
    async writeFile(filePath, contents) {
      files.set(filePath, contents);
    },
    async appendFile(filePath, contents) {
      files.set(filePath, (files.get(filePath) ?? '') + contents);
    },
  };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

describe('ensureKnowledgeContext', () => {
  it('applies only to the freebuff and codebuff providers', () => {
    expect(shouldSeedKnowledgeContext('freebuff')).toBe(true);
    expect(shouldSeedKnowledgeContext('codebuff')).toBe(true);
    expect(shouldSeedKnowledgeContext('claude')).toBe(false);
    expect(shouldSeedKnowledgeContext('opencode')).toBe(false);
  });

  it('skips providers that do not load knowledge.md', async () => {
    const io = memoryIo();
    const result = await ensureKnowledgeContext({
      providerId: 'opencode',
      workspacePath: '/p',
      io,
    });
    expect(result).toBe('skipped');
    expect(io.files.size).toBe(0);
  });

  it('writes knowledge.md from CLAUDE.md when absent (preferred source)', async () => {
    const io = memoryIo({ '/p/CLAUDE.md': '# Claude context' });
    const result = await ensureKnowledgeContext({
      providerId: 'freebuff',
      workspacePath: '/p',
      io,
      now: () => '2026-01-01T00:00:00.000Z',
    });
    expect(result).toBe('written');
    const written = io.files.get('/p/knowledge.md')!;
    expect(written).toContain('# Claude context');
    expect(written).toContain('CLAUDE.md');
    expect(written).toContain('Seeded by Emdash for freebuff on 2026-01-01T00:00:00.000Z');
  });

  it('falls back to AGENTS.md when CLAUDE.md is absent', async () => {
    const io = memoryIo({ '/p/AGENTS.md': '# Repo instructions' });
    const result = await ensureKnowledgeContext({
      providerId: 'codebuff',
      workspacePath: '/p',
      io,
    });
    expect(result).toBe('written');
    expect(io.files.get('/p/knowledge.md')).toContain('# Repo instructions');
  });

  it('reports exists without overwriting an existing knowledge.md', async () => {
    const io = memoryIo({
      '/p/CLAUDE.md': '# Claude context',
      '/p/knowledge.md': '# Hand-written context',
    });
    const result = await ensureKnowledgeContext({
      providerId: 'freebuff',
      workspacePath: '/p',
      io,
    });
    expect(result).toBe('exists');
    expect(io.files.get('/p/knowledge.md')).toBe('# Hand-written context');
  });

  it('reports no-source when the workspace has neither CLAUDE.md nor AGENTS.md', async () => {
    const io = memoryIo();
    const result = await ensureKnowledgeContext({
      providerId: 'freebuff',
      workspacePath: '/p',
      io,
    });
    expect(result).toBe('no-source');
    expect(io.files.has('/p/knowledge.md')).toBe(false);
  });
});

describe('git exclude for the seeded file', () => {
  it('excludes knowledge.md through .git/info/exclude in a plain checkout', async () => {
    const io = memoryIo({ '/p/CLAUDE.md': '# context' }, ['/p/.git']);
    await ensureKnowledgeContext({ providerId: 'freebuff', workspacePath: '/p', io });
    expect(io.files.get('/p/.git/info/exclude')).toContain('\n/knowledge.md\n');
  });

  it('excludes through the common dir of a linked worktree, not the per-worktree gitdir', async () => {
    const io = memoryIo({
      '/wt/CLAUDE.md': '# context',
      '/wt/.git': 'gitdir: /repo/.git/worktrees/wt\n',
      '/repo/.git/worktrees/wt/commondir': '../..\n',
      '/repo/.git/info/exclude': '# existing\n*.log',
    });

    expect(await resolveGitExcludePath(io, '/wt')).toBe('/repo/.git/info/exclude');
    await ensureKnowledgeContext({ providerId: 'codebuff', workspacePath: '/wt', io });

    const exclude = io.files.get('/repo/.git/info/exclude')!;
    expect(exclude.startsWith('# existing\n*.log\n')).toBe(true);
    expect(exclude.split('\n')).toContain('/knowledge.md');
    expect(io.files.has('/repo/.git/worktrees/wt/info/exclude')).toBe(false);
  });

  it('does not repeat an exclude entry that is already present', async () => {
    const io = memoryIo(
      { '/p/CLAUDE.md': '# context', '/p/.git/info/exclude': '/knowledge.md\n' },
      ['/p/.git']
    );
    await ensureKnowledgeContext({ providerId: 'freebuff', workspacePath: '/p', io });
    expect(io.files.get('/p/.git/info/exclude')).toBe('/knowledge.md\n');
  });

  it('still seeds outside a git repository', async () => {
    const io = memoryIo({ '/p/CLAUDE.md': '# context' });
    expect(await resolveGitExcludePath(io, '/p')).toBeNull();
    const result = await ensureKnowledgeContext({
      providerId: 'freebuff',
      workspacePath: '/p',
      io,
    });
    expect(result).toBe('written');
  });

  it('keeps the seeded file out of git status in a real linked worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-knowledge-exclude-'));
    try {
      const repo = join(root, 'repo');
      const worktree = join(root, 'wt');
      execFileSync('git', ['init', '-q', repo]);
      await writeFile(join(repo, 'CLAUDE.md'), '# context\n');
      git(repo, 'add', 'CLAUDE.md');
      git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
      git(repo, 'worktree', 'add', '-q', worktree);

      const result = await ensureKnowledgeContext({
        providerId: 'freebuff',
        workspacePath: worktree,
        io: nodeKnowledgeContextIo,
      });

      expect(result).toBe('written');
      await expect(readFile(join(worktree, 'knowledge.md'), 'utf8')).resolves.toContain(
        '# context'
      );
      expect(git(worktree, 'status', '--porcelain')).toBe('');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('renderKnowledgeContext', () => {
  it('annotates the generated file and keeps the source content', () => {
    const rendered = renderKnowledgeContext(
      { fileName: 'CLAUDE.md', content: 'line 1\nline 2\n\n' },
      'Seeded by Emdash for freebuff on 2026-01-01.'
    );
    expect(rendered).toContain('# Project knowledge');
    expect(rendered).toContain('Seeded by Emdash for freebuff on 2026-01-01.');
    expect(rendered).toContain('CLAUDE.md');
    expect(rendered).toContain('line 1\nline 2');
    expect(rendered.trimEnd()).not.toMatch(/\n\s*\n+$/u);
  });
});
