/**
 * Reviewer gate: a separate, read-only reviewer run judges the diff.
 *
 * Isolation (SEC-18). The reviewer never gets a path into the lane worktree.
 * The app's `prepareReviewCheckout` makes a disposable detached checkout of the
 * job's result; the diff is computed there as argv (no shell), and the
 * reviewer starts with that checkout as its cwd and read-only tools (no Bash).
 * It does not run tests: the tests gate does, and its log reaches the reviewer
 * as evidence. The checkout is disposed however the gate ends.
 *
 * Injection (SEC-19). The job, diff, untracked names and evidence all go into
 * per-call nonce blocks the content cannot close, and the reply must be a
 * strict JSON verdict.
 */

import {
  VERDICT_INSTRUCTIONS,
  describeEvidence,
  describeJob,
  formatIssues,
  parseReviewerVerdict,
} from '../reviewer-verdict';
import type { Gate, GateContext, GateJob, GateResult, ReviewCheckout } from '../types';
import { createFence } from '../untrusted';
import { errorMessage, tailLines, truncate } from '../util';

export type ReviewFocus = 'general' | 'security';

export interface ReviewerGateOptions {
  id?: string;
  title?: string;
  focus?: ReviewFocus;
  /** git arguments for the diff, run as argv in the review checkout. */
  diffArgs?: (job: GateJob, base: string) => string[];
  /** git arguments that list new files, run as argv; null to skip. */
  untrackedArgs?: string[] | null;
  /** Diff characters included in the prompt. The full diff is stored as evidence. Default 60000. */
  maxDiffChars?: number;
  appliesTo?: (job: GateJob) => boolean;
}

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/~^-]{0,199}$/;

/**
 * Repository config is writable by the lane, so stop it from running programs
 * during a diff (fsmonitor hooks, external diff drivers, pagers).
 */
const SAFE_GIT = ['-c', 'core.fsmonitor=false', '-c', 'diff.external=', '-c', 'core.pager=cat'];

export function defaultDiffArgs(_job: GateJob, base: string): string[] {
  return [...SAFE_GIT, 'diff', '--no-ext-diff', '--no-textconv', '--no-color', base, '--'];
}

const DEFAULT_UNTRACKED_ARGS = [...SAFE_GIT, 'ls-files', '--others', '--exclude-standard'];

const FOCUS: Record<ReviewFocus, string> = {
  general:
    'Decide whether the change fully and correctly satisfies the job. Judge from the diff, the ' +
    'files in your working directory (a read-only copy of the result) and the evidence. Do not ' +
    'run code or tests: the tests gate already has, and its log is in the evidence. Look for ' +
    'regressions, missing edge cases and unfinished work.',
  security:
    'Review the change for security problems only: injection (shell, SQL, HTML), path ' +
    'traversal, SSRF, missing authorisation, secrets in code or logs, unsafe deserialisation, ' +
    'and weakened input validation. Ignore style. Do not run code.',
};

const fail = (feedback: string, evidence: GateResult['evidence'] = []): GateResult => ({
  pass: false,
  evidence,
  feedback,
});

/** A filter driver name that is safe inside `-c filter.<name>.<key>=`. */
const DRIVER = /^[A-Za-z0-9._-]{1,128}$/;

type Git = (argv: string[]) => ReturnType<GateContext['capabilities']['runCommand']>;

/**
 * T31. `git diff` against the checkout's files runs each changed file's `clean`
 * filter, and both `.gitattributes` and the repo config are lane-writable. git
 * has no switch that turns every filter off, so read the drivers the config
 * defines (`git config` runs no filter) and blank each one, the same rule as the
 * app's review checkout. Fails closed on an unreadable config or an odd name.
 */
async function filterDriverOverrides(git: Git): Promise<string[]> {
  const listed = await git([
    ...SAFE_GIT,
    'config',
    '--null',
    '--name-only',
    '--get-regexp',
    '^filter\\.',
  ]);
  if (listed.exitCode === 1) return []; // no filter.* keys
  if (listed.exitCode !== 0) {
    throw new Error(`git config exited with ${listed.exitCode}.\n${tailLines(listed.stderr, 5)}`);
  }
  const names = new Set(
    listed.stdout
      .split('\0')
      .filter(Boolean)
      .map((key) => key.slice('filter.'.length, key.lastIndexOf('.')))
  );
  const flags: string[] = [];
  for (const name of names) {
    if (!DRIVER.test(name)) {
      throw new Error(`Refusing a repo with filter driver ${JSON.stringify(name)}.`);
    }
    for (const key of ['smudge', 'clean', 'process']) flags.push('-c', `filter.${name}.${key}=`);
    flags.push('-c', `filter.${name}.required=false`);
  }
  return flags;
}

