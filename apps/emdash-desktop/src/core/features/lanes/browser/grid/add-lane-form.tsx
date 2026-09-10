import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { Button, Select } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useAgentInstallationStatuses } from '@core/features/agents/api/browser/use-agent-installation-statuses';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { SSH_UNSUPPORTED_MESSAGE, type LaneProvider, type LaneSlot } from '../../api';
import { runLaneAction } from '../use-lanes';

const PROVIDERS: { id: LaneProvider; label: string }[] = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
];

/** Empty-slot state: pick a project and an installed agent, then add a lane. */
export const AddLaneForm = observer(function AddLaneForm({
  tabId,
  slot,
}: {
  tabId: string;
  slot: LaneSlot;
}) {
  const projects = [...getProjectManagerStore().projects.values()].flatMap((store) =>
    store.data ? [store.data] : []
  );
  const { data: statuses } = useAgentInstallationStatuses(LOCAL_HOST_REF);
  const installed = PROVIDERS.filter((provider) =>
    statuses?.some((status) => status.id === provider.id && status.status === 'available')
  );
  const [projectId, setProjectId] = useState<string | undefined>();
  const [provider, setProvider] = useState<LaneProvider | undefined>();
  const [busy, setBusy] = useState(false);

  const selectedProject =
    projects.find((project) => project.id === projectId) ??
    projects.find((project) => project.type === 'local');
  const selectedProvider = installed.find((candidate) => candidate.id === provider) ?? installed[0];
  const isRemote = selectedProject?.type === 'ssh';
  const canAdd = Boolean(selectedProject && selectedProvider && !isRemote && !busy);

  const add = async () => {
    if (!selectedProject || !selectedProvider) return;
    setBusy(true);
    await runLaneAction('Could not add the lane', (client) =>
      client.createLane({
        tabId,
        slot,
        projectId: selectedProject.id,
        provider: selectedProvider.id,
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
        {statuses && installed.length === 0 ? (
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
              {installed.map((candidate) => (
                <Select.Item key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        )}
        {isRemote && <p className="text-xs text-foreground-warning">{SSH_UNSUPPORTED_MESSAGE}</p>}
        <Button onClick={() => void add()} disabled={!canAdd}>
          {busy ? 'Adding…' : 'Add lane'}
        </Button>
      </div>
    </div>
  );
});
