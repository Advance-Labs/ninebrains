// Run: node --test tooling/scripts/sync-labels.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LABELS, planLabels, syncLabels } from './sync-labels.mjs';

const wanted = LABELS.find((label) => label.name === 'run-e2e');

describe('planLabels', () => {
  it('creates missing labels, updates drifted ones and leaves matching ones alone', () => {
    const plan = planLabels(
      [
        { name: 'Security', color: 'B60205', description: LABELS[0].description },
        { name: 'run-e2e', color: '000000', description: 'old' },
      ],
      [LABELS[0], wanted, LABELS[2]]
    );
    assert.deepEqual(plan.map((step) => `${step.action} ${step.label.name}`), [
      'ok security',
      'update run-e2e',
      'create upstream-patch',
    ]);
  });

  it('covers every label the tooling uses', () => {
    assert.deepEqual(
      LABELS.map((label) => label.name).sort(),
      ['dependencies', 'flaky-test', 'release', 'run-e2e', 'security', 'security-reviewed', 'upstream-patch']
    );
  });
});

describe('syncLabels', () => {
  const listing = JSON.stringify([{ name: 'run-e2e', color: '000000', description: 'old' }]);

  it('changes nothing without --apply', () => {
    const calls = [];
    syncLabels({ repo: 'o/r', gh: (args) => (calls.push(args[1]), listing), log: () => {} });
    assert.deepEqual(calls, ['list']);
  });

  it('creates and edits with --apply', () => {
    const calls = [];
    syncLabels({ repo: 'o/r', apply: true, gh: (args) => (calls.push(`${args[1]} ${args[2]}`), listing), log: () => {} });
    assert.equal(calls.filter((c) => c.startsWith('create')).length, LABELS.length - 1);
    assert.deepEqual(calls.filter((c) => c.startsWith('edit')), ['edit run-e2e']);
  });
});
