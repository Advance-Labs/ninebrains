/**
 * Strict parsing of reviewer replies.
 *
 * A reviewer is another model, and a model that rambles instead of answering
 * has not reviewed anything. So the reply must be exactly one JSON object
 * `{ "pass": boolean, "issues": [...] }` — optionally wrapped in a single
 * ```json fence and nothing else. Anything else is malformed, and a malformed
 * reply fails the gate.
 */

import type { Evidence, GateJob } from './types';
import type { Fence } from './untrusted';

export interface ReviewIssue {
  message: string;
  severity?: 'blocker' | 'major' | 'minor';
  file?: string;
}

export interface ReviewVerdict {
  pass: boolean;
  issues: ReviewIssue[];
}

export type ParsedVerdict = { ok: true; verdict: ReviewVerdict } | { ok: false; error: string };

const FENCED = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/;
const SEVERITIES = new Set(['blocker', 'major', 'minor']);

function parseIssue(value: unknown, i: number): ReviewIssue | string {
  if (typeof value === 'string' && value.trim().length > 0) return { message: value.trim() };
  if (typeof value !== 'object' || value === null) return `issues[${i}] must be a string or object`;
  const v = value as Record<string, unknown>;
  if (typeof v.message !== 'string' || v.message.trim().length === 0) {
    return `issues[${i}].message must be a non-empty string`;
  }
  const issue: ReviewIssue = { message: v.message.trim() };
  if (v.severity !== undefined) {
    if (typeof v.severity !== 'string' || !SEVERITIES.has(v.severity)) {
      return `issues[${i}].severity must be blocker, major or minor`;
    }
    issue.severity = v.severity as ReviewIssue['severity'];
  }
  if (v.file !== undefined) {
    if (typeof v.file !== 'string') return `issues[${i}].file must be a string`;
    issue.file = v.file;
  }
  return issue;
}

export function parseReviewerVerdict(text: string): ParsedVerdict {
  const trimmed = text.trim();
  const fenced = FENCED.exec(trimmed);
  const body = fenced ? fenced[1] : trimmed;

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return { ok: false, error: 'reply is not a single JSON object' };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: 'reply is not a JSON object' };
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.pass !== 'boolean') return { ok: false, error: '"pass" must be a boolean' };
  if (!Array.isArray(obj.issues)) return { ok: false, error: '"issues" must be an array' };

  const issues: ReviewIssue[] = [];
  for (const [i, raw] of obj.issues.entries()) {
    const parsed = parseIssue(raw, i);
    if (typeof parsed === 'string') return { ok: false, error: parsed };
    issues.push(parsed);
  }
  if (!obj.pass && issues.length === 0) {
    return { ok: false, error: 'a failing verdict must list at least one issue' };
  }
  return { ok: true, verdict: { pass: obj.pass, issues } };
}

export function formatIssues(issues: ReviewIssue[]): string {
  return issues
    .map((issue) => {
      const where = issue.file ? ` (${issue.file})` : '';
      const severity = issue.severity ? `[${issue.severity}] ` : '';
      return `- ${severity}${issue.message}${where}`;
    })
    .join('\n');
}

export const VERDICT_INSTRUCTIONS =
  'Reply with exactly one JSON object and nothing else:\n' +
  '{"pass": boolean, "issues": [{"message": string, "severity": "blocker"|"major"|"minor", ' +
  '"file"?: string}]}\n' +
  'Set "pass" to false only for problems that must be fixed; list every such problem as an issue. ' +
  'Do not modify any files and do not run any commands.';

/** The job as a fenced block: its title and body can carry text from the web or a worker. */
export function describeJob(job: GateJob, fence: Fence): string {
  return `# Job\n${fence.wrap('JOB', `${job.title}\n\n${job.body.trim()}`)}`;
}

export function describeEvidence(evidence: Evidence[], fence: Fence): string {
  if (evidence.length === 0) return '# Evidence\n(none)';
  const lines = evidence.map((e) => `- ${e.kind}: ${e.label} — ${e.path}`).join('\n');
  return `# Evidence\n${fence.wrap('EVIDENCE', lines)}`;
}
