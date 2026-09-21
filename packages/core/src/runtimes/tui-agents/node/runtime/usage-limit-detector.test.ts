import { describe, expect, it } from 'vitest';
import { createUsageLimitDetector, matchUsageLimit } from './usage-limit-detector';

const CLAUDE_NOTICES = [
  'Claude usage limit reached. Your limit will reset at 3pm (America/Toronto).',
  '5-hour limit reached ∙ resets 2:40am',
  "You've hit your limit · resets 2:40am (America/Toronto)",
  'Weekly limit reached ∙ resets Mon 9am',
];

const CODEX_NOTICES = [
  "■ You've hit your usage limit. Upgrade to Pro (https://openai.com/chatgpt/pricing) or try again in 3 days 2 hours.",
  "You've hit your usage limit. Try again in 42 minutes.",
];

// Lines an agent prints while *working on* rate-limit code or docs. None of these
// mean the agent itself is out of quota.
const LOOKALIKES = [
  "+  'Claude usage limit reached. Your limit will reset at 3pm'",
  '⏺ Update(src/usage-limit-detector.ts)',
  '   42 │ // detect "5-hour limit reached ∙ resets 2:40am"',
  'The API returns 429 when the rate limit is reached.',
  'grep -rn "You\'ve hit your usage limit" src/',
];

describe('matchUsageLimit', () => {
  it.each(CLAUDE_NOTICES)('matches Claude notice: %s', (line) => {
    expect(matchUsageLimit(line, 'claude')).not.toBeNull();
  });

  it.each(CODEX_NOTICES)('matches Codex notice: %s', (line) => {
    expect(matchUsageLimit(line, 'codex')).not.toBeNull();
  });

  it.each(LOOKALIKES)('ignores lookalike output: %s', (line) => {
    expect(matchUsageLimit(line, 'claude')).toBeNull();
    expect(matchUsageLimit(line, 'codex')).toBeNull();
  });

  it("ignores a notice under a provider it doesn't belong to", () => {
    expect(matchUsageLimit(CLAUDE_NOTICES[0], 'freebuff')).toBeNull();
    expect(matchUsageLimit(CODEX_NOTICES[1], 'freebuff')).toBeNull();
  });
});

describe('createUsageLimitDetector', () => {
  const notice = CLAUDE_NOTICES[1];

  it('detects a notice split across chunks and wrapped in ANSI', () => {
    const detector = createUsageLimitDetector('claude', () => 7);
    const colored = `\x1b[2K\x1b[31m${notice}\x1b[0m\r\n`;
    const mid = Math.floor(colored.length / 2);
    expect(detector.push(colored.slice(0, mid))).toBeNull();
    expect(detector.push(colored.slice(mid))).toEqual({ message: notice, detectedAt: 7 });
  });

  it('reads cursor-forward as a space and cursor positioning as a line break', () => {
    const detector = createUsageLimitDetector('claude', () => 1);
    const redrawn = `\x1b[12;1Hsome other row\x1b[13;3H${notice.replaceAll(' ', '\x1b[1C')}`;
    expect(detector.push(redrawn)?.message).toBe(notice);
  });

  it('fires only once per spawn', () => {
    const detector = createUsageLimitDetector('claude', () => 1);
    expect(detector.push(`${notice}\n`)).not.toBeNull();
    expect(detector.push(`${notice}\n`)).toBeNull();
  });
});
