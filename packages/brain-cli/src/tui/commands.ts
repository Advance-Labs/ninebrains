import type { JobSummary, Lane } from '@ninebrains/brain-core';
import { parseAddress } from '../args';
import { laneLabel } from './feed';

/**
 * The prompt box's slash commands. Every action that changes Brain state goes through here, so
 * stray typing in the tab can never act: plain text is refused with a hint.
 */

export type Overlay = 'jobs' | 'lanes' | 'notes' | 'inbox' | 'help';

export type Action =
  | { type: 'new'; title: string; body?: string }
  | { type: 'send'; to: { kind: 'lane' | 'brain'; id: string }; body: string }
  | { type: 'assign'; jobId: string; laneId: string }
  | { type: 'requeue'; jobId: string }
  | { type: 'block'; jobId: string; reason: string }
  | { type: 'complete'; jobId: string; summary: string }
  | { type: 'note'; body: string }
  | { type: 'mode'; laneId: string; mode: 'attended' | 'unattended' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'clear-stop' }
  | { type: 'overlay'; overlay: Overlay }
  | { type: 'quit' };

export interface CommandSpec {
  name: string;
  args: string;
  summary: string;
}

export const COMMANDS: readonly CommandSpec[] = [
  { name: 'new', args: '<title> [-- <body>]', summary: 'create a job' },
  { name: 'send', args: '<lane|brain:id> <message>', summary: 'message a lane or Brain session' },
  { name: 'assign', args: '<job> <lane>', summary: 'hand a job to a lane' },
  { name: 'requeue', args: '<job>', summary: 'put a blocked or failed job back' },
  { name: 'block', args: '<job> <reason>', summary: 'block a job' },
  { name: 'complete', args: '<job> <summary>', summary: 'complete a job (gates still run)' },
  { name: 'note', args: '<text>', summary: 'add a project note' },
  { name: 'mode', args: '<lane> attended|unattended', summary: 'whether a lane runs jobs alone' },
  { name: 'pause', args: '', summary: 'stop dispatching new jobs' },
  { name: 'resume', args: '', summary: 'start dispatching again' },
  { name: 'stop', args: '', summary: 'STOP: kill runs, halt dispatch (latches)' },
  { name: 'clear-stop', args: '', summary: 'clear the STOP latch' },
  { name: 'jobs', args: '', summary: 'list jobs' },
  { name: 'lanes', args: '', summary: 'list lanes' },
  { name: 'notes', args: '', summary: 'list notes' },
  { name: 'inbox', args: '', summary: 'read your inbox' },
  { name: 'help', args: '', summary: 'this list' },
  { name: 'quit', args: '', summary: 'leave the TUI' },
];

/** Command names starting with what is typed, for the completion hint and Tab. */
export function completions(line: string): CommandSpec[] {
  if (!line.startsWith('/') || line.includes(' ')) return [];
  const typed = line.slice(1);
  return COMMANDS.filter((command) => command.name.startsWith(typed));
}

export interface CommandContext {
  jobs: readonly JobSummary[];
  lanes: readonly Lane[];
}

export type ParseResult = { ok: true; action: Action } | { ok: false; error: string };

const fail = (error: string): ParseResult => ({ ok: false, error });

/** One unique match, by exact id, id prefix (4+ chars) or a case-insensitive name. */
function resolve<T extends { id: string }>(
  items: readonly T[],
  ref: string,
  name: (item: T) => string,
  noun: string
): T | string {
  const exact = items.find((item) => item.id === ref);
  if (exact) return exact;
  const needle = ref.toLowerCase();
  const matches = items.filter(
    (item) => name(item).toLowerCase() === needle || (ref.length >= 4 && item.id.startsWith(ref))
  );
  if (matches.length === 1) return matches[0]!;
  return matches.length === 0
    ? `no ${noun} matches "${ref}"`
    : `"${ref}" matches ${matches.length} ${noun}s`;
}

export function parseCommand(line: string, ctx: CommandContext): ParseResult {
  const text = line.trim();
  if (!text) return fail('Type a command. /help lists them.');
  if (!text.startsWith('/')) return fail('Commands start with /. /help lists them.');

  const [head = '', ...words] = text.slice(1).split(/\s+/);
  const rest = text.slice(1 + head.length).trim();
  const job = (ref: string | undefined) =>
    ref ? resolve(ctx.jobs, ref, (j) => j.title, 'job') : 'name a job';
  const lane = (ref: string | undefined) =>
    ref ? resolve(ctx.lanes, ref, laneLabel, 'lane') : 'name a lane';
  const tail = (from: number) => words.slice(from).join(' ');

  switch (head) {
    case 'new': {
      const [title = '', body] = rest.split(/\s+--\s+/, 2).map((part) => part.trim());
      if (!title) return fail('/new needs a title');
      return { ok: true, action: { type: 'new', title, ...(body ? { body } : {}) } };
    }
    case 'send': {
      const [target, ...msg] = words;
      if (!target || msg.length === 0)
        return fail('/send needs a lane (or brain:<id>) and a message');
      let to: { kind: 'lane' | 'brain'; id: string };
      if (target.startsWith('brain:')) {
        try {
          to = parseAddress(target);
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error));
        }
      } else {
        const found = lane(target.replace(/^lane:/, ''));
        if (typeof found === 'string') return fail(found);
        to = { kind: 'lane', id: found.id };
      }
      return { ok: true, action: { type: 'send', to, body: msg.join(' ') } };
    }
    case 'assign': {
      const foundJob = job(words[0]);
      if (typeof foundJob === 'string') return fail(foundJob);
      const foundLane = lane(words[1]);
      if (typeof foundLane === 'string') return fail(foundLane);
      return { ok: true, action: { type: 'assign', jobId: foundJob.id, laneId: foundLane.id } };
    }
    case 'requeue': {
      const found = job(words[0]);
      return typeof found === 'string'
        ? fail(found)
        : { ok: true, action: { type: 'requeue', jobId: found.id } };
    }
    case 'block':
    case 'complete': {
      const found = job(words[0]);
      if (typeof found === 'string') return fail(found);
      const why = tail(1);
      if (!why) return fail(`/${head} needs a ${head === 'block' ? 'reason' : 'summary'}`);
      return head === 'block'
        ? { ok: true, action: { type: 'block', jobId: found.id, reason: why } }
        : { ok: true, action: { type: 'complete', jobId: found.id, summary: why } };
    }
    case 'note':
      return rest ? { ok: true, action: { type: 'note', body: rest } } : fail('/note needs text');
    case 'mode': {
      const found = lane(words[0]);
      if (typeof found === 'string') return fail(found);
      const mode = words[1];
      if (mode !== 'attended' && mode !== 'unattended') {
        return fail('/mode needs attended or unattended');
      }
      return { ok: true, action: { type: 'mode', laneId: found.id, mode } };
    }
    case 'pause':
    case 'resume':
    case 'stop':
    case 'clear-stop':
    case 'quit':
      return { ok: true, action: { type: head } };
    case 'jobs':
    case 'lanes':
    case 'notes':
    case 'inbox':
    case 'help':
      return { ok: true, action: { type: 'overlay', overlay: head } };
    default:
      return fail(`Unknown command /${head}. /help lists them.`);
  }
}
