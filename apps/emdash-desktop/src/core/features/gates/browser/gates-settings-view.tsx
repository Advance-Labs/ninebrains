import { PageLayout, SettingsRow, SettingsSection } from '@emdash/ui/react/patterns';
import { Badge, Text } from '@emdash/ui/react/primitives';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { RIGOR_TABLE, gatesAttachedAt } from '../api/rigor-table';
import { DEFAULT_GATES_SETTINGS, type GatesSettings } from '../contributions/settings';

function RigorSlider(props: {
  label: string;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={0}
        max={10}
        step={1}
        value={props.value}
        aria-label={props.label}
        disabled={props.disabled}
        onChange={(event) => props.onChange(Number(event.currentTarget.value))}
        className="w-24 accent-[var(--primary-button-background)] sm:w-40"
      />
      <Text variant="body" className="w-5 text-right text-foreground tabular-nums">
        {props.value}
      </Text>
    </div>
  );
}

function RigorTable({ testing, security }: { testing: number; security: number }) {
  const attached = gatesAttachedAt(testing, security);
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-foreground-muted">
            <th className="px-2 py-2 font-medium sm:px-3">Gate</th>
            <th className="px-2 py-2 font-medium sm:px-3">Attaches at</th>
            <th className="px-2 py-2 font-medium sm:px-3">Job kinds</th>
            <th className="px-2 py-2 font-medium sm:px-3">Now</th>
          </tr>
        </thead>
        <tbody>
          {RIGOR_TABLE.map((row) => (
            <tr key={row.gate} className="border-t border-border text-foreground">
              <td className="px-2 py-2 sm:px-3">{row.label}</td>
              <td className="px-2 py-2 tabular-nums sm:px-3">
                {row.slider === 'testing' ? 'Testing' : 'Security'} ≥ {row.threshold}
              </td>
              <td className="px-2 py-2 text-foreground-muted sm:px-3">{row.kinds}</td>
              <td className="px-2 py-2 sm:px-3">
                {attached.has(row.gate) ? (
                  <Badge tone="success">On</Badge>
                ) : (
                  <Badge variant="outline">Off</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GatesSettingsPanel(props: {
  settings: GatesSettings;
  disabled?: boolean;
  onChange: (partial: Partial<GatesSettings>) => void;
}) {
  const { testingRigor, securityRigor } = props.settings;
  return (
    <PageLayout>
      <PageLayout.Content>
        <PageLayout.Header
          title="Gates"
          description="Gates check a job's work before it reaches you. Rigor decides which gates attach to a job by default. A project can override it, and a job can only add gates, never remove them."
        />
        <div className="flex flex-col gap-6">
          <SettingsSection title="Rigor">
            <SettingsRow
              label="Testing rigor"
              description="Tests, screenshots, fact checks and the reviewer agent."
              control={
                <RigorSlider
                  label="Testing rigor"
                  value={testingRigor}
                  disabled={props.disabled}
                  onChange={(value) => props.onChange({ testingRigor: value })}
                />
              }
            />
            <SettingsRow
              label="Security rigor"
              description="At 6 or more, code and UI jobs also get a security review."
              control={
                <RigorSlider
                  label="Security rigor"
                  value={securityRigor}
                  disabled={props.disabled}
                  onChange={(value) => props.onChange({ securityRigor: value })}
                />
              }
            />
          </SettingsSection>
          <SettingsSection title="Which gates attach" bare>
            <div className="flex flex-col gap-2">
              <RigorTable testing={testingRigor} security={securityRigor} />
              <Text variant="description" tone="muted">
                A job no gate applies to finishes as unverified, never as passed. Evidence is kept
                for {props.settings.evidenceRetentionDays} days.
              </Text>
            </div>
          </SettingsSection>
        </div>
      </PageLayout.Content>
    </PageLayout>
  );
}

export function GatesSettingsView() {
  const { value, update, isLoading } = useAppSettingsKey('ninebrains.gates');
  return (
    <GatesSettingsPanel
      settings={value ?? DEFAULT_GATES_SETTINGS}
      disabled={isLoading}
      onChange={(partial) => update(partial)}
    />
  );
}