export function reviewerGate(options: ReviewerGateOptions = {}): Gate {
  const id = options.id ?? 'reviewer';
  const title = options.title ?? 'Reviewer';
  const focus = options.focus ?? 'general';
  const maxDiffChars = options.maxDiffChars ?? 60_000;
  const diffArgs = options.diffArgs ?? defaultDiffArgs;

  async function review(ctx: GateContext, checkout: ReviewCheckout, base: string) {
    const run: Git = (argv) =>
      ctx.capabilities.runCommand('git', { argv, cwd: checkout.path, signal: ctx.signal });

    let diff: string;
    let untracked = '';
    try {
      const hardening = await filterDriverOverrides(run);
      const git: Git = (argv) => run([...hardening, ...argv]);
      const result = await git(diffArgs(ctx.job, base));
      if (result.exitCode !== 0) {
        return fail(
          `Could not compute the diff: git exited with ${result.exitCode}.\n${tailLines(result.stderr, 10)}`
        );
      }
      diff = result.stdout;
      if (options.untrackedArgs !== null) {
        const listed = await git(options.untrackedArgs ?? DEFAULT_UNTRACKED_ARGS);
        if (listed.exitCode === 0) untracked = listed.stdout.trim();
      }
    } catch (error) {
      return fail(`Could not compute the diff: ${errorMessage(error)}`);
    }

    if (diff.trim().length === 0 && untracked.length === 0) {
      return fail(`No changes found against ${base}; there is nothing to review.`);
    }

    const diffEvidence = await ctx.evidence.put({
      kind: 'diff',
      label: `Diff against ${base}`,
      fileName: 'changes.diff',
      data: untracked ? `${diff}\n# untracked files\n${untracked}\n` : diff,
    });
    const attachments = ctx.evidence.list();

    const fence = createFence();
    const prompt = [
      `You are an independent reviewer. ${FOCUS[focus]}`,
      fence.preamble,
      describeJob(ctx.job, fence),
      `# Diff against ${base}\n${fence.wrap('DIFF', truncate(diff, maxDiffChars))}`,
      untracked ? `# New untracked files\n${fence.wrap('UNTRACKED', untracked)}` : '',
      describeEvidence(attachments, fence),
      VERDICT_INSTRUCTIONS,
    ]
      .filter((part) => part.length > 0)
      .join('\n\n');

    let reply: string;
    try {
      ({ text: reply } = await ctx.capabilities.spawnReviewer(prompt, {
        signal: ctx.signal,
        cwd: checkout.path,
        tools: 'read-only',
        attachments,
        purpose: id,
      }));
    } catch (error) {
      return fail(`Reviewer failed to run: ${errorMessage(error)}`, [diffEvidence]);
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
        ...fail(
          `The reviewer's reply was not a valid verdict (${parsed.error}), so the change is unverified.`,
          [diffEvidence, raw]
        ),
        metrics,
      };
    }

    const verdict = await ctx.evidence.put({
      kind: 'json',
      label: `${title} verdict`,
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
  }

  return {
    id,
    title,
    appliesTo: options.appliesTo ?? (() => true),
    async run(ctx) {
      const base = ctx.job.baseRef ?? 'HEAD';
      if (!SAFE_REF.test(base) || base.includes('..')) {
        return fail(`Refusing to diff against unsafe baseRef ${JSON.stringify(base)}.`);
      }

      let checkout: ReviewCheckout;
      try {
        checkout = await ctx.capabilities.prepareReviewCheckout(ctx.job, { signal: ctx.signal });
      } catch (error) {
        return fail(`Could not prepare an isolated checkout for review: ${errorMessage(error)}`);
      }
      try {
        return await review(ctx, checkout, base);
      } finally {
        await checkout.dispose().catch(() => undefined);
      }
    },
  };
}

/** The reviewer gate with a security brief, attached by the security rigor slider. */
export function securityReviewGate(options: Omit<ReviewerGateOptions, 'focus'> = {}): Gate {
  return reviewerGate({
    id: 'security-review',
    title: 'Security review',
    appliesTo: (job) => job.kind === 'code' || job.kind === 'ui',
    ...options,
    focus: 'security',
  });
}
