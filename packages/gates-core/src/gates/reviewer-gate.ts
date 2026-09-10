/**
 * Reviewer gate: a separate, read-only reviewer run judges the diff.
 *
 * The reviewer gets the task, the diff against the lane's base commit, the
 * names of new untracked files, and the evidence gathered so far. Its reply
 * must be a strict JSON verdict; anything else fails the gate.
 */

import {
  VERDICT_INSTRUCTIONS,
  describeEvidence,
  describeTask,
  formatIssues,
  parseReviewerVerdict,
} from '../reviewer-verdict';
import type { Gate, GateTask } from '../types';
import { errorMessage, tailLines, truncate } from '../util';

export type ReviewFocus = 'general' | 'security';

export interface ReviewerGateOptions {
  id?: string;
  title?: string;
  focus?: ReviewFocus;
  /** Builds the diff command. Default `git diff --no-color <baseRef|HEAD>`. */
  diffCommand?: (task: GateTask) => string;
  /** Lists new files. Default `git ls-files --others --exclude-standard`; null to skip. */
  untrackedCommand?: string | null;
  /** Diff characters included in the prompt. The full diff is stored as evidence. Default 60000. */
  maxDiffChars?: number;
  appliesTo?: (task: GateTask) => boolean;
}

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/~^-]{0,199}$/;

const FOCUS: Record<ReviewFocus, string> = {
  general:
    'Decide whether the change fully and correctly satisfies the task. Reproduce the result ' +
    'where you can (run the tests, open the URL). Look for regressions, missing edge cases and ' +
    'unfinished work.',
  security:
    'Review the change for security problems only: injection (shell, SQL, HTML), path ' +
    'traversal, SSRF, missing authorisation, secrets in code or logs, unsafe deserialisation, ' +
    'and weakened input validation. Ignore style.',
};

export function reviewerGate(options: ReviewerGateOptions = {}): Gate {
  const id = options.id ?? 'reviewer';
  const focus = options.focus ?? 'general';
  const maxDiffChars = options.maxDiffChars ?? 60_000;

  return {
    id,
    title: options.title ?? 'Reviewer',
    appliesTo: options.appliesTo ?? (() => true),
    async run(ctx) {
      const base = ctx.task.baseRef ?? 'HEAD';
      if (!options.diffCommand && (!SAFE_REF.test(base) || base.includes('..'))) {
        return {
          pass: false,
          evidence: [],
          feedback: `Refusing to diff against unsafe baseRef ${JSON.stringify(base)}.`,
        };
      }
      const run = (command: string) =>
        ctx.capabilities.runCommand(command, { cwd: ctx.worktreePath, signal: ctx.signal });

      const diffCommand = options.diffCommand?.(ctx.task) ?? `git diff --no-color ${base}`;
      let diff: string;
      let untracked = '';
      try {
        const result = await run(diffCommand);
        if (result.exitCode !== 0) {
          return {
            pass: false,
            evidence: [],
            feedback: `Could not compute the diff: \`${diffCommand}\` exited with ${result.exitCode}.\n${tailLines(result.stderr, 10)}`,
          };
        }
        diff = result.stdout;
        if (options.untrackedCommand !== null) {
          const listed = await run(
            options.untrackedCommand ?? 'git ls-files --others --exclude-standard'
          );
          if (listed.exitCode === 0) untracked = listed.stdout.trim();
        }
      } catch (error) {
        return {
          pass: false,
          evidence: [],
          feedback: `Could not compute the diff: ${errorMessage(error)}`,
        };
      }

      if (diff.trim().length === 0 && untracked.length === 0) {
        return {
          pass: false,
          evidence: [],
          feedback: `No changes found against ${base}; there is nothing to review.`,
        };
      }

      const diffEvidence = await ctx.evidence.put({
        kind: 'diff',
        label: `Diff against ${base}`,
        fileName: 'changes.diff',
        data: untracked ? `${diff}\n# untracked files\n${untracked}\n` : diff,
      });
      const attachments = ctx.evidence.list();

      const prompt = [
        `You are an independent reviewer. ${FOCUS[focus]}`,
        describeTask(ctx.task),
        `# Diff against ${base}\n\`\`\`diff\n${truncate(diff, maxDiffChars)}\n\`\`\``,
        untracked ? `# New untracked files\n${untracked}` : '',
        describeEvidence(attachments),
        VERDICT_INSTRUCTIONS,
      ]
        .filter((part) => part.length > 0)
        .join('\n\n');

      let reply: string;
      try {
        ({ text: reply } = await ctx.capabilities.spawnReviewer(prompt, {
          signal: ctx.signal,
          cwd: ctx.worktreePath,
          readOnly: true,
          attachments,
          purpose: id,
        }));
      } catch (error) {
        return {
          pass: false,
          evidence: [diffEvidence],
          feedback: `Reviewer failed to run: ${errorMessage(error)}`,
        };
      }

      const metrics = { diffChars: diff.length };
      const parsed = parseReviewerVerdict(reply);
      if (!parsed.ok) {
        const raw = await ctx.evidence.put({
          kind: 'text',
          label: 'Malformed reviewer reply',
          fileName: `${id}-reply.txt`,
          data: reply,
        });
        return {
          pass: false,
          evidence: [diffEvidence, raw],
          feedback: `The reviewer's reply was not a valid verdict (${parsed.error}), so the change is unverified.`,
          metrics,
        };
      }

      const verdict = await ctx.evidence.put({
        kind: 'json',
        label: `${options.title ?? 'Reviewer'} verdict`,
        fileName: `${id}-verdict.json`,
        data: JSON.stringify(parsed.verdict, null, 2),
      });
      const issues = formatIssues(parsed.verdict.issues);
      const evidence = [diffEvidence, verdict];
      const withIssues = { ...metrics, issues: parsed.verdict.issues.length };
      return parsed.verdict.pass
        ? {
            pass: true,
            evidence,
            feedback: `Reviewer approved.${issues ? `\nNotes:\n${issues}` : ''}`,
            metrics: withIssues,
          }
        : {
            pass: false,
            evidence,
            feedback: `Reviewer rejected the change:\n${issues}`,
            metrics: withIssues,
          };
    },
  };
}

/** The reviewer gate with a security brief, attached by the security rigor slider. */
export function securityReviewGate(options: Omit<ReviewerGateOptions, 'focus'> = {}): Gate {
  return reviewerGate({
    id: 'security-review',
    title: 'Security review',
    appliesTo: (task) => task.kind === 'code' || task.kind === 'ui',
    ...options,
    focus: 'security',
  });
}
