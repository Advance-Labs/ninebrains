import type { ContractClient } from '@emdash/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { brainContract, brainDomain } from '../contract';

export type BrainRpcClient = ContractClient<typeof brainContract>;

export function getBrainClient(): Promise<BrainRpcClient> {
  return domainClient<BrainRpcClient>(brainDomain, brainContract);
}
