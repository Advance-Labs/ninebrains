import { createController, type Controller } from '@emdash/wire/rpc';
import { gatesContract } from '../api/contract';
import {
  unavailableProjectPrefsService,
  type GatesProjectPrefsService,
} from './project-prefs-service';
import {
  unavailableVerificationService,
  type GatesVerificationService,
} from './verification-service';

/** What the `gates` domain serves: the Job verification modal and Settings → Gates. */
export type GatesWireService = GatesVerificationService & GatesProjectPrefsService;

/** Used by the controller manifest until boot wiring passes the real services. */
export const unavailableGatesWireService: GatesWireService = {
  ...unavailableVerificationService,
  ...unavailableProjectPrefsService,
};

export function createGatesWireController(service: GatesWireService): Controller {
  return createController(gatesContract, {
    getVerification: ({ jobId }) => service.getVerification(jobId),
    readEvidence: (input) => service.readEvidence(input),
    deleteEvidence: ({ jobId }) => service.deleteEvidence(jobId),
    getProjectPrefs: ({ projectId }) => service.getProjectPrefs(projectId),
    setTestCommand: (input) => service.setTestCommand(input),
  });
}
