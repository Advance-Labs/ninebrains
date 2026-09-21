import type { ContractClient } from '@emdash/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { releaseCheckContract, releaseCheckDomain } from '../contract';

export type ReleaseCheckClient = ContractClient<typeof releaseCheckContract>;

export function getReleaseCheckClient(): Promise<ReleaseCheckClient> {
  return domainClient<ReleaseCheckClient>(releaseCheckDomain, releaseCheckContract);
}
