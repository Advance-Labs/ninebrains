/**
 * SEC-12: no permission bypass, ever. One guard for every agent spawn, attended or not.
 *
 * The run supervisor (unattended and reviewer runs) calls `assertSafeArgv` inside `spawnInGroup`.
 * The attended launch-config builder must call it on the FULL argv it hands the PTY, including
 * upstream's `providerConfig.extraArgs` and the `autoApproveFlag`, so a flag injected anywhere
 * upstream (user settings, a Brain-built config) still cannot reach the CLI.
 *
 * Before matching, every argument is normalised (review finding M2):
 * - `--flag=value` is split; attached short values (`-sVALUE`, `-s=VALUE`) and combined short flags
 *   (`-ps x`) are expanded per the provider's short-flag table.
 * - Inline `--settings` JSON is parsed, so JSON escapes (`bypassPermissions`) and nesting
 *   can't hide a value. Codex `-c key=value` TOML strings are decoded (`-`, `\x..`, literal
 *   strings) the same way.
 * - Flag names and values match case-insensitively.
 *
 * Config-bearing flags (`--settings`, `-c`/`--config`, `--profile`, `--mcp-config`, `--add-dir`)
 * are refused unless their value is one Ninebrains generated itself, passed in `trusted`: the
 * absolute paths of the settings and MCP files it wrote, and the exact `-c` overrides it built. A
 * settings file path that is not in `trusted` is refused. Use the `=` form for the variadic
 * `--mcp-config` and `--add-dir`: in the space form every following non-flag token is a value.
 */
import { resolve } from 'node:path';

export class UnsafeArgvError extends Error {
  constructor(
    readonly token: string,
    reason = 'a permission or sandbox bypass'
  ) {
    super(`Refusing to spawn an agent: ${reason}: ${JSON.stringify(token)}`);
    this.name = 'UnsafeArgvError';
  }
}

export interface ArgvGuardOptions {
  /** Values Ninebrains generated for config-bearing flags: file paths and Codex `-c` overrides. */
  trusted?: Iterable<string>;
  /**
   * Which CLI the argv is for. It decides what short flags mean (`-c` is Claude's `--continue` but
   * Codex's `--config`). `any` (default) reads every ambiguous short flag the strict way.
   */
  provider?: 'claude' | 'codex' | 'any';
}

/** Exact flags, lower-case. */
const BANNED_FLAGS = new Set([
  // Claude
  '--dangerously-skip-permissions',
  '--allow-dangerously-skip-permissions',
  // Codex
  '--dangerously-bypass-approvals-and-sandbox',
  '--dangerously-bypass-hook-trust',
  '--full-auto',
  '--yolo',
  // Codex routes approvals to an automatic reviewer instead of refusing them.
  '--approve-for-me',
]);

/** Any flag whose name mentions these is treated as a bypass, including future spellings. */
const BANNED_FLAG_WORDS = /(dangerous|bypass|yolo|skip-permissions)/i;

/** Values that switch the permission or sandbox layer off, wherever they appear. */
const BANNED_VALUES: readonly RegExp[] = [
  /bypass\s*permissions/i,
  /danger[\s_-]*full[\s_-]*access/i,
  /"allowUnsandboxedCommands"\s*:\s*true/i,
  /"dangerouslyDisableSandbox"\s*:\s*true/i,
];

/** Flags whose value must come from `trusted`. */
const CONFIG_FLAGS = new Set(['--settings', '--config', '--profile', '--mcp-config', '--add-dir']);

/** Long flags that take a value; the variadic ones swallow every following non-flag token. */
const VALUE_FLAGS = new Set([
  '--permission-mode',
  '--sandbox',
  '--settings',
  '--config',
  '--profile',
  '--ask-for-approval',
  '--cd',
  '--model',
  '--append-system-prompt',
  '--system-prompt',
  '--resume',
  '--name',
  '--session-id',
  '--output-format',
]);
const VARIADIC_FLAGS = new Set([
  '--mcp-config',
  '--add-dir',
  '--allowedtools',
  '--allowed-tools',
  '--disallowedtools',
  '--disallowed-tools',
  '--tools',
]);

interface Short {
  long: string;
  value: boolean;
}
const flag = (long: string, value = true): Short => ({ long, value });
const CODEX_SHORT: Record<string, Short> = {
  s: flag('--sandbox'),
  c: flag('--config'),
  p: flag('--profile'),
  a: flag('--ask-for-approval'),
  m: flag('--model'),
  i: flag('--image'),
  C: flag('--cd'),
};
const CLAUDE_SHORT: Record<string, Short> = {
  p: flag('--print', false),
  c: flag('--continue', false),
  r: flag('--resume'),
  n: flag('--name'),
};
/** Unknown provider: Codex's meaning wins where the two disagree, because it is the stricter. */
const ANY_SHORT: Record<string, Short> = { ...CLAUDE_SHORT, ...CODEX_SHORT };
const SHORTS = { claude: CLAUDE_SHORT, codex: CODEX_SHORT, any: ANY_SHORT };

