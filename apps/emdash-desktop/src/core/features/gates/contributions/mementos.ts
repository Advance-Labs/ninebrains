import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import { z } from 'zod';
import { projectSubject } from '@core/features/projects/contributions/subject';
import { days, defineMemento } from '@core/primitives/mementos/api';
import { appSubject } from '@core/primitives/subjects/api';
import { rigorLevelSchema } from './settings';

// Rigor overrides are durable user choices, not UI state, so they must outlive
// the default 60-day memento sweep.
const KEEP = { tier: 'persisted' as const, maxAge: days(3650), maxEntries: 10_000 };

const gatesProjectPrefsV1Schema = z.object({
  version: z.literal('1'),
  /** Null means "use the app setting". */
  testingRigor: rigorLevelSchema.nullable(),
  securityRigor: rigorLevelSchema.nullable(),
  /** SEC-20: the tests gate's command. Only the user sets it, never a job or a worktree file. */
  testCommand: z.string().max(500).nullable(),
});

const gatesProjectPrefsV2Schema = gatesProjectPrefsV1Schema.extend({
  version: z.literal('2'),
  /** `testsGate.allowNetwork` (SEC-20/R12). Set only from Settings → Gates. Default false. */
  allowNetwork: z.boolean(),
  /** `testsGate.allowUnsandboxed` (SEC-20/R11). Set only from Settings → Gates. Default false. */
  allowUnsandboxed: z.boolean(),
});

/**
 * v1: testingRigor, securityRigor, testCommand.
 * v2 (SEC-08, W7 testsgate-prefs): adds allowNetwork/allowUnsandboxed, both false for every row
 * stored before this change — `VersionedSchema.safeParse` only validates the stored version's
 * schema in dev, so a plain `.default(false)` on the v1 schema would leave both fields `undefined`
 * on a v1 row's fast path in production. The `up()` migration sets them explicitly instead.
 */
export const gatesProjectPrefsSchema = defineVersionedSchema()
  .initial('1', gatesProjectPrefsV1Schema)
  .version('2', gatesProjectPrefsV2Schema, (prev) => ({
    ...prev,
    version: '2' as const,
    allowNetwork: false,
    allowUnsandboxed: false,
  }))
  .build();
export type GatesProjectPrefs = typeof gatesProjectPrefsSchema.Type;

/** Per-project rigor override and test command. Deleted with the project (subject sweep). */
export const gatesProjectPrefsMemento = defineMemento({
  id: 'gates.project-prefs',
  subject: projectSubject,
  schema: gatesProjectPrefsSchema,
  default: {
    version: '2' as const,
    testingRigor: null,
    securityRigor: null,
    testCommand: null,
    allowNetwork: false,
    allowUnsandboxed: false,
  },
  retention: KEEP,
});

export const gatesPrefsIndexSchema = defineVersionedSchema()
  .initial('1', z.object({ version: z.literal('1'), projectIds: z.array(z.string()) }))
  .build();
export type GatesPrefsIndex = typeof gatesPrefsIndexSchema.Type;

/**
 * Projects with stored overrides. Mementos can't be listed by id, and the gate
 * floor is resolved synchronously, so every override is loaded up front.
 */
export const gatesPrefsIndexMemento = defineMemento({
  id: 'gates.prefs-index',
  subject: appSubject,
  schema: gatesPrefsIndexSchema,
  default: { version: '1' as const, projectIds: [] },
  retention: KEEP,
});
