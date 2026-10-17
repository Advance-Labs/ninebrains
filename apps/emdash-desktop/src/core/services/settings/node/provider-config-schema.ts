import { z } from 'zod';
import type { ProviderCustomConfig } from '@core/primitives/app-settings/api';
import { MAX_SKIP_PLUGINS, PLUGIN_ID } from '@core/primitives/app-settings/api/plugin-id';

export const providerCustomConfigEntrySchema: z.ZodType<ProviderCustomConfig> = z.object({
  extraArgs: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  skipPlugins: z.array(z.string().regex(PLUGIN_ID)).max(MAX_SKIP_PLUGINS).optional(),
});

export const providerConfigDefaults: Record<string, ProviderCustomConfig> = {};
