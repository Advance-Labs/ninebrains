/**
 * Ninebrains: Claude Code plugins to leave off in task sessions.
 *
 * Every agent session starts every enabled plugin's MCP and LSP servers, so per-session costs
 * multiply with the number of agents (#158). Claude Code has no per-directory switch for user
 * plugins, but a per-launch `--settings` outranks user, project and local settings, and a plugin
 * set to false there starts none of its servers. This builds that one argument.
 */
import { MAX_SKIP_PLUGINS, PLUGIN_ID } from '@core/primitives/app-settings/api/plugin-id';

export function parseSkipPlugins(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter((id) => PLUGIN_ID.test(id)))];
}

/** True when the user's own arguments already pass `--settings`, which ours would silently override. */
export function hasOwnSettingsArg(args: readonly string[]): boolean {
  return args.some((arg) => arg === '--settings' || arg.startsWith('--settings='));
}

/**
 * ponytail: on Windows, cmd and PowerShell quoting may mangle the JSON, so the skip list may not
 * apply there (Brain lanes' --settings shares this). A settings file path would avoid it.
 */
export function pluginSkipArgs(
  providerId: string,
  skipPlugins: readonly string[] | undefined,
  userArgs: readonly string[] = []
): string[] {
  if (providerId !== 'claude' || hasOwnSettingsArg(userArgs)) return [];
  const ids = (skipPlugins ?? []).filter((id) => PLUGIN_ID.test(id)).slice(0, MAX_SKIP_PLUGINS);
  if (ids.length === 0) return [];
  return [
    '--settings',
    JSON.stringify({ enabledPlugins: Object.fromEntries(ids.map((id) => [id, false])) }),
  ];
}
