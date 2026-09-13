/**
 * Settings → Gates: a project's test command. SEC-20: the tests gate's command comes only from
 * this user action, never from a job record or a worktree file. Stored in the existing gates
 * project prefs memento through the rigor resolver, so the runner sees it on the next job.
 */
import { err, ok, type Result } from '@emdash/shared';
import type { GatesError, GatesProjectPrefsView } from '../api/contract';
import type { RigorResolver } from './rigor/rigor';

/** Matches the memento schema's limit. */
export const TEST_COMMAND_MAX_CHARS = 500;

export interface GatesProjectPrefsService {
  getProjectPrefs(projectId: string): Promise<Result<GatesProjectPrefsView, GatesError>>;
  /** An empty or whitespace command clears it, which blocks code and UI jobs again. */
  setTestCommand(input: {
    projectId: string;
    testCommand: string | null;
  }): Promise<Result<GatesProjectPrefsView, GatesError>>;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createProjectPrefsService(
  rigor: Pick<RigorResolver, 'projectPrefs' | 'setProjectPrefs'>
): GatesProjectPrefsService {
  const view = (projectId: string): GatesProjectPrefsView => ({
    projectId,
    testCommand: rigor.projectPrefs(projectId).testCommand,
  });

  return {
    async getProjectPrefs(projectId) {
      return ok(view(projectId));
    },

    async setTestCommand({ projectId, testCommand }) {
      const command = testCommand?.trim() ?? '';
      if (/[\r\n]/.test(command)) {
        return err({ type: 'refused', message: 'The test command must be a single line.' });
      }
      if (command.length > TEST_COMMAND_MAX_CHARS) {
        return err({
          type: 'refused',
          message: `The test command must be at most ${TEST_COMMAND_MAX_CHARS} characters.`,
        });
      }
      try {
        await rigor.setProjectPrefs(projectId, {
          ...rigor.projectPrefs(projectId),
          testCommand: command.length > 0 ? command : null,
        });
      } catch (error) {
        return err({
          type: 'unavailable',
          message: `Could not save the test command: ${message(error)}`,
        });
      }
      return ok(view(projectId));
    },
  };
}

const UNAVAILABLE: GatesError = {
  type: 'unavailable',
  message: 'The gates are not running yet, so project settings cannot be read or saved.',
};

/** Used by the controller manifest until boot wiring passes the real service. */
export const unavailableProjectPrefsService: GatesProjectPrefsService = {
  getProjectPrefs: async () => err(UNAVAILABLE),
  setTestCommand: async () => err(UNAVAILABLE),
};
