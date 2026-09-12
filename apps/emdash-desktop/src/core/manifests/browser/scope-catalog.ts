import { DEV_PERF_COMMAND_DEFS } from '@core/features/dev-perf/contributions/commands';
import { fileTreeScope } from '@core/features/editor/contributions/scopes';
import { GATES_WINDOW_COMMAND_DEFS } from '@core/features/gates/contributions/commands';
import { BRAIN_WINDOW_COMMAND_DEFS } from '@core/features/brain/contributions/commands';
import { LANES_WINDOW_COMMAND_DEFS } from '@core/features/lanes/contributions/commands';
import { lanesViewScope } from '@core/features/lanes/contributions/scopes';
import { settingsScope } from '@core/features/settings/contributions/scopes';
import { taskListScope, taskViewScope } from '@core/features/tasks/contributions/scopes';
import {
  defineWindowScope,
  editorScope,
  modalScope,
  paneScope,
  terminalInputScope,
  terminalSearchScope,
} from '@core/features/workbench/contributions/scopes';
import { COMMAND_CATALOG } from '../shared/command-catalog';

export const windowScope = defineWindowScope([
  ...DEV_PERF_COMMAND_DEFS,
  ...LANES_WINDOW_COMMAND_DEFS,
  ...GATES_WINDOW_COMMAND_DEFS,
  ...BRAIN_WINDOW_COMMAND_DEFS,
]);

export const SCOPE_CATALOG = [
  windowScope,
  taskViewScope,
  fileTreeScope,
  modalScope,
  settingsScope,
  paneScope,
  editorScope,
  terminalInputScope,
  terminalSearchScope,
  taskListScope,
  lanesViewScope,
] as const;

const catalogCommands = new Set(COMMAND_CATALOG.defs);
for (const scope of SCOPE_CATALOG) {
  const unknownCommands = scope.commands.filter((command) => !catalogCommands.has(command));
  if (unknownCommands.length > 0) {
    throw new Error(
      `View scope ${scope.id} declares commands outside COMMAND_CATALOG: ${unknownCommands
        .map((command) => command.id)
        .join(', ')}`
    );
  }
}

export type ViewScopeId = (typeof SCOPE_CATALOG)[number]['id'];
