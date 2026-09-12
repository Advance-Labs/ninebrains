import { describe, expect, it } from 'vitest';
import { canPaste, pastePrompt, sanitizePasteBody, type LaneAgentState } from './attended';

function harness(states: Array<LaneAgentState | undefined>) {
  const writes: string[] = [];
  let reads = 0;
  const deps = {
    state: () => states[Math.min(reads++, states.length - 1)],
    write: async (data: string) => void writes.push(data),
    sleep: async () => {},
  };
  return { deps, writes };
}

const idle: LaneAgentState = { status: 'idle' };
const completed: LaneAgentState = { status: 'completed' };
const permission: LaneAgentState = {
  status: 'awaiting-input',
  notificationType: 'permission_prompt',
  message: 'Claude needs your permission to use Bash',
};

describe('SEC-15 paste cannot inject keystrokes', () => {
  it('refuses a body that closes the bracketed paste, and writes nothing', async () => {
    const { deps, writes } = harness([idle]);
    expect(await pastePrompt(deps, 'do it\x1b[201~\ry\r')).toBe('unsafe');
    expect(await pastePrompt(deps, '\x1b[200~nested')).toBe('unsafe');
    expect(writes).toEqual([]);
  });

  it('never writes to a lane that is awaiting input', async () => {
    const { deps, writes } = harness([permission]);
    expect(await pastePrompt(deps, 'job')).toBe('not-ready');
    expect(writes).toEqual([]);
  });

  it('never writes before the first hook (a first-run dialog may own the input)', async () => {
    const { deps, writes } = harness([undefined]);
    expect(await pastePrompt(deps, 'job')).toBe('not-ready');
    expect(writes).toEqual([]);
  });

  it('pastes in brackets, then submits with a separate carriage return', async () => {
    for (const state of [idle, completed]) {
      const { deps, writes } = harness([state]);
      expect(await pastePrompt(deps, 'line one\nline two')).toBe('pasted');
      expect(writes).toEqual(['\x1b[200~line one\nline two\x1b[201~', '\r']);
    }
  });

  it('holds the Enter if a permission prompt opened after the paste', async () => {
    const { deps, writes } = harness([idle, permission]);
    expect(await pastePrompt(deps, 'job')).toBe('not-ready');
    expect(writes).toEqual(['\x1b[200~job\x1b[201~']);
  });

  it('strips ESC and C0 controls except newline and tab', () => {
    expect(sanitizePasteBody('a\x1b[31mred\x07\tb\r\nc\x00')).toBe('a[31mred\tb\nc');
  });

  it("treats only Claude's exact idle reminder as pasteable while awaiting input", () => {
    expect(
      canPaste({
        status: 'awaiting-input',
        notificationType: 'idle_prompt',
        message: 'Claude is waiting for your input',
      })
    ).toBe(true);
    expect(
      canPaste({ status: 'awaiting-input', notificationType: 'idle_prompt', message: 'Approve?' })
    ).toBe(false);
    expect(canPaste({ status: 'working' })).toBe(false);
    expect(canPaste({ status: 'error' })).toBe(false);
  });
});
