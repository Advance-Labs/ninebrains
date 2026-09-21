import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const KNOWLEDGE_CONTEXT_FILE_NAME = 'knowledge.md';

/**
 * Providers that load `knowledge.md` (or AGENTS.md) from the project directory as
 * context. Freebuff and Codebuff read these files automatically; they do not read
 * CLAUDE.md, so Emdash mirrors CLI-focused providers' context into knowledge.md.
 */
const CONTEXT_PROVIDERS: ReadonlySet<string> = new Set(['freebuff', 'codebuff']);

export function shouldSeedKnowledgeContext(providerId: string): boolean {
  return CONTEXT_PROVIDERS.has(providerId);
}

export type KnowledgeContextIo = {
  readFile: (filePath: string) => Promise<string | null>;
  exists: (filePath: string) => Promise<boolean>;
  writeFile: (filePath: string, contents: string) => Promise<void>;
};

export const nodeKnowledgeContextIo: KnowledgeContextIo = {
  async readFile(filePath) {
    try {
      return await readFile(filePath, 'utf8');
    } catch {
      return null;
    }
  },
  async exists(filePath) {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  },
  writeFile(filePath, contents) {
    return writeFile(filePath, contents, { mode: 0o600 });
  },
};

export type EnsureKnowledgeContextResult =
  | 'written'
  | 'exists'
  | 'skipped'
  | 'no-source'
  | 'io-error';

export type EnsureKnowledgeContextDeps = {
  providerId: string;
  workspacePath: string;
  io?: KnowledgeContextIo;
  now?: () => string;
};

export type KnowledgeContextSource = {
  fileName: string;
  content: string;
};

const SOURCE_CANDIDATES = ['CLAUDE.md', 'AGENTS.md'] as const;

async function firstExistingSource(
  io: KnowledgeContextIo,
  workspacePath: string
): Promise<KnowledgeContextSource | null> {
  for (const fileName of SOURCE_CANDIDATES) {
    const filePath = join(workspacePath, fileName);
    if (!(await io.exists(filePath))) continue;
    const content = await io.readFile(filePath);
    if (content !== null) return { fileName, content };
  }
  return null;
}

export function renderKnowledgeContext(source: KnowledgeContextSource, header: string): string {
  return `# Project knowledge

> ${header}
> Generated from this repository's \`${source.fileName}\` so the agent loads the same
> project context as Claude. Re-run the agent session to refresh after the source
> file changes; edit this file directly to keep it stable.

${source.content.trimEnd()}
`;
}

/**
 * Best-effort seed of `knowledge.md` for CLI providers that read it from the
 * project directory. Never overwrites an existing file; skips providers that do
 * not consume this file; falls back from CLAUDE.md to AGENTS.md for the seed.
 */
export async function ensureKnowledgeContext({
  providerId,
  workspacePath,
  io = nodeKnowledgeContextIo,
  now = () => new Date().toISOString(),
}: EnsureKnowledgeContextDeps): Promise<EnsureKnowledgeContextResult> {
  if (!shouldSeedKnowledgeContext(providerId)) return 'skipped';
  const target = join(workspacePath, KNOWLEDGE_CONTEXT_FILE_NAME);
  if (await io.exists(target)) return 'exists';
  const source = await firstExistingSource(io, workspacePath);
  if (!source) return 'no-source';
  try {
    await io.writeFile(
      target,
      renderKnowledgeContext(source, `Seeded by Emdash for ${providerId} on ${now()}.`)
    );
    return 'written';
  } catch {
    return 'io-error';
  }
}
