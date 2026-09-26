import { describe, expect, it } from 'vitest';
import { NINEBRAINS_TMUX_SOCKET, tmuxArgs, tmuxShellCommand } from './tmux-socket';

describe('tmuxArgs', () => {
  it('puts the socket selector ahead of the subcommand, where tmux requires it', () => {
    // tmux parses -L as a server option, so it must precede the verb; appending it
    // would make tmux treat it as an argument to list-sessions.
    expect(tmuxArgs(['list-sessions', '-F', '#{pid}'])).toEqual([
      '-L',
      NINEBRAINS_TMUX_SOCKET,
      'list-sessions',
      '-F',
      '#{pid}',
    ]);
  });

  it("does not mutate the caller's arguments", () => {
    const args = ['kill-session'];
    tmuxArgs(args);
    expect(args).toEqual(['kill-session']);
  });
});

describe('tmuxShellCommand', () => {
  it('names the socket so a shell line cannot reach the default server', () => {
    expect(tmuxShellCommand()).toBe(`tmux -L ${NINEBRAINS_TMUX_SOCKET}`);
  });
});
