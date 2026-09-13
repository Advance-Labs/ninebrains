import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { Button, Input, Select } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { useAgentInstallationStatuses } from '@core/features/agents/api/browser/use-agent-installation-statuses';
import type { PacksListing } from '@core/features/packs/api';
import { getPacksClient } from '@core/features/packs/api/browser/client';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
import {
  LaneRoutingFields,
  type LaneRoutingValue,
} from '@core/features/routing/contributions/lanes';
import { SSH_UNSUPPORTED_MESSAGE, type LaneProvider, type LaneSlot } from '../../api';
import { runLaneAction } from '../use-lanes';

const PROVIDERS: { id: LaneProvider; label: string }[] = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
];

const NO_ROLE = '';

export type AddLaneProject = { id: string; name: string; type: 'local' | 'ssh' };

/** A role of one of the project's enabled packs, as the form offers it. */
export type AddLaneRole = {
  /** `pack:role`, which is always unambiguous. */
  value: string;
  label: string;
  provider?: LaneProvider;
  model?: string;
  /** The role's subagent tier (Lever A). */
  subagentModel?: string;
};

export function rolesOfEnabledPacks(listing: PacksListing | null): AddLaneRole[] {
  return (listing?.packs ?? [])
    .filter((pack) => pack.enabled)
    .flatMap((pack) =>
      pack.roles.map((role) => ({
        value: `${pack.id}:${role.id}`,
        label: `${role.title} (${pack.title})`,
        ...(role.provider ? { provider: role.provider } : {}),
        ...(role.model ? { model: role.model } : {}),
        ...(role.subagentModel ? { subagentModel: role.subagentModel } : {}),
      }))
    );
}

/** Empty-slot state: pick a project and an installed agent, then add a lane. */
export const AddLaneForm = observer(function AddLaneForm({
  tabId,
  slot,
}: {
  tabId: string;
  slot: LaneSlot;
}) {
  const projects = [...getProjectManagerStore().projects.values()].flatMap((store) =>
    store.data ? [{ id: store.data.id, name: store.data.name, type: store.data.type }] : []
  );
  const { data: statuses } = useAgentInstallationStatuses(LOCAL_HOST_REF);
  const installed = PROVIDERS.filter((provider) =>
    statuses?.some((status) => status.id === provider.id && status.status === 'available')
  ).map((provider) => provider.id);
  return (
    <AddLaneFields
      tabId={tabId}
      slot={slot}
      projects={projects}
      installed={statuses ? installed : null}
    />
  );
});

/**
 * The form itself, fed plain data so it renders without the app stores.
 * `installed` is null while agent detection is still running.
 */
