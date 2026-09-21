import { describe, expect, it } from 'vitest';
import {
  ensureKnowledgeContext,
  renderKnowledgeContext,
  shouldSeedKnowledgeContext,
  type KnowledgeContextIo,
} from './ensure-context-file';

function memoryIo(initial: Record<string, string> = {}): KnowledgeContextIo & {
  files: Map<string, string>;
} {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    async readFile(filePath) {
      return files.get(filePath) ?? null;
    },
    async exists(filePath) {
      return files.has(filePath);
    },
    async writeFile(filePath, contents) {
      files.set(filePath, contents);
    },
  };
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
