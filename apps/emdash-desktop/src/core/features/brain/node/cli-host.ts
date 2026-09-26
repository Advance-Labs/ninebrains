import type { Result } from '@emdash/shared';
import { peek } from '@emdash/wire/state';
import { BrainError as CoreBrainError, type BrainHostOps } from '@ninebrains/brain-core';
import type { LaneRunMode } from '@core/features/lanes/api';
import type { BrainError } from '../api';
import type { BrainService } from './brain-service';

/**
 * The app-side half of the user-role surface (M5): the controls the Brain drawer
 * used to own, exposed to the CLI through the same hardened endpoint the lanes
 * use. Every method is a pass-through to `BrainService`, so there is one
 * implementation of each control and the CLI cannot reach behaviour the app does
 * not already have.
 *
 * `BrainService` answers with `Result<T, BrainError>`; brain-core's executor
 * expects a value or a thrown `BrainError`. `unwrap` is that translation, and it
 * is the only place the two error vocabularies meet.
 */
export function createBrainHostOps(service: BrainService): BrainHostOps {
  const views = service.views;
  return {
    listDone: (projectId, limit) => unwrap(service.listDone(projectId, limit)),
    listNotes: (projectId, limit) => unwrap(service.listNotes(projectId, limit)),
    dispatcherStatus: () => Promise.resolve(peek(views.dispatcher)),
    setDispatcherPaused: (paused) => unwrap(service.setDispatcherPaused(paused)),
    setLaneMode: async (laneId, mode) =>
      unwrap(await service.setLaneMode(laneId, mode as LaneRunMode)),
    listSessions: () => Promise.resolve(peek(views.sessions)),
    startBrain: async (projectId) => unwrap(await service.startBrain(projectId)),
    stopBrain: async (brainId) => unwrap(await service.stopBrain(brainId)),
    stopAll: async () => unwrap(await service.stopAll()),
    clearStop: () => unwrap(service.clearStop()),
  };
}

/**
 * Maps the app's `BrainError` onto brain-core's codes.
 *
 * `conflict` and `unavailable` become `INVALID`: brain-core's `BrainErrorCode`
 * has no member for either, and the operator needs to read the reason ("STOP is
 * latched. Clear it first.") to know what to do next. Those messages are written
 * by this codebase, so returning them does not widen SEC-07.
 *
 * `internal` throws a plain `Error` instead, so SEC-07 applies unchanged: the
 * caller sees a bare `INTERNAL` and the detail goes to `onInternalError`.
 */
async function unwrap<T>(result: Result<T, BrainError>): Promise<T> {
  if (result.success) return result.data;
  const { type, message } = result.error;
  switch (type) {
    case 'not-found':
      throw new CoreBrainError('NOT_FOUND', message);
    case 'forbidden':
      throw new CoreBrainError('FORBIDDEN', message);
    case 'invalid':
    case 'conflict':
    case 'unavailable':
      throw new CoreBrainError('INVALID', message);
    default:
      throw new Error(`brain host op failed: ${message}`);
  }
}
