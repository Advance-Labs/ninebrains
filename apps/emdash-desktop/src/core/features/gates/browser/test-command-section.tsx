import { SettingsRow, SettingsSection } from '@emdash/ui/react/patterns';
import { Button, Input, Select, Text } from '@emdash/ui/react/primitives';
import { useEffect, useState } from 'react';

export type GatesProjectOption = { id: string; name: string };

export type TestCommandSectionProps = {
  projects: GatesProjectOption[];
  projectId: string | undefined;
  onProjectChange: (projectId: string) => void;
  /** The selected project's saved command: null when none is set, undefined while loading. */
  savedCommand: string | null | undefined;
  /** Resolves to an error message, or null once saved. */
  onSave: (command: string) => Promise<string | null>;
  disabled?: boolean;
};

/**
 * The tests gate's command, per project (SEC-20: only the user sets it, here). Without one, code
 * and UI jobs block as a setup problem instead of shipping unverified.
 */
export function TestCommandSection(props: TestCommandSectionProps) {
  const { projects, projectId, savedCommand } = props;
  const [draft, setDraft] = useState(savedCommand ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(savedCommand ?? '');
    setError(null);
  }, [projectId, savedCommand]);

  const selected = projects.find((project) => project.id === projectId);
  const busy = props.disabled || saving || savedCommand === undefined || !selected;
  const changed = draft.trim() !== (savedCommand ?? '');

  const save = async () => {
    setSaving(true);
    setError(await props.onSave(draft));
    setSaving(false);
  };

  return (
    <SettingsSection title="Tests">
      <SettingsRow
        label="Project"
        description="Test commands are set per project."
        control={
          <Select.Root
            value={projectId ?? null}
            onValueChange={(next) => typeof next === 'string' && props.onProjectChange(next)}
            disabled={props.disabled || projects.length === 0}
          >
            <Select.Trigger aria-label="Project" className="w-40 shrink-0 sm:w-56">
              <Select.Value>{selected?.name ?? 'No project'}</Select.Value>
            </Select.Trigger>
            <Select.Content align="end">
              {projects.map((project) => (
                <Select.Item key={project.id} value={project.id}>
                  {project.name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        }
      />
      <div className="flex flex-col gap-2 py-2">
        <Text variant="body" className="text-foreground">
          Test command
        </Text>
        <Text variant="description" tone="muted">
          Runs in the lane&apos;s worktree when a code or UI job finishes, for example{' '}
          <code>pnpm test</code>. Without one, those jobs block until you set it here.
        </Text>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label="Test command"
            value={draft}
            placeholder="pnpm test"
            className="min-w-0 flex-1 font-mono text-sm"
            disabled={busy}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && changed && !busy) void save();
            }}
          />
          <Button onClick={() => void save()} disabled={busy || !changed}>
            Save test command
          </Button>
        </div>
        {error ? (
          <Text variant="description" className="text-foreground-destructive">
            {error}
          </Text>
        ) : savedCommand === null && selected ? (
          <Text variant="description" tone="muted">
            Not set for {selected.name}: its code and UI jobs will block.
          </Text>
        ) : null}
      </div>
    </SettingsSection>
  );
}
