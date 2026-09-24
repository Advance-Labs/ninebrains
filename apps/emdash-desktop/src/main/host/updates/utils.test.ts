import { describe, expect, it } from 'vitest';
import { formatUpdaterError } from './utils';

describe('formatUpdaterError', () => {
  it('describes a real HTTP failure as one', () => {
    expect(formatUpdaterError(Object.assign(new Error('nope'), { statusCode: 503 }))).toBe(
      'Update request failed with HTTP 503'
    );
  });

  // The regression: `err.code` used to be folded in with `statusCode`, so an `fs.rm` failure
  // during an in-place install was logged as "Update request failed with HTTP ENOTEMPTY" —
  // sending a filesystem bug's diagnosis straight at the network.
  it('does not call a filesystem error code an HTTP status', () => {
    const error = Object.assign(
      new Error("ENOTEMPTY: directory not empty, rmdir '/Applications/.ninebrains-rollback-x'"),
      { code: 'ENOTEMPTY' }
    );
    const message = formatUpdaterError(error);
    expect(message).not.toContain('HTTP');
    expect(message).toContain('ENOTEMPTY');
    expect(message).toContain('rmdir');
  });

  it('prefixes a bare code-only error with its code', () => {
    expect(formatUpdaterError(Object.assign(new Error('write failed'), { code: 'EACCES' }))).toBe(
      'EACCES: write failed'
    );
  });

  it('falls back to the message when there is no code or status', () => {
    expect(formatUpdaterError(new Error('plain failure'))).toBe('plain failure');
  });
});
