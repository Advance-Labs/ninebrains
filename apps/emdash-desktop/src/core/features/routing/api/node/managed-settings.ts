/**
 * SEC-41 for attended and unattended Claude: Claude Code applies a settings file's `env` block
 * over the process env. Our per-launch `--settings` outranks user, project and local settings
 * (spike §13 Q2), so the launch writes its gateway values there too. Managed settings
 * (enterprise policy) outrank `--settings` per Claude Code's docs, so a managed `env` that sets a
 * gateway variable means we cannot know where the credential goes: the launch is refused.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GATEWAY_ENV } from './launch-env';

/** Claude Code's managed-settings locations (not provider credentials, SEC-34). */
export function managedSettingsPaths(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'darwin') {
    return ['/Library/Application Support/ClaudeCode/managed-settings.json'];
  }
  if (platform === 'win32') {
    return [
      join(process.env.ProgramData ?? 'C:\\ProgramData', 'ClaudeCode', 'managed-settings.json'),
    ];
  }
  return ['/etc/claude-code/managed-settings.json'];
}

/** Gateway variables a settings JSON's `env` block sets to a non-empty value. */
export function gatewayVarsInSettings(json: unknown): string[] {
  const env = (json as { env?: unknown } | null)?.env;
  if (!env || typeof env !== 'object') return [];
  return GATEWAY_ENV.filter((name) => {
    const value = (env as Record<string, unknown>)[name];
    return typeof value === 'string' && value.trim() !== '';
  });
}

export type ReadText = (path: string) => string | undefined;

const readIfPresent: ReadText = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

/** Managed settings that set a gateway variable: `[path, names]`. Unreadable or invalid JSON is skipped. */
export function managedGatewaySettings(
  paths: readonly string[] = managedSettingsPaths(),
  read: ReadText = readIfPresent
): Array<{ path: string; names: string[] }> {
  const found: Array<{ path: string; names: string[] }> = [];
  for (const path of paths) {
    const text = read(path);
    if (text === undefined) continue;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      continue;
    }
    const names = gatewayVarsInSettings(json);
    if (names.length > 0) found.push({ path, names });
  }
  return found;
}
