// Parses the subset of `claude` CLI flags Ninebrains uses. Mirrors commander's
// behaviour where it matters: variadic flags swallow following tokens until the
// next flag (so a positional prompt placed after --allowedTools is eaten, just
// like the real CLI), `--` ends option parsing, and `--flag=value` works.

const VARIADIC = {
  '--mcp-config': 'mcpConfigs',
  '--allowedTools': 'allowedTools',
  '--allowed-tools': 'allowedTools',
  '--disallowedTools': 'disallowedTools',
  '--disallowed-tools': 'disallowedTools',
  '--add-dir': 'addDirs',
  '--tools': 'tools',
};

const VALUE = {
  '--output-format': 'outputFormat',
  '--input-format': 'inputFormat',
  '--model': 'model',
  '--append-system-prompt': 'appendSystemPrompt',
  '--system-prompt': 'systemPrompt',
  '--session-id': 'sessionId',
  '--max-turns': 'maxTurns',
  '--permission-mode': 'permissionMode',
  '--settings': 'settings',
  '--setting-sources': 'settingSources',
  '--fallback-model': 'fallbackModel',
  '--max-budget-usd': 'maxBudgetUsd',
  '--permission-prompts': 'permissionPrompts',
  '--name': 'name',
  '-n': 'name',
};

const OPTIONAL_VALUE = { '--resume': 'resume', '-r': 'resume' };

const BOOL = {
  '-p': 'print',
  '--print': 'print',
  '--verbose': 'verbose',
  '--strict-mcp-config': 'strictMcpConfig',
  '--continue': 'continue',
  '-c': 'continue',
  '--dangerously-skip-permissions': 'dangerouslySkipPermissions',
  '--include-partial-messages': 'includePartialMessages',
  '--no-session-persistence': 'noSessionPersistence',
  '--fork-session': 'forkSession',
  '-h': 'help',
  '--help': 'help',
  '-v': 'version',
  '--version': 'version',
};

const PERMISSION_MODES = ['acceptEdits', 'auto', 'bypassPermissions', 'manual', 'default', 'dontAsk', 'plan'];
const OUTPUT_FORMATS = ['text', 'json', 'stream-json'];

export class ArgError extends Error {}

/** Splits "Bash(git *) Edit,Read" into ["Bash(git *)", "Edit", "Read"]. */
export function splitToolList(value) {
  const out = [];
  let cur = '';
  let depth = 0;
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ',' || /\s/.test(ch))) {
      if (cur) out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function parseArgs(argv) {
  const opts = {
    print: false,
    outputFormat: 'text',
    inputFormat: 'text',
    verbose: false,
    mcpConfigs: [],
    allowedTools: [],
    disallowedTools: [],
    addDirs: [],
    tools: undefined,
    permissionMode: 'default',
    positionals: [],
  };
  const tokens = [...argv];
  let endOfOptions = false;

  while (tokens.length) {
    let tok = tokens.shift();
    if (endOfOptions || !tok.startsWith('-') || tok === '-') {
      opts.positionals.push(tok);
      continue;
    }
    if (tok === '--') {
      endOfOptions = true;
      continue;
    }
    let inline;
    const eq = tok.indexOf('=');
    if (tok.startsWith('--') && eq > 0) {
      inline = tok.slice(eq + 1);
      tok = tok.slice(0, eq);
    }

    if (BOOL[tok]) {
      opts[BOOL[tok]] = true;
    } else if (VALUE[tok]) {
      const v = inline ?? tokens.shift();
      if (v === undefined) throw new ArgError(`error: option '${tok}' argument missing`);
      opts[VALUE[tok]] = v;
    } else if (OPTIONAL_VALUE[tok]) {
      const next = inline ?? (tokens[0] && !tokens[0].startsWith('-') ? tokens.shift() : true);
      opts[OPTIONAL_VALUE[tok]] = next;
    } else if (VARIADIC[tok]) {
      const key = VARIADIC[tok];
      const values = inline !== undefined ? [inline] : [];
      while (inline === undefined && tokens.length && !tokens[0].startsWith('-')) values.push(tokens.shift());
      if (!values.length) throw new ArgError(`error: option '${tok}' argument missing`);
      if (key === 'mcpConfigs' || key === 'addDirs') opts[key].push(...values);
      else opts[key] = [...(opts[key] ?? []), ...values.flatMap(splitToolList)];
    } else {
      throw new ArgError(`error: unknown option '${tok}'`);
    }
  }

  if (opts.dangerouslySkipPermissions) opts.permissionMode = 'bypassPermissions';
  if (!PERMISSION_MODES.includes(opts.permissionMode)) {
    throw new ArgError(`error: option '--permission-mode <mode>' argument '${opts.permissionMode}' is invalid.`);
  }
  if (!OUTPUT_FORMATS.includes(opts.outputFormat)) {
    throw new ArgError(`error: option '--output-format <format>' argument '${opts.outputFormat}' is invalid.`);
  }
  if (opts.maxTurns !== undefined) {
    const n = Number(opts.maxTurns);
    if (!Number.isInteger(n) || n < 1) throw new ArgError(`error: --max-turns must be a positive integer`);
    opts.maxTurns = n;
  }
  opts.prompt = opts.positionals.length ? opts.positionals.join(' ') : undefined;
  return opts;
}