export function AddLaneFields({
  tabId,
  slot,
  projects,
  installed,
}: {
  tabId: string;
  slot: LaneSlot;
  projects: readonly AddLaneProject[];
  installed: readonly LaneProvider[] | null;
}) {
  const [projectId, setProjectId] = useState<string | undefined>();
  const [provider, setProvider] = useState<LaneProvider | undefined>();
  const [roleValue, setRoleValue] = useState(NO_ROLE);
  const [model, setModel] = useState('');
  const [routing, setRouting] = useState<LaneRoutingValue>({});
  const [roles, setRoles] = useState<AddLaneRole[]>([]);
  const [busy, setBusy] = useState(false);

  const agents = PROVIDERS.filter((candidate) => installed?.includes(candidate.id));
  const selectedProject =
    projects.find((project) => project.id === projectId) ??
    projects.find((project) => project.type === 'local');
  const selectedProvider = agents.find((candidate) => candidate.id === provider) ?? agents[0];
  const role = roles.find((candidate) => candidate.value === roleValue);
  const isRemote = selectedProject?.type === 'ssh';
  const canAdd = Boolean(selectedProject && selectedProvider && !isRemote && !busy);

  // Roles come from the packs this project has enabled (Settings → Packs).
  const selectedProjectId = selectedProject?.id;
  useEffect(() => {
    setRoleValue(NO_ROLE);
    if (!selectedProjectId) {
      setRoles([]);
      return;
    }
    let cancelled = false;
    void getPacksClient()
      .then((client) => client.list({ projectId: selectedProjectId }))
      .then((listing) => !cancelled && setRoles(rolesOfEnabledPacks(listing)))
      .catch(() => !cancelled && setRoles([]));
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  const pickRole = (value: string) => {
    setRoleValue(value);
    const next = roles.find((candidate) => candidate.value === value);
    if (next?.provider && agents.some((candidate) => candidate.id === next.provider)) {
      setProvider(next.provider);
    }
    if (next?.model && !model.trim()) setModel(next.model);
  };

  const add = async () => {
    if (!selectedProject || !selectedProvider) return;
    // Unchosen means the role's tier. Codex has no subagent model setting.
    const subagentModel =
      selectedProvider.id === 'claude' ? (routing.subagentModel ?? role?.subagentModel) : undefined;
    const authProfileId = routing.authProfileId;
    setBusy(true);
    await runLaneAction('Could not add the lane', (client) =>
      client.createLane({
        tabId,
        slot,
        projectId: selectedProject.id,
        provider: selectedProvider.id,
        ...(model.trim() ? { model: model.trim() } : {}),
        ...(role ? { roleId: role.value } : {}),
        ...(subagentModel ? { subagentModel } : {}),
        ...(authProfileId ? { authProfileId } : {}),
      })
    );
    setBusy(false);
  };

  return (
    <div
      data-testid="lane-empty-slot"
      className="flex h-full w-full items-center justify-center overflow-y-auto p-4"
    >
      <div className="flex w-full max-w-64 flex-col gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">Add a lane</div>
          <div className="text-xs text-foreground-muted">Starts an agent in its own worktree.</div>
        </div>
        {projects.length === 0 ? (
          <p className="text-xs text-foreground-muted">
            Add a project from the sidebar first, then come back here.
          </p>
        ) : (
          <Select.Root
            value={selectedProject?.id ?? ''}
            onValueChange={(next) => setProjectId(next as string)}
          >
            <Select.Trigger aria-label="Project" className="w-full">
              <Select.Value>{selectedProject?.name ?? 'Choose a project'}</Select.Value>
            </Select.Trigger>
            <Select.Content>
              {projects.map((project) => (
                <Select.Item key={project.id} value={project.id}>
                  {project.type === 'ssh' ? `${project.name} (SSH)` : project.name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        )}
        {installed && agents.length === 0 ? (
          <p className="text-xs text-foreground-muted">
            No agent is installed. Install Claude Code or Codex in Settings, then come back.
          </p>
        ) : (
          <Select.Root
            value={selectedProvider?.id ?? ''}
            onValueChange={(next) => setProvider(next as LaneProvider)}
          >
            <Select.Trigger aria-label="Agent" className="w-full">
              <Select.Value>{selectedProvider?.label ?? 'Checking agents…'}</Select.Value>
            </Select.Trigger>
            <Select.Content>
              {agents.map((candidate) => (
                <Select.Item key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        )}
        {roles.length > 0 && (
          <Select.Root value={roleValue} onValueChange={(next) => pickRole(next as string)}>
            <Select.Trigger aria-label="Role" className="w-full">
              <Select.Value>{role?.label ?? 'No role'}</Select.Value>
            </Select.Trigger>
            <Select.Content>
              <Select.Item value={NO_ROLE}>No role</Select.Item>
              {roles.map((candidate) => (
                <Select.Item key={candidate.value} value={candidate.value}>
                  {candidate.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        )}
        <Input
          aria-label="Model"
          placeholder="Model (optional, agent default)"
          value={model}
          maxLength={128}
          onChange={(event) => setModel(event.target.value)}
        />
        {selectedProvider && (
          <LaneRoutingFields
            provider={selectedProvider.id}
            value={routing}
            onChange={setRouting}
            roleSubagentModel={role?.subagentModel}
          />
        )}
        {role && (
          <p className="text-xs text-foreground-muted">
            The lane launches with this role's prompt and its pack's servers.
          </p>
        )}
        {isRemote && <p className="text-xs text-foreground-warning">{SSH_UNSUPPORTED_MESSAGE}</p>}
        <Button onClick={() => void add()} disabled={!canAdd}>
          {busy ? 'Adding…' : 'Add lane'}
        </Button>
      </div>
    </div>
  );
}
