import type { ContractClient } from '@emdash/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { gatesContract, gatesDomain } from '../contract';

export type GatesClient = ContractClient<typeof gatesContract>;

export function getGatesClient(): Promise<GatesClient> {
  return domainClient<GatesClient>(gatesDomain, gatesContract);
}
