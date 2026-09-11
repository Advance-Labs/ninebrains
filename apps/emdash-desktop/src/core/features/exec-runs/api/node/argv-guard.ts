/**
 * SEC-12: no permission bypass, ever. One guard for every agent spawn, attended or not.
 *
 * The launch-config builder (attended lanes) and the run supervisor (unattended and reviewer
 * runs) both call `assertSafeArgv` right before spawning, so a flag injected anywhere upstream
 * (provider `autoApprove`, user `extraArgs`, a Brain-built config) still cannot reach the CLI.
 */

export class UnsafeArgvError extends Error {
  constructor(readonly token: string) {
    super(`Refusing to spawn an agent with a permission-bypass argument: ${JSON.stringify(token)}`);
    this.name = 'UnsafeArgvError';
  }
}

/** Exact flags (either spelling), matched on the part before any `=`. */
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
  /bypassPermissions/i,
  /danger-full-access/i,
  /"allowUnsandboxedCommands"\s*:\s*true/i,
  /"dangerouslyDisableSandbox"\s*:\s*true/i,
];

/** An inline `--settings` JSON that turns the sandbox off. Checked only on settings values. */
const SANDBOX_OFF = /"sandbox"\s*:\s*\{[^}]*"enabled"\s*:\s*false/i;

/** Flags whose next token is a value we must inspect (the non-`=` spelling). */
const VALUE_FLAGS = new Set([
  '--permission-mode',
  '--sandbox',
  '-s',
  '--settings',
  '-c',
  '--config',
]);

/**
 * Throws `UnsafeArgvError` on any permission or sandbox bypass. Also rejects non-string
 * entries and NUL bytes, which can truncate arguments at the OS boundary.
 */
export function assertSafeArgv(argv: readonly unknown[]): void {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (typeof token !== 'string') throw new TypeError(`argv[${i}] is not a string`);
    if (token.includes('\0')) throw new UnsafeArgvError(token);

    const isFlag = token.startsWith('-');
    const name = isFlag ? token.split('=', 1)[0] : undefined;
    if (name !== undefined) {
      if (BANNED_FLAGS.has(name) || BANNED_FLAG_WORDS.test(name)) throw new UnsafeArgvError(token);
    }
    // Inline values (`--permission-mode=bypassPermissions`, `-c sandbox_mode="danger-full-access"`,
    // inline settings JSON) and bare values after a value flag are all checked the same way.
    const inspectValue = !isFlag || token.includes('=');
    const previous = i > 0 ? argv[i - 1] : undefined;
    const afterValueFlag = typeof previous === 'string' && VALUE_FLAGS.has(previous);
    if ((inspectValue || afterValueFlag) && BANNED_VALUES.some((re) => re.test(token))) {
      throw new UnsafeArgvError(token);
    }
    const isSettingsValue = name === '--settings' || previous === '--settings';
    if (isSettingsValue && SANDBOX_OFF.test(token)) throw new UnsafeArgvError(token);
  }
}
