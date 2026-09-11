import type { ContractClient } from '@emdash/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { packsContract, packsDomain } from '../contract';

export type PacksClient = ContractClient<typeof packsContract>;

export function getPacksClient(): Promise<PacksClient> {
  return domainClient<PacksClient>(packsDomain, packsContract);
}
