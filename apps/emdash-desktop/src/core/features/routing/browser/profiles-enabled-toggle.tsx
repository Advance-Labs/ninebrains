import { Switch, Text } from '@emdash/ui/react/primitives';

/**
 * T47 (`docs/plans/2026-09-15-routing-usability.md`): the toggle a user flips to turn Lever B
 * (model profiles, your own API keys) on. Off by default; the warning sits next to it, once, the
 * same convention Settings → Gates uses for its sandbox opt-outs, rather than a toast or a dialog
 * that would nag on every visit.
 */
export function ProfilesEnabledToggle({
  enabled,
  disabled,
  onChange,
}: {
  enabled: boolean;
  disabled?: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-3"
      data-testid="profiles-enabled-toggle"
    >
      <div className="flex flex-col gap-1">
        <Text variant="body" className="text-foreground">
          Model profiles
        </Text>
        <Text variant="description" tone="muted">
          Use your own API keys for cheaper models, instead of your subscription login.
        </Text>
        <Text variant="description" className="text-foreground-destructive">
          Warning: once on, a key you add below is used for real API calls at that vendor, billed to
          you. Turning this on by itself changes nothing — every lane and reviewer still runs on
          your subscription until you add a profile.
        </Text>
      </div>
      <Switch
        aria-label="Model profiles"
        checked={enabled}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}
