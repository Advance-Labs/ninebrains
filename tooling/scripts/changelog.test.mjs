// Run: node --test tooling/scripts/changelog.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bumpPackageVersion,
  canaryNotes,
  extractSection,
  HEADER,
  insertRelease,
  parseSubject,
  prepareRelease,
  renderCommits,
} from './changelog.mjs';

const c = (subject, body = '', sha = 'abcdef1234567890') => ({ sha, subject, body });

describe('parseSubject', () => {
  it('reads type, scope, bang and description', () => {
    assert.deepEqual(parseSubject('feat(lanes)!: new grid (#12)'), {
      type: 'feat',
      scope: 'lanes',
      breaking: true,
      description: 'new grid (#12)',
    });
    assert.equal(parseSubject('Merge branch main'), null);
  });
});

describe('renderCommits', () => {
  it('groups by type, puts breaking changes first and drops internal types', () => {
    const text = renderCommits([
      c('feat(lanes): grid'),
      c('fix: crash on empty pid'),
      c('chore: tidy'),
      c('ci: new workflow'),
      c('refactor(core)!: rename api'),
      c('feat: old flag gone', 'BREAKING CHANGE: the flag is removed'),
    ]);
    assert.equal(
      text,
      [
        '### Breaking changes',
        '',
        '- **core:** rename api (abcdef1)',
        '- old flag gone (abcdef1)',
        '',
        '### Features',
        '',
        '- **lanes:** grid (abcdef1)',
        '',
        '### Fixes',
        '',
        '- crash on empty pid (abcdef1)',
      ].join('\n')
    );
  });
});

describe('sections', () => {
  const changelog = `${HEADER}\nHand note.\n\n## [0.1.0] - 2026-09-01\n\n### Fixes\n\n- a (1234567)\n`;

  it('extracts a section body up to the next heading', () => {
    assert.equal(extractSection(changelog, 'Unreleased'), 'Hand note.');
    assert.equal(extractSection(changelog, '0.1.0'), '### Fixes\n\n- a (1234567)');
    assert.equal(extractSection(changelog, '9.9.9'), null);
  });

  it('inserts the release under an emptied Unreleased and keeps older releases', () => {
    const next = insertRelease(changelog, { version: '0.2.0', date: '2026-09-12', body: 'Body.' });
    assert.equal(extractSection(next, 'Unreleased'), '');
    assert.equal(extractSection(next, '0.2.0'), 'Body.');
    assert.equal(extractSection(next, '0.1.0'), '### Fixes\n\n- a (1234567)');
    assert.ok(next.indexOf('## [0.2.0]') < next.indexOf('## [0.1.0]'));
  });

  it('creates the file from scratch', () => {
    const next = insertRelease('', { version: '0.1.0', date: '2026-09-12', body: '' });
    assert.ok(next.startsWith('# Changelog'));
    assert.equal(extractSection(next, '0.1.0'), '_No user-facing changes._');
  });
});

describe('bumpPackageVersion', () => {
  it('changes only the version value', () => {
    const pkg = '{\n  "name": "x",\n  "version": "0.1.0",\n  "dependencies": { "y": "1.0.0" }\n}\n';
    assert.equal(bumpPackageVersion(pkg, '0.2.0'), pkg.replace('0.1.0', '0.2.0'));
  });
});

describe('prepareRelease', () => {
  const log = ['aaa\x1ffeat(lanes): grid\x1f\x1e', '\nbbb\x1fchore: noise\x1f\x1e\n'].join('');

  it('writes the section from commits since the last tag and bumps the desktop version', () => {
    const files = {
      'CHANGELOG.md': `${HEADER}\nCarry me.\n`,
      'apps/emdash-desktop/package.json': '{ "version": "0.1.0" }\n',
    };
    const calls = [];
    const git = (args) => {
      calls.push(args.join(' '));
      if (args[0] === 'tag') return args[2] === 'HEAD' ? 'v0.1.0\nv1.2.4\n' : 'v1.2.4\n';
      return log;
    };
    const result = prepareRelease({
      version: '0.2.0',
      date: '2026-09-12',
      git,
      read: (f) => files[f] ?? null,
      write: (f, t) => (files[f] = t),
    });
    assert.deepEqual(result, { from: 'v0.1.0', commits: 2 });
    assert.ok(calls.some((call) => call.endsWith('v0.1.0..HEAD')));
    assert.equal(extractSection(files['CHANGELOG.md'], '0.2.0'), 'Carry me.\n\n### Features\n\n- **lanes:** grid (aaa)');
    assert.equal(files['apps/emdash-desktop/package.json'], '{ "version": "0.2.0" }\n');
  });

  it('refuses a bad version and a version that is already in the changelog', () => {
    const read = (f) => (f === 'CHANGELOG.md' ? `${HEADER}\n## [0.1.0] - d\n` : '{ "version": "0.1.0" }');
    assert.throws(() => prepareRelease({ version: 'v0.2', read, git: () => '', write: () => {} }), /not a version/);
    assert.throws(() => prepareRelease({ version: '0.1.0', read, git: () => '', write: () => {} }), /already has/);
  });

  it('ignores Emdash tags and starts from the fork base when there is no Ninebrains tag yet', () => {
    const calls = [];
    const git = (args) => {
      calls.push(args.join(' '));
      // v1.2.4 is upstream's: reachable from HEAD and from the fork base alike.
      if (args[0] === 'tag') return 'v1.2.4\nv1.2.3\n';
      return '';
    };
    const result = prepareRelease({ version: '0.1.0', git, read: (f) => (f === 'CHANGELOG.md' ? null : '{"version":"0.1.0"}'), write: () => {} });
    assert.equal(result.from, 'dbf690c');
  });
});

describe('canaryNotes', () => {
  it('combines the Unreleased notes with the commits since the last tag', () => {
    const git = (args) => {
      if (args[0] === 'tag') return args[2] === 'HEAD' ? 'v0.1.0\n' : '';
      return 'ccc\x1ffix(gates): x\x1f\x1e';
    };
    const text = canaryNotes({ git, read: () => `${HEADER}\nWIP note.\n` });
    assert.equal(text, 'WIP note.\n\nChanges since v0.1.0.\n\n### Fixes\n\n- **gates:** x (ccc)');
  });
});
