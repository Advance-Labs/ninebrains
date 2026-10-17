/**
 * Ninebrains: Claude Code plugins to leave off in task sessions.
 *
 * Every agent session starts every enabled plugin's MCP and LSP servers, so per-session costs
 * multiply with the number of agents (#158). Claude Code has no per-directory switch for user
 * plugins, but a per-launch `--settings` outranks user, project and local settings, and a plugin
 * set to false there starts none of its servers. This builds that one argument.
 */

/** `name@marketplace`, as `claude plugin list` prints it. Anything else is dropped. */
const PLUGIN_ID = /^[A-Za-z0-9][\w.-]*@[A-Za-z0-9][\w.-]*$/;

export function parseSkipPlugins(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter((id) => PLUGIN_ID.test(id)))];
}

export function pluginSkipArgs(
  providerId: string,
  skipPlugins: readonly string[] | undefined
): string[] {
  if (providerId !== 'claude') return [];
  const ids = (skipPlugins ?? []).filter((id) => PLUGIN_ID.test(id));
  if (ids.length === 0) return [];
  return [
    '--settings',
    JSON.stringify({ enabledPlugins: Object.fromEntries(ids.map((id) => [id, false])) }),
  ];
}
