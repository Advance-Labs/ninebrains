/**
 * Ninebrains: a Claude Code plugin id, `name@marketplace`, as `claude plugin list` prints it. A
 * non-dash first character and no quote, backslash or whitespace, so an id can never become a flag
 * or break out of a JSON key (`\w` also admits `_`, which is harmless). Shared by the settings
 * schema and the launch path (`features/conversations/api/plugin-skip.ts`).
 */
export const PLUGIN_ID = /^[A-Za-z0-9][\w.-]*@[A-Za-z0-9][\w.-]*$/;
export const MAX_SKIP_PLUGINS = 100;
