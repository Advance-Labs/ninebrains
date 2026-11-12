import { z } from 'zod';
import { COMMAND_CATALOG } from '@core/manifests/shared/command-catalog';
import type {
  InterfaceSettings,
  KeyboardSettings,
  OpenInSettings,
  SystemThemeSlots,
  Theme,
} from '@core/primitives/app-settings/api';
import { openInAppIdSchema } from '@core/primitives/open-in-apps/api/open-in-apps';
import { defineSettingsContribution } from '@core/primitives/settings/api';

const keyboardSettingsSchema = z
  .optional(
    z.object(
      Object.fromEntries(
        COMMAND_CATALOG.defs.flatMap((command) =>
          command.keybinding?.kind === 'settings'
            ? [[command.keybinding.settingsKey, z.string().nullable().optional()]]
            : []
        )
      ) as Record<string, z.ZodOptional<z.ZodNullable<z.ZodString>>>
    )
  )
  .default({});

const interfaceSettingsSchema = z.object({
  showTrayIcon: z.boolean(),
  taskHoverAction: z.enum(['delete', 'archive']),
  autoRightSidebarBehavior: z.boolean(),
  showLeftSidebarLineChanges: z.boolean(),
  showLeftSidebarPrStatus: z.boolean(),
  showLeftSidebarTimestamps: z.boolean(),
  hideContextBar: z.boolean(),
});

const themeSchema = z
  .enum(['emlight', 'emdark', 'emhardstyle'])
  .nullable()
  .catch(null)
  .optional()
  .default(null);

// Ninebrains: a slot must hold a theme of its own polarity; anything else falls back.
const systemThemeSlotsSchema = z.object({
  light: z.enum(['emlight']).catch('emlight'),
  dark: z.enum(['emdark', 'emhardstyle']).catch('emdark'),
});

const openInSettingsSchema = z.object({
  default: openInAppIdSchema,
  hidden: z.array(openInAppIdSchema),
});

export const keyboardSettingsContribution = defineSettingsContribution<
  'keyboard',
  KeyboardSettings
>({
  key: 'keyboard',
  schema: keyboardSettingsSchema,
  defaults: {},
});

export const interfaceSettingsContribution = defineSettingsContribution<
  'interface',
  InterfaceSettings
>({
  key: 'interface',
  schema: interfaceSettingsSchema,
  defaults: {
    showTrayIcon: true,
    taskHoverAction: 'delete',
    autoRightSidebarBehavior: false,
    showLeftSidebarLineChanges: true,
    showLeftSidebarPrStatus: true,
    showLeftSidebarTimestamps: true,
    hideContextBar: false,
  },
});

export const themeSettingsContribution = defineSettingsContribution<'theme', Theme>({
  key: 'theme',
  schema: themeSchema,
  defaults: null,
});

export const systemThemeSlotsSettingsContribution = defineSettingsContribution<
  'systemThemeSlots',
  SystemThemeSlots
>({
  key: 'systemThemeSlots',
  schema: systemThemeSlotsSchema.catch({ light: 'emlight', dark: 'emdark' }),
  defaults: { light: 'emlight', dark: 'emdark' },
});

export const openInSettingsContribution = defineSettingsContribution<'openIn', OpenInSettings>({
  key: 'openIn',
  schema: openInSettingsSchema,
  defaults: {
    default: 'terminal',
    hidden: [],
  },
});
