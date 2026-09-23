import { domainClient } from '@core/primitives/wire/browser/connection';
import type { ContractClient } from '@emdash/wire/rpc';
import { coworkContract, coworkDomain } from '../contract';

export type CoworkClient = ContractClient<typeof coworkContract>;

export function getCoworkClient(): Promise<CoworkClient> {
  return domainClient<CoworkClient>(coworkDomain, coworkContract);
}
