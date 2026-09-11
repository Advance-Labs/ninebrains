import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import {
  throwSkillsRuntimeResolveError,
  type SkillsRuntimeBroker,
} from '@core/features/skills/api/runtime-adapter';
import type { SkillsPort } from './skills-sync';

/**
 * SkillsPort over the upstream agent-config skills manager on the local host.
 * Pack skills install globally (SEAMS §3.16); the `nb-` prefix keeps them apart.
 */
export function createRuntimeSkillsPort(runtimes: SkillsRuntimeBroker): SkillsPort {
  const agentConfig = async () => {
    const runtime = await runtimes.client(LOCAL_HOST_REF);
    if (!runtime.success) throwSkillsRuntimeResolveError(runtime.error);
    return runtime.data.agentConfig;
  };

  return {
    async listInstalled() {
      const client = await agentConfig();
      const snapshot = await client.skills.state(undefined, 'list').snapshot();
      return snapshot.data.map((skill) => ({
        id: skill.installId ?? skill.id,
        skillMdContent: skill.skillMdContent,
      }));
    },
    async install({ id, content }) {
      const client = await agentConfig();
      const result = await client.installSkill({
        skill: { id, installId: id, skillMdContent: content, source: 'local' },
      });
      if (!result.success) throw new Error(result.error.message);
    },
    async remove(id) {
      const client = await agentConfig();
      const result = await client.removeSkill({ name: id });
      if (!result.success) throw new Error(result.error.message);
    },
  };
}
