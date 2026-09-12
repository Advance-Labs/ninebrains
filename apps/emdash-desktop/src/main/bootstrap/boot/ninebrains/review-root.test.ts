import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createReviewRoot } from './review-root';

const parent = mkdtempSync(join(tmpdir(), 'nb-review-root-'));
afterAll(() => rmSync(parent, { recursive: true, force: true }));

describe('T34 review root', () => {
  it('is a new 0700 directory on every call, whatever squats the old fixed name', async () => {
    // Another user's file at the old fixed path used to block boot.
    writeFileSync(join(parent, 'ninebrains-review'), 'squatter');
    const a = createReviewRoot(parent);
    const b = createReviewRoot(parent);
    try {
      expect(a.path).not.toBe(b.path);
      expect(dirname(a.path)).toBe(realpathSync(parent));
      expect(basename(a.path)).toMatch(/^ninebrains-review-.{6}$/);
      if (process.platform !== 'win32') {
        expect(statSync(a.path).mode & 0o777).toBe(0o700);
        expect(statSync(a.path).uid).toBe(process.getuid?.());
      }
    } finally {
      await b.dispose();
    }

    mkdirSync(join(a.path, 'nb-review-x', 'checkout'), { recursive: true });
    writeFileSync(join(a.path, 'nb-review-x', 'checkout', 'left.txt'), 'x');
    await a.dispose();
    expect(existsSync(a.path)).toBe(false);
    expect(existsSync(b.path)).toBe(false);
    await a.dispose(); // idempotent
  });
});
