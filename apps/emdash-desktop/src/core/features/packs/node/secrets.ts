/**
 * Secrets are referenced by name in pack.json and resolved here at launch.
 * The app injects the real store (keychain, env, …); packs never hold values.
 */
export interface SecretResolver {
  /** The secret's value, or undefined when it is not set. */
  resolve(name: string): Promise<string | undefined>;
  /** Tells the user where to set it, e.g. "environment variable NINEBRAINS_SECRET_X". */
  describeLocation(name: string): string;
}

export const DEFAULT_SECRET_ENV_PREFIX = 'NINEBRAINS_SECRET_';

/** Reads `NINEBRAINS_SECRET_<NAME>` from an environment. Good for development and CI. */
export function createEnvSecretResolver(
  env: Readonly<Record<string, string | undefined>>,
  prefix = DEFAULT_SECRET_ENV_PREFIX
): SecretResolver {
  return {
    resolve: async (name) => {
      const value = env[`${prefix}${name}`]?.trim();
      return value ? value : undefined;
    },
    describeLocation: (name) => `environment variable ${prefix}${name}`,
  };
}

/** Used until the app wires a secret store: every secret reads as missing. */
export const unconfiguredSecretResolver: SecretResolver = {
  resolve: async () => undefined,
  describeLocation: () => 'no secret store is configured yet',
};
