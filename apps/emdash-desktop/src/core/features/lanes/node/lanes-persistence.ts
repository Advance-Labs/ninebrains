import type { Scope } from '@emdash/shared/concurrency';
import { remote, snapshot, whenReady, type RemoteMember } from '@emdash/wire/state';
import { mementosWireContract } from '@core/primitives/mementos/api';
import type { MementosRuntimeClient } from '@core/services/runtime-broker/api/clients';
import type { LanesGridConfig } from '../api';
import { lanesGridMemento } from '../contributions/mementos';
import type { LanePersistencePort } from './lane-ports';

type MementoMember = RemoteMember<typeof mementosWireContract.memento>;

/**
 * Persists the lanes grid in the `lanes.grid` memento (subject `app`) through
 * the mementos worker. Main is the only writer of this memento.
 */
export function createMementoLanePersistence(options: {
  getClient(): Promise<MementosRuntimeClient>;
  scope: Scope;
}): LanePersistencePort {
  let memberPromise: Promise<MementoMember> | null = null;
  const getMember = () => {
    memberPromise ??= options.getClient().then((client) =>
      remote(mementosWireContract.memento, client.memento, { scope: options.scope })({
        mementoId: lanesGridMemento.id,
        kind: 'app',
        key: '',
      })
    );
    return memberPromise;
  };

  return {
    async load(): Promise<LanesGridConfig | null> {
      const member = await getMember();
      await whenReady(member.states.value, { scope: options.scope });
      const row = snapshot(member.states.value).value;
      if (!row) return null;
      const parsed = lanesGridMemento.schema.parseJson(row.data);
      return parsed ? { tabs: parsed.tabs } : null;
    },
    async save(config: LanesGridConfig): Promise<void> {
      const member = await getMember();
      const invocation = await member.mutations.save({
        version: lanesGridMemento.schema.currentVersion,
        data: lanesGridMemento.schema.serialize({ version: '1', tabs: config.tabs }),
        updatedAt: Date.now(),
      });
      if (!invocation.result.success) {
        throw new Error(`lanes grid save failed: ${JSON.stringify(invocation.result.error)}`);
      }
    },
  };
}
