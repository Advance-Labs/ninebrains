// Run: node --test tooling/scripts/bot-pr.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { verifiedBotPr } from './bot-pr.mjs';

const BOT = 'dependabot[bot]';

const botPr = (overrides = {}) => ({
  user: { login: BOT, type: 'Bot' },
  ...overrides,
});

const botCommit = (overrides = {}) => ({
  sha: 'a'.repeat(40),
  parents: [{ sha: 'p'.repeat(40) }],
  author: { login: BOT },
  committer: { login: 'web-flow' },
  commit: { verification: { verified: true } },
  ...overrides,
});

describe('verifiedBotPr', () => {
  it('exempts a real-shaped Dependabot PR', () => {
    const { exempt, reasons } = verifiedBotPr(botPr(), [botCommit()]);
    assert.equal(exempt, true);
    assert.deepEqual(reasons, []);
  });

  it('rejects a PR opened by a person', () => {
    const pr = botPr({ user: { login: 'zordhalo', type: 'User' } });
    const { exempt, reasons } = verifiedBotPr(pr, [botCommit()]);
    assert.equal(exempt, false);
    assert.match(reasons.join(';'), /opened by "zordhalo"/);
  });

  it("rejects a PR whose account isn't typed Bot, even with the bot's login", () => {
    const pr = botPr({ user: { login: BOT, type: 'User' } });
    const { exempt, reasons } = verifiedBotPr(pr, [botCommit()]);
    assert.equal(exempt, false);
    assert.match(reasons.join(';'), /not "Bot"/);
  });

  it("rejects a person's commit added to a Dependabot branch", () => {
    const humanCommit = botCommit({ author: { login: 'zordhalo' }, committer: { login: 'zordhalo' } });
    const { exempt, reasons } = verifiedBotPr(botPr(), [botCommit(), humanCommit]);
    assert.equal(exempt, false);
    assert.match(reasons.join(';'), /commit 2\/2.*author\.login is "zordhalo"/s);
    assert.match(reasons.join(';'), /committer\.login is "zordhalo"/);
  });

  it('rejects a spoofed git author email when author.login is null', () => {
    const spoofed = botCommit({ author: null });
    const { exempt, reasons } = verifiedBotPr(botPr(), [spoofed]);
    assert.equal(exempt, false);
    assert.match(reasons.join(';'), /author\.login is "unknown"/);
  });

  it('rejects a spoofed author whose login resolves to a real person', () => {
    const spoofed = botCommit({ author: { login: 'zordhalo' } });
    const { exempt, reasons } = verifiedBotPr(botPr(), [spoofed]);
    assert.equal(exempt, false);
    assert.match(reasons.join(';'), /author\.login is "zordhalo"/);
  });

  it('rejects an unverified commit even when author.login says the bot', () => {
    const unverified = botCommit({ commit: { verification: { verified: false } } });
    const { exempt, reasons } = verifiedBotPr(botPr(), [unverified]);
    assert.equal(exempt, false);
    assert.match(reasons.join(';'), /is not verified/);
  });

  it('rejects a merge commit', () => {
    const merge = botCommit({ parents: [{ sha: 'p1' }, { sha: 'p2' }] });
    const { exempt, reasons } = verifiedBotPr(botPr(), [merge]);
    assert.equal(exempt, false);
    assert.match(reasons.join(';'), /has 2 parent\(s\), not 1/);
  });

  it('rejects an empty commit list', () => {
    const { exempt, reasons } = verifiedBotPr(botPr(), []);
    assert.equal(exempt, false);
    assert.match(reasons.join(';'), /no commits/);
  });

  it('fails closed on missing or malformed fields', () => {
    assert.equal(verifiedBotPr(null, [botCommit()]).exempt, false);
    assert.equal(verifiedBotPr(botPr(), null).exempt, false);
    assert.equal(verifiedBotPr(botPr(), [{}]).exempt, false);
    assert.equal(verifiedBotPr(botPr(), [botCommit({ commit: {} })]).exempt, false);
    assert.equal(verifiedBotPr(botPr(), [botCommit({ commit: null })]).exempt, false);
    assert.equal(verifiedBotPr(botPr(), [botCommit({ parents: null })]).exempt, false);
    assert.equal(verifiedBotPr(botPr(), [botCommit({ parents: [] })]).exempt, false);
  });

  it('respects a custom botLogin', () => {
    const pr = { user: { login: 'renovate[bot]', type: 'Bot' } };
    const commit = botCommit({ author: { login: 'renovate[bot]' } });
    const { exempt } = verifiedBotPr(pr, [commit], { botLogin: 'renovate[bot]' });
    assert.equal(exempt, true);
  });
});
