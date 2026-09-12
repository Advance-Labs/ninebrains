// Run: node --test tooling/scripts/nx-affected.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldRun } from './nx-affected.mjs';

describe('shouldRun', () => {
  const affected = () => ['@emdash/core', '@emdash/emdash-desktop'];

  it('runs an affected project and skips an unaffected one', () => {
    assert.equal(shouldRun({ project: '@emdash/emdash-desktop', scope: 'affected', affected }), true);
    assert.equal(shouldRun({ project: '@emdash/chat-ui', scope: 'affected', affected }), false);
  });

  it('runs everything on a full run without asking Nx', () => {
    const never = () => assert.fail('nx must not be asked on a full run');
    assert.equal(shouldRun({ project: '@emdash/chat-ui', scope: 'run-many --all', affected: never }), true);
  });
});
