import type { TuiUsageLimit } from '#runtimes/tui-agents/api';

/** A partial line longer than this is not a provider notice; keep only its tail. */
const MAX_PENDING_LINE = 1024;

export type UsageLimitDetector = {
  /** Feeds one raw PTY chunk; returns the limit the first time one is seen, else null. */
  push(chunk: string): TuiUsageLimit | null;
};

/**
 * Watches one PTY process's output for the provider's own usage-limit notice.
 *
 * Output is split into lines and each line is ANSI-cleaned before matching. TUIs
 * redraw with cursor moves rather than newlines and spaces, so cursor positioning
 * reads as a line break and cursor-forward as a space. The detector fires once;
 * the runtime creates a fresh one per spawn.
 */
export function createUsageLimitDetector(
  providerId: string,
  now: () => number
): UsageLimitDetector {
  let pending = '';
  let fired = false;

  return {
    push(chunk) {
      if (fired) return null;
      const lines = (pending + chunk).split('\n');
      pending = (lines.pop() ?? '').slice(-MAX_PENDING_LINE);
      // The unfinished line is checked too: a notice often sits on the last row
      // with no trailing newline until the next redraw.
      for (const raw of [...lines, pending]) {
        for (const line of cleanTerminalLine(raw).split('\n')) {
          const message = matchUsageLimit(line.trim(), providerId);
          if (message === null) continue;
          fired = true;
          pending = '';
          return { message, detectedAt: now() };
        }
      }
      return null;
    },
  };
}

function cleanTerminalLine(value: string): string {
  return (
    value
      // OSC sequences (titles, hyperlinks), BEL- or ST-terminated.
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      // Cursor forward: a TUI's stand-in for spaces.
      .replace(/\x1b\[\d*C/g, ' ')
      // Cursor position / next line / down: a TUI's stand-in for newlines.
      .replace(/\x1b\[[\d;]*[HfEB]/g, '\n')
      // Every other CSI sequence (colors, erase, modes).
      .replace(/\x1b\[[?>=]?[\d;]*[A-Za-z~]/g, '')
      .replace(/\x1b[()][A-Za-z0-9]/g, '')
      .replace(/\r/g, '')
  );
}

/** One status glyph a TUI may draw before a notice, e.g. Codex's `■` or Claude's `⎿`. */
const LEADING_GLYPH = /^[■⎿⏺●▶►✗✘⚠]\s*/u;

const USAGE_LIMIT_NOTICES: Record<string, readonly RegExp[]> = {
  claude: [
    /^Claude (?:AI )?usage limit reached\b/i,
    // "5-hour limit reached ∙ resets 2:40am", "Weekly limit reached ∙ resets Mon 9am"
    /^(?:[\w-]+ )?limit reached\s*[∙·•|-]\s*resets\b/i,
    /^You've hit your (?:[\w-]+ )?limit\s*[∙·•|-]\s*resets\b/i,
  ],
  codex: [/^You've hit your usage limit\b/i],
};

/**
 * Returns the notice text when `line` is `providerId`'s own usage-limit message, else null.
 *
 * `line` is one ANSI-cleaned, trimmed line of terminal output. Only providers with a
 * known notice should ever match; everything else returns null.
 */
export function matchUsageLimit(line: string, providerId: string): string | null {
  const patterns = USAGE_LIMIT_NOTICES[providerId];
  if (!patterns) return null;
  // Anchored at the line start (after an optional TUI glyph) so diffs, greps and
  // source lines that merely quote a notice never match.
  const body = line.replace(LEADING_GLYPH, '');
  return patterns.some((pattern) => pattern.test(body)) ? body : null;
}
