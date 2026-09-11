import { createEventStreamHost } from '@emdash/wire/live';
import { lanesContract } from '../api';

export const lanesEvents = createEventStreamHost(lanesContract.events);
