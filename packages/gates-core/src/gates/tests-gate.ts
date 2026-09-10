import type { Gate, GateJob } from '../types';
import { errorMessage, tailLines } from '../util';

export interface TestsGateOptions {
  /** Shell command run in the worktree, e.g. "pnpm test". */
  command: string;
  timeoutMs?: number;
  appliesTo?: (job: GateJob) => boolean;
}

export const TESTS_LOG_LINES = 200;
const FEEDBACK_LINES = 40;

export function testsGate(options: TestsGateOptions): Gate {
  const command = options.command.trim();
  if (command.length === 0) throw new Error('testsGate needs a non-empty command');

  return {
    id: 'tests',
    title: 'Tests',
    appliesTo: options.appliesTo ?? ((job) => job.kind === 'code' || job.kind === 'ui'),
    async run(ctx) {
      const started = Date.now();
      let result;
      try {
        result = await ctx.capabilities.runCommand(command, {
          cwd: ctx.worktreePath,
          signal: ctx.signal,
          timeoutMs: options.timeoutMs,
        });
      } catch (error) {
        return {
          pass: false,
          evidence: [],
          feedback: `Could not run \`${command}\`: ${errorMessage(error)}`,
        };
      }

      const output = [result.stdout, result.stderr].filter((s) => s.length > 0).join('\n');
      const excerpt = tailLines(output, TESTS_LOG_LINES);
      const log = await ctx.evidence.put({
        kind: 'log',
        label: `Last ${TESTS_LOG_LINES} lines of \`${command}\``,
        fileName: 'tests.log',
        data: `$ ${command}\nexit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}\n\n${excerpt}\n`,
      });

      const pass = result.exitCode === 0 && !result.timedOut;
      const metrics = { exitCode: result.exitCode ?? -1, durationMs: Date.now() - started };
      if (pass) return { pass, evidence: [log], feedback: `\`${command}\` passed.`, metrics };

      const why = result.timedOut ? 'timed out' : `exited with code ${result.exitCode}`;
      return {
        pass,
        evidence: [log],
        feedback:
          `\`${command}\` ${why}. Last lines of output:\n\n` +
          `${tailLines(output, FEEDBACK_LINES) || '(no output)'}\n\nFull excerpt: ${log.path}`,
        metrics,
      };
    },
  };
}
