import type { ContractClient } from '@emdash/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { routingContract, routingDomain } from '../contract';

export type RoutingClient = ContractClient<typeof routingContract>;

export function getRoutingClient(): Promise<RoutingClient> {
  return domainClient<RoutingClient>(routingDomain, routingContract);
}
