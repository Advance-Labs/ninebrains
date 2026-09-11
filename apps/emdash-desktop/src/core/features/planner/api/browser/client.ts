import type { ContractClient } from '@emdash/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { plannerContract, plannerDomain } from '../contract';

export type PlannerClient = ContractClient<typeof plannerContract>;

export function getPlannerClient(): Promise<PlannerClient> {
  return domainClient<PlannerClient>(plannerDomain, plannerContract);
}
