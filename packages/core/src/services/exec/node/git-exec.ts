import { createBoundExec, type BoundExec } from '#services/exec/api';
import { hardenGitExec } from '#services/exec/api/hardened-git';

export type GitExecFactory = (cwd: string) => BoundExec;

/**
 * Non-interactive git exec bound to `cwd`. Git needs the full process env (PATH, HOME,
 * SSH_AUTH_SOCK, credential helpers), so it is composed in here — exec itself never
 * merges `process.env`. Every prompt channel is disabled so background git work fails
 * fast instead of blocking on credential or host-key input.
 */
export function createNonInteractiveGitExec(cwd: string): BoundExec {
  // Ninebrains: T36 hardening against repo config a lane can write; these calls are app-driven.
  const exec = createBoundExec({
    file: 'git',
    cwd,
    env: {
      ...process.env,
      LC_ALL: 'C',
      LANG: 'C',
      LANGUAGE: 'C',
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
      GIT_ASKPASS: '',
      SSH_ASKPASS: '',
      ...(process.env.GIT_SSH_COMMAND ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }),
    },
  });
  return hardenGitExec(exec, 'app-write');
}

export const defaultGitExecFactory: GitExecFactory = (cwd) => createNonInteractiveGitExec(cwd);
