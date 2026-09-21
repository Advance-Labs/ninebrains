import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

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
  /** Appends to a file, creating it and its parent directory when absent. */
  appendFile: (filePath: string, contents: string) => Promise<void>;
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
    return writeFile(filePath, contents);
  },
  async appendFile(filePath, contents) {
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, contents);
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

/** Anchored so only the worktree-root file is ignored, not nested `knowledge.md` files. */
const EXCLUDE_PATTERN = `/${KNOWLEDGE_CONTEXT_FILE_NAME}`;

/**
 * Path of the `info/exclude` file git reads for `workspacePath`, or null outside a repo. A linked
 * worktree's `.git` is a `gitdir:` file, and git reads `info/exclude` from the shared common dir
 * named by that gitdir's `commondir` file, not from the per-worktree gitdir. Resolved with plain
 * reads so seeding never spawns `git`.
 */
export async function resolveGitExcludePath(
  io: KnowledgeContextIo,
  workspacePath: string
): Promise<string | null> {
  const dotGit = join(workspacePath, '.git');
  // readFile returns null for a directory, so a non-null read means a linked worktree.
  const gitFile = await io.readFile(dotGit);
  if (gitFile === null) {
    return (await io.exists(dotGit)) ? join(dotGit, 'info', 'exclude') : null;
  }
  const match = /^gitdir:\s*(.+)$/mu.exec(gitFile);
  if (!match) return null;
  const gitDir = resolve(workspacePath, match[1]!.trim());
  const commonDir = (await io.readFile(join(gitDir, 'commondir')))?.trim();
  const root = commonDir
    ? isAbsolute(commonDir)
      ? commonDir
      : resolve(gitDir, commonDir)
    : gitDir;
  return join(root, 'info', 'exclude');
}

/**
 * Keeps the seeded file out of `git add -A` so agents do not commit a generated copy of the
 * repo's context. `info/exclude` is local to the clone and never committed. Idempotent.
 */
async function excludeFromGit(io: KnowledgeContextIo, workspacePath: string): Promise<void> {
  const excludePath = await resolveGitExcludePath(io, workspacePath);
  if (!excludePath) return;
  const current = (await io.readFile(excludePath)) ?? '';
  if (current.split(/\r?\n/u).some((line) => line.trim() === EXCLUDE_PATTERN)) return;
  const separator = current === '' || current.endsWith('\n') ? '' : '\n';
  await io.appendFile(
    excludePath,
    `${separator}# Seeded by Emdash for Freebuff/Codebuff context\n${EXCLUDE_PATTERN}\n`
  );
}

/**
 * Best-effort seed of `knowledge.md` for CLI providers that read it from the
 * project directory. Never overwrites an existing file; skips providers that do
 * not consume this file; falls back from CLAUDE.md to AGENTS.md for the seed. A written file is
 * added to the repo's `info/exclude`.
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
    // Exclude first: if this fails, no file exists that an agent could commit.
    await excludeFromGit(io, workspacePath);
    await io.writeFile(
      target,
      renderKnowledgeContext(source, `Seeded by Emdash for ${providerId} on ${now()}.`)
    );
    return 'written';
  } catch {
    return 'io-error';
  }
}
