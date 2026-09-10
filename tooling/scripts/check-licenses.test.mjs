import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateLicenses,
  fromPnpmLicensesJson,
  loadExceptions,
  validateExceptions,
} from './check-licenses.mjs';

const pkg = (name, license, version = '1.0.0') => ({ name, version, license });
const rules = (result) => result.violations.map((v) => `${v.name}:${v.rule}`);

test('rejects tldraw even though its npm licence field is permissive', () => {
  const result = evaluateLicenses({ production: [pkg('tldraw', 'MIT')] });
  assert.deepEqual(rules(result), ['tldraw:blocked-package']);
});

test('rejects a scoped @tldraw package found only in the installed (dev) tree', () => {
  const result = evaluateLicenses({ installed: [pkg('@tldraw/editor', 'MIT')] });
  assert.deepEqual(rules(result), ['@tldraw/editor:blocked-package']);
});

test('rejects every other blocklisted package name', () => {
  const names = ['remotion', '@remotion/player', 'task-master-ai', 'mcp_agent_mail'];
  const result = evaluateLicenses({ installed: names.map((name) => pkg(name, 'MIT')) });
  assert.deepEqual(
    rules(result),
    names.map((name) => `${name}:blocked-package`)
  );
});

test('an exception can never unblock a blocklisted package', () => {
  const data = {
    exceptions: [{ package: 'tldraw', license: 'MIT', reason: 'we want it for the whiteboard' }],
  };
  assert.throws(() => validateExceptions(data), /blocklist/);
});

test('rejects copyleft and source-available licences in any scope, even with an exception', () => {
  const exceptions = validateExceptions({
    exceptions: [{ package: 'strong-copyleft', license: 'AGPL-3.0', reason: 'pretend reviewer said yes' }],
  });
  const result = evaluateLicenses(
    {
      production: [pkg('strong-copyleft', 'AGPL-3.0')],
      installed: [
        pkg('gpl-tool', 'GPL-3.0-or-later'),
        pkg('sspl-db', 'SSPL-1.0'),
        pkg('elastic', 'Elastic-2.0'),
        pkg('busl', 'BUSL-1.1'),
        pkg('clause', 'MIT AND Commons-Clause'),
      ],
    },
    exceptions
  );
  assert.deepEqual(rules(result), [
    'strong-copyleft:forbidden-license',
    'gpl-tool:forbidden-license',
    'sspl-db:forbidden-license',
    'elastic:forbidden-license',
    'busl:forbidden-license',
    'clause:forbidden-license',
  ]);
});

test('LGPL and Boost are not forbidden; LGPL still needs a reviewed exception in production', () => {
  const result = evaluateLicenses({
    production: [pkg('lgpl-binary', 'LGPL-3.0-or-later'), pkg('boost', 'BSL-1.0')],
    installed: [pkg('lgpl-dev', 'LGPL-2.1')],
  });
  assert.deepEqual(rules(result), ['lgpl-binary:not-allowlisted', 'boost:not-allowlisted']);
});

test('evaluates SPDX OR / AND expressions and common non-SPDX spellings', () => {
  const result = evaluateLicenses({
    production: [
      pkg('dual', '(MIT OR WTFPL)'),
      pkg('triple', '(BSD-2-Clause OR MIT OR Apache-2.0)'),
      pkg('choose-mit', '(MIT OR GPL-3.0)'),
      pkg('alias', 'Apache 2.0'),
      pkg('with', 'Apache-2.0 WITH LLVM-exception'),
      pkg('both-needed', '(MIT AND OFL-1.1)'),
      pkg('stuck-with-gpl', '(MIT AND GPL-3.0)'),
    ],
  });
  assert.deepEqual(rules(result), [
    'both-needed:not-allowlisted',
    'stuck-with-gpl:forbidden-license',
  ]);
});

test('an exception matches only the reviewed licence string', () => {
  const exceptions = validateExceptions({
    exceptions: [{ package: 'font', license: 'OFL-1.1', reason: 'font files, redistribution allowed' }],
  });
  const reviewed = evaluateLicenses({ production: [pkg('font', 'OFL-1.1')] }, exceptions);
  assert.deepEqual(reviewed.violations, []);
  assert.deepEqual(reviewed.unusedExceptions, []);

  const changed = evaluateLicenses({ production: [pkg('font', 'CC-BY-NC-4.0')] }, exceptions);
  assert.deepEqual(rules(changed), ['font:not-allowlisted']);
  assert.equal(changed.unusedExceptions.length, 1);
});

test('exceptions must carry a written reason', () => {
  assert.throws(
    () => validateExceptions({ exceptions: [{ package: 'x', license: 'OFL-1.1', reason: 'ok' }] }),
    /written reason/
  );
  assert.throws(() => validateExceptions({}), /exceptions/);
});

test('the committed allowlist-exceptions.json is valid', () => {
  const exceptions = loadExceptions();
  assert.ok(exceptions.length > 0);
});

test('surfaces pnpm errors instead of reporting an empty tree', () => {
  assert.throws(
    () => fromPnpmLicensesJson({ error: { code: 'ERR', message: 'boom' } }),
    /pnpm licenses list failed: boom/
  );
  assert.deepEqual(
    fromPnpmLicensesJson({ MIT: [{ name: 'a', versions: ['1.0.0', '2.0.0'], license: 'MIT' }] }),
    [pkg('a', 'MIT', '1.0.0'), pkg('a', 'MIT', '2.0.0')]
  );
});
