import { createEventStreamHost } from '@emdash/wire/live';
import { brainContract } from '../api';

export const brainEvents = createEventStreamHost(brainContract.events);
