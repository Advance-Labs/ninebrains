/** Shared fixtures for the packs slice tests. Not imported by production code. */
import type { PackManifest } from '../api/pack-schema';
import type { LoadedPack } from './loader';
import type { SecretResolver } from './secrets';

export const SKILL_MD = '---\nname: demo\ndescription: A demo skill.\n---\n\n# Demo\n';

export function manifest(overrides: Partial<PackManifest> = {}): PackManifest {
  return {
    id: 'demo',
    version: '0.1.0',
    title: 'Demo',
    description: 'A demo pack.',
    license: 'Apache-2.0',
    roles: [
      {
        id: 'worker',
        title: 'Worker',
        kind: 'code',
        systemPrompt: 'You are the demo worker lane. Do the job you are given.',
        gates: ['tests'],
      },
    ],
    skills: [],
    mcpServers: [],
    gates: ['reviewer'],
    requiredSecrets: [],
    ...overrides,
  };
}

export function loaded(m: PackManifest, skills: Record<string, string> = {}): LoadedPack {
  return { manifest: m, source: 'bundled', location: `bundled:${m.id}`, skills };
}

export function secretsFrom(values: Record<string, string>): SecretResolver & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    resolve: async (name) => {
      calls.push(name);
      return values[name];
    },
    describeLocation: (name) => `test store entry ${name}`,
  };
}
