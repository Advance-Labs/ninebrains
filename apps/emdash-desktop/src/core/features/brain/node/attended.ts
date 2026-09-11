/**
 * SEC-15: pasting a job into an attended lane's PTY.
 *
 * - Paste only when the lane's hook status is `idle` or `completed`. Never when
 *   it is `awaiting-input` (a paste plus Enter would answer a permission prompt),
 *   `working`, `error`, or unknown (before SessionStart, a first-run dialog may
 *   own the input box).
 * - The single exception is Claude's idle reminder ("Claude is waiting for your
 *   input"), which upstream classifies as `awaiting-input`/`idle_prompt` though
 *   no prompt is open. It is matched by its exact text, never by type alone.
 * - Strip ESC and C0 controls except `\n` and `\t`, and refuse a body that
 *   carries a bracketed-paste delimiter, so it cannot close the paste early.
 * - Bracketed paste, then a separate `\r` about 300 ms later (spike §1).
 */

export type LaneAgentStatus = 'idle' | 'working' | 'awaiting-input' | 'error' | 'completed';

export interface LaneAgentState {
  status: LaneAgentStatus;
  notificationType?: string;
  message?: string;
}

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
const IDLE_REMINDER = /^Claude is waiting for your input\.?$/;

export function canPaste(state: LaneAgentState | undefined): boolean {
  if (!state) return false;
  if (state.status === 'idle' || state.status === 'completed') return true;
  return (
    state.status === 'awaiting-input' &&
    state.notificationType === 'idle_prompt' &&
    IDLE_REMINDER.test(state.message?.trim() ?? '')
  );
}

export class UnsafePasteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafePasteError';
  }
}

/** Removes ESC and C0/C1 controls except newline and tab. Throws on paste delimiters. */
export function sanitizePasteBody(body: string): string {
  if (body.includes(PASTE_START) || body.includes(PASTE_END)) {
    throw new UnsafePasteError('The job text contains a bracketed-paste delimiter.');
  }
  // eslint-disable-next-line no-control-regex
  return body.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}

export interface PasteDeps {
  /** Current hook state for the conversation, read right before each write. */
  state(): LaneAgentState | undefined;
  write(data: string): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export type PasteOutcome = 'pasted' | 'not-ready' | 'unsafe';

/** Pastes and submits one prompt, re-checking the paste rule before each write. */
export async function pastePrompt(
  deps: PasteDeps,
  prompt: string,
  submitDelayMs = 300
): Promise<PasteOutcome> {
  let body: string;
  try {
    body = sanitizePasteBody(prompt);
  } catch (error) {
    if (error instanceof UnsafePasteError) return 'unsafe';
    throw error;
  }
  if (!canPaste(deps.state())) return 'not-ready';
  await deps.write(`${PASTE_START}${body}${PASTE_END}`);
  await deps.sleep(submitDelayMs);
  // A permission prompt that opened in between must not be answered by Enter.
  const now = deps.state();
  if (now?.status === 'awaiting-input' && !canPaste(now)) return 'not-ready';
  await deps.write('\r');
  return 'pasted';
}
