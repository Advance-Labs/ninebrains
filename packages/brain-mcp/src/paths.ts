import { realpathSync } from 'node:fs';
import path from 'node:path';
import { InvalidInputError, LIMITS } from '@ninebrains/brain-core';

/**
 * Resolves an agent-supplied attachment path and proves it stays inside an
 * allowed root (the project dir or the app evidence dir). Relative paths are
 * resolved against the first root. The file must exist: both the file and
 * the roots are canonicalized with realpath, so `..` segments and symlinks
 * cannot point outside.
 */
export function resolveAttachmentPath(input: string, roots: readonly string[]): string {
  if (input.length === 0 || input.length > LIMITS.pathChars) {
    throw new InvalidInputError(`attachment path must be 1-${LIMITS.pathChars} characters`);
  }
  if (input.includes('\0')) throw new InvalidInputError('attachment path contains a NUL byte');
  if (roots.length === 0) {
    throw new InvalidInputError('attachments are disabled: no project or evidence directory is configured');
  }

  const candidate = path.resolve(roots[0]!, input);
  let real: string;
  try {
    real = realpathSync(candidate);
  } catch {
    throw new InvalidInputError(`attachment ${input} does not exist`);
  }
  const allowed = roots.some((root) => isInside(real, canonical(root)));
  if (!allowed) throw new InvalidInputError(`attachment ${input} is outside the project and evidence directories`);
  return real;
}

function canonical(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    return path.resolve(root);
  }
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
