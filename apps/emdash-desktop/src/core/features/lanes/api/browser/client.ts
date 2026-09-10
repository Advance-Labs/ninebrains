import type { ContractClient } from '@emdash/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { lanesContract, lanesDomain } from '../contract';

export type LanesRpcClient = ContractClient<typeof lanesContract>;

export function getLanesClient(): Promise<LanesRpcClient> {
  return domainClient<LanesRpcClient>(lanesDomain, lanesContract);
}
