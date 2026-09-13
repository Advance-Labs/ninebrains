import { SettingsRow, SettingsSection } from '@emdash/ui/react/patterns';
import { Button, Input, Select, Switch, Text } from '@emdash/ui/react/primitives';
import { useEffect, useState } from 'react';

export type GatesProjectOption = { id: string; name: string };

/** The project rigor override and the tests-gate sandbox opt-outs (Settings → Gates). */
export type ProjectGateSettings = {
  /** null uses the app's rigor sliders for both testing and security. */
  rigorLevel: number | null;
  allowNetwork: boolean;
  allowUnsandboxed: boolean;
};

export type TestCommandSectionProps = {
  projects: GatesProjectOption[];
  projectId: string | undefined;
  onProjectChange: (projectId: string) => void;
  /** The selected project's saved command: null when none is set, undefined while loading. */
  savedCommand: string | null | undefined;
  /** Resolves to an error message, or null once saved. */
  onSave: (command: string) => Promise<string | null>;
  /** The selected project's saved rigor and sandbox opt-outs; undefined while loading. */
  savedSettings: ProjectGateSettings | undefined;
  /** Resolves to an error message, or null once saved. */
  onSaveSettings: (settings: ProjectGateSettings) => Promise<string | null>;
  disabled?: boolean;
};

const RIGOR_LEVELS = Array.from({ length: 11 }, (_, level) => level);
const rigorSelectValue = (level: number | null) => (level === null ? 'default' : String(level));

/**
 * The tests gate's command, per project (SEC-20: only the user sets it, here). Without one, code
 * and UI jobs block as a setup problem instead of shipping unverified.
 */
export function TestCommandSection(props: TestCommandSectionProps) {
  const { projects, projectId, savedCommand, savedSettings } = props;
  const [draft, setDraft] = useState(savedCommand ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    setDraft(savedCommand ?? '');
    setError(null);
  }, [projectId, savedCommand]);

  useEffect(() => {
    setSettingsError(null);
  }, [projectId]);

  const selected = projects.find((project) => project.id === projectId);
  const busy = props.disabled || saving || savedCommand === undefined || !selected;
  const changed = draft.trim() !== (savedCommand ?? '');
  const settingsBusy = props.disabled || savingSettings || savedSettings === undefined || !selected;

  const save = async () => {
    setSaving(true);
    setError(await props.onSave(draft));
    setSaving(false);
  };

  const saveSettings = async (next: ProjectGateSettings) => {
    setSavingSettings(true);
    setSettingsError(await props.onSaveSettings(next));
    setSavingSettings(false);
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
      <SettingsRow
        label="Rigor override"
        description="Overrides the app's testing and security rigor for this project's jobs."
        control={
          <Select.Root
            value={rigorSelectValue(savedSettings?.rigorLevel ?? null)}
            onValueChange={(next) => {
              if (typeof next !== 'string' || !savedSettings) return;
              const rigorLevel = next === 'default' ? null : Number(next);
              void saveSettings({ ...savedSettings, rigorLevel });
            }}
            disabled={settingsBusy}
          >
            <Select.Trigger aria-label="Rigor override" className="w-40 shrink-0 sm:w-56">
              <Select.Value>
                {savedSettings?.rigorLevel == null ? 'Use app default' : savedSettings.rigorLevel}
              </Select.Value>
            </Select.Trigger>
            <Select.Content align="end">
              <Select.Item value="default">Use app default</Select.Item>
              {RIGOR_LEVELS.map((level) => (
                <Select.Item key={level} value={String(level)}>
                  {level}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        }
      />
      <div className="flex flex-col gap-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Text variant="body" className="text-foreground">
              Allow network
            </Text>
            <Text variant="description" tone="muted">
              Lets the test command reach the network, not just loopback.
            </Text>
            <Text variant="description" className="text-foreground-destructive">
              Warning: the test command runs lane-controlled code. With this on, it can reach the
              internet and any host on your network.
            </Text>
          </div>
          <Switch
            aria-label="Allow network"
            checked={savedSettings?.allowNetwork ?? false}
            disabled={settingsBusy}
            onCheckedChange={(checked) => {
              if (!savedSettings) return;
              void saveSettings({ ...savedSettings, allowNetwork: checked });
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Text variant="body" className="text-foreground">
              Allow unsandboxed
            </Text>
            <Text variant="description" tone="muted">
              Runs the test command without an OS sandbox where none is available (Linux without
              bubblewrap, or Windows).
            </Text>
            <Text variant="description" className="text-foreground-destructive">
              Warning: with no sandbox, the test command runs as your user with only a scrubbed
              environment and a timeout. It can read your files and reach the network.
            </Text>
          </div>
          <Switch
            aria-label="Allow unsandboxed"
            checked={savedSettings?.allowUnsandboxed ?? false}
            disabled={settingsBusy}
            onCheckedChange={(checked) => {
              if (!savedSettings) return;
              void saveSettings({ ...savedSettings, allowUnsandboxed: checked });
            }}
          />
        </div>
        {settingsError ? (
          <Text variant="description" className="text-foreground-destructive">
            {settingsError}
          </Text>
        ) : null}
      </div>
    </SettingsSection>
  );
}
