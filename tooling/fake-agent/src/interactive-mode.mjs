// Interactive mode (no -p): a line-oriented stand-in for the TUI. Prints a
// banner and a "> " prompt, echoes each submitted line, and runs the script up
// to the next {waitForInput}. Accepts bracketed paste and \r or \n as submit, so
// the same input recipe used for real claude in a PTY works here.
import { runSteps } from './steps.mjs';

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

class LineReader {
  constructor(stdin) {
    this.queue = [];
    this.waiters = [];
    this.buf = '';
    this.ended = false;
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk) => this.push(chunk));
    stdin.on('end', () => {
      this.ended = true;
      for (const w of this.waiters.splice(0)) w(null);
    });
  }

  push(chunk) {
    this.buf += chunk;
    // Newlines inside a bracketed paste are content, not submits.
    let out = '';
    let inPaste = false;
    let i = 0;
    while (i < this.buf.length) {
      if (this.buf.startsWith(PASTE_START, i)) {
        inPaste = true;
        i += PASTE_START.length;
      } else if (this.buf.startsWith(PASTE_END, i)) {
        inPaste = false;
        i += PASTE_END.length;
      } else {
        const ch = this.buf[i++];
        if ((ch === '\r' || ch === '\n') && !inPaste) {
          if (!(ch === '\n' && out === '' && this.lastWasCr)) this.deliver(out);
          this.lastWasCr = ch === '\r';
          out = '';
        } else {
          out += ch;
          this.lastWasCr = false;
        }
      }
    }
    this.buf = inPaste ? PASTE_START + out : out;
  }

  deliver(line) {
    const w = this.waiters.shift();
    if (w) w(line);
    else this.queue.push(line);
  }

  next() {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.ended) return Promise.resolve(null);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

export async function runInteractiveMode(opts, { steps, io, env, openSession }) {
  const { stdout } = io;
  const ctx = await openSession();
  const reader = new LineReader(io.stdin);
  const say = (s) => stdout.write(s + '\n');

  say(`Fake Claude Code (fake-agent) | lane ${env.LANE_ID ?? '-'} | model ${ctx.model}`);
  say(`session ${ctx.sessionId}`);
  say(`mcp: ${ctx.mcpServers.map((s) => `${s.name} (${s.status})`).join(', ') || 'none'}`);
  ctx.hooks.fire('SessionStart', { source: typeof opts.resume === 'string' ? 'resume' : 'startup', model: ctx.model });

  const ui = {
    text: (text) => say(`● ${text}`),
    toolUse: (block) => say(`● ${block.name}(${JSON.stringify(block.input)})`),
    toolResult: (_id, content, isError) =>
      say(`  ⎿ ${isError ? 'Error: ' : ''}${Array.isArray(content) ? content.map((b) => b.text ?? '').join(' ') : content}`),
    askPermission: async (name, input) => {
      ctx.hooks.fire('PermissionRequest', { tool_name: name, tool_input: input });
      ctx.hooks.fire('Notification', {
        message: `Claude needs your permission to use ${name}`,
        title: 'Permission needed',
        notification_type: 'permission_prompt',
      });
      say(`Do you want to proceed? (tool ${name})`);
      say('❯ 1. Yes');
      say('  2. No');
      const answer = (await reader.next()) ?? '2';
      return answer.trim() === '' || answer.trim() === '1' || /^y/i.test(answer.trim());
    },
  };

  let cursor = 0;
  let exitCode = 0;
  let pending = opts.prompt; // an argv prompt counts as the first submitted line
  for (;;) {
    stdout.write('> ');
    const line = pending ?? (await reader.next());
    pending = undefined;
    if (line === null || line.trim() === '/exit') break;
    if (!line.trim()) continue;
    say(`you said: ${line}`);
    ctx.state.prompt = line;
    ctx.hooks.fire('UserPromptSubmit', { prompt: line });
    const outcome = steps ? await runSteps(ctx, steps, ui, cursor) : { next: 0 };
    cursor = outcome.next;
    ctx.hooks.fire('Stop', { stop_hook_active: false });
    if (outcome.exitCode !== undefined) {
      exitCode = outcome.exitCode;
      break;
    }
  }
  ctx.hooks.fire('SessionEnd', { reason: 'prompt_input_exit' });
  await ctx.close();
  return exitCode;
}
