import { createController, type Controller } from '@emdash/wire/rpc';
import { packsContract } from '../api';
import type { PacksService } from './packs-service';

export function createPacksWireController(service: PacksService): Controller {
  return createController(packsContract, {
    list: ({ projectId }) => service.list(projectId),
    setEnabled: ({ projectId, packId, enabled }) => service.setEnabled(projectId, packId, enabled),
    setSecret: ({ name, value }) => service.setSecret(name, value),
    clearSecret: ({ name }) => service.clearSecret(name),
  });
}
