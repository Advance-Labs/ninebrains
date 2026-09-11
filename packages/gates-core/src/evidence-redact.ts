/**
 * Redaction for text evidence (SEC-24, SEC-35).
 *
 * Test logs, diffs and reviewer replies are written by processes a lane controls, so they can
 * carry secrets: an `env` dump with `NINEBRAINS_TOKEN`, a curl trace with `Authorization:`, a key
 * committed by mistake. Everything but screenshots passes through this before it reaches disk.
 * It is pattern plus literal-value based, so it is best-effort: the literal values the app hands
 * in (live Ninebrains tokens, pack secrets) are the reliable part.
 */

const PATTERNS: Array<[RegExp, string]> = [
  // NINEBRAINS_TOKEN=..., "NINEBRAINS_TOKEN": "...", and any other NINEBRAINS_*TOKEN/SECRET.
  [/(NINEBRAINS_[A-Z_]*(?:TOKEN|SECRET)["']?\s*[:=]\s*["']?)[^\s"',}]+/g, '$1[REDACTED]'],
  // Authorization / Proxy-Authorization headers, whatever the scheme.
  [/((?:proxy-)?authorization["']?\s*[:=]\s*["']?)[^\r\n"']+/gi, '$1[REDACTED]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/g, 'Bearer [REDACTED]'],
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    '[REDACTED_PRIVATE_KEY]',
  ],
  [/\bsk-ant-[A-Za-z0-9_-]{16,}/g, '[REDACTED_KEY]'],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, '[REDACTED_KEY]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[REDACTED_SLACK_TOKEN]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[REDACTED_JWT]'],
];

/** Shorter literals are too likely to collide with ordinary text. */
const MIN_LITERAL = 8;

export type EvidenceRedactor = (text: string) => string;

/** `secrets`: literal values to remove wherever they appear (live tokens, pack secrets). */
export function createEvidenceRedactor(secrets: Iterable<string> = []): EvidenceRedactor {
  const literals = [...new Set(secrets)]
    .filter((s) => s.length >= MIN_LITERAL)
    .sort((a, b) => b.length - a.length);
  return (text) => {
    let out = text;
    for (const literal of literals) out = out.split(literal).join('[REDACTED]');
    for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
    return out;
  };
}
