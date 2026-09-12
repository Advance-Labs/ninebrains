import type { Scope } from '@emdash/shared/concurrency';
import { remote, snapshot, whenReady, type RemoteMember } from '@emdash/wire/state';
import { mementosWireContract } from '@core/primitives/mementos/api';
import type { MementosRuntimeClient } from '@core/services/runtime-broker/api/clients';
import { brainSessionsMemento } from '../contributions/mementos';
import type { BrainSessionPorts, StoredBrainSession } from './brain-sessions';

type MementoMember = RemoteMember<typeof mementosWireContract.memento>;

/** Persists Brain sessions in the `brain.sessions` memento. Main is the only writer. */
export function createMementoBrainSessionsPersistence(options: {
  getClient(): Promise<MementosRuntimeClient>;
  scope: Scope;
}): BrainSessionPorts['persistence'] {
  let memberPromise: Promise<MementoMember> | null = null;
  const getMember = () => {
    memberPromise ??= options.getClient().then((client) =>
      remote(mementosWireContract.memento, client.memento, { scope: options.scope })({
        mementoId: brainSessionsMemento.id,
        kind: 'app',
        key: '',
      })
    );
    return memberPromise;
  };

  return {
    async load(): Promise<StoredBrainSession[] | null> {
      const member = await getMember();
      await whenReady(member.states.value, { scope: options.scope });
      const row = snapshot(member.states.value).value;
      if (!row) return null;
      return brainSessionsMemento.schema.parseJson(row.data)?.sessions ?? null;
    },
    async save(sessions: StoredBrainSession[]): Promise<void> {
      const member = await getMember();
      const invocation = await member.mutations.save({
        version: brainSessionsMemento.schema.currentVersion,
        data: brainSessionsMemento.schema.serialize({ version: '1', sessions }),
        updatedAt: Date.now(),
      });
      if (!invocation.result.success) {
        throw new Error(`brain sessions save failed: ${JSON.stringify(invocation.result.error)}`);
      }
    },
  };
}
