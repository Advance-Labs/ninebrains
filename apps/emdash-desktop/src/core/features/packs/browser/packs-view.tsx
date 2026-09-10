import { PageLayout, SettingsRow, SettingsSection } from '@emdash/ui/react/patterns';
import { Alert, Badge, Select, Switch } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import React, { useEffect, useState } from 'react';
import {
  getProjectManagerStore,
  projectDisplayName,
} from '@core/features/projects/api/browser/stores/project-selectors';
import type { PackSecretStatus, PackSummary, PacksListing } from '../api';
import { getPacksClient } from '../api/browser/client';

export interface PacksProjectOption {
  id: string;
  name: string;
}

export const PacksView = observer(function PacksView() {
  const projects = [...getProjectManagerStore().projects.entries()].map(([id, store]) => ({
    id,
    name: projectDisplayName(store) ?? id,
  }));
  return <PacksPanel projects={projects} />;
});

function secretLine(secret: PackSecretStatus): string {
  return `${secret.name}: ${secret.description} Set it in ${secret.location}. ${secret.howToGet}`;
}

function MissingSecrets({ pack }: { pack: PackSummary }) {
  const missing = pack.secrets.filter((s) => !s.present);
  const required = missing.filter((s) => !s.optional);
  const optional = missing.filter((s) => s.optional);
  return (
    <>
      {required.length > 0 && (
        <Alert.Root status="warning">
          <Alert.Title>Missing secrets</Alert.Title>
          <Alert.Description>
            Servers that need these are left out of lane launches until they are set.
            <ul>
              {required.map((s) => (
                <li key={s.name}>{secretLine(s)}</li>
              ))}
            </ul>
          </Alert.Description>
        </Alert.Root>
      )}
      {optional.length > 0 && (
        <Alert.Root status="info">
          <Alert.Title>Optional secrets not set</Alert.Title>
          <Alert.Description>
            <ul>
              {optional.map((s) => (
                <li key={s.name}>{secretLine(s)}</li>
              ))}
            </ul>
          </Alert.Description>
        </Alert.Root>
      )}
    </>
  );
}

function PackSection({
  pack,
  canToggle,
  onToggle,
}: {
  pack: PackSummary;
  canToggle: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const servers = pack.mcpServers
    .map((s) => `${s.name} (${s.license}${s.optional ? ', optional' : ''})`)
    .join(', ');
  return (
    <div className="flex flex-col gap-2">
      <SettingsSection
        title={
          <span className="flex items-center gap-2">
            {pack.title}
            <Badge variant="outline">{pack.license}</Badge>
            {pack.source === 'user' && <Badge tone="info">User pack</Badge>}
          </span>
        }
      >
        <SettingsRow
          label="Enabled for this project"
          description={pack.description}
          control={
            <Switch
              aria-label={`Enable the ${pack.title} pack`}
              checked={pack.enabled}
              disabled={!canToggle}
              onCheckedChange={(checked) => onToggle(checked)}
            />
          }
        />
        <SettingsRow
          label="Roles"
          description={pack.roles.map((r) => r.title).join(', ')}
          control={null}
        />
        {pack.mcpServers.length > 0 && (
          <SettingsRow label="MCP servers" description={servers} control={null} />
        )}
        {pack.skills.length > 0 && (
          <SettingsRow
            label="Skills"
            description={pack.skills.map((s) => s.installId).join(', ')}
            control={null}
          />
        )}
        {pack.catalogLinks.length > 0 && (
          <SettingsRow
            label="Connect yourself"
            description={pack.catalogLinks.map((l) => `${l.name}: ${l.url}`).join(' · ')}
            control={null}
          />
        )}
        <SettingsRow label="Default gates" description={pack.gates.join(', ')} control={null} />
      </SettingsSection>
      <MissingSecrets pack={pack} />
    </div>
  );
}

export function PacksPanel({ projects }: { projects: PacksProjectOption[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [listing, setListing] = useState<PacksListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const projectId = projects.some((p) => p.id === selected) ? selected : (projects[0]?.id ?? null);

  useEffect(() => {
    let cancelled = false;
    void getPacksClient()
      .then((client) => client.list({ projectId }))
      .then((next) => {
        if (!cancelled) setListing(next);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const toggle = async (packId: string, enabled: boolean) => {
    if (!projectId) return;
    setPending(packId);
    try {
      const client = await getPacksClient();
      const result = await client.setEnabled({ projectId, packId, enabled });
      if (!result.success) {
        setError(result.error.message);
        return;
      }
      const on = new Set(result.data.enabledPackIds);
      setListing(
        (prev) =>
          prev && { ...prev, packs: prev.packs.map((p) => ({ ...p, enabled: on.has(p.id) })) }
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(null);
    }
  };

  const projectPicker =
    projects.length > 0 && projectId ? (
      <Select.Root value={projectId} onValueChange={(next) => setSelected(next as string)}>
        <Select.Trigger aria-label="Project" className="w-[200px]">
          <Select.Value>{projects.find((p) => p.id === projectId)?.name}</Select.Value>
        </Select.Trigger>
        <Select.Content align="end">
          {projects.map((p) => (
            <Select.Item key={p.id} value={p.id}>
              {p.name}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    ) : null;

  return (
    <div className="flex flex-col gap-6 text-foreground">
      <PageLayout.Header
        sticky
        title="Packs"
        description="Discipline packs give a project's lanes roles, skills, MCP servers and gates"
        actions={projectPicker}
      />
      {!projectId && (
        <Alert.Root status="info">
          <Alert.Description>Add a project to turn packs on for it.</Alert.Description>
        </Alert.Root>
      )}
      {error && (
        <Alert.Root status="destructive" onDismiss={() => setError(null)}>
          <Alert.Description>{error}</Alert.Description>
        </Alert.Root>
      )}
      {listing?.errors.map((e) => (
        <Alert.Root key={e.location} status="destructive">
          <Alert.Title>Pack {e.packId ?? e.location} could not be loaded</Alert.Title>
          <Alert.Description>{e.message}</Alert.Description>
        </Alert.Root>
      ))}
      {listing?.packs.map((pack) => (
        <PackSection
          key={pack.id}
          pack={pack}
          canToggle={projectId !== null && pending === null}
          onToggle={(enabled) => void toggle(pack.id, enabled)}
        />
      ))}
    </div>
  );
}
