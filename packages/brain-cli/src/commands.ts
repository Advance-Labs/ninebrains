import type { BrainRequest } from '@ninebrains/brain-core';
import {
  flagList,
  flagNumber,
  flagString,
  parseAddress,
  requirePositional,
  requireRest,
  UsageError,
  type ParsedArgs,
} from './args';

/**
 * The command table: one entry per shell verb, each building exactly one
 * `BrainRequest`. No command builds two, so nothing here is a transaction that
 * could half-apply, and `--dry-run` can print the request without sending it.
 */

export interface CommandContext {
  /** `--project`, else `NINEBRAINS_PROJECT`. Commands that need one say so. */
  defaultProject: string | undefined;
}

export interface Command {
  usage: string;
  summary: string;
  build(args: ParsedArgs, context: CommandContext): BrainRequest;
}

const project = (args: ParsedArgs, context: CommandContext): string | undefined =>
  flagString(args, 'project') ?? context.defaultProject;

/**
 * Commands that must name a project fail here rather than at the endpoint, so the
 * message can mention `--project` and `NINEBRAINS_PROJECT` instead of repeating
 * the contract's wording.
 */
const requireProject = (args: ParsedArgs, context: CommandContext): string => {
  const id = project(args, context);
  if (!id) {
    throw new UsageError(
      'no project; pass --project <id> or set NINEBRAINS_PROJECT. `brain lanes` lists the ids.'
    );
  }
  return id;
};

const optional = <T>(key: string, value: T | undefined): Record<string, T> =>
  value === undefined ? {} : ({ [key]: value } as Record<string, T>);

