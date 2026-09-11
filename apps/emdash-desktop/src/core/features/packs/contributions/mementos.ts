import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import { z } from 'zod';
import { projectSubject } from '@core/features/projects/contributions/subject';
import { days, defineMemento } from '@core/primitives/mementos/api';
import { appSubject } from '@core/primitives/subjects/api';

// Pack toggles are durable user choices, not UI state, so they must outlive the
// default 60-day memento sweep.
const KEEP = { tier: 'persisted' as const, maxAge: days(3650), maxEntries: 10_000 };

export const packsProjectPrefsSchema = defineVersionedSchema()
  .initial('1', z.object({ version: z.literal('1'), enabledPackIds: z.array(z.string()) }))
  .build();
export type PacksProjectPrefs = typeof packsProjectPrefsSchema.Type;

/** Enabled packs for one project. Deleted with the project (subject sweep). */
export const packsProjectPrefsMemento = defineMemento({
  id: 'packs.project-prefs',
  subject: projectSubject,
  schema: packsProjectPrefsSchema,
  default: { version: '1' as const, enabledPackIds: [] },
  retention: KEEP,
});

export const packsPrefsIndexSchema = defineVersionedSchema()
  .initial('1', z.object({ version: z.literal('1'), projectIds: z.array(z.string()) }))
  .build();
export type PacksPrefsIndex = typeof packsPrefsIndexSchema.Type;

/**
 * Projects that have stored pack prefs. Mementos can't be listed by id, and the
 * skill sync needs "is this pack enabled anywhere?". Entries for deleted
 * projects are harmless: their per-project memento is gone, so they read empty.
 */
export const packsPrefsIndexMemento = defineMemento({
  id: 'packs.prefs-index',
  subject: appSubject,
  schema: packsPrefsIndexSchema,
  default: { version: '1' as const, projectIds: [] },
  retention: KEEP,
});
