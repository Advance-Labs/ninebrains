/**
 * Test-only backend: runs requests in-process against a Brain the test
 * owns. It lives under test/ so it can never reach the shipped bin (SEC-01):
 * production brain-mcp only forwards over HTTP.
 */
import {
  type Brain,
  type BrainGrant,
  type ExecuteOptions,
  executeBrainRequest,
} from '@ninebrains/brain-core';
import type { BrainBackend } from '../src/backend';

/** `options.resolveBrainProject` plays main's token registry (L1: Brain recipients must exist). */
export function directBackend(
  brain: Brain,
  grant: BrainGrant,
  options: ExecuteOptions = {}
): BrainBackend {
  return {
    call: async (request) => executeBrainRequest(brain, grant, request, options),
    close: () => {},
  };
}
