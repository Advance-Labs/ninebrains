import { createController, type Controller } from '@emdash/wire/rpc';
import { routingContract } from '../api';
import type { RoutingService } from './routing-service';

/** Thin delegate. No procedure returns a key (SEC-40). */
export function createRoutingWireController(service: RoutingService): Controller {
  return createController(routingContract, {
    listProfiles: () => service.listProfiles(),
    agentCliStatus: () => service.agentCliStatus(),
    saveProfile: (input) => service.saveProfile(input),
    setProfileKey: ({ profileId, key }) => service.setProfileKey(profileId, key),
    clearProfileKey: ({ profileId }) => service.clearProfileKey(profileId),
    deleteProfile: ({ profileId }) => service.deleteProfile(profileId),
    testConnection: ({ profileId }) => service.testConnection(profileId),
  });
}
