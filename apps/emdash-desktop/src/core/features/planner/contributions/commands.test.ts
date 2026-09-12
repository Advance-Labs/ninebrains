import { describe, expect, it } from 'vitest';
import { windowScope } from '@core/manifests/browser/scope-catalog';
import { COMMAND_CATALOG } from '@core/manifests/shared/command-catalog';
import { COMMAND_PALETTE_CATALOG } from '@core/manifests/shared/command-palette-catalog';
import { openPlannerCommand } from './commands';

describe('planner.open', () => {
  it('is in the command catalog, the palette and the window scope', () => {
    expect(COMMAND_CATALOG.defs).toContain(openPlannerCommand);
    expect(COMMAND_PALETTE_CATALOG.items.map((item) => item.command.id)).toContain('planner.open');
    expect(windowScope.commands).toContain(openPlannerCommand);
  });

  it('runs with no input (palette) or with a project id (other slices)', () => {
    expect(openPlannerCommand.input.safeParse(undefined).success).toBe(true);
    expect(openPlannerCommand.input.safeParse({ projectId: 'p1' }).success).toBe(true);
    expect(openPlannerCommand.input.safeParse({ projectId: '' }).success).toBe(false);
  });
});
