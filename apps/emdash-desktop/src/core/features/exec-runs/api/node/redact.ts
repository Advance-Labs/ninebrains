/**
 * SEC-35 redaction for run transcripts. Builds on the shared logger's secret patterns and adds
 * the ones the threat model names that the logger does not cover, plus the literal values of
 * secrets this run was handed (API key, MCP server env).
 */
import { redactSecrets } from '@emdash/shared/logger';

const EXTRA_PATTERNS: Array<[RegExp, string]> = [
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/g, 'Bearer [REDACTED]'],
];

/** Values shorter than this are too likely to collide with ordinary text. */
const MIN_LITERAL_LENGTH = 8;

export type Redactor = (text: string) => string;

export function createRedactor(secretValues: Iterable<string> = []): Redactor {
  const literals = [...new Set(secretValues)]
    .filter((v) => v.length >= MIN_LITERAL_LENGTH)
    // Longest first, so a secret that contains another is replaced whole.
    .sort((a, b) => b.length - a.length);
  return (text) => {
    let out = text;
    for (const literal of literals) out = out.split(literal).join('[REDACTED]');
    out = redactSecrets(out);
    for (const [pattern, replacement] of EXTRA_PATTERNS) out = out.replace(pattern, replacement);
    return out;
  };
}

/** Env names whose values are safe to record verbatim in a transcript header. */
const SAFE_ENV_VALUES = new Set([
  'PATH',
  'HOME',
  'USER',
  'LANG',
  'TZ',
  'TMPDIR',
  'TERM',
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'ENABLE_TOOL_SEARCH',
]);

/** Env dump for the transcript: names always, values only for a known-safe set. */
export function describeEnvForTranscript(
  env: Readonly<Record<string, string>>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(env).sort()) {
    out[key] = SAFE_ENV_VALUES.has(key) ? env[key] : '[REDACTED]';
  }
  return out;
}