export const COMMANDS: Record<string, Command> = {
  whoami: {
    usage: 'brain whoami',
    summary: 'Show what the endpoint thinks this CLI is.',
    build: () => ({ v: 1, op: 'whoami', args: {} }),
  },

  jobs: {
    usage: 'brain jobs [--project ID] [--state ready,running] [--lane ID] [--limit N]',
    summary: 'List jobs.',
    build: (args, context) => ({
      v: 1,
      op: 'list_jobs',
      args: {
        ...optional('projectId', project(args, context)),
        ...optional('states', flagList(args, 'state') as never),
        ...optional('laneId', flagString(args, 'lane')),
        ...optional('limit', flagNumber(args, 'limit')),
      },
    }),
  },

  new: {
    usage:
      'brain new <title...> [--project ID] [--body TEXT] [--depends-on A,B] [--gates tests,reviewer] [--gate-kind code|ui|research|seo|docs] [--paths a,b]',
    summary: 'Create a job.',
    build: (args, context) => ({
      v: 1,
      op: 'create_job',
      args: {
        title: requireRest(args, 0, 'title'),
        projectId: requireProject(args, context),
        ...optional('body', flagString(args, 'body')),
        ...optional('dependsOn', flagList(args, 'depends-on')),
        ...optional('gates', flagList(args, 'gates')),
        ...optional('gateKind', flagString(args, 'gate-kind') as never),
        ...optional('paths', flagList(args, 'paths')),
      },
    }),
  },

  link: {
    usage: 'brain link <prerequisite-job> <dependent-job>',
    summary: 'Make one job wait for another.',
    build: (args) => ({
      v: 1,
      op: 'link_jobs',
      args: { from: requirePositional(args, 0, 'from'), to: requirePositional(args, 1, 'to') },
    }),
  },

  assign: {
    usage: 'brain assign <job> <lane>',
    summary: 'Hand a job to a lane.',
    build: (args) => ({
      v: 1,
      op: 'assign_job',
      args: {
        jobId: requirePositional(args, 0, 'job'),
        laneId: requirePositional(args, 1, 'lane'),
      },
    }),
  },

  requeue: {
    usage: 'brain requeue <job>',
    summary: 'Put a blocked or failed job back, with attempts reset.',
    build: (args) => ({
      v: 1,
      op: 'requeue_job',
      args: { jobId: requirePositional(args, 0, 'job') },
    }),
  },

  block: {
    usage: 'brain block <job> <reason...>',
    summary: 'Block a job with a reason.',
    build: (args) => ({
      v: 1,
      op: 'block_job',
      args: { jobId: requirePositional(args, 0, 'job'), reason: requireRest(args, 1, 'reason') },
    }),
  },

  complete: {
    usage: 'brain complete <job> <summary...> [--artifacts a,b]',
    summary: "Complete a job on the operator's behalf. Gates still run.",
    build: (args) => ({
      v: 1,
      op: 'complete_job',
      args: {
        jobId: requirePositional(args, 0, 'job'),
        summary: requireRest(args, 1, 'summary'),
        ...optional('artifacts', flagList(args, 'artifacts')),
      },
    }),
  },

  lanes: {
    usage: 'brain lanes [--project ID]',
    summary: 'List lanes and what they are holding.',
    build: (args, context) => ({
      v: 1,
      op: 'list_lanes',
      args: { ...optional('projectId', project(args, context)) },
    }),
  },

  mode: {
    usage: 'brain mode <lane> <attended|unattended>',
    summary: 'Set whether a lane runs jobs on its own.',
    build: (args) => ({
      v: 1,
      op: 'set_lane_mode',
      args: {
        laneId: requirePositional(args, 0, 'lane'),
        mode: requirePositional(args, 1, 'attended|unattended') as never,
      },
    }),
  },

  inbox: {
    usage: 'brain inbox [--address lane:A] [--limit N]',
    summary: 'Read an inbox and mark what it returns as read.',
    build: (args) => {
      const address = flagString(args, 'address');
      return {
        v: 1,
        op: 'read_inbox',
        args: {
          ...(address ? { address: parseAddress(address) } : {}),
          ...optional('limit', flagNumber(args, 'limit')),
        },
      };
    },
  },

  send: {
    usage: 'brain send <lane:ID|brain:ID> <body...>',
    summary: 'Message a lane or a Brain session.',
    build: (args) => ({
      v: 1,
      op: 'send_message',
      args: {
        to: parseAddress(requirePositional(args, 0, 'address')),
        body: requireRest(args, 1, 'body'),
      },
    }),
  },

  broadcast: {
    usage: 'brain broadcast <body...> [--project ID]',
    summary: 'Message every lane in a project.',
    build: (args, context) => ({
      v: 1,
      op: 'broadcast',
      args: { body: requireRest(args, 0, 'body'), projectId: requireProject(args, context) },
    }),
  },

  note: {
    usage: 'brain note <body...> [--project ID] [--job ID]',
    summary: 'Add a note to a project or a job.',
    build: (args, context) => ({
      v: 1,
      op: 'add_note',
      args: {
        body: requireRest(args, 0, 'body'),
        projectId: requireProject(args, context),
        ...optional('jobId', flagString(args, 'job')),
      },
    }),
  },

  notes: {
    usage: 'brain notes [--project ID] [--limit N]',
    summary: 'List notes.',
    build: (args, context) => ({
      v: 1,
      op: 'list_notes',
      args: {
        projectId: requireProject(args, context),
        ...optional('limit', flagNumber(args, 'limit')),
      },
    }),
  },

  done: {
    usage: 'brain done [--project ID] [--limit N]',
    summary: 'The done log: what finished and how it was verified.',
    build: (args, context) => ({
      v: 1,
      op: 'list_done',
      args: {
        projectId: requireProject(args, context),
        ...optional('limit', flagNumber(args, 'limit')),
      },
    }),
  },

  status: {
    usage: 'brain status',
    summary: 'Dispatcher state: paused, STOP latched, lane modes, active runs.',
    build: () => ({ v: 1, op: 'dispatcher_status', args: {} }),
  },

  pause: {
    usage: 'brain pause',
    summary: 'Stop dispatching new jobs. Running jobs keep going.',
    build: () => ({ v: 1, op: 'set_dispatcher_paused', args: { paused: true } }),
  },

  resume: {
    usage: 'brain resume',
    summary: 'Dispatch again. Refused while STOP is latched.',
    build: () => ({ v: 1, op: 'set_dispatcher_paused', args: { paused: false } }),
  },

  sessions: {
    usage: 'brain sessions',
    summary: 'List Brain sessions.',
    build: () => ({ v: 1, op: 'list_sessions', args: {} }),
  },

  'session-start': {
    usage: 'brain session-start [--project ID]',
    summary: 'Launch a Brain session for a project.',
    build: (args, context) => ({
      v: 1,
      op: 'start_brain',
      args: { projectId: requireProject(args, context) },
    }),
  },

  'session-stop': {
    usage: 'brain session-stop <brainId>',
    summary: 'Stop a Brain session.',
    build: (args) => ({
      v: 1,
      op: 'stop_brain',
      args: { brainId: requirePositional(args, 0, 'brainId') },
    }),
  },

  // SEC-30. With no desktop UI this is the operator's emergency brake, so it is
  // one word, takes no arguments and asks nothing before acting.
  stop: {
    usage: 'brain stop',
    summary: 'STOP everything: kill runs, pause dispatch, stop Brain-dispatched lanes. Latches.',
    build: () => ({ v: 1, op: 'stop_all', args: {} }),
  },

  'stop-clear': {
    usage: 'brain stop-clear',
    summary: 'Clear a latched STOP. Dispatch stays paused until `brain resume`.',
    build: () => ({ v: 1, op: 'clear_stop', args: {} }),
  },
};

export function commandNames(): string[] {
  return Object.keys(COMMANDS).sort();
}
