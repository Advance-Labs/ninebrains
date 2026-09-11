import { z } from 'zod';
import { defineSettingsContribution } from '@core/primitives/settings/api';

export const GATES_SETTINGS_KEY = 'ninebrains.gates' as const;

export const rigorLevelSchema = z.number().int().min(0).max(10);

export const gatesSettingsSchema = z.object({
  /** 0-10. Which verification gates attach to a job by default (gates-core `rigorToGates`). */
  testingRigor: rigorLevelSchema,
  /** 0-10. At 6 or more, code and UI jobs also get the security review. */
  securityRigor: rigorLevelSchema,
  /** SEC-24: gate evidence (screenshots, logs) older than this is deleted. */
  evidenceRetentionDays: z.number().int().min(1).max(3650),
});

export type GatesSettings = z.infer<typeof gatesSettingsSchema>;

export const DEFAULT_GATES_SETTINGS: GatesSettings = {
  testingRigor: 5,
  securityRigor: 5,
  evidenceRetentionDays: 30,
};

export const gatesSettingsContribution = defineSettingsContribution<
  typeof GATES_SETTINGS_KEY,
  GatesSettings
>({
  key: GATES_SETTINGS_KEY,
  schema: gatesSettingsSchema,
  defaults: DEFAULT_GATES_SETTINGS,
});
