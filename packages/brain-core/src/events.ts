import type { Lane, Message, Job, JobState } from './types';

export interface BrainEventMap {
  /** Any change to a job: state, assignment, content or archival. */
  jobChanged: { job: Job; previousState: JobState | null };
  /** A job hit the attempt cap or was blocked by a lane or the Brain. */
  jobBlocked: { job: Job; reason: string };
  messageSent: { message: Message };
  laneChanged: { lane: Lane };
}

export type BrainEventType = keyof BrainEventMap;

export type BrainEvent = {
  [K in BrainEventType]: { type: K; payload: BrainEventMap[K] };
}[BrainEventType];

/** A persisted event, readable by other processes sharing the DB file. */
export type StoredBrainEvent = BrainEvent & { seq: number; at: number };

type Listener<K extends BrainEventType> = (payload: BrainEventMap[K]) => void;

/**
 * Minimal typed emitter. Listeners run synchronously after the change has
 * been committed. A throwing listener is reported to `onListenerError` and
 * never breaks the operation that emitted the event.
 */
export class BrainEmitter {
  private readonly listeners = new Map<BrainEventType, Set<Listener<never>>>();

  constructor(private readonly onListenerError: (error: unknown) => void = () => {}) {}

  on<K extends BrainEventType>(type: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as Listener<never>);
    return () => this.off(type, listener);
  }

  off<K extends BrainEventType>(type: K, listener: Listener<K>): void {
    this.listeners.get(type)?.delete(listener as Listener<never>);
  }

  emit<K extends BrainEventType>(type: K, payload: BrainEventMap[K]): void {
    for (const listener of this.listeners.get(type) ?? []) {
      try {
        (listener as Listener<K>)(payload);
      } catch (error) {
        this.onListenerError(error);
      }
    }
  }

  listenerCount(type: BrainEventType): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}
