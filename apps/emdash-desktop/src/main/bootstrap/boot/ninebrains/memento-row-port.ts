import type { Scope } from '@emdash/shared/concurrency';
import { remote, snapshot, whenReady, type RemoteMember } from '@emdash/wire/state';
import type { MementoRowPort } from '@core/features/planner/node/ports';
import { mementosWireContract, type MementoModelKey } from '@core/primitives/mementos/api';
import type { MementosRuntimeClient } from '@core/services/runtime-broker/api/clients';

type MementoMember = RemoteMember<typeof mementosWireContract.memento>;

/**
 * The planner's raw memento row port over the mementos runtime (planner README,
 * "Wiring"): one leased live member per key, read after it is ready, written
 * through the `save` mutation. Main-owned, like the lanes grid persistence.
 */
export function createMementoRowPort(options: {
  getClient(): Promise<MementosRuntimeClient>;
  scope: Scope;
}): MementoRowPort {
  const members = new Map<string, Promise<MementoMember>>();
  const member = (key: MementoModelKey) => {
    const id = JSON.stringify([key.mementoId, key.kind, key.key]);
    let found = members.get(id);
    if (!found) {
      found = options
        .getClient()
        .then((client) =>
          remote(mementosWireContract.memento, client.memento, { scope: options.scope })(key)
        );
      members.set(id, found);
    }
    return found;
  };
  return {
    async read(key) {
      const live = await member(key);
      await whenReady(live.states.value, { scope: options.scope });
      return snapshot(live.states.value).value ?? null;
    },
    async write(key, row) {
      const live = await member(key);
      const invocation = await live.mutations.save(row);
      if (!invocation.result.success) {
        throw new Error(`memento save failed: ${JSON.stringify(invocation.result.error)}`);
      }
    },
  };
}
