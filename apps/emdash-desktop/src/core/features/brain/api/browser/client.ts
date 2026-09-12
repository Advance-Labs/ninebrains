import type { ContractClient } from '@emdash/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { brainContract, brainDomain } from '../contract';

export type BrainClient = ContractClient<typeof brainContract>;

export function getBrainClient(): Promise<BrainClient> {
  return domainClient<BrainClient>(brainDomain, brainContract);
}
