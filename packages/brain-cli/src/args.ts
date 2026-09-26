/**
 * A deliberately small argv parser.
 *
 * The CLI's whole job is to turn a shell line into one `{ v: 1, op, args }` that
 * brain-core's zod schemas then validate, so parsing here only needs to produce
 * strings, numbers, booleans and lists. Every type and range error is the
 * endpoint's to report, which keeps one source of truth for the contract.
 */

export interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | true>;
}

export class UsageError extends Error {}

/**
 * `--key value`, `--key=value` and bare `--flag`. A `--` ends flag parsing, so a
 * job body that starts with a dash can still be passed positionally.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  let onlyPositionals = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (onlyPositionals || !arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    if (arg === '--') {
      onlyPositionals = true;
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) {
      flags.set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    // A following `--something` is the next flag, not this one's value.
    if (next === undefined || next.startsWith('--')) {
      flags.set(body, true);
      continue;
    }
    flags.set(body, next);
    i++;
  }
  return { positionals, flags };
}

export function flagString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  if (value === undefined) return undefined;
  if (value === true) throw new UsageError(`--${name} needs a value`);
  return value;
}

export function flagNumber(args: ParsedArgs, name: string): number | undefined {
  const value = flagString(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new UsageError(`--${name} must be a whole number`);
  return parsed;
}

export function flagBool(args: ParsedArgs, name: string): boolean {
  const value = args.flags.get(name);
  if (value === undefined) return false;
  if (value === true || value === 'true') return true;
  if (value === 'false') return false;
  throw new UsageError(`--${name} takes no value, or true/false`);
}

/** `--gates a,b,c` or a repeated `--gates a --gates b` are both one list. */
export function flagList(args: ParsedArgs, name: string): string[] | undefined {
  const value = flagString(args, name);
  if (value === undefined) return undefined;
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** `lane:A` or `brain:hub`. The wire form is always the structured object. */
export function parseAddress(raw: string): { kind: 'lane' | 'brain'; id: string } {
  const separator = raw.indexOf(':');
  if (separator < 0) {
    throw new UsageError(`"${raw}" is not an address; use lane:<id> or brain:<id>`);
  }
  const kind = raw.slice(0, separator);
  const id = raw.slice(separator + 1);
  if (kind !== 'lane' && kind !== 'brain') {
    throw new UsageError(`"${kind}" is not an address kind; use lane or brain`);
  }
  if (id.length === 0) throw new UsageError(`"${raw}" has no id`);
  return { kind, id };
}

export function requirePositional(args: ParsedArgs, index: number, name: string): string {
  const value = args.positionals[index];
  if (value === undefined || value.length === 0) throw new UsageError(`missing <${name}>`);
  return value;
}

/** Everything from `index` on, joined. Lets a body or summary be typed unquoted. */
export function requireRest(args: ParsedArgs, index: number, name: string): string {
  const rest = args.positionals.slice(index).join(' ').trim();
  if (rest.length === 0) throw new UsageError(`missing <${name}>`);
  return rest;
}
