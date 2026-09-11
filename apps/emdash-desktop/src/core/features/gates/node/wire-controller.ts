import { createController, type Controller } from '@emdash/wire/rpc';
import { gatesContract } from '../api/contract';
import type { GatesVerificationService } from './verification-service';

export function createGatesWireController(service: GatesVerificationService): Controller {
  return createController(gatesContract, {
    getVerification: ({ jobId }) => service.getVerification(jobId),
    readEvidence: (input) => service.readEvidence(input),
    deleteEvidence: ({ jobId }) => service.deleteEvidence(jobId),
  });
}