/**
 * Throws `UnsafeArgvError` on any permission or sandbox bypass, or on a config-bearing flag whose
 * value Ninebrains did not generate. Also rejects non-string entries and NUL bytes, which can
 * truncate arguments at the OS boundary.
 */
export function assertSafeArgv(argv: readonly unknown[], options: ArgvGuardOptions = {}): void {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');
  const tokens = argv.map((token, i) => {
    if (typeof token !== 'string') throw new TypeError(`argv[${i}] is not a string`);
    if (token.includes('\0')) throw new UnsafeArgvError(token, 'a NUL byte');
    return token;
  });
  const trusted = new Set<string>();
  for (const value of options.trusted ?? []) trusted.add(value).add(resolve(value));
  const shorts = SHORTS[options.provider ?? 'any'];
  const value = (name: string, raw: string) => checkValue(name, raw, trusted);

  let positionalOnly = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (positionalOnly || token === '-' || !token.startsWith('-')) {
      value('', token);
      continue;
    }
    if (token === '--') {
      positionalOnly = true;
      continue;
    }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      const name = (eq < 0 ? token : token.slice(0, eq)).toLowerCase();
      checkName(name, token);
      if (eq >= 0) value(name, token.slice(eq + 1));
      else if (VARIADIC_FLAGS.has(name)) {
        while (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) value(name, tokens[++i]);
      } else if (VALUE_FLAGS.has(name) || CONFIG_FLAGS.has(name)) {
        if (i + 1 < tokens.length) value(name, tokens[++i]);
      }
      continue;
    }
    // A short cluster: `-p`, `-sVALUE`, `-s=VALUE`, `-ps value`.
    const letters = token.slice(1);
    for (let j = 0; j < letters.length; j++) {
      const short = shorts[letters[j]];
      if (!short) continue;
      checkName(short.long, token);
      if (!short.value) continue;
      const rest = letters.slice(j + 1).replace(/^=/, '');
      if (rest) value(short.long, rest);
      else if (i + 1 < tokens.length) value(short.long, tokens[++i]);
      break;
    }
  }
}

function checkName(name: string, token: string): void {
  const lower = name.toLowerCase();
  if (BANNED_FLAGS.has(lower) || BANNED_FLAG_WORDS.test(lower)) throw new UnsafeArgvError(token);
}

function checkValue(name: string, raw: string, trusted: ReadonlySet<string>): void {
  if (CONFIG_FLAGS.has(name) && !trusted.has(raw)) {
    throw new UnsafeArgvError(`${name} ${raw}`, 'a config flag whose value Ninebrains did not write');
  }
  const decoded =
    name === '--settings' ? decodeSettings(raw) : name === '--config' ? decodeToml(raw) : raw;
  for (const text of [raw, decoded]) {
    if (BANNED_VALUES.some((re) => re.test(text))) throw new UnsafeArgvError(raw);
  }
}

/** Inline settings JSON, canonicalised (escapes decoded), with a structural sandbox-off check. */
function decodeSettings(raw: string): string {
  if (!raw.trim().startsWith('{')) return raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UnsafeArgvError(raw, 'inline settings that are not valid JSON');
  }
  const sandbox = (parsed as { sandbox?: { enabled?: unknown } } | null)?.sandbox;
  if (sandbox && typeof sandbox === 'object' && sandbox.enabled === false) {
    throw new UnsafeArgvError(raw, 'settings that turn the sandbox off');
  }
  return JSON.stringify(parsed);
}

const TOML_ESCAPES: Record<string, string> = {
  b: '\b',
  t: '\t',
  n: '\n',
  f: '\f',
  r: '\r',
  e: '\x1b',
  '"': '"',
  '\\': '\\',
};

/**
 * Replaces every TOML string literal in a `-c key=value` override with its decoded content, so
 * `"danger-full-access"` reads as `danger-full-access`. Keys and values are both covered.
 */
export function decodeToml(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const quote = text[i];
    if (quote !== '"' && quote !== "'") {
      out += text[i++];
      continue;
    }
    const delimiter = text.startsWith(quote.repeat(3), i) ? quote.repeat(3) : quote;
    let j = i + delimiter.length;
    while (j < text.length && !text.startsWith(delimiter, j)) {
      if (quote === "'" || text[j] !== '\\') {
        out += text[j++];
        continue;
      }
      const escape = text[j + 1] ?? '';
      const hexLength = { u: 4, U: 8, x: 2 }[escape];
      if (hexLength) {
        const code = Number.parseInt(text.slice(j + 2, j + 2 + hexLength), 16);
        if (!Number.isFinite(code) || code > 0x10ffff) {
          throw new UnsafeArgvError(text, 'an invalid TOML escape');
        }
        out += String.fromCodePoint(code);
        j += 2 + hexLength;
      } else if (/\s/.test(escape)) {
        // Line-ending backslash in a multi-line string: drop the whitespace that follows.
        j += 1;
        while (j < text.length && /\s/.test(text[j])) j++;
      } else {
        out += TOML_ESCAPES[escape] ?? escape;
        j += 2;
      }
    }
    i = j + delimiter.length;
  }
  return out;
}
