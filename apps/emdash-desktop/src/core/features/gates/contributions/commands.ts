import { z } from 'zod';
import { defineCommand } from '@core/primitives/commands/api';

/**
 * Opens the "Job verification" modal for a Brain job. Other slices run this
 * command by id with `{ jobId }` (or open the `jobVerificationModal` modal id)
 * so they never import this slice's browser code.
 */
export const openJobVerificationCommand = defineCommand({
  id: 'gates.openJobVerification',
  title: 'Show Job Verification',
  description: 'Gate results, screenshots and logs for each attempt of a job',
  category: 'Gates',
  icon: 'shield-check',
  input: z.object({ jobId: z.string().min(1).max(64) }),
});

/** Available everywhere (window scope). */
export const GATES_WINDOW_COMMAND_DEFS = [openJobVerificationCommand] as const;

export const GATES_COMMAND_DEFS = [openJobVerificationCommand] as const;
