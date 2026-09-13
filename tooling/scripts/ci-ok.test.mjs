// Run: node --test tooling/scripts/ci-ok.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluate } from './ci-ok.mjs';

const lists = { required: ['static', 'test-node'], optional: ['pr-hygiene', 'e2e'] };
const needs = (results) =>
  Object.fromEntries(Object.entries(results).map(([job, result]) => [job, { result }]));

describe('ci-ok', () => {
  it('is green when required jobs pass and optional ones pass or skip', () => {
    const results = needs({ static: 'success', 'test-node': 'success', 'pr-hygiene': 'success', e2e: 'skipped' });
    assert.deepEqual(evaluate(results, lists), []);
  });

  it('fails when a required job fails, is cancelled or is skipped', () => {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      const results = needs({ static: result, 'test-node': 'success', 'pr-hygiene': 'skipped', e2e: 'skipped' });
      assert.deepEqual(evaluate(results, lists), [`static: ${result} (required)`]);
    }
  });

  it('fails when an optional job ran and did not pass', () => {
    const results = needs({ static: 'success', 'test-node': 'success', 'pr-hygiene': 'failure', e2e: 'cancelled' });
    assert.deepEqual(evaluate(results, lists), ['pr-hygiene: failure', 'e2e: cancelled']);
  });

  it('fails a required or optional job that is missing from needs (workflow drift)', () => {
    const results = needs({ 'test-node': 'success', 'pr-hygiene': 'skipped' });
    assert.deepEqual(evaluate(results, lists), ['static: missing (required)', 'e2e: missing']);
  });

  it('fails a job the workflow added without classifying it', () => {
    const results = needs({
      static: 'success',
      'test-node': 'success',
      'pr-hygiene': 'skipped',
      e2e: 'skipped',
      lint2: 'success',
    });
    assert.deepEqual(evaluate(results, lists), ['lint2: not classified as required or optional']);
  });
});
