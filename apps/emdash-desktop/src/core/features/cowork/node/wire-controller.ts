import type { Duplex } from 'node:stream';
import { createEventStreamHost } from '@emdash/wire/live';
import { createController, type Controller } from '@emdash/wire/rpc';
import { coworkContract } from '../api';
import { CoworkService } from './cowork-service';

export function createCoworkWireController(
  openSocket: (connectionId: string, socketPath: string) => Promise<Duplex>
): Controller {
  const events = createEventStreamHost(coworkContract.events);
  const service = new CoworkService(openSocket, (event) => events.emit(undefined, event));
  const controller = createController(coworkContract, {
    events,
    join: (input) => service.join(input),
    sendUpdate: (input) => service.sendUpdate(input),
    save: (input) => service.save(input),
    leave: (input) => service.leave(input),
  });
  return {
    ...controller,
    async dispose() {
      service.dispose();
      await controller.dispose?.();
    },
  };
}
