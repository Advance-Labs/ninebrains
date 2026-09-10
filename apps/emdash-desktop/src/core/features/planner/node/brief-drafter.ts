import { err } from '@emdash/shared';
import type { BriefDrafter } from './ports';

export const DRAFTING_UNAVAILABLE_MESSAGE =
  'Drafting needs the Brain. It can draft once unattended Brain runs are connected.';

/** v0.1 stub. The Brain replaces it with an unattended run that proposes nodes and edges. */
export function createUnavailableBriefDrafter(): BriefDrafter {
  return {
    draftFromBrief: async () => err({ type: 'unavailable', message: DRAFTING_UNAVAILABLE_MESSAGE }),
  };
}
