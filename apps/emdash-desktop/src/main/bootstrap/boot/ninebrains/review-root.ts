/**
 * The parent directory for review checkouts, new on every boot (T34).
 *
 * `mkdtemp` creates a 0700 directory with a random name that did not exist before. A fixed name
 * such as `/tmp/ninebrains-review` does not give that on Linux, where `/tmp` is shared: another
 * local user could create the directory first and own it, or put a file there that blocks boot.
 * The root stays outside `<userData>`, because runCommand denies all of `<userData>` to gate
 * commands (M4). It is realpath-ed, because macOS's tmpdir is a symlink into `/private`.
 */
import { mkdtempSync, realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ReviewRoot {
  readonly path: string;
  /** Removes the root and any checkout still in it. Safe to call twice. */
  dispose(): Promise<void>;
}

export function createReviewRoot(parent: string = tmpdir()): ReviewRoot {
  const path = mkdtempSync(join(realpathSync(parent), 'ninebrains-review-'));
  return { path, dispose: () => rm(path, { recursive: true, force: true }) };
}
